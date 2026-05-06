'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { sanitize, safeInt } = require('../utils/validate');

router.use(authMiddleware);

// GET leave requests
router.get('/', requirePermission('leave.request'), (req, res) => {
  try {
    const canManage = db.userHasPerm(req.user.id,'leave.manage');
    const { status='', page=1, limit=50 } = req.query;
    const pg=Math.max(1,safeInt(page,1)), lim=Math.min(100,safeInt(limit,50));
    let where=canManage?'WHERE 1=1':'WHERE lr.user_id=?';
    const params=canManage?[]:[req.user.id];
    if(status){where+=' AND lr.status=?';params.push(status);}
    const total=db.prepare(`SELECT COUNT(*) as c FROM leave_requests lr ${where}`).get(...params)?.c||0;
    const data=db.prepare(`
      SELECT lr.*, u.name as user_name, a.name as approver_name
      FROM leave_requests lr
      LEFT JOIN users u ON lr.user_id=u.id
      LEFT JOIN users a ON lr.approved_by=a.id
      ${where} ORDER BY lr.created_at DESC LIMIT ? OFFSET ?
    `).all(...params,lim,(pg-1)*lim);
    res.json({success:true,data,pagination:{page:pg,limit:lim,total,pages:Math.ceil(total/lim)}});
  } catch(e){ err(res,e,'GET /leave'); }
});

// POST submit leave request
router.post('/', requirePermission('leave.request'), (req, res) => {
  try {
    const { type='leave', reason='', start_at, end_at, hours } = req.body;
    if (!start_at || !end_at) return fail(res,'تاريخ البدء والانتهاء مطلوبان');
    if (new Date(end_at) < new Date(start_at)) return fail(res,'تاريخ الانتهاء يجب أن يكون بعد البدء');
    const r = db.prepare("INSERT INTO leave_requests (user_id,type,reason,start_at,end_at,hours) VALUES (?,?,?,?,?,?)")
      .run(req.user.id, type, sanitize(reason), start_at, end_at, hours||null);
    // Notify admins/managers
    db.prepare(`INSERT INTO notifications (message,created_by,show_author,target_role,end_at)
      VALUES (?,?,1,'admin',datetime('now','+48 hours'))`
    ).run(`طلب ${type==='leave'?'إجازة':'إذن'} من ${req.user.name}`, req.user.id);
    ok(res,{id:r.lastInsertRowid},'تم إرسال طلب الإجازة',201);
  } catch(e){ err(res,e,'POST /leave'); }
});

// PUT approve/reject
router.put('/:id', requirePermission('leave.request'), (req, res) => {
  try {
    const { status, start_at, end_at } = req.body;
    const lr = db.prepare('SELECT * FROM leave_requests WHERE id=?').get(req.params.id);
    if (!lr) return fail(res,'الطلب غير موجود',404);
    const fields=['status=?','approved_by=?'], vals=[status, req.user.id];
    if(start_at){ fields.push('start_at=?'); vals.push(start_at); }
    if(end_at)  { fields.push('end_at=?');   vals.push(end_at); }
    vals.push(req.params.id);
    db.prepare(`UPDATE leave_requests SET ${fields.join(',')} WHERE id=?`).run(...vals);

    // If approved → update user status
    if (status==='approved') {
      db.prepare("UPDATE users SET status='on_leave' WHERE id=?").run(lr.user_id);
    } else if (status==='rejected') {
      db.prepare("UPDATE users SET status='active' WHERE id=? AND status='on_leave'").run(lr.user_id);
    }
    // Notify requester
    db.prepare(`INSERT INTO notifications (message,created_by,show_author,target_user,end_at)
      VALUES (?,?,0,?,datetime('now','+24 hours'))`
    ).run(`تم ${status==='approved'?'قبول':'رفض'} طلب إجازتك`, req.user.id, lr.user_id);
    logAction(req,'HANDLE_LEAVE','leave_requests',parseInt(req.params.id),{status});
    ok(res,null,'تم التحديث');
  } catch(e){ err(res,e,'PUT /leave/:id'); }
});

module.exports = router;
