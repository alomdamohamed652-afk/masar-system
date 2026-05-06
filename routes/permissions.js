'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');

router.use(authMiddleware, requirePermission('permissions.manage'));

// GET all permissions + role matrix
router.get('/', (req, res) => {
  try {
    const permissions = db.prepare("SELECT * FROM permissions ORDER BY group_name, key").all();
    const rolePerms   = db.prepare("SELECT role, permission, allowed FROM role_permissions").all();
    const roles = ['admin','manager','accountant','employee','developer'];
    const matrix = {};
    roles.forEach(r => { matrix[r] = {}; });
    rolePerms.forEach(rp => { if (matrix[rp.role]) matrix[rp.role][rp.permission] = rp.allowed; });
    ok(res, { permissions, matrix, roles });
  } catch(e) { err(res,e,'GET /permissions'); }
});

// GET user-specific overrides
router.get('/user/:userId', (req, res) => {
  try {
    const user = db.prepare("SELECT id,name,role FROM users WHERE id=?").get(req.params.userId);
    if (!user) return fail(res,'المستخدم غير موجود',404);
    const overrides = db.prepare("SELECT permission, allowed FROM user_permissions WHERE user_id=?").all(req.params.userId);
    const overrideMap = Object.fromEntries(overrides.map(o => [o.permission, o.allowed]));
    ok(res, { user, overrides: overrideMap });
  } catch(e) { err(res,e,'GET /permissions/user/:id'); }
});

// PUT update role permissions (bulk)
router.put('/role/:role', (req, res) => {
  try {
    const { permissions } = req.body; // { 'orders.delete': 1, 'users.manage': 0, ... }
    if (!permissions || typeof permissions !== 'object') return fail(res,'بيانات غير صالحة');
    const t = db.transaction(() => {
      Object.entries(permissions).forEach(([perm, allowed]) => {
        db.prepare("INSERT OR REPLACE INTO role_permissions (role, permission, allowed) VALUES (?,?,?)")
          .run(req.params.role, perm, allowed ? 1 : 0);
      });
    });
    t();
    logAction(req, 'UPDATE_ROLE_PERMISSIONS', 'permissions', null, { role: req.params.role });
    ok(res, null, 'تم تحديث صلاحيات الدور');
  } catch(e) { err(res,e,'PUT /permissions/role/:role'); }
});

// PUT update user permission overrides
router.put('/user/:userId', (req, res) => {
  try {
    const { permissions } = req.body; // { 'perm.key': 1|0|null }
    if (!permissions) return fail(res,'بيانات غير صالحة');
    const t = db.transaction(() => {
      Object.entries(permissions).forEach(([perm, value]) => {
        if (value === null || value === undefined) {
          db.prepare("DELETE FROM user_permissions WHERE user_id=? AND permission=?").run(req.params.userId, perm);
        } else {
          db.prepare("INSERT OR REPLACE INTO user_permissions (user_id, permission, allowed) VALUES (?,?,?)")
            .run(req.params.userId, perm, value ? 1 : 0);
        }
      });
    });
    t();
    logAction(req, 'UPDATE_USER_PERMISSIONS', 'users', parseInt(req.params.userId));
    ok(res, null, 'تم تحديث صلاحيات المستخدم');
  } catch(e) { err(res,e,'PUT /permissions/user/:id'); }
});

module.exports = router;
