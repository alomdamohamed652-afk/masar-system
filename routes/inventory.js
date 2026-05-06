'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, requireRole, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { safeInt } = require('../utils/validate');

router.use(authMiddleware, requirePermission('products.view'));

router.get('/', (req, res) => {
  try {
    const data = db.prepare(`
      SELECT p.id, p.code, p.name, p.color, p.size, p.cost, p.price, p.image_url,
             COALESCE(i.quantity,0) as quantity, COALESCE(i.sold,0) as sold,
             COALESCE(i.quantity,0)-COALESCE(i.sold,0) as remaining
      FROM products p LEFT JOIN inventory i ON p.id=i.product_id ORDER BY p.name`).all();
    ok(res, data);
  } catch(e){ err(res,e,'GET /inventory'); }
});

router.put('/:product_id', requireRole('admin','manager'), (req, res) => {
  try {
    const qty = safeInt(req.body.quantity, -1);
    if (qty < 0) return fail(res,'الكمية لا يمكن أن تكون سالبة');
    if (!db.prepare('SELECT id FROM products WHERE id=?').get(req.params.product_id))
      return fail(res,'المنتج غير موجود',404);
    db.prepare('UPDATE inventory SET quantity=? WHERE product_id=?').run(qty, req.params.product_id);
    logAction(req,'UPDATE_STOCK','inventory',parseInt(req.params.product_id),{quantity:qty});
    ok(res,null,'تم تحديث المخزون');
  } catch(e){ err(res,e,'PUT /inventory/:id'); }
});

module.exports = router;
