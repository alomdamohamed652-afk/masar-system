'use strict';
const express = require('express');
const router  = express.Router();
const https   = require('https');
const http    = require('http');
const db      = require('../database/db');
const { authMiddleware, requirePermission, requireRole, logAction } = require('../middleware/auth');
const { ok, fail, err } = require('../utils/respond');
const { safeFloat, safeInt, sanitize } = require('../utils/validate');

router.use(authMiddleware, requirePermission('products.view'));

function fetchUrl(url, apiKey) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const opts = { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } };
    const req = lib.get(url, opts, resp => {
      if (resp.statusCode !== 200) return reject(new Error(`API returned status ${resp.statusCode}`));
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON from API')); } });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('API request timed out')); });
  });
}

router.get('/products', requireRole('admin','manager'), async (req, res) => {
  try {
    const apiUrl = db.prepare("SELECT value FROM settings WHERE key='external_api_url'").get()?.value?.trim();
    const apiKey = db.prepare("SELECT value FROM settings WHERE key='external_api_key'").get()?.value?.trim();

    if (!apiUrl) return fail(res,'لم يتم ضبط External API URL في الإعدادات. أضفه من صفحة الإعدادات.');

    const data = await fetchUrl(apiUrl, apiKey || '');
    logAction(req,'FETCH_EXTERNAL_PRODUCTS','external');
    ok(res, { source:'api', data: Array.isArray(data) ? data : (data.products || data.items || data.data || []) });
  } catch(e) {
    return fail(res, `فشل الاتصال بالـ API: ${e.message}. تأكد من صحة الرابط والـ API Key في الإعدادات.`, 502);
  }
});

router.post('/products/import', requireRole('admin','manager'), (req, res) => {
  try {
    const { products } = req.body;
    if (!products?.length) return fail(res,'لا توجد منتجات للاستيراد');
    const inserted=[], skipped=[];
    const t = db.transaction(() => {
      products.forEach(p => {
        const code = sanitize(p.external_id || p.code || p.id || `EXT-${Date.now()}`);
        if (db.prepare('SELECT id FROM products WHERE code=?').get(code)) { skipped.push(code); return; }
        const r = db.prepare('INSERT INTO products (code,name,color,size,cost,price) VALUES (?,?,?,?,?,?)').run(code, sanitize(p.name||'منتج'), sanitize(p.color||''), sanitize(p.size||''), safeFloat(p.cost||0), safeFloat(p.price||0));
        db.prepare('INSERT INTO inventory (product_id,quantity,sold) VALUES (?,0,0)').run(r.lastInsertRowid);
        inserted.push(code);
      });
    });
    t();
    logAction(req,'IMPORT_EXTERNAL_PRODUCTS','products',null,{inserted:inserted.length,skipped:skipped.length});
    ok(res,{inserted,skipped},`تم استيراد ${inserted.length} منتج${skipped.length?` | تجاهل ${skipped.length}`:''}`);
  } catch(e){ err(res,e,'POST /external/products/import'); }
});

module.exports = router;
