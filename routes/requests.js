'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { sanitize, safeInt } = require('../utils/validate');

router.use(authMiddleware);

// GET requests
router.get('/', requirePermission('requests.view'), (req, res) => {
  try {
    const { status='', page=1, limit=50 } = req.query;
    const canManage = db.userHasPerm(req.user.id,'requests.manage');
    const pg=Math.max(1,safeInt(page,1)), lim=Math.min(100,safeInt(limit,50));

    let where = canManage ? 'WHERE 1=1' : 'WHERE r.user_id=?';
    const params = canManage ? [] : [req.user.id];
    if (status) { where += ' AND r.status=?'; params.push(status); }

    const total = db.prepare(`SELECT COUNT(*) as c FROM requests r ${where}`).get(...params)?.c||0;
    const data  = db.prepare(`
      SELECT r.*, u.name as user_name, h.name as handler_name
      FROM requests r
      LEFT JOIN users u ON r.user_id=u.id
      LEFT JOIN users h ON r.handled_by=h.id
      ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, lim, (pg-1)*lim);

    res.json({ success:true, data, pagination:{ page:pg,limit:lim,total,pages:Math.ceil(total/lim) } });
  } catch(e) { err(res,e,'GET /requests'); }
});

// POST create request
router.post('/', requirePermission('requests.view'), (req, res) => {
  try {
    const { type='request', title, description='' } = req.body;
    if (!title?.trim()) return fail(res,'عنوان الطلب مطلوب');
    const r = db.prepare("INSERT INTO requests (user_id,type,title,description) VALUES (?,?,?,?)")
      .run(req.user.id, type, sanitize(title), sanitize(description));
    // Notify all admins/managers
    db.prepare(`INSERT INTO notifications (message, created_by, show_author, target_role, end_at)
      VALUES (?,?,1,'admin',datetime('now','+48 hours'))`
    ).run(`طلب جديد من ${req.user.name}: ${title}`, req.user.id);
    ok(res,{id:r.lastInsertRowid},'تم إرسال الطلب',201);
  } catch(e) { err(res,e,'POST /requests'); }
});

// PUT handle request (admin/manager)
router.put('/:id', requirePermission('requests.view'), (req, res) => {
  try {
    const { status, response='' } = req.body;
    const req2 = db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
    if (!req2) return fail(res,'الطلب غير موجود',404);
    db.prepare("UPDATE requests SET status=?,response=?,handled_by=? WHERE id=?")
      .run(status, sanitize(response), req.user.id, req.params.id);
    // Notify requester
    db.prepare(`INSERT INTO notifications (message, created_by, show_author, target_user, end_at)
      VALUES (?,?,0,?,datetime('now','+24 hours'))`
    ).run(`تم ${status==='approved'?'قبول':'رفض'} طلبك: ${req2.title}`, req.user.id, req2.user_id);
    logAction(req,'HANDLE_REQUEST','requests',parseInt(req.params.id),{status});
    ok(res,null,'تم تحديث الطلب');
  } catch(e) { err(res,e,'PUT /requests/:id'); }
});

// DELETE
router.delete('/:id', requirePermission('requests.view'), (req, res) => {
  try {
    db.prepare('DELETE FROM requests WHERE id=?').run(req.params.id);
    ok(res,null,'تم الحذف');
  } catch(e) { err(res,e,'DELETE /requests/:id'); }
});

module.exports = router;
