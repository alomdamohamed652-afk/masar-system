'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, requireRole, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { safeFloat, notEmpty, sanitize } = require('../utils/validate');

router.use(authMiddleware, requirePermission('expenses.view'));

router.get('/', (req, res) => {
  try {
    const { from='', to='', page=1, limit=50 } = req.query;
    const pg = Math.max(1,parseInt(page)||1), lim = Math.min(200,parseInt(limit)||50);
    let w='WHERE 1=1'; const p=[];
    if (from){ w+=' AND DATE(created_at)>=?'; p.push(from); }
    if (to)  { w+=' AND DATE(created_at)<=?'; p.push(to); }
    const total = db.prepare(`SELECT COUNT(*) as c FROM expenses ${w}`).get(...p)?.c||0;
    const data  = db.prepare(`SELECT * FROM expenses ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...p,lim,(pg-1)*lim);
    res.json({ success:true, data, pagination:{ page:pg,limit:lim,total,pages:Math.ceil(total/lim) } });
  } catch(e){ err(res,e,'GET /expenses'); }
});

router.post('/', requireRole('admin','accountant'), (req, res) => {
  try {
    const { type, details, amount } = req.body;
    if (!notEmpty(type)) return fail(res,'نوع المصروف مطلوب');
    if (safeFloat(amount) <= 0) return fail(res,'المبلغ يجب أن يكون أكبر من صفر');
    const r = db.prepare('INSERT INTO expenses (type,details,amount,created_by) VALUES (?,?,?,?)').run(sanitize(type), sanitize(details), safeFloat(amount), req.user.id);
    logAction(req,'CREATE_EXPENSE','expenses',r.lastInsertRowid,{type,amount});
    ok(res,{id:r.lastInsertRowid},'تم تسجيل المصروف',201);
  } catch(e){ err(res,e,'POST /expenses'); }
});

router.delete('/:id', requireRole('admin','accountant'), (req, res) => {
  try {
    const exp = db.prepare('SELECT * FROM expenses WHERE id=?').get(req.params.id);
    if (!exp) return fail(res,'المصروف غير موجود',404);
    db.prepare('DELETE FROM expenses WHERE id=?').run(req.params.id);
    logAction(req,'DELETE_EXPENSE','expenses',parseInt(req.params.id),null,exp);
    ok(res,null,'تم الحذف');
  } catch(e){ err(res,e,'DELETE /expenses/:id'); }
});

module.exports = router;
