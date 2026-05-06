'use strict';
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const db      = require('../database/db');
const { authMiddleware, requirePermission, requireRole, logAction, getSecret } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { notEmpty, sanitize } = require('../utils/validate');

// Avatar upload
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname,'..','public','uploads','avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true});
    cb(null,dir);
  },
  filename: (req, file, cb) => cb(null, `avatar-${req.user?.id||Date.now()}${path.extname(file.originalname).toLowerCase()}`)
});
const uploadAvatar = multer({ storage:avatarStorage, limits:{fileSize:2*1024*1024}, fileFilter:(req,f,cb)=>{ if(['.jpg','.jpeg','.png','.webp'].includes(path.extname(f.originalname).toLowerCase())) cb(null,true); else cb(new Error('نوع غير مدعوم')); } });

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!notEmpty(phone)||!notEmpty(password)) return fail(res,'الهاتف وكلمة المرور مطلوبان');

    const user = db.prepare("SELECT * FROM users WHERE phone=? AND is_active=1").get(sanitize(phone));
    if (!user || !bcrypt.compareSync(password, user.password))
      return fail(res,'بيانات الدخول غير صحيحة',401);

    if (user.status === 'suspended' || user.status === 'resigned')
      return fail(res,'الحساب موقوف أو مُنهى',401);

    // Check active leave
    const now = new Date().toISOString();
    const activeLeave = db.prepare(
      "SELECT id FROM leave_requests WHERE user_id=? AND status='approved' AND start_at<=? AND end_at>=?"
    ).get(user.id, now, now);
    if (activeLeave) return fail(res,'أنت في إجازة حالياً',401);

    const sessionHours = parseInt(db.prepare("SELECT value FROM settings WHERE key='session_hours'").get()?.value||'12');
    const token = jwt.sign({ id:user.id, role:user.role }, getSecret(), { expiresIn: `${sessionHours}h` });

    // Register session
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0,16);
    db.prepare("INSERT INTO sessions (user_id,token_hash,ip,user_agent) VALUES (?,?,?,?)")
      .run(user.id, tokenHash, req.ip, req.headers['user-agent']?.slice(0,200)||'');

    // Record attendance login
    db.prepare("UPDATE attendance SET logout_time=CURRENT_TIMESTAMP WHERE user_id=? AND logout_time IS NULL").run(user.id);
    db.prepare("INSERT INTO attendance (user_id) VALUES (?)").run(user.id);

    logAction({ user, ip:req.ip }, 'LOGIN', 'users', user.id);
    // Build flat permissions list for this user
    const userPerms = _getUserPermissions(user.id, user.role);

    ok(res, {
      token,
      user: {
        id:          user.id,
        name:        user.name,
        phone:       user.phone,
        role:        user.role,
        avatar_url:  user.avatar_url,
        timezone:    user.timezone,
        permissions: userPerms
      }
    }, 'تم تسجيل الدخول');
  } catch(e){ err(res,e,'POST /auth/login'); }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const permissions = _getUserPermissions(req.user.id, req.user.role);
  ok(res, { ...req.user, permissions });
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (req, res) => {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) {
    const h = crypto.createHash('sha256').update(token).digest('hex').slice(0,16);
    db.prepare("UPDATE sessions SET is_valid=0 WHERE user_id=? AND token_hash=?").run(req.user.id, h);
  }
  db.prepare("UPDATE attendance SET logout_time=CURRENT_TIMESTAMP WHERE user_id=? AND logout_time IS NULL").run(req.user.id);
  logAction(req,'LOGOUT','users',req.user.id);
  ok(res,null,'تم تسجيل الخروج');
});

// ── Users CRUD ────────────────────────────────────────────────────────────────
router.get('/users', authMiddleware, requirePermission('users.view'), (req, res) => {
  try {
    const users = db.prepare('SELECT id,name,phone,role,status,is_active,avatar_url,timezone,created_at FROM users ORDER BY created_at DESC').all();
    ok(res, users);
  } catch(e){ err(res,e,'GET /auth/users'); }
});

router.post('/users', authMiddleware, requirePermission('users.manage'), (req, res) => {
  try {
    const { name, phone, password, role } = req.body;
    const validRoles = ['admin','manager','accountant','employee','developer'];
    if (!notEmpty(name)||!notEmpty(phone)||!notEmpty(password)) return fail(res,'الاسم والهاتف وكلمة المرور مطلوبة');
    if (!validRoles.includes(role)) return fail(res,'الدور غير صالح');
    if (db.prepare('SELECT id FROM users WHERE phone=?').get(sanitize(phone))) return fail(res,'رقم الهاتف مسجل');
    const r = db.prepare("INSERT INTO users (name,phone,password,role) VALUES (?,?,?,?)").run(sanitize(name),sanitize(phone),bcrypt.hashSync(password,12),role);
    logAction({ user:req.user, ip:req.ip },'CREATE_USER','users',r.lastInsertRowid,{name,phone,role});
    ok(res,{id:r.lastInsertRowid},'تم إنشاء المستخدم',201);
  } catch(e){ err(res,e,'POST /auth/users'); }
});

