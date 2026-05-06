'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, requireRole } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { safeInt, sanitize } = require('../utils/validate');

router.use(authMiddleware, requirePermission('settings.manage'));

router.get('/', (req, res) => {
  try {
    const { action='', from='', to='', user_id='', page=1, limit=100 } = req.query;
    const pg=Math.max(1,parseInt(page)||1), lim=Math.min(500,parseInt(limit)||100);
    let w='WHERE 1=1'; const p=[];
    if (action)  { w+=' AND action LIKE ?'; p.push(`%${sanitize(action)}%`); }
    if (user_id) { w+=' AND user_id=?'; p.push(safeInt(user_id)); }
    if (from)    { w+=' AND DATE(created_at)>=?'; p.push(from); }
    if (to)      { w+=' AND DATE(created_at)<=?'; p.push(to); }
    const total = db.prepare(`SELECT COUNT(*) as c FROM logs ${w}`).get(...p)?.c||0;
    const data  = db.prepare(`SELECT * FROM logs ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...p,lim,(pg-1)*lim);
    res.json({ success:true, data, pagination:{ page:pg,limit:lim,total,pages:Math.ceil(total/lim) } });
  } catch(e){ err(res,e,'GET /logs'); }
});

// Undo: restore from snapshot
router.post('/:id/undo', (req, res) => {
  try {
    const log = db.prepare('SELECT * FROM logs WHERE id=?').get(req.params.id);
    if (!log) return fail(res,'السجل غير موجود',404);
    if (!log.snapshot) return fail(res,'لا يوجد snapshot لهذا السجل');

    const snapshot = JSON.parse(log.snapshot);

    if (log.action === 'DELETE_ORDER' && snapshot.order) {
      const { order, items } = snapshot;
      const existing = db.prepare('SELECT id FROM orders WHERE id=?').get(order.id);
      if (existing) return fail(res,'الأوردر موجود بالفعل');

      db.transaction(() => {
        db.prepare(`INSERT INTO orders (id,order_number,customer_name,phone,address,notes,total,shipping_price,status,payment_method,payment_status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.id, order.order_number, order.customer_name, order.phone, order.address, order.notes, order.total, order.shipping_price, order.status, order.payment_method, order.payment_status, order.created_by, order.created_at);
        if (items?.length) {
          items.forEach(i => {
            db.prepare('INSERT INTO order_items (order_id,product_id,quantity,unit_price,unit_cost,total) VALUES (?,?,?,?,?,?)').run(order.id, i.product_id, i.quantity, i.unit_price, i.unit_cost, i.total);
            db.prepare('UPDATE inventory SET sold=sold+? WHERE product_id=?').run(i.quantity, i.product_id);
          });
        }
      })();
      return ok(res,null,`تم استعادة الأوردر ${order.order_number}`);
    }

    if (log.action === 'DELETE_PRODUCT' && snapshot) {
      if (db.prepare('SELECT id FROM products WHERE id=?').get(snapshot.id)) return fail(res,'المنتج موجود بالفعل');
      db.prepare('INSERT INTO products (id,code,name,color,size,cost,price,image_url,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(snapshot.id,snapshot.code,snapshot.name,snapshot.color,snapshot.size,snapshot.cost,snapshot.price,snapshot.image_url,snapshot.created_at);
      db.prepare('INSERT OR IGNORE INTO inventory (product_id,quantity,sold) VALUES (?,0,0)').run(snapshot.id);
      return ok(res,null,`تم استعادة المنتج ${snapshot.name}`);
    }

    fail(res,'نوع السجل غير قابل للاستعادة');
  } catch(e){ err(res,e,'POST /logs/:id/undo'); }
});

router.delete('/clear', (req, res) => {
  try {
    const days = safeInt(req.body?.days, 30);
    db.prepare(`DELETE FROM logs WHERE created_at < date('now','-${days} days')`).run();
    ok(res,null,`تم حذف السجلات الأقدم من ${days} يوم`);
  } catch(e){ err(res,e,'DELETE /logs/clear'); }
});

module.exports = router;
