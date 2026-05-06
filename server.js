'use strict';
require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const path        = require('path');
const os          = require('os');
const rateLimit   = require('express-rate-limit');

const app  = express();

// --- التعديل المهم هنا: تعريف الـ PORT في الأول عشان الكل يشوفه ---
const PORT = process.env.PORT || 10000; 
const isDev = process.env.NODE_ENV !== 'production';

app.use(helmet({ contentSecurityPolicy:false, crossOriginEmbedderPolicy:false }));
app.use(cors({
  origin: (process.env.CORS_ORIGIN||'*') === '*' ? '*' : (o,cb)=>{ const list=(process.env.CORS_ORIGIN||'').split(',').map(s=>s.trim()); cb(!o||list.includes(o)?null:new Error('CORS'),true); },
  methods:['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders:['Content-Type','Authorization']
}));
app.use(compression());
app.use(express.json({limit:'10mb'}));
app.use(express.urlencoded({extended:true,limit:'10mb'}));

const limiter     = rateLimit({ windowMs:15*60*1000, max:isDev?5000:300, standardHeaders:true, legacyHeaders:false, message:{success:false,message:'طلبات كثيرة'} });
const authLimiter = rateLimit({ windowMs:15*60*1000, max:isDev?1000:20, message:{success:false,message:'محاولات دخول كثيرة — حاول بعد 15 دقيقة'} });

app.use('/api/', limiter);
app.use('/api/auth/login', authLimiter);
app.set('trust proxy', 1);

app.use(express.static(path.join(__dirname,'public'), { maxAge: isDev?0:'1d', etag:true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/products',      require('./routes/products'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/expenses',      require('./routes/expenses'));
app.use('/api/inventory',     require('./routes/inventory'));
app.use('/api/dashboard',     require('./routes/dashboard'));
app.use('/api/logs',          require('./routes/logs'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/external',      require('./routes/external'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/permissions',   require('./routes/permissions'));
app.use('/api/tasks',         require('./routes/tasks'));
app.use('/api/requests',      require('./routes/requests'));
app.use('/api/attendance',    require('./routes/attendance'));
app.use('/api/leave',         require('./routes/leave'));

app.get('/api/health', (req,res)=>res.json({status:'ok',version:'4.0.0',env:process.env.NODE_ENV||'dev',ts:new Date().toISOString()}));

app.get('/qr', (req, res) => {
  const localIP  = _getLocalIP();
  const url      = `https://masar-system.onrender.com`; // خليناها الرابط المباشر بتاعك
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(url)}`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>QR — MASAR</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#fff;min-height:100vh;
       display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#111;border:1px solid #222;border-radius:16px;padding:36px 40px;
        text-align:center;max-width:340px;width:100%}
  h1{font-size:1.5rem;font-weight:800;letter-spacing:3px;color:#22c55e;margin-bottom:4px}
  .sub{font-size:.8rem;color:#555;margin-bottom:28px}
  .qr-wrap{background:#fff;border-radius:12px;padding:16px;display:inline-block;margin-bottom:20px}
  .qr-wrap img{display:block;width:220px;height:220px}
  .url{font-size:.9rem;color:#22c55e;font-family:monospace;word-break:break-all;
       background:#0d1f13;border:1px solid #1a3d21;border-radius:8px;padding:10px 14px;margin-bottom:20px}
</style>
</head>
<body>
<div class="card">
  <h1>MASAR</h1>
  <div class="sub">نظام مسار الإداري</div>
  <div class="qr-wrap">
    <img src="${qrImgUrl}" alt="QR Code"/>
  </div>
  <div class="url">${url}</div>
</div>
</body>
</html>`);
});

app.use('/api/*', (req,res)=>res.status(404).json({success:false,message:'Endpoint not found'}));
app.get('*', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((e,req,res,_next)=>{ console.error('[Error]',e); res.status(500).json({success:false,message:isDev?e.message:'خطأ داخلي'}); });

function _getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// تشغيل السيرفر مرة واحدة فقط في نهاية الملف
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});

module.exports = app;