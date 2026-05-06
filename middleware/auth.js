'use strict';
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../database/db');

const getSecret = () =>
  db.prepare("SELECT value FROM settings WHERE key='jwt_secret'").get()?.value ||
  process.env.JWT_SECRET || 'masar_fallback';

// ── Live permissions from DB (dot-notation keys, e.g. 'users.manage') ─────────
// Reads role_permissions + user_permissions — no hardcoded map, always in sync.
function getUserPerms(userId, role) {
  const base = new Set();
  try {
    db.prepare("SELECT permission FROM role_permissions WHERE role=? AND allowed=1")
      .all(role).forEach(r => base.add(r.permission));
  } catch {}
  try {
    db.prepare("SELECT permission, allowed FROM user_permissions WHERE user_id=?")
      .all(userId).forEach(({ permission, allowed }) => {
        if (allowed) base.add(permission);
        else         base.delete(permission);
      });
  } catch {}
  return base;
}

// ── Verify JWT ────────────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
if (req.query.token && !req.headers.authorization) {
  req.headers.authorization = `Bearer ${req.query.token}`;
}
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token)
    return res.status(401).json({ success: false, message: 'غير مصرح — سجّل دخولك أولاً' });
  try {
    const decoded = jwt.verify(token, getSecret());
    const user = db.prepare(
      'SELECT id, name, phone, role, status, is_active, force_logout, avatar_url, timezone FROM users WHERE id=?'
    ).get(decoded.id);

    if (!user || !user.is_active || user.status === 'suspended' || user.status === 'resigned')
      return res.status(401).json({ success: false, message: 'الحساب غير موجود أو موقوف' });

    if (user.force_logout) {
      db.prepare("UPDATE users SET force_logout=0 WHERE id=?").run(user.id);
      return res.status(401).json({ success: false, message: 'تم تسجيل خروجك من قبل المدير' });
    }

    if (user.status === 'on_leave') {
      const now = new Date().toISOString();
      const activeLeave = db.prepare(
        "SELECT id FROM leave_requests WHERE user_id=? AND status='approved' AND start_at<=? AND end_at>=?"
      ).get(user.id, now, now);
      if (activeLeave)
        return res.status(401).json({ success: false, message: 'أنت في إجازة حالياً — تواصل مع الإدارة' });
    }

    req.user  = user;
    req.perms = getUserPerms(user.id, user.role);

    // Non-blocking session heartbeat
    try {
      const h = crypto.createHash('sha256').update(token).digest('hex').slice(0,16);
      db.prepare("UPDATE sessions SET last_seen=CURRENT_TIMESTAMP WHERE user_id=? AND token_hash=? AND is_valid=1").run(user.id, h);
    } catch {}

    next();
  } catch (e) {
    const msg = e.name === 'TokenExpiredError'
      ? 'انتهت صلاحية الجلسة — سجّل دخولك مجدداً'
      : 'Token غير صالح';
    return res.status(401).json({ success: false, message: msg });
  }
}

// ── requirePermission — checks flat UPPERCASE key ─────────────────────────────
function requirePermission(permKey) {
  return (req, res, next) => {
    if (!req.user)  return res.status(401).json({ success: false, message: 'غير مصرح' });
    if (!req.perms?.has(permKey))
      return res.status(403).json({ success: false, message: `ليس لديك صلاحية: ${permKey}` });
    next();
  };
}

// ── requireRole (kept for compatibility) ─────────────────────────────────────
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: 'غير مصرح' });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ success: false, message: `يتطلب: ${roles.join(' أو ')}` });
    next();
  };
}

// ── Audit logger ──────────────────────────────────────────────────────────────
function logAction(req, action, entity = null, entityId = null, details = null, snapshot = null) {
  try {
    db.prepare(`
      INSERT INTO logs (user_id, user_name, action, entity, entity_id, details, snapshot, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user?.id   || null,
      req.user?.name || 'system',
      action, entity, entityId || null,
      details  ? JSON.stringify(details)  : null,
      snapshot ? JSON.stringify(snapshot) : null,
      req.ip || null
    );
  } catch {}
}

module.exports = { authMiddleware, requirePermission, requireRole, logAction, getSecret, getUserPerms };
