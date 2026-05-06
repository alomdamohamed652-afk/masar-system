'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');
const router  = express.Router();
const db      = require('../database/db');
const { authMiddleware, requirePermission, requireRole, logAction } = require('../middleware/auth');
const { ok, err } = require('../utils/respond');
const { sanitize } = require('../utils/validate');

router.use(authMiddleware, requirePermission('settings.manage'));

// Logo upload
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname,'..','public','uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `logo${path.extname(file.originalname).toLowerCase()}`)
});
const logoUpload = multer({ storage: logoStorage, limits: { fileSize: 2*1024*1024 }, fileFilter: (req,file,cb) => { if (['.jpg','.jpeg','.png','.webp'].includes(path.extname(file.originalname).toLowerCase())) cb(null,true); else cb(new Error('نوع غير مدعوم')); } });

router.get('/', (req, res) => {
  try {
    const rows = db.prepare("SELECT key,value FROM settings WHERE key != 'jwt_secret' AND key != 'external_api_key'").all();
    const data = Object.fromEntries(rows.map(r => [r.key, r.value]));
    ok(res, data);
  } catch(e){ err(res,e,'GET /settings'); }
});

router.put('/', requireRole('admin'), logoUpload.single('brand_logo_file'), (req, res) => {
  try {
    const allowed = ['brand_name','brand_address','brand_phone','brand_logo','currency','external_api_url'];
    const upsert  = db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)");
    const t = db.transaction(() => {
      allowed.forEach(key => { if (req.body[key] !== undefined) upsert.run(key, sanitize(req.body[key])); });
      if (req.file) upsert.run('brand_logo', `/uploads/${req.file.filename}`);
      // store API key separately (never expose to frontend)
      if (req.body.external_api_key !== undefined)
        db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('external_api_key',?)").run(sanitize(req.body.external_api_key));
    });
    t();
    logAction(req,'UPDATE_SETTINGS','settings');
    ok(res,null,'تم حفظ الإعدادات');
  } catch(e){ err(res,e,'PUT /settings'); }
});

module.exports = router;
