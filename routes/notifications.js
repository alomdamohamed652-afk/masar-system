'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { sanitize } = require('../utils/validate');

// ── SSE client registry ───────────────────────────────────────────────────────
// Map of userId → Set of SSE response objects
// Supports multiple tabs per user (each tab = one res in the Set)
const _sseClients = new Map();

/**
 * pushOrderNotification
 * Broadcasts a new-order event to every connected SSE client.
 * Safe to call with zero clients — forEach on empty Map is a no-op.
 * Each res.write is wrapped in try/catch — a dead connection never crashes the broadcast.
 */
function pushOrderNotification(payload) {
  const msg = `data: ${JSON.stringify({ type: 'new_order', payload })}\n\n`;
  _sseClients.forEach((clients) => {
    clients.forEach(res => {
      try { res.write(msg); } catch (_) { /* silent — dead client, will be evicted on next heartbeat or close */ }
    });
  });
}

// ── Auth + routes ─────────────────────────────────────────────────────────────
router.use(authMiddleware);

// ── GET /stream — SSE endpoint ────────────────────────────────────────────────
router.get('/stream', (req, res) => {
  const user    = req.user;
  const isAdmin = user.role === 'admin';
  const perms   = Array.isArray(user.permissions) ? user.permissions : [];

  if (!isAdmin && !perms.includes('orders.view')) {
    return res.status(403).json({ success: false, message: 'غير مسموح' });
  }

  // SSE headers — must be set before any write
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering
  res.flushHeaders();

  // Heartbeat every 25s — keeps connection alive through proxies and load balancers
  // On write failure: evict the dead client immediately (don't wait for 'close' event
  // which may not fire in all proxy/timeout/network-drop scenarios)
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (_) {
      clearInterval(heartbeat);
      const set = _sseClients.get(user.id);
      if (set) {
        set.delete(res);
        if (set.size === 0) _sseClients.delete(user.id);
      }
    }
  }, 25000);

  // Register client — one Set per userId, supports multiple tabs
  if (!_sseClients.has(user.id)) _sseClients.set(user.id, new Set());
  _sseClients.get(user.id).add(res);

  // Handshake — lets frontend confirm the connection is live
  res.write(`data: ${JSON.stringify({ type: 'connected', userId: user.id })}\n\n`);

  // Primary cleanup path — fires on normal browser disconnect / page close
  req.on('close', () => {
    clearInterval(heartbeat);
    const set = _sseClients.get(user.id);
    if (set) {
      set.delete(res);
      if (set.size === 0) _sseClients.delete(user.id);
    }
  });
});

// ── GET /active — active notifications for current user ───────────────────────
router.get('/active', (req, res) => {
  try {
    const now = new Date().toISOString();
    const data = db.prepare(`
      SELECT n.*, u.name as author_name
      FROM notifications n
      LEFT JOIN users u ON n.created_by = u.id
      WHERE n.is_active = 1
        AND n.start_at <= ?
        AND (n.end_at IS NULL OR n.end_at >= ?)
        AND (
          n.target_role IS NULL AND n.target_user IS NULL
          OR n.target_role = ?
          OR n.target_user = ?
        )
      ORDER BY n.created_at DESC
    `).all(now, now, req.user.role, req.user.id);
    ok(res, data);
  } catch(e) { err(res, e, 'GET /notifications/active'); }
});

// ── GET / — all notifications (admin) ────────────────────────────────────────
router.get('/', requirePermission('settings.manage'), (req, res) => {
  try {
    const data = db.prepare(`
      SELECT n.*, u.name as author_name FROM notifications n
      LEFT JOIN users u ON n.created_by = u.id
      ORDER BY n.created_at DESC LIMIT 200
    `).all();
    ok(res, data);
  } catch(e) { err(res, e, 'GET /notifications'); }
});

// ── POST / — create notification ──────────────────────────────────────────────
router.post('/', requirePermission('settings.manage'), (req, res) => {
  try {
    const { message, show_author = 0, duration_hours, target_role, target_user, start_at } = req.body;
    if (!message?.trim()) return fail(res, 'نص الإشعار مطلوب');
    const start = start_at || new Date().toISOString();
    let end_at = null;
    if (duration_hours && duration_hours > 0) {
      const endDate = new Date(start);
      endDate.setHours(endDate.getHours() + Number(duration_hours));
      end_at = endDate.toISOString();
    }
    const r = db.prepare(`
      INSERT INTO notifications (message, created_by, show_author, target_role, target_user, start_at, end_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sanitize(message), req.user.id, show_author ? 1 : 0, target_role || null, target_user || null, start, end_at);
    logAction(req, 'CREATE_NOTIFICATION', 'notifications', r.lastInsertRowid, { message });
    ok(res, { id: r.lastInsertRowid }, 'تم إنشاء الإشعار', 201);
  } catch(e) { err(res, e, 'POST /notifications'); }
});

// ── PUT /:id/disable ──────────────────────────────────────────────────────────
router.put('/:id/disable', requirePermission('settings.manage'), (req, res) => {
  try {
    const n = db.prepare('SELECT id FROM notifications WHERE id=?').get(req.params.id);
    if (!n) return fail(res, 'الإشعار غير موجود', 404);
    db.prepare('UPDATE notifications SET is_active=0 WHERE id=?').run(req.params.id);
    ok(res, null, 'تم إلغاء الإشعار');
  } catch(e) { err(res, e, 'PUT /notifications/:id/disable'); }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
router.delete('/:id', requirePermission('settings.manage'), (req, res) => {
  try {
    db.prepare('DELETE FROM notifications WHERE id=?').run(req.params.id);
    ok(res, null, 'تم الحذف');
  } catch(e) { err(res, e, 'DELETE /notifications/:id'); }
});

// ── Export ────────────────────────────────────────────────────────────────────
// Export router as default AND attach pushOrderNotification as a named property.
// This is the ONLY export statement — no earlier partial exports that get overwritten.
router.pushOrderNotification = pushOrderNotification;
module.exports = router;
