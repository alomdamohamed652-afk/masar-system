'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('../database/db');
const XLSX    = require('xlsx');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');

// Auth applied per-route (export needs token-from-query injection first)

// ── Date range helpers ────────────────────────────────────────────────────────
function getRangeSQL(range) {
  const now = new Date();
  let fromDate, groupBy, labelFmt;

  switch(range) {
    case 'today':
      fromDate = new Date(now); fromDate.setHours(0,0,0,0);
      groupBy  = "strftime('%H:00', created_at)";
      labelFmt = 'hour';
      break;
    case 'week':
      fromDate = new Date(now); fromDate.setDate(now.getDate()-6);
      groupBy  = "DATE(created_at)";
      labelFmt = 'day';
      break;
    case 'month':
      fromDate = new Date(now); fromDate.setDate(1);
      groupBy  = "DATE(created_at)";
      labelFmt = 'day';
      break;
    case '3months':
      fromDate = new Date(now); fromDate.setMonth(now.getMonth()-2); fromDate.setDate(1);
      groupBy  = "strftime('%Y-%W', created_at)";
      labelFmt = 'week';
      break;
    case '6months':
      fromDate = new Date(now); fromDate.setMonth(now.getMonth()-5); fromDate.setDate(1);
      groupBy  = "strftime('%Y-%W', created_at)";
      labelFmt = 'week';
      break;
    case 'year':
      fromDate = new Date(now); fromDate.setFullYear(now.getFullYear()-1);
      groupBy  = "strftime('%Y-%m', created_at)";
      labelFmt = 'month';
      break;
    case '3years':
      fromDate = new Date(now); fromDate.setFullYear(now.getFullYear()-3);
      groupBy  = "strftime('%Y-%m', created_at)";
      labelFmt = 'month';
      break;
    case 'all':
    default:
      fromDate  = new Date('2000-01-01');
      groupBy   = "strftime('%Y', created_at)";
      labelFmt  = 'year';
      break;
  }

  return { fromISO: fromDate.toISOString(), groupBy, labelFmt };
}

// GET /api/dashboard/stats?range=month
router.get('/stats', authMiddleware, requirePermission('dashboard.view'), (req, res) => {
  try {
    const range = req.query.range || 'month';
    const { fromISO, groupBy } = getRangeSQL(range);

    // ── Accounting (correct, no double-counting) ───────────────────────────
    const totalSales = db.prepare(`
      SELECT COALESCE(SUM(total),0) as v FROM orders
      WHERE status != 'cancelled' AND created_at >= ?`).get(fromISO)?.v || 0;

    const totalCost = db.prepare(`
      SELECT COALESCE(SUM(oi.quantity * oi.unit_cost),0) as v
      FROM order_items oi JOIN orders o ON oi.order_id=o.id
      WHERE o.status != 'cancelled' AND o.created_at >= ?`).get(fromISO)?.v || 0;

    const totalExpenses = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE created_at >= ?`).get(fromISO)?.v || 0;

    const grossProfit = totalSales - totalCost;
    const netProfit   = grossProfit - totalExpenses;

    const totalOrders = db.prepare(`
      SELECT COUNT(*) as v FROM orders WHERE status != 'cancelled' AND created_at >= ?`).get(fromISO)?.v || 0;

    const totalShipping = db.prepare(`
      SELECT COALESCE(SUM(shipping_price),0) as v FROM orders WHERE status!='cancelled' AND created_at>=?`).get(fromISO)?.v||0;

    const avgOrderValue = totalOrders > 0 ? (totalSales / totalOrders) : 0;

    const bestProduct = db.prepare(`
      SELECT p.name, SUM(oi.quantity) as qty, SUM(oi.total) as rev
      FROM order_items oi JOIN products p ON oi.product_id=p.id
      JOIN orders o ON oi.order_id=o.id
      WHERE o.status!='cancelled' AND o.created_at>=?
      GROUP BY oi.product_id ORDER BY rev DESC LIMIT 1`).get(fromISO);

    // ── Chart data ─────────────────────────────────────────────────────────
    const chartData = db.prepare(`
      SELECT ${groupBy} as label,
             COALESCE(SUM(total),0) as revenue,
             COUNT(*) as orders
      FROM orders WHERE status!='cancelled' AND created_at>=?
      GROUP BY label ORDER BY label`).all(fromISO);

    // ── Top products ───────────────────────────────────────────────────────
    const topProducts = db.prepare(`
      SELECT p.name, p.image_url, SUM(oi.total) as revenue, SUM(oi.quantity) as sold
      FROM order_items oi JOIN products p ON oi.product_id=p.id
      JOIN orders o ON oi.order_id=o.id
      WHERE o.status!='cancelled' AND o.created_at>=?
      GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 5`).all(fromISO);

    // ── Trend (compare to previous same period) ────────────────────────────
    const prevSales = db.prepare(`
      SELECT COALESCE(SUM(total),0) as v FROM orders
      WHERE status!='cancelled' AND created_at < ? AND created_at >= datetime(?, '-'||?||' seconds')`
    ).get(fromISO, fromISO, Math.round((Date.now() - new Date(fromISO).getTime())/1000))?.v || 0;

    const trend = prevSales > 0 ? ((totalSales - prevSales) / prevSales * 100).toFixed(1) : null;

    ok(res, {
      totalSales, totalCost, totalExpenses, grossProfit, netProfit,
      totalOrders, totalShipping, avgOrderValue,
      bestProduct: bestProduct?.name || '—',
      trend,
      chartData,
      topProducts,
      range
    });
  } catch(e) { err(res,e,'GET /dashboard/stats'); }
});

// Export to Excel — inject token from query BEFORE auth middleware runs
router.get('/export', (req, res, next) => {
  if (req.query.token && !req.headers['authorization'])
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  next();
}, authMiddleware, requirePermission('dashboard.view'), (req, res) => {
  try {
    const wb = XLSX.utils.book_new();
    const orders = db.prepare(`SELECT o.order_number "رقم الأوردر", o.customer_name "العميل", o.phone "الهاتف", o.status "الحالة", o.payment_status "الدفع", o.total "المبيعات", o.shipping_price "الشحن", (o.total+o.shipping_price) "الإجمالي", o.created_at "التاريخ" FROM orders o ORDER BY o.created_at DESC`).all();
    const ws1=XLSX.utils.json_to_sheet(orders); ws1['!cols']=[{wch:18},{wch:20},{wch:14},{wch:12},{wch:10},{wch:12},{wch:10},{wch:14},{wch:20}];
    XLSX.utils.book_append_sheet(wb,ws1,'الأوردرات');
    const products = db.prepare(`SELECT p.code "الكود", p.name "الاسم", p.color "اللون", p.size "المقاس", p.cost "التكلفة", p.price "السعر", COALESCE(i.quantity,0) "المخزون", COALESCE(i.sold,0) "المباع" FROM products p LEFT JOIN inventory i ON p.id=i.product_id`).all();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(products),'المنتجات');
    const expenses = db.prepare(`SELECT type "النوع", details "التفاصيل", amount "المبلغ", created_at "التاريخ" FROM expenses ORDER BY created_at DESC`).all();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(expenses),'المصاريف');
    const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename=MASAR-${Date.now()}.xlsx`);
    res.send(buf);
  } catch(e){ err(res,e,'GET /dashboard/export'); }
});

module.exports = router;
