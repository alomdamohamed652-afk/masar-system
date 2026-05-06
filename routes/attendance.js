'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { safeInt } = require('../utils/validate');

router.use(authMiddleware);

// POST heartbeat (called every 30-60s from frontend)
router.post('/heartbeat', (req, res) => {
  try {
    const { is_idle = 0 } = req.body;
    const idle = is_idle ? 1 : 0;

    // Find current open session
    let session = db.prepare(
      "SELECT * FROM attendance WHERE user_id=? AND logout_time IS NULL ORDER BY login_time DESC LIMIT 1"
    ).get(req.user.id);

    if (!session) {
      // Auto-create session if missing
      db.prepare("INSERT INTO attendance (user_id) VALUES (?)").run(req.user.id);
      session = db.prepare("SELECT * FROM attendance WHERE user_id=? AND logout_time IS NULL ORDER BY login_time DESC LIMIT 1").get(req.user.id);
    }

    const now     = Date.now();
    const lastMs  = new Date(session.last_active).getTime();
    const diffSec = Math.round((now - lastMs) / 1000);

    db.prepare(`
      UPDATE attendance SET
        last_active     = CURRENT_TIMESTAMP,
        total_seconds   = total_seconds + ?,
        idle_seconds    = idle_seconds  + ?,
        active_seconds  = active_seconds + ?
      WHERE id = ?
    `).run(diffSec, idle ? diffSec : 0, idle ? 0 : diffSec, session.id);

    ok(res, null, 'ok');
  } catch(e) { err(res,e,'POST /attendance/heartbeat'); }
});

// POST login record (called on login)
router.post('/login', (req, res) => {
  try {
    // Close any orphaned sessions for this user
    db.prepare("UPDATE attendance SET logout_time=CURRENT_TIMESTAMP WHERE user_id=? AND logout_time IS NULL").run(req.user.id);
    const r = db.prepare("INSERT INTO attendance (user_id) VALUES (?)").run(req.user.id);
    ok(res,{id:r.lastInsertRowid});
  } catch(e) { err(res,e,'POST /attendance/login'); }
});

// POST logout record
router.post('/logout', (req, res) => {
  try {
    db.prepare("UPDATE attendance SET logout_time=CURRENT_TIMESTAMP WHERE user_id=? AND logout_time IS NULL").run(req.user.id);
    ok(res, null, 'ok');
  } catch(e) { err(res,e,'POST /attendance/logout'); }
});

// GET who is online (last heartbeat < 3 minutes ago)
router.get('/online', requirePermission('settings.manage'), (req, res) => {
  try {
    const data = db.prepare(`
      SELECT a.user_id, u.name, u.role, u.avatar_url,
             a.login_time, a.last_active,
             a.total_seconds, a.active_seconds, a.idle_seconds
      FROM attendance a JOIN users u ON a.user_id=u.id
      WHERE a.logout_time IS NULL
        AND a.last_active >= datetime('now','-3 minutes')
      ORDER BY a.last_active DESC
    `).all();
    ok(res, data);
  } catch(e) { err(res,e,'GET /attendance/online'); }
});

// GET attendance report
router.get('/', requirePermission('settings.manage'), (req, res) => {
  try {
    const { user_id, from, to, page=1, limit=50 } = req.query;
    const pg=Math.max(1,safeInt(page,1)), lim=Math.min(200,safeInt(limit,50));
    let where='WHERE a.logout_time IS NOT NULL'; const params=[];
    if (user_id){ where+=' AND a.user_id=?'; params.push(safeInt(user_id)); }
    if (from)   { where+=' AND DATE(a.login_time)>=?'; params.push(from); }
    if (to)     { where+=' AND DATE(a.login_time)<=?'; params.push(to); }
    const total=db.prepare(`SELECT COUNT(*) as c FROM attendance a ${where}`).get(...params)?.c||0;
    const data=db.prepare(`
      SELECT a.*, u.name as user_name, u.role
      FROM attendance a JOIN users u ON a.user_id=u.id
      ${where} ORDER BY a.login_time DESC LIMIT ? OFFSET ?
    `).all(...params, lim, (pg-1)*lim);
    res.json({success:true,data,pagination:{page:pg,limit:lim,total,pages:Math.ceil(total/lim)}});
  } catch(e){ err(res,e,'GET /attendance'); }
});

module.exports = router;