router.put('/users/:id', authMiddleware, requirePermission('users.manage'), (req, res) => {
  try {
    const { name, phone, password, role, is_active, status, timezone } = req.body;
    const validRoles=['admin','manager','accountant','employee','developer'];
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id)) return fail(res,'المستخدم غير موجود',404);
    if (role && !validRoles.includes(role)) return fail(res,'الدور غير صالح');
    const f=[],v=[];
    if (notEmpty(name))  { f.push('name=?');     v.push(sanitize(name)); }
    if (notEmpty(phone)) { f.push('phone=?');    v.push(sanitize(phone)); }
    if (role)            { f.push('role=?');     v.push(role); }
    if (status)          { f.push('status=?');   v.push(status); }
    if (timezone)        { f.push('timezone=?'); v.push(timezone); }
    if (is_active!==undefined){ f.push('is_active=?'); v.push(is_active?1:0); }
    if (notEmpty(password)){ f.push('password=?'); v.push(bcrypt.hashSync(password,12)); }
    if (f.length){ v.push(req.params.id); db.prepare(`UPDATE users SET ${f.join(',')} WHERE id=?`).run(...v); }
    ok(res,null,'تم التحديث');
  } catch(e){ err(res,e,'PUT /auth/users/:id'); }
});

router.delete('/users/:id', authMiddleware, requirePermission('users.manage'), (req, res) => {
  try {
    if (parseInt(req.params.id)===req.user.id) return fail(res,'لا يمكنك حذف حسابك');
    if (!db.prepare('DELETE FROM users WHERE id=?').run(req.params.id).changes) return fail(res,'المستخدم غير موجود',404);
    ok(res,null,'تم الحذف');
  } catch(e){ err(res,e,'DELETE /auth/users/:id'); }
});

// PUT force logout a user
router.put('/users/:id/force-logout', authMiddleware, requirePermission('users.manage'), (req, res) => {
  try {
    db.prepare("UPDATE users SET force_logout=1 WHERE id=?").run(req.params.id);
    db.prepare("UPDATE sessions SET is_valid=0 WHERE user_id=?").run(req.params.id);
    db.prepare("UPDATE attendance SET logout_time=CURRENT_TIMESTAMP WHERE user_id=? AND logout_time IS NULL").run(req.params.id);
    logAction(req,'FORCE_LOGOUT','users',parseInt(req.params.id));
    ok(res,null,'تم تسجيل خروج المستخدم');
  } catch(e){ err(res,e,'PUT /auth/users/:id/force-logout'); }
});

// GET active sessions
router.get('/sessions', authMiddleware, requirePermission('users.manage'), (req, res) => {
  try {
    const data = db.prepare(`
      SELECT s.*, u.name, u.role FROM sessions s JOIN users u ON s.user_id=u.id
      WHERE s.is_valid=1 AND s.last_seen >= datetime('now','-1 hour')
      ORDER BY s.last_seen DESC`).all();
    ok(res,data);
  } catch(e){ err(res,e,'GET /auth/sessions'); }
});

// PUT update own profile
router.put('/me', authMiddleware, uploadAvatar.single('avatar'), (req, res) => {
  try {
    const { name, timezone } = req.body;
    const f=[],v=[];
    if (notEmpty(name)) { f.push('name=?'); v.push(sanitize(name)); }
    if (timezone)       { f.push('timezone=?'); v.push(timezone); }
    if (req.file)       { f.push('avatar_url=?'); v.push(`/uploads/avatars/${req.file.filename}`); }
    if (f.length){ v.push(req.user.id); db.prepare(`UPDATE users SET ${f.join(',')} WHERE id=?`).run(...v); }
    ok(res,null,'تم تحديث الملف الشخصي');
  } catch(e){ err(res,e,'PUT /auth/me'); }
});

// PUT change own password
router.put('/me/password', authMiddleware, (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password||new_password.length<6) return fail(res,'كلمة المرور الجديدة يجب 6 أحرف+');
    if (!/[A-Z0-9@#$%!]/.test(new_password)) return fail(res,'كلمة المرور ضعيفة — استخدم حرفاً كبيراً أو رمزاً');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!bcrypt.compareSync(current_password, user.password)) return fail(res,'كلمة المرور الحالية غير صحيحة');
    db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(new_password,12),req.user.id);
    logAction(req,'CHANGE_PASSWORD','users',req.user.id);
    ok(res,null,'تم التغيير');
  } catch(e){ err(res,e,'PUT /auth/me/password'); }
});

// ── Permission helper (shared with login + /me) ──────────────────────────────
// Reads dot-notation keys from role_permissions + user_permissions tables
// (matches what requirePermission() checks against)
function _getUserPermissions(userId, role) {
  // 1. Load role defaults from DB (dot-notation keys, e.g. 'users.view')
  const base = new Set();
  try {
    db.prepare(
      "SELECT permission FROM role_permissions WHERE role=? AND allowed=1"
    ).all(role).forEach(r => base.add(r.permission));
  } catch {}

  // 2. Apply per-user overrides
  try {
    db.prepare(
      "SELECT permission, allowed FROM user_permissions WHERE user_id=?"
    ).all(userId).forEach(({ permission, allowed }) => {
      if (allowed) base.add(permission);
      else         base.delete(permission);
    });
  } catch {}

  return [...base];
}

module.exports = router;
