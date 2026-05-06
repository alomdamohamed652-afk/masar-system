'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');

router.use(authMiddleware);

// GET /api/barcode/scan?q=BARCODE
// Universal scan endpoint — checks orders first, then products
router.get('/scan', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return fail(res, 'الباركود مطلوب');

    // 1. Try orders (by barcode OR order_number)
    const order = db.prepare(`
      SELECT o.*, o.barcode, (o.total + o.shipping_price) as grand_total,
             u.name as created_by_name,
             (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as items_count
      FROM orders o
      LEFT JOIN users u ON o.created_by = u.id
      WHERE o.barcode = ? OR o.order_number = ?
      LIMIT 1
    `).get(q, q);

    if (order) {
      const items = db.prepare(`
        SELECT oi.*, p.name, p.code, p.color, p.size, p.image_url
        FROM order_items oi JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ?
      `).all(order.id);
      return ok(res, { type: 'order', data: { ...order, items } });
    }

    // 2. Try products (by barcode OR code)
    const product = db.prepare(`
      SELECT p.*, p.barcode,
             COALESCE(i.quantity, 0) as stock,
             COALESCE(i.sold, 0) as sold,
             COALESCE(i.quantity, 0) - COALESCE(i.sold, 0) as remaining
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE p.barcode = ? OR p.code = ?
      LIMIT 1
    `).get(q, q);

    if (product) {
      return ok(res, { type: 'product', data: product });
    }

    return fail(res, `لم يُعثر على نتيجة للباركود: ${q}`, 404);
  } catch(e) { err(res, e, 'GET /barcode/scan'); }
});

// POST /api/barcode/generate/:type/:id
// Force generate/regenerate barcode for a record
router.post('/generate/:type/:id', (req, res) => {
  try {
    const { type, id } = req.params;
    if (!['product','order'].includes(type)) return fail(res, 'النوع غير صالح');

    const table   = type === 'product' ? 'products' : 'orders';
    const flag    = type === 'product' ? 'P' : 'O';
    const exists  = db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id);
    if (!exists) return fail(res, 'السجل غير موجود', 404);

    const barcode = db.ensureBarcode(flag, parseInt(id), table);
    ok(res, { barcode }, 'تم توليد الباركود');
  } catch(e) { err(res, e, 'POST /barcode/generate'); }
});

// GET /api/barcode/backfill — generate barcodes for all existing records
router.post('/backfill', (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'admin') return fail(res, 'للمدير فقط', 403);

    const products = db.prepare("SELECT id FROM products WHERE barcode IS NULL").all();
    const orders   = db.prepare("SELECT id FROM orders WHERE barcode IS NULL").all();

    products.forEach(r => db.ensureBarcode('P', r.id, 'products'));
    orders.forEach(r   => db.ensureBarcode('O', r.id, 'orders'));

    ok(res, {
      products: products.length,
      orders:   orders.length
    }, `تم توليد ${products.length + orders.length} باركود`);
  } catch(e) { err(res, e, 'POST /barcode/backfill'); }
});

module.exports = router;
