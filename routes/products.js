'use strict';
const express = require('express');
const path    = require('path');
const multer  = require('multer');
const fs      = require('fs');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, requireRole, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { notEmpty, safeFloat, safeInt, sanitize } = require('../utils/validate');

router.use(authMiddleware, requirePermission('products.view'));

// ── Image upload config ───────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `product-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg','.jpeg','.png','.webp'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('نوع الصورة غير مدعوم — jpg/png/webp فقط'));
  }
});

// ── GET all products (with search + pagination) ───────────────────────────────
router.get('/', (req, res) => {
  try {
    const search = sanitize(req.query.search || '');
    const page   = Math.max(1, safeInt(req.query.page, 1));
    const limit  = Math.min(200, safeInt(req.query.limit, 100));
    const offset = (page - 1) * limit;

    const q = `
      SELECT p.*, COALESCE(i.quantity,0) as stock, COALESCE(i.sold,0) as sold,
             COALESCE(i.quantity,0) - COALESCE(i.sold,0) as remaining
      FROM products p LEFT JOIN inventory i ON p.id = i.product_id
      WHERE p.name LIKE ? OR p.code LIKE ? OR p.color LIKE ? OR p.barcode LIKE ?
      ORDER BY p.created_at DESC`;
    const params = [`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`];

    const total = db.prepare(`SELECT COUNT(*) as c FROM products p WHERE p.name LIKE ? OR p.code LIKE ? OR p.color LIKE ? OR p.barcode LIKE ?`).get(...params)?.c || 0;
    const data  = db.prepare(`${q} LIMIT ? OFFSET ?`).all(...params, limit, offset);

    res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total/limit) } });
  } catch (e) { err(res, e, 'GET /products'); }
});

// ── GET single product ────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  try {
    const product = db.prepare(`
      SELECT p.*, COALESCE(i.quantity,0) as stock, COALESCE(i.sold,0) as sold
      FROM products p LEFT JOIN inventory i ON p.id=i.product_id
      WHERE p.id = ?`).get(req.params.id);
    if (!product) return fail(res, 'المنتج غير موجود', 404);
    ok(res, product);
  } catch (e) { err(res, e, 'GET /products/:id'); }
});

// ── POST create product ───────────────────────────────────────────────────────
router.post('/', requireRole('admin','manager','employee'), upload.single('image'), (req, res) => {
  try {
    const { code, name, color, size, cost, price, quantity } = req.body;
    if (!notEmpty(code)) return fail(res, 'الكود مطلوب');
    if (!notEmpty(name)) return fail(res, 'اسم المنتج مطلوب');

    const exists = db.prepare('SELECT id FROM products WHERE code=?').get(sanitize(code));
    if (exists) return fail(res, 'كود المنتج موجود بالفعل');

    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    const t = db.transaction(() => {
      const r = db.prepare(
        'INSERT INTO products (code,name,color,size,cost,price,image_url) VALUES (?,?,?,?,?,?,?)'
      ).run(sanitize(code), sanitize(name), sanitize(color), sanitize(size), safeFloat(cost), safeFloat(price), image_url);
      db.prepare('INSERT INTO inventory (product_id,quantity,sold) VALUES (?,?,0)').run(r.lastInsertRowid, safeInt(quantity));
      return r.lastInsertRowid;
    });

    const id = t();
    const barcode = db.ensureBarcode('P', id, 'products');
    logAction(req, 'CREATE_PRODUCT', 'products', id, { code, name, barcode });
    ok(res, { id, barcode }, 'تم إنشاء المنتج', 201);
  } catch (e) { err(res, e, 'POST /products'); }
});

// ── PUT update product ────────────────────────────────────────────────────────
router.put('/:id', requireRole('admin','manager','employee'), upload.single('image'), (req, res) => {
  try {
    const { code, name, color, size, cost, price, quantity } = req.body;
    const existing = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!existing) return fail(res, 'المنتج غير موجود', 404);

    const dup = db.prepare('SELECT id FROM products WHERE code=? AND id!=?').get(sanitize(code), req.params.id);
    if (dup) return fail(res, 'كود المنتج مستخدم لمنتج آخر');

    // Delete old image if new one uploaded
    if (req.file && existing.image_url) {
      const oldPath = path.join(__dirname,'..','public', existing.image_url);
      try { fs.unlinkSync(oldPath); } catch {}
    }
    const image_url = req.file ? `/uploads/${req.file.filename}` : existing.image_url;

    db.prepare('UPDATE products SET code=?,name=?,color=?,size=?,cost=?,price=?,image_url=? WHERE id=?')
      .run(sanitize(code||existing.code), sanitize(name||existing.name), sanitize(color??existing.color), sanitize(size??existing.size), safeFloat(cost??existing.cost), safeFloat(price??existing.price), image_url, req.params.id);

    if (quantity !== undefined)
      db.prepare('UPDATE inventory SET quantity=? WHERE product_id=?').run(safeInt(quantity), req.params.id);

    logAction(req, 'UPDATE_PRODUCT', 'products', parseInt(req.params.id), { code, name }, existing);
    ok(res, null, 'تم تحديث المنتج');
  } catch (e) { err(res, e, 'PUT /products/:id'); }
});

// ── DELETE product ────────────────────────────────────────────────────────────
router.delete('/:id', requireRole('admin','manager'), (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
    if (!existing) return fail(res, 'المنتج غير موجود', 404);

    // Delete image file
    if (existing.image_url) {
      try { fs.unlinkSync(path.join(__dirname,'..','public',existing.image_url)); } catch {}
    }

    db.prepare('DELETE FROM products WHERE id=?').run(req.params.id);
    logAction(req, 'DELETE_PRODUCT', 'products', parseInt(req.params.id), null, existing);
    ok(res, null, 'تم حذف المنتج');
  } catch (e) { err(res, e, 'DELETE /products/:id'); }
});

module.exports = router;
