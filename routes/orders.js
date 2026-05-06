'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, requireRole, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { safeFloat, safeInt, sanitize } = require('../utils/validate');

// ── SSE push helper ───────────────────────────────────────────────────────────
// Lazy require: notifications module is loaded at call-time, not at startup.
// This avoids any circular dependency risk at module load time.
// Called ONLY after a successful committed transaction — never inside db.transaction().
function _push(payload) {
  try {
    const notif = require('./notifications');
    if (typeof notif.pushOrderNotification === 'function') {
      notif.pushOrderNotification(payload);
    }
  } catch (_) { /* silent — never let push failure affect the order response */ }
}

router.use(authMiddleware, requirePermission('orders.view'));

const VALID_STATUSES   = ['pending','confirmed','shipped','delivered','cancelled'];
const VALID_PAY_STATUS = ['unpaid','paid'];

function genOrderNum() {
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `MSR-${String(d.getFullYear()).slice(-2)}${pad(d.getMonth()+1)}${pad(d.getDate())}-${Math.floor(Math.random()*9000)+1000}`;
}

// ── GET / — all orders ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const { search='', status='', from='', to='', page=1, limit=50 } = req.query;
    const pg  = Math.max(1, safeInt(page, 1));
    const lim = Math.min(200, safeInt(limit, 50));
    const off = (pg - 1) * lim;

    let where = 'WHERE 1=1';
    const params = [];
    if (status) { where += ' AND o.status=?';                        params.push(status); }
    if (from)   { where += ' AND DATE(o.created_at)>=?';             params.push(from); }
    if (to)     { where += ' AND DATE(o.created_at)<=?';             params.push(to); }
    if (search) {
      where += ' AND (o.order_number LIKE ? OR o.customer_name LIKE ? OR o.phone LIKE ? OR o.barcode LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const baseQ = `FROM orders o LEFT JOIN users u ON o.created_by=u.id ${where}`;
    const total = db.prepare(`SELECT COUNT(*) as c ${baseQ}`).get(...params)?.c || 0;
    const data  = db.prepare(`
      SELECT o.*, o.barcode, (o.total+o.shipping_price) as grand_total,
             u.name as created_by_name,
             (SELECT COUNT(*) FROM order_items WHERE order_id=o.id) as items_count
      ${baseQ} ORDER BY o.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, lim, off);

    res.json({ success:true, data, pagination:{ page:pg, limit:lim, total, pages:Math.ceil(total/lim) } });
  } catch(e) { err(res, e, 'GET /orders'); }
});

// ── GET /:id — single order ───────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return fail(res, 'الأوردر غير موجود', 404);
    const items = db.prepare(`
      SELECT oi.*, p.name, p.code, p.color, p.size, p.image_url
      FROM order_items oi JOIN products p ON oi.product_id=p.id
      WHERE oi.order_id=?
    `).all(req.params.id);
    ok(res, { ...order, items, grand_total: order.total + (order.shipping_price || 0) });
  } catch(e) { err(res, e, 'GET /orders/:id'); }
});

// ── POST / — create order ─────────────────────────────────────────────────────
router.post('/', (req, res) => {
  try {
    const { customer_name='', phone='', address='', notes='', shipping_price=0, payment_method=null, items=[] } = req.body;
    if (!items.length)                 return fail(res, 'أضف منتجاً على الأقل');
    if (safeFloat(shipping_price) < 0) return fail(res, 'سعر الشحن لا يمكن أن يكون سالباً');

    // All DB work happens inside transaction — atomic, no partial inserts possible
    const t = db.transaction(() => {
      const enriched = items.map((item, i) => {
        const qty = safeInt(item.quantity, 0);
        if (qty < 1) throw new Error(`العنصر ${i+1}: الكمية يجب أن تكون 1 على الأقل`);
        const product = db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id);
        if (!product) throw new Error(`المنتج ID=${item.product_id} غير موجود`);
        const inv   = db.prepare('SELECT * FROM inventory WHERE product_id=?').get(item.product_id);
        const avail = (inv?.quantity || 0) - (inv?.sold || 0);
        if (qty > avail) throw new Error(`"${product.name}": المتاح ${avail} فقط`);
        return { ...item, qty, unit_price: product.price, unit_cost: product.cost, total: product.price * qty };
      });

      const subtotal    = enriched.reduce((s, i) => s + i.total, 0);
      const orderNumber = genOrderNum();

      const r2 = db.prepare(`
        INSERT INTO orders (order_number,customer_name,phone,address,notes,total,shipping_price,payment_method,status,payment_status,created_by)
        VALUES (?,?,?,?,?,?,?,?,'pending','unpaid',?)
      `).run(orderNumber, sanitize(customer_name), sanitize(phone), sanitize(address), sanitize(notes), subtotal, safeFloat(shipping_price), payment_method || null, req.user.id);

      const orderId = r2.lastInsertRowid;
      enriched.forEach(item => {
        db.prepare('INSERT INTO order_items (order_id,product_id,quantity,unit_price,unit_cost,total) VALUES (?,?,?,?,?,?)')
          .run(orderId, item.product_id, item.qty, item.unit_price, item.unit_cost, item.total);
        db.prepare('UPDATE inventory SET sold=sold+? WHERE product_id=?').run(item.qty, item.product_id);
      });

      return { orderId, orderNumber, total: subtotal, grandTotal: subtotal + safeFloat(shipping_price) };
    });

    // t() commits the full transaction. If it throws, nothing was written to DB.
    const result  = t();
    const barcode = db.ensureBarcode('O', result.orderId, 'orders');
    result.barcode = barcode;
    logAction(req, 'CREATE_ORDER', 'orders', result.orderId, { orderNumber: result.orderNumber, total: result.grandTotal, barcode });

    // Push SSE notification AFTER transaction is committed and response data is ready.
    // _push is fully isolated — any error inside it is swallowed and never affects the HTTP response.
    _push({
      id:           result.orderId,
      orderNumber:  result.orderNumber,
      customerName: customer_name || 'عميل',
      total:        result.total,
      grandTotal:   result.grandTotal,
    });

    ok(res, result, 'تم إنشاء الأوردر بنجاح', 201);
  } catch(e) { err(res, e, 'POST /orders'); }
});

// ── PUT /:id — update order ───────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!existing) return fail(res, 'الأوردر غير موجود', 404);
    if (existing.status === 'cancelled') return fail(res, 'لا يمكن تعديل أوردر ملغي');

    const { customer_name, phone, address, notes, shipping_price, payment_method, payment_status, items } = req.body;
    if (shipping_price !== undefined && safeFloat(shipping_price) < 0) return fail(res, 'سعر الشحن لا يمكن أن يكون سالباً');

    const t = db.transaction(() => {
      if (items?.length) {
        const oldItems = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(req.params.id);
        const oldMap   = {};
        oldItems.forEach(i => { oldMap[i.product_id] = (oldMap[i.product_id] || 0) + i.quantity; });

        const enriched = items.map((item, idx) => {
          const qty = safeInt(item.quantity, 0);
          if (qty < 1) throw new Error(`العنصر ${idx+1}: الكمية يجب أن تكون 1+`);
          const product = db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id);
          if (!product) throw new Error(`المنتج ID=${item.product_id} غير موجود`);
          return { ...item, qty, unit_price: product.price, unit_cost: product.cost, total: product.price * qty };
        });

        const newMap = {};
        enriched.forEach(i => { newMap[i.product_id] = (newMap[i.product_id] || 0) + i.qty; });

        const allIds = new Set([...Object.keys(oldMap), ...Object.keys(newMap)].map(Number));
        allIds.forEach(pid => {
          const diff = (newMap[pid] || 0) - (oldMap[pid] || 0);
          if (diff > 0) {
            const inv   = db.prepare('SELECT * FROM inventory WHERE product_id=?').get(pid);
            const avail = (inv?.quantity || 0) - (inv?.sold || 0);
            const prod  = db.prepare('SELECT name FROM products WHERE id=?').get(pid);
            if (diff > avail) throw new Error(`"${prod?.name}": المتاح ${avail}`);
            db.prepare('UPDATE inventory SET sold=sold+? WHERE product_id=?').run(diff, pid);
          } else if (diff < 0) {
            db.prepare('UPDATE inventory SET sold=MAX(0,sold-?) WHERE product_id=?').run(Math.abs(diff), pid);
          }
        });

        db.prepare('DELETE FROM order_items WHERE order_id=?').run(req.params.id);
        enriched.forEach(item =>
          db.prepare('INSERT INTO order_items (order_id,product_id,quantity,unit_price,unit_cost,total) VALUES (?,?,?,?,?,?)')
            .run(req.params.id, item.product_id, item.qty, item.unit_price, item.unit_cost, item.total)
        );
        db.prepare('UPDATE orders SET total=? WHERE id=?').run(enriched.reduce((s, i) => s + i.total, 0), req.params.id);
      }

      const fields = [], vals = [];
      if (customer_name  !== undefined) { fields.push('customer_name=?');  vals.push(sanitize(customer_name)); }
      if (phone          !== undefined) { fields.push('phone=?');           vals.push(sanitize(phone)); }
      if (address        !== undefined) { fields.push('address=?');         vals.push(sanitize(address)); }
      if (notes          !== undefined) { fields.push('notes=?');           vals.push(sanitize(notes)); }
      if (shipping_price !== undefined) { fields.push('shipping_price=?');  vals.push(safeFloat(shipping_price)); }
      if (payment_method !== undefined) { fields.push('payment_method=?');  vals.push(payment_method || null); }
      if (payment_status !== undefined) { fields.push('payment_status=?');  vals.push(payment_status); }
      if (fields.length) {
        vals.push(req.params.id);
        db.prepare(`UPDATE orders SET ${fields.join(',')} WHERE id=?`).run(...vals);
      }
    });

    t();
    logAction(req, 'UPDATE_ORDER', 'orders', parseInt(req.params.id), null, existing);
    ok(res, null, 'تم تحديث الأوردر');
  } catch(e) { err(res, e, 'PUT /orders/:id'); }
});

// ── PUT /:id/status — update status ──────────────────────────────────────────
router.put('/:id/status', (req, res) => {
  try {
    const { status, payment_method, payment_status } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return fail(res, 'الأوردر غير موجود', 404);
    if (status && !VALID_STATUSES.includes(status)) return fail(res, 'حالة غير صالحة');
    if (payment_status && !VALID_PAY_STATUS.includes(payment_status)) return fail(res, 'حالة دفع غير صالحة');

    if (status === 'cancelled' && order.status !== 'cancelled') {
      const t = db.transaction(() => {
        db.prepare('SELECT * FROM order_items WHERE order_id=?').all(req.params.id)
          .forEach(i => db.prepare('UPDATE inventory SET sold=MAX(0,sold-?) WHERE product_id=?').run(i.quantity, i.product_id));
        db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(req.params.id);
      });
      t();
      logAction(req, 'CANCEL_ORDER', 'orders', parseInt(req.params.id), null, order);
      return ok(res, null, 'تم إلغاء الأوردر وإعادة المخزون');
    }

    const f = [], v = [];
    if (status)                     { f.push('status=?');         v.push(status); }
    if (payment_method !== undefined){ f.push('payment_method=?'); v.push(payment_method || null); }
    if (payment_status)             { f.push('payment_status=?'); v.push(payment_status); }
    if (f.length) { v.push(req.params.id); db.prepare(`UPDATE orders SET ${f.join(',')} WHERE id=?`).run(...v); }
    logAction(req, 'UPDATE_ORDER_STATUS', 'orders', parseInt(req.params.id), { status, payment_status });
    ok(res, null, 'تم تحديث الحالة');
  } catch(e) { err(res, e, 'PUT /orders/:id/status'); }
});

// ── PUT /:id/cancel ───────────────────────────────────────────────────────────
router.put('/:id/cancel', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
    if (!order) return fail(res, 'الأوردر غير موجود', 404);
    if (order.status === 'cancelled') return fail(res, 'الأوردر ملغي بالفعل');
    const t = db.transaction(() => {
      db.prepare('SELECT * FROM order_items WHERE order_id=?').all(req.params.id)
        .forEach(i => db.prepare('UPDATE inventory SET sold=MAX(0,sold-?) WHERE product_id=?').run(i.quantity, i.product_id));
      db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(req.params.id);
    });
    t();
    logAction(req, 'CANCEL_ORDER', 'orders', parseInt(req.params.id), null, order);
    ok(res, null, 'تم إلغاء الأوردر وإعادة الكميات');
  } catch(e) { err(res, e, 'PUT /orders/:id/cancel'); }
});

// ── DELETE /:id — admin/manager only ─────────────────────────────────────────
router.delete('/:id', requireRole('admin', 'manager'), (req, res) => {
  try {
    const t = db.transaction(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
      if (!order) throw new Error('الأوردر غير موجود');
      const items = db.prepare('SELECT oi.*, p.name, p.code FROM order_items oi JOIN products p ON oi.product_id=p.id WHERE oi.order_id=?').all(req.params.id);
      if (order.status !== 'cancelled') {
        items.forEach(i => db.prepare('UPDATE inventory SET sold=MAX(0,sold-?) WHERE product_id=?').run(i.quantity, i.product_id));
      }
      db.prepare('DELETE FROM orders WHERE id=?').run(req.params.id);
      return { order, items };
    });
    const snapshot = t();
    logAction(req, 'DELETE_ORDER', 'orders', parseInt(req.params.id), null, snapshot);
    ok(res, null, 'تم حذف الأوردر وإعادة المخزون');
  } catch(e) { err(res, e, 'DELETE /orders/:id'); }
});

module.exports = router;
