/* ═══════════════════════════════════════════════════════════════
   MASAR Brand Manager v3 — Main Frontend JS
   Production-ready: auth, pagination, image upload, action menus
═══════════════════════════════════════════════════════════════ */
'use strict';

const API = '/api';
let _revenueChart = null;
let _productsChart = null;
let _allProducts = [];   // cached for order dropdowns
let _extProducts = [];   // external products buffer
let _currency = 'ج';

/* Barcode scanner */
let _scanBuffer = '';
let _scanTimer = null;
const SCAN_SPEED = 80;

/* ── Auth ────────────────────────────────────────────────────── */
const getToken = () => localStorage.getItem('masar_token') || '';
const getUser  = () => { try { return JSON.parse(localStorage.getItem('masar_user')); } catch { return null; } };
const hasRole  = (...roles) => roles.includes(getUser()?.role);

/**
 * hasPerm — checks if current user has a given UPPERCASE permission key.
 * Uses the permissions array stored in localStorage (set at login / /me refresh).
 */
function hasPerm(key) {
  const user = getUser();
  if (!user) return false;
  // Admin always has everything
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(key);
}

/**
 * applyPermissionsUI — removes nav items the user has no access to.
 * Called after login data is loaded into localStorage.
 */
function applyPermissionsUI() {
  const MAP = {
    'nav-dashboard':  'dashboard.view',
    'nav-products':   'products.view',
    'nav-inventory':  'products.view',
    'nav-orders':     'orders.view',
    'nav-expenses':   'expenses.view',
    'nav-tasks':      'tasks.view',
    'nav-requests':   'requests.view',
    'nav-leave':      'leave.request',
    'nav-permissions':'permissions.manage',
    'nav-settings':   'settings.manage',
    'nav-logs':       'logs.view',
    'nav-users':      'users.view',
  };
  Object.entries(MAP).forEach(([navId, permKey]) => {
    const el = document.getElementById(navId);
    if (!el) return;
    if (hasPerm(permKey)) {
      el.style.removeProperty('display');
    } else {
      el.remove();   // Remove entirely — no empty items
    }
  });

  // Always remove orphaned dividers (dividers between removed items)
  _cleanNavDividers();
}

function _cleanNavDividers() {
  const nav = document.getElementById('sidebar-nav');
  if (!nav) return;
  // Remove consecutive dividers and leading/trailing dividers
  let lastWasDivider = true; // treat start as if preceded by divider
  const children = [...nav.children];
  children.forEach(el => {
    const isDivider = el.classList.contains('nav-divider');
    if (isDivider) {
      if (lastWasDivider) el.remove();
      else lastWasDivider = true;
    } else {
      lastWasDivider = false;
    }
  });
  // Remove trailing divider
  const last = nav.lastElementChild;
  if (last?.classList.contains('nav-divider')) last.remove();
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
      ...(opts.headers || {})
    }
  });
  if (res.status === 401) { doLogout(); return null; }
  return res.json();
}

async function apiUpload(url, formData, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${getToken()}` },
    body: formData
  });
  if (res.status === 401) { doLogout(); return null; }
  return res.json();
}

function doLogout() {
  apiFetch(`${API}/auth/logout`, { method: 'POST' }).catch(() => {});
  localStorage.removeItem('masar_token');
  localStorage.removeItem('masar_user');
  window.location.href = '/login.html';
}

// Refresh user permissions from server (call if stale)
/* Barcode modal */
function showBarcodeModal(barcode, label, e) {
  if (e) e.stopPropagation();
  if (!barcode || barcode === '—') return;
  document.getElementById('barcode-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'barcode-overlay';
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:9999';
  ov.onclick = () => ov.remove();
  const bars = _barcodeSVG(barcode);
  const safe = barcode.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  ov.innerHTML =
    '<div style="background:var(--card-bg,#1a1a1a);border-radius:12px;padding:28px 32px;min-width:300px;text-align:center" onclick="event.stopPropagation()">'+
    '<div style="font-size:.8rem;color:var(--white-faint,#888);margin-bottom:10px">'+(label||'')+'</div>'+
    '<div style="background:#fff;border-radius:8px;padding:14px;display:inline-block;margin-bottom:10px">'+
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="64" viewBox="0 0 240 64">'+bars+'</svg>'+
    '</div>'+
    '<div style="font-family:monospace;font-size:1.05rem;letter-spacing:3px;color:#fff;margin-bottom:16px">'+barcode+'</div>'+
    '<button onclick="navigator.clipboard.writeText(\''+safe+'\').then(()=>showToast(\'تم النسخ ✓\')).catch(()=>{});document.getElementById(\'barcode-overlay\')?.remove()" '+
      'style="background:var(--green,#22c55e);color:#000;border:none;border-radius:6px;padding:8px 20px;cursor:pointer;margin-left:8px">نسخ</button> '+
    '<button onclick="document.getElementById(\'barcode-overlay\')?.remove()" '+
      'style="background:transparent;color:var(--white-faint,#888);border:1px solid var(--border,#333);border-radius:6px;padding:8px 14px;cursor:pointer">إغلاق</button>'+
    '</div>';
  document.body.appendChild(ov);
}

function _barcodeSVG(code) {
  const W=240,H=60,unit=2.2;
  let x=6, svg='';
  svg += '<rect x="'+x+'" y="0" width="'+unit+'" height="'+H+'" fill="#000"/>';
  svg += '<rect x="'+(x+unit*1.5)+'" y="0" width="'+(unit*.6)+'" height="'+H+'" fill="#000"/>';
  x += unit*3.5;
  for (let i=0;i<code.length;i++){
    const v=code.charCodeAt(i); const thick=(v%2===0);
    const bw=thick?unit*2:unit;
    svg += '<rect x="'+x.toFixed(1)+'" y="0" width="'+bw.toFixed(1)+'" height="'+H+'" fill="#000"/>';
    x += bw + (thick?unit*.6:unit*.4) + unit*.3;
  }
  svg += '<rect x="'+(W-unit*3).toFixed(1)+'" y="0" width="'+unit+'" height="'+H+'" fill="#000"/>';
  svg += '<rect x="'+(W-unit*1.2).toFixed(1)+'" y="0" width="'+(unit*.6).toFixed(1)+'" height="'+H+'" fill="#000"/>';
  return svg;
}

async function refreshPerms() {
  const res = await apiFetch(`${API}/auth/me`);
  if (res?.success) {
    const current = getUser() || {};
    localStorage.setItem('masar_user', JSON.stringify({ ...current, ...res.data }));
  }
}

/* ── Debounce ────────────────────────────────────────────────── */
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ── Toast ───────────────────────────────────────────────────── */
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  requestAnimationFrame(() => { requestAnimationFrame(() => el.classList.add('show')); });
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 320);
  }, 3000);
}

/* ── Format ──────────────────────────────────────────────────── */
const fmt     = n => Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + _currency;
const fmtDate = dt => new Date(dt).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
const fmtDT   = dt => new Date(dt).toLocaleString('ar-EG',    { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtSec  = s  => { const h=Math.floor((s||0)/3600),m=Math.floor(((s||0)%3600)/60); return h+`س `+m+`د`; };
const esc     = s  => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ── Pagination helper ───────────────────────────────────────── */
function renderPagination(containerId, pagination, loadFn) {
  const el = document.getElementById(containerId);
  if (!el || !pagination) return;
  const { page, pages, total } = pagination;
  if (pages <= 1) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = `
    <span>${total} عنصر إجمالي</span>
    <div class="pagination-btns">
      <button class="page-btn" ${page<=1?'disabled':''} onclick="${loadFn}(${page-1})">السابق</button>
      ${Array.from({length:Math.min(pages,7)},(_,i)=>{
        const p=pages<=7?i+1:page<=4?i+1:page>=pages-3?pages-6+i:page-3+i;
        return `<button class="page-btn ${p===page?'active':''}" onclick="${loadFn}(${p})">${p}</button>`;
      }).join('')}
      <button class="page-btn" ${page>=pages?'disabled':''} onclick="${loadFn}(${page+1})">التالي</button>
    </div>`;
}

/* ── Mobile Sidebar ──────────────────────────────────────────── */
function toggleMobileSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
  document.getElementById('mobile-overlay').classList.toggle('open');
}
function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('mobile-overlay').classList.remove('open');
}

/* ── Action menu — fixed positioning (no clipping) ─────────── */
document.addEventListener('click', e => {
  if (!e.target.closest('.action-menu-wrap') && !e.target.closest('.action-menu')) {
    document.querySelectorAll('.action-menu.open').forEach(m => {
      m.classList.remove('open');
      m.style.cssText = '';
    });
  }
});

function toggleMenu(id, event) {
  const menu = document.getElementById(id);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');

  // Close all other menus first
  document.querySelectorAll('.action-menu.open').forEach(m => {
    if (m !== menu) { m.classList.remove('open'); m.style.cssText = ''; }
  });

  if (isOpen) {
    menu.classList.remove('open');
    menu.style.cssText = '';
    return;
  }

  // Get trigger position
  const trigger = (event && (event.currentTarget || event.target)) || menu.previousElementSibling;
  if (trigger) {
    const rect   = trigger.getBoundingClientRect();
    const menuW  = 190;
    const menuH  = 260;

    let top  = rect.bottom + 4;
    let left = rect.left;

    // Flip up if near bottom
    if (top + menuH > window.innerHeight - 10) top = rect.top - menuH - 4;
    // Prevent left overflow (RTL)
    if (left + menuW > window.innerWidth - 4) left = window.innerWidth - menuW - 4;
    if (left < 4) left = 4;
    if (top < 4)  top  = 4;

    menu.style.cssText = `top:${top}px;left:${left}px;right:auto;bottom:auto;position:fixed`;
  }

  menu.classList.add('open');
}

/* ── Navigate ────────────────────────────────────────────────── */
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  const navEl  = document.querySelector(`[data-page="${page}"]`);
  if (!pageEl) return;
  pageEl.classList.add('active');
  if (navEl) navEl.classList.add('active');
  closeMobileSidebar();
  if (page === 'dashboard')        loadDashboard();
  if (page === 'products')         loadProducts();
  if (page === 'inventory')        loadInventory();
  if (page === 'orders')           { loadOrders(); _fetchProducts(); }
  if (page === 'expenses')         loadExpenses();
  if (page === 'tasks')            loadTasks();
  if (page === 'requests')         loadRequests();
  if (page === 'leave')            loadLeave();
  if (page === 'permissions-page') { loadRolePermissions(); loadPermUserList(); }
  if (page === 'logs')             loadLogs();
  if (page === 'users')            loadUsers();
  if (page === 'settings')         loadSettings();
}

function _initBarcodeScanner() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Enter') {
      if (_scanBuffer.length >= 4) _handleScan(_scanBuffer.trim());
      _scanBuffer = ''; clearTimeout(_scanTimer); return;
    }
    if (e.key.length === 1) {
      _scanBuffer += e.key;
      clearTimeout(_scanTimer);
      _scanTimer = setTimeout(() => {
        if (_scanBuffer.length >= 6) _handleScan(_scanBuffer.trim());
        _scanBuffer = '';
      }, SCAN_SPEED * 3);
    }
  });
}

async function _handleScan(code) {
  if (!code) return;
  showToast('🔍 جاري البحث: ' + code);
  const res = await apiFetch(API + '/barcode/scan?q=' + encodeURIComponent(code));
  if (!res?.success) { showToast(res?.message || 'لم يُعثر على نتيجة', 'error'); return; }
  if (res.data.type === 'order') { navigate('orders'); setTimeout(() => viewOrder(res.data.data.id), 300); }
  else if (res.data.type === 'product') {
    navigate('products');
    setTimeout(() => { const el = document.getElementById('product-search'); if (el) { el.value = res.data.data.code; loadProducts(1); } }, 300);
  }
}

/* ── Theme ────────────────────────────────────────────────────── */
function _applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  document.body.classList.toggle('dark',  theme !== 'light');
  const icon = theme === 'light' ? '🌙' : '☀️';
  document.querySelectorAll('#theme-btn, #theme-btn-sidebar').forEach(b => { if(b) b.textContent = icon; });
  localStorage.setItem('masar_theme', theme);
}
function toggleTheme() {
  _applyTheme(document.body.classList.contains('light') ? 'dark' : 'light');
}

/* ── Notification Banner ──────────────────────────────────────── */
let _activeBannerId = null;

async function _loadActiveBanner() {
  try {
    const res = await apiFetch(`${API}/notifications/active`);
    const banner = document.getElementById('notif-banner');
    if (!banner) return;

    if (!res?.success || !res.data?.length) {
      // No active notifications — hide banner
      hideBanner();
      return;
    }

    const n = res.data[0];
    // Don't re-show if same notification already displayed
    if (n.id === _activeBannerId && banner.classList.contains('show')) return;

    _activeBannerId = n.id;
    const author = (n.show_author && n.author_name) ? ` — ${n.author_name}` : '';
    const msgEl = banner.querySelector('.notif-msg') || document.getElementById('notif-text');
    if (msgEl) msgEl.textContent = n.message + author;

    // Show banner
    banner.classList.add('show');
    document.body.classList.add('has-banner');

    // Auto-hide when end_at expires
    if (n.end_at) {
      const msLeft = new Date(n.end_at).getTime() - Date.now();
      if (msLeft > 0 && msLeft < 24 * 3600 * 1000) {
        setTimeout(() => {
          if (_activeBannerId === n.id) hideBanner();
        }, msLeft);
      }
    }
  } catch(e) { /* silent — never break UI */ }
}

function hideBanner() {
  const b = document.getElementById('notif-banner');
  if (b) { b.classList.remove('show'); }
  document.body.classList.remove('has-banner');
  _activeBannerId = null;
}

function dismissBanner() {
  hideBanner();
}

/* ── Init ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  _initBarcodeScanner();
  const user = getUser();
  if (!user) return;

  // Apply saved theme
  _applyTheme(localStorage.getItem('masar_theme') || 'dark');

  document.getElementById('current-date').textContent =
    new Date().toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  document.getElementById('sidebar-user-name').textContent = user.name;
  document.getElementById('sidebar-user-role').textContent = user.role;
  const avEl = document.getElementById('user-avatar');
  if (avEl) avEl.textContent = user.name.charAt(0).toUpperCase();

  // ── Apply permissions-based UI filter ────────────────────────────
  // Permissions come from localStorage (set during login or /me refresh).
  // If not present yet, refresh them from /me endpoint.
  if (!user.permissions) {
    const meRes = await apiFetch(`${API}/auth/me`);
    if (meRes?.success) {
      const freshUser = { ...user, ...meRes.data };
      localStorage.setItem('masar_user', JSON.stringify(freshUser));
    }
  }
  applyPermissionsUI();

  // Load settings (currency + brand)
  const s = await apiFetch(`${API}/settings`);
  if (s?.success) {
    _currency = s.data.currency || 'ج';
    if (s.data.brand_name) {
      const bn = document.getElementById('sidebar-brand-name');
      if (bn) bn.textContent = s.data.brand_name;
      const mb = document.getElementById('mobile-brand-name');
      if (mb) mb.textContent = s.data.brand_name;
    }
    if (s.data.brand_logo) {
      const logoBox = document.getElementById('sidebar-logo-box');
      if (logoBox) logoBox.innerHTML = `<img src="${s.data.brand_logo}" alt="logo" style="width:100%;height:100%;object-fit:cover"/>`;
    }
  }

  // Range tab click handlers
  document.querySelectorAll('.range-tab').forEach(btn => {
    btn.addEventListener('click', () => setDashRange(btn.dataset.range));
  });

  // Load notification banner immediately then poll every 45s
  _loadActiveBanner();
  setInterval(_loadActiveBanner, 45000);

  loadDashboard();
});

/* ═══════════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════════ */
let _dashRange = 'month';

// Range tab click handler — attached after DOM ready
function setDashRange(range) {
  _dashRange = range;
  document.querySelectorAll('.range-tab').forEach(b => b.classList.toggle('active', b.dataset.range === range));
  loadDashboard();
}

async function loadDashboard() {
  // Show loading state in stat cards
  ['stat-revenue','stat-expenses','stat-profit','stat-orders'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>';
  });

  const res = await apiFetch(`${API}/dashboard/stats?range=${_dashRange}`);
  if (!res?.success) {
    ['stat-revenue','stat-expenses','stat-profit','stat-orders'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '—';
    });
    showToast('فشل تحميل Dashboard', 'error');
    return;
  }
  const d = res.data;

  // Fix: API returns totalSales not totalRevenue
  const elRev = document.getElementById('stat-revenue');
  if (elRev) elRev.textContent = fmt(d.totalSales ?? d.totalRevenue ?? 0);

  const elExp = document.getElementById('stat-expenses');
  if (elExp) elExp.textContent = fmt(d.totalExpenses ?? 0);

  const elProfit = document.getElementById('stat-profit');
  if (elProfit) elProfit.textContent = fmt(d.netProfit ?? d.totalProfit ?? 0);

  const elOrders = document.getElementById('stat-orders');
  if (elOrders) {
    const count = d.totalOrders ?? 0;
    const avg   = d.avgOrderValue ?? 0;
    elOrders.textContent = avg > 0 ? `${count} / ${fmt(avg)}` : String(count);
  }

  // Trend indicator
  const trendEl = document.getElementById('stat-trend');
  if (trendEl && d.trend != null) {
    const up = Number(d.trend) >= 0;
    trendEl.className = 'stat-trend ' + (up ? 'up' : 'down');
    trendEl.textContent = (up ? '▲ ' : '▼ ') + Math.abs(d.trend) + '% مقارنة بالفترة السابقة';
  }

  // Fix: API returns chartData not monthly
  _renderRevenueChart(d.chartData || d.monthly || []);
  _renderProductsChart(d.topProducts || []);
}

function _renderRevenueChart(data) {
  const ctx = document.getElementById('revenueChart')?.getContext('2d');
  if (!ctx) return;
  if (_revenueChart) _revenueChart.destroy();

  // Handle both {label, revenue} (chartData) and {month, revenue} (monthly) formats
  const labels  = data.map(m => m.label || m.month || '');
  const values  = data.map(m => m.revenue || 0);
  const maxVal  = Math.max(...values, 1);

  // Dynamic bar colors: low=red, medium=yellow, high=green
  const barColors = values.map(v => {
    const pct = v / maxVal;
    if (pct < 0.33) return 'rgba(239,68,68,0.75)';
    if (pct < 0.67) return 'rgba(234,179,8,0.8)';
    return 'rgba(34,197,94,0.85)';
  });

  _revenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'المبيعات',
        data: values,
        backgroundColor: barColors,
        borderRadius: 5,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#737373', font: { family: 'Cairo' } } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#737373', font: { family: 'Cairo' }, callback: v => v.toLocaleString() + ' ' + _currency } }
      }
    }
  });
}

function _renderProductsChart(products) {
  const ctx = document.getElementById('productsChart')?.getContext('2d');
  if (!ctx) return;
  if (_productsChart) _productsChart.destroy();

  if (!products.length) {
    // Draw "no data" message on canvas
    ctx.fillStyle = '#525252';
    ctx.font = '14px Cairo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('لا توجد بيانات', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  // Dynamic colors: top product = green, others descend
  const gradientColors = ['#22c55e','#4ade80','#eab308','#f97316','#ef4444'];

  _productsChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: products.map(p => p.name),
      datasets: [{
        data: products.map(p => p.revenue),
        backgroundColor: gradientColors.slice(0, products.length),
        borderColor: 'transparent',
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#a3a3a3', font: { family: 'Cairo', size: 11 }, padding: 10, boxWidth: 10 }
        }
      },
      cutout: '60%'
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   PRODUCTS
═══════════════════════════════════════════════════════════════ */
async function loadProducts(page = 1) {
  const search = document.getElementById('product-search')?.value || '';
  const tbody  = document.getElementById('products-tbody');
  tbody.innerHTML = `<tr class="loading-row"><td colspan="10"><span class="spinner"></span></td></tr>`;

  const res = await apiFetch(`${API}/products?search=${encodeURIComponent(search)}&page=${page}&limit=50`);
  if (!res?.success) { tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><p>فشل التحميل</p></div></td></tr>`; return; }
  _allProducts = res.data;

  if (!res.data.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><p>لا توجد منتجات</p>${hasRole('admin','manager','employee')?'<button class="btn-primary" style="margin-top:12px" onclick="openProductModal()">+ إضافة منتج</button>':''}</div></td></tr>`;
    return;
  }

  const canEdit = hasRole('admin','manager','employee');
  const canDel  = hasRole('admin','manager');

  tbody.innerHTML = res.data.map(p => {
    const thumb = p.image_url
      ? `<img src="${p.image_url}" class="product-thumb" alt="${esc(p.name)}" loading="lazy"/>`
      : `<div class="product-thumb-placeholder">—</div>`;
    const menuId = `pm-${p.id}`;
    return `<tr>
      <td>${thumb}</td>
      <td class="td-code">${esc(p.code)}</td>
      <td class="td-main">${esc(p.name)}</td>
      <td style="color:var(--white-dim)">${esc(p.color||'—')} / ${esc(p.size||'—')}</td>
      <td>${fmt(p.cost)}</td>
      <td style="color:var(--green);font-weight:600">${fmt(p.price)}</td>
      <td>${p.stock??0}</td>
      <td>${p.sold??0}</td>
      <td>
  <span style="font-family:monospace;font-size:.85rem;cursor:pointer;color:var(--green)"
    onclick="showBarcodeModal('${p.barcode||''}','${esc(p.name)}')">
    ${p.barcode||'—'}
  </span>

  <div style="margin-top:5px">
    <button onclick="printSingleLabel(${p.id})"
      style="font-size:11px;padding:3px 8px;border:none;background:#22c55e;border-radius:5px;cursor:pointer">
      طباعة
    </button>
  </div>
</td>
      <td>
        <div class="action-menu-wrap">
          <button class="btn-action-trigger" onclick="toggleMenu('${menuId}',event)">⋮</button>
          <div class="action-menu" id="${menuId}">
            ${canEdit?`<button class="action-menu-item" onclick="editProduct(${p.id});toggleMenu('${menuId}')">تعديل</button>`:''}
            ${canDel?`<div class="action-menu-divider"></div><button class="action-menu-item danger" onclick="deleteProduct(${p.id},'${esc(p.name)}');toggleMenu('${menuId}')">حذف</button>`:''}
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');

  renderPagination('products-pagination', res.pagination, 'loadProducts');
}

function openProductModal(product = null) {
  document.getElementById('product-id').value     = product?.id || '';
  document.getElementById('prod-code').value      = product?.code || '';
  document.getElementById('prod-name').value      = product?.name || '';
  document.getElementById('prod-color').value     = product?.color || '';
  document.getElementById('prod-size').value      = product?.size || '';
  document.getElementById('prod-cost').value      = product?.cost || '';
  document.getElementById('prod-price').value     = product?.price || '';
  document.getElementById('prod-quantity').value  = product?.stock || '';
  document.getElementById('modal-title').textContent = product ? 'تعديل منتج' : 'إضافة منتج جديد';

  const prev  = document.getElementById('product-img-preview');
  const place = document.getElementById('product-img-placeholder');
  if (product?.image_url) {
    prev.src = product.image_url; prev.style.display = 'block'; place.style.display = 'none';
  } else {
    prev.style.display = 'none'; place.style.display = 'flex';
  }
  document.getElementById('product-image-input').value = '';
  document.getElementById('product-modal').classList.add('open');
}

function previewProductImg(input) {
  const file = input.files[0];
  if (!file) return;
  const prev = document.getElementById('product-img-preview');
  const place = document.getElementById('product-img-placeholder');
  prev.src = URL.createObjectURL(file);
  prev.style.display = 'block';
  place.style.display = 'none';
}

function closeProductModal(e) {
  if (e && e.target !== document.getElementById('product-modal')) return;
  document.getElementById('product-modal').classList.remove('open');
}

async function editProduct(id) {
  const res = await apiFetch(`${API}/products/${id}`);
  if (!res?.success) { showToast('فشل تحميل المنتج', 'error'); return; }
  openProductModal(res.data);
}

async function saveProduct() {
  const id  = document.getElementById('product-id').value;
  const btn = document.getElementById('btn-save-product');
  btn.disabled = true; btn.textContent = 'جاري الحفظ...';

  const fd = new FormData();
  fd.append('code',     document.getElementById('prod-code').value.trim());
  fd.append('name',     document.getElementById('prod-name').value.trim());
  fd.append('color',    document.getElementById('prod-color').value.trim());
  fd.append('size',     document.getElementById('prod-size').value.trim());
  fd.append('cost',     document.getElementById('prod-cost').value || '0');
  fd.append('price',    document.getElementById('prod-price').value || '0');
  fd.append('quantity', document.getElementById('prod-quantity').value || '0');
  const imgFile = document.getElementById('product-image-input').files[0];
  if (imgFile) fd.append('image', imgFile);

  if (!fd.get('code') || !fd.get('name')) {
    showToast('الكود والاسم مطلوبان', 'error');
    btn.disabled = false; btn.textContent = 'حفظ المنتج';
    return;
  }

  const data = await apiUpload(
    id ? `${API}/products/${id}` : `${API}/products`,
    fd,
    id ? 'PUT' : 'POST'
  );
  btn.disabled = false; btn.textContent = 'حفظ المنتج';
  if (!data) return;
  if (!data.success) { showToast(data.message, 'error'); return; }
  showToast(id ? 'تم تحديث المنتج' : 'تم إضافة المنتج');
  closeProductModal();
  loadProducts();
}

async function deleteProduct(id, name) {
  if (!confirm(`حذف المنتج "${name}"؟`)) return;
  const data = await apiFetch(`${API}/products/${id}`, { method: 'DELETE' });
  if (data?.success) { showToast('تم الحذف'); loadProducts(); }
  else showToast(data?.message, 'error');
}

/* ═══════════════════════════════════════════════════════════════
   INVENTORY
═══════════════════════════════════════════════════════════════ */
async function loadInventory() {
  const tbody = document.getElementById('inventory-tbody');
  tbody.innerHTML = `<tr class="loading-row"><td colspan="8"><span class="spinner"></span></td></tr>`;
  const res = await apiFetch(`${API}/inventory`);
  if (!res?.success) return;
  if (!res.data.length) { tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>لا يوجد مخزون</p></div></td></tr>`; return; }

  tbody.innerHTML = res.data.map(item => {
    const pct   = item.quantity > 0 ? Math.round((item.remaining / item.quantity) * 100) : 0;
    const color = pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--yellow)' : 'var(--red)';
    const badge = item.remaining === 0
      ? '<span class="badge badge-red">نفد</span>'
      : item.remaining <= 5
        ? '<span class="badge badge-yellow">منخفض</span>'
        : '<span class="badge badge-green">متاح</span>';
    return `<tr>
      <td class="td-code">${esc(item.code)}</td>
      <td class="td-main">${esc(item.name)}</td>
      <td style="color:var(--white-dim)">${esc(item.color||'—')} / ${esc(item.size||'—')}</td>
      <td>${item.quantity}</td>
      <td>${item.sold}</td>
      <td style="font-weight:700;color:${color}">${item.remaining}</td>
      <td>${badge}</td>
      <td>
        ${hasRole('admin','manager') ? `<input type="number" min="0" value="${item.quantity}"
          style="width:70px;background:var(--bg-3);border:1px solid var(--border-2);border-radius:6px;padding:5px 8px;color:var(--white);font-family:Cairo,sans-serif;font-size:0.82rem;outline:none;text-align:center"
          onchange="updateStock(${item.id},this.value)"
          onkeydown="if(event.key==='Enter')this.blur()"/>` : item.quantity}
      </td>
    </tr>`;
  }).join('');
}

async function updateStock(productId, qty) {
  const data = await apiFetch(`${API}/inventory/${productId}`, { method:'PUT', body: JSON.stringify({ quantity: parseInt(qty) }) });
  if (data?.success) showToast('تم تحديث المخزون');
  else { showToast(data?.message || 'فشل التحديث', 'error'); loadInventory(); }
}

/* ═══════════════════════════════════════════════════════════════
   ORDERS
═══════════════════════════════════════════════════════════════ */
let _orderItems = [];

const STATUS_LABELS = { pending:'Pending', confirmed:'Confirmed', shipped:'Shipped', delivered:'Delivered', cancelled:'Cancelled' };
const STATUS_BADGE  = { pending:'badge-grey', confirmed:'badge-blue', shipped:'badge-blue', delivered:'badge-green', cancelled:'badge-red' };
const STATUS_AR     = { pending:'قيد الانتظار', confirmed:'مؤكد', shipped:'تم الشحن', delivered:'تم التسليم', cancelled:'ملغي' };
const PAY_LABELS    = { visa:'Visa', vodafone_cash:'Vodafone Cash', cash_on_delivery:'Cash on Delivery' };

const statusBadge    = s  => `<span class="badge ${STATUS_BADGE[s]||'badge-grey'}">${STATUS_LABELS[s]||s}</span>`;
const payStatusBadge = ps => ps==='paid' ? `<span class="badge badge-green">Paid</span>` : `<span class="badge badge-red">Unpaid</span>`;

async function _fetchProducts() {
  const res = await apiFetch(`${API}/products?limit=200`);
  if (res?.success) _allProducts = res.data;
}

async function loadOrders(page = 1) {
  const search = document.getElementById('orders-search')?.value || '';
  const status = document.getElementById('orders-status-filter')?.value || '';
  const from   = document.getElementById('orders-from')?.value || '';
  const to     = document.getElementById('orders-to')?.value   || '';
  const tbody  = document.getElementById('orders-tbody');
  tbody.innerHTML = `<tr class="loading-row"><td colspan="9"><span class="spinner"></span></td></tr>`;

  const res = await apiFetch(`${API}/orders?${new URLSearchParams({search,status,from,to,page,limit:50})}`);
  if (!res?.success) { tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><p>فشل التحميل</p></div></td></tr>`; return; }

  if (!res.data.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><p>لا توجد أوردرات</p></div></td></tr>`;
    return;
  }

  const canDelete = hasRole('admin','manager');
  tbody.innerHTML = res.data.map(o => {
    const menuId = `om-${o.id}`;
    return `<tr class="${o.status==='cancelled'?'row-cancelled':''}">
      <td><span class="order-num" onclick="viewOrder(${o.id})">${esc(o.order_number)}</span>${o.barcode?`<div style="font-family:monospace;font-size:.62rem;color:var(--white-faint);cursor:pointer;margin-top:2px" onclick="showBarcodeModal('${o.barcode}','${esc(o.order_number)}',event)">${o.barcode}</div>`:''}</td>
      <td>
        <div class="td-main">${esc(o.customer_name||'—')}</div>
        ${o.phone?`<div style="font-size:0.75rem;color:var(--white-faint)">${esc(o.phone)}</div>`:''}
      </td>
      <td>${statusBadge(o.status)}</td>
      <td>
        ${payStatusBadge(o.payment_status)}
        ${o.payment_method?`<div style="font-size:0.73rem;color:var(--white-faint);margin-top:2px">${PAY_LABELS[o.payment_method]||o.payment_method}</div>`:''}
      </td>
      <td><span class="badge badge-grey">${o.items_count}</span></td>
      <td style="font-weight:600">${fmt(o.total)}</td>
      <td style="font-weight:700;color:var(--green)">${fmt(o.grand_total)}</td>
      <td style="color:var(--white-faint);font-size:0.8rem">${fmtDate(o.created_at)}</td>
      <td>
        <div class="action-menu-wrap">
          <button class="btn-action-trigger" onclick="toggleMenu('${menuId}',event)">⋮</button>
          <div class="action-menu" id="${menuId}">
            <button class="action-menu-item" onclick="viewOrder(${o.id});toggleMenu('${menuId}')">عرض التفاصيل</button>
            ${o.status!=='cancelled'?`<button class="action-menu-item" onclick="openEditOrderForm(${o.id});toggleMenu('${menuId}')">تعديل</button>`:''}
            <button class="action-menu-item" onclick="openStatusModal(${o.id},'${o.status}','${o.payment_method||''}','${o.payment_status}');toggleMenu('${menuId}')">تحديث الحالة</button>
            <button class="action-menu-item" onclick="printOrder(${o.id});toggleMenu('${menuId}')">طباعة الفاتورة</button>
            <div class="action-menu-divider"></div>
            ${o.status!=='cancelled'?`<button class="action-menu-item danger" onclick="cancelOrder(${o.id},'${esc(o.order_number)}');toggleMenu('${menuId}')">إلغاء الأوردر</button>`:''}
            ${canDelete?`<button class="action-menu-item danger" onclick="deleteOrder(${o.id},'${esc(o.order_number)}');toggleMenu('${menuId}')">حذف نهائي</button>`:''}
          </div>
        </div>
      </td>
    </tr>`;
  }).join('');

  renderPagination('orders-pagination', res.pagination, 'loadOrders');
}

/* Order form */
function openNewOrderForm() {
  _orderItems = [];
  document.getElementById('editing-order-id').value  = '';
  document.getElementById('order-form-title').textContent = 'إنشاء أوردر جديد';
  ['order-customer','order-phone','order-address','order-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('order-payment-method').value = '';
  document.getElementById('order-shipping').value = '0';
  _renderOrderItems();
  document.getElementById('order-form').style.display = 'block';
  addOrderItem();
  document.getElementById('order-form').scrollIntoView({ behavior:'smooth', block:'start' });
}

async function openEditOrderForm(id) {
  const res = await apiFetch(`${API}/orders/${id}`);
  if (!res?.data) { showToast('فشل تحميل الأوردر','error'); return; }
  await _fetchProducts();
  const d = res.data;
  _orderItems = d.items.map(i => ({ product_id:i.product_id, quantity:i.quantity, price:i.unit_price }));
  document.getElementById('editing-order-id').value        = id;
  document.getElementById('order-form-title').textContent  = `تعديل: ${d.order_number}`;
  document.getElementById('order-customer').value          = d.customer_name || '';
  document.getElementById('order-phone').value             = d.phone || '';
  document.getElementById('order-address').value           = d.address || '';
  document.getElementById('order-notes').value             = d.notes || '';
  document.getElementById('order-payment-method').value    = d.payment_method || '';
  document.getElementById('order-shipping').value          = d.shipping_price || 0;
  _renderOrderItems();
  document.getElementById('order-form').style.display = 'block';
  document.getElementById('order-form').scrollIntoView({ behavior:'smooth', block:'start' });
  closeOrderDetail();
}

function closeOrderForm() {
  document.getElementById('order-form').style.display = 'none';
  _orderItems = [];
}

function addOrderItem()     { _orderItems.push({ product_id:'', quantity:1, price:0 }); _renderOrderItems(); }
function removeOrderItem(i) { _orderItems.splice(i,1); _renderOrderItems(); }

function _renderOrderItems() {
  const c = document.getElementById('order-items-container');
  if (!_orderItems.length) { c.innerHTML=''; updateOrderTotal(); return; }
  c.innerHTML = _orderItems.map((item,idx) => `
    <div class="order-item-row">
      <div class="form-group" style="margin-bottom:0">
        <label>المنتج</label>
        <select onchange="_onProductSelect(${idx},this.value)">
          <option value="">-- اختر منتج --</option>
          ${_allProducts.map(p => {
            const rem = (p.stock||0)-(p.sold||0);
            return `<option value="${p.id}" ${item.product_id==p.id?'selected':''}>${esc(p.code)} — ${esc(p.name)} ${p.color?'('+esc(p.color)+')':''} | ${fmt(p.price)} | متاح: ${rem}</option>`;
          }).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label>الكمية</label>
        <input type="number" min="1" value="${item.quantity}" onchange="_onQtyChange(${idx},this.value)"/>
      </div>
      <div>
        <div style="font-size:0.72rem;color:var(--white-faint);margin-bottom:5px;text-transform:uppercase">المجموع</div>
        <div class="order-item-total" id="iTotal-${idx}">${fmt(item.price*item.quantity)}</div>
      </div>
      <button class="btn-remove-item" onclick="removeOrderItem(${idx})" title="حذف">✕</button>
    </div>`).join('');
  updateOrderTotal();
}

function _onProductSelect(idx,pid) {
  const p = _allProducts.find(p=>p.id==pid);
  _orderItems[idx].product_id = pid;
  _orderItems[idx].price = p ? p.price : 0;
  const el = document.getElementById(`iTotal-${idx}`);
  if (el) el.textContent = fmt(_orderItems[idx].price * _orderItems[idx].quantity);
  updateOrderTotal();
}

function _onQtyChange(idx,qty) {
  _orderItems[idx].quantity = parseInt(qty)||1;
  const el = document.getElementById(`iTotal-${idx}`);
  if (el) el.textContent = fmt(_orderItems[idx].price * _orderItems[idx].quantity);
  updateOrderTotal();
}

function updateOrderTotal() {
  const sub  = _orderItems.reduce((s,i) => s + (Number(i.price||0) * Number(i.quantity||0)), 0);
  const ship = parseFloat(document.getElementById('order-shipping')?.value) || 0;
  const total = sub + ship;
  const setEl = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = fmt(v); };
  setEl('order-subtotal-live', sub);
  setEl('order-shipping-live', ship);
  setEl('order-total-live',    total);
}

async function submitOrder() {
  const editId = document.getElementById('editing-order-id').value;
  const items  = _orderItems.filter(i=>i.product_id);
  if (!items.length) { showToast('أضف منتجاً على الأقل','error'); return; }
  const ship = parseFloat(document.getElementById('order-shipping').value)||0;
  if (ship < 0) { showToast('سعر الشحن لا يمكن أن يكون سالباً','error'); return; }

  const btn = document.getElementById('btn-submit-order');
  btn.disabled = true; btn.textContent = 'جاري الحفظ...';

  const body = {
    customer_name:  document.getElementById('order-customer').value.trim(),
    phone:          document.getElementById('order-phone').value.trim(),
    address:        document.getElementById('order-address').value.trim(),
    notes:          document.getElementById('order-notes').value.trim(),
    payment_method: document.getElementById('order-payment-method').value || null,
    shipping_price: ship,
    items: items.map(i=>({ product_id:parseInt(i.product_id), quantity:i.quantity }))
  };

  const data = await apiFetch(
    editId ? `${API}/orders/${editId}` : `${API}/orders`,
    { method: editId?'PUT':'POST', body: JSON.stringify(body) }
  );
  btn.disabled = false; btn.textContent = 'حفظ الأوردر';
  if (!data) return;
  if (!data.success) { showToast(data.message,'error'); return; }
  showToast(editId ? 'تم تحديث الأوردر' : `تم حفظ الأوردر ${data.orderNumber}`);
  closeOrderForm();
  loadOrders();
}

/* Order detail modal */
async function viewOrder(id) {
  const res = await apiFetch(`${API}/orders/${id}`);
  if (!res?.data) return;
  const d = res.data;
  document.getElementById('order-detail-title').textContent = `أوردر: ${d.order_number}`;
  document.getElementById('order-detail-status-badge').innerHTML = statusBadge(d.status);
  document.getElementById('detail-print-btn').onclick = () => printOrder(id);

  document.getElementById('order-detail-body').innerHTML = `
    <div class="order-detail-grid">
      <div class="detail-field"><div class="lbl">الباركود</div><div class="val" style="font-family:monospace;cursor:pointer" onclick="showBarcodeModal('${d.barcode||''}','${esc(d.order_number)}')">${d.barcode||'—'}</div></div>
      <div class="detail-field"><div class="lbl">رقم الأوردر</div><div class="val" style="color:var(--green);font-family:'Courier New',monospace">${esc(d.order_number)}</div></div>
      <div class="detail-field"><div class="lbl">التاريخ</div><div class="val">${fmtDate(d.created_at)}</div></div>
      <div class="detail-field"><div class="lbl">العميل</div><div class="val">${esc(d.customer_name||'—')}</div></div>
      <div class="detail-field"><div class="lbl">الهاتف</div><div class="val">${esc(d.phone||'—')}</div></div>
      <div class="detail-field" style="grid-column:span 2"><div class="lbl">العنوان</div><div class="val">${esc(d.address||'—')}</div></div>
      <div class="detail-field"><div class="lbl">طريقة الدفع</div><div class="val">${PAY_LABELS[d.payment_method]||'—'}</div></div>
      <div class="detail-field"><div class="lbl">حالة الدفع</div><div class="val">${payStatusBadge(d.payment_status)}</div></div>
      ${d.notes?`<div class="detail-field" style="grid-column:span 2"><div class="lbl">ملاحظات</div><div class="val">${esc(d.notes)}</div></div>`:''}
    </div>
    <div class="table-wrapper" style="margin:14px 0">
      <table class="data-table">
        <thead><tr><th>الكود</th><th>المنتج</th><th>اللون</th><th>المقاس</th><th>الكمية</th><th>سعر الوحدة</th><th>المجموع</th></tr></thead>
        <tbody>${d.items.map(i=>`
          <tr>
            <td class="td-code">${esc(i.code)}</td>
            <td class="td-main">${esc(i.name)}</td>
            <td>${esc(i.color||'—')}</td>
            <td>${esc(i.size||'—')}</td>
            <td style="font-weight:700">${i.quantity}</td>
            <td>${fmt(i.unit_price)}</td>
            <td style="font-weight:700">${fmt(i.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="order-summary-box">
      <div class="summary-row"><span>المنتجات</span><span>${fmt(d.total)}</span></div>
      <div class="summary-row"><span>الشحن</span><span>${fmt(d.shipping_price||0)}</span></div>
      <div class="summary-row summary-total"><span>الإجمالي الكلي</span><span style="color:var(--green)">${fmt(d.grand_total)}</span></div>
    </div>`;
  document.getElementById('order-detail-modal').classList.add('open');
}

function closeOrderDetail(e) {
  if (e && e.target !== document.getElementById('order-detail-modal')) return;
  document.getElementById('order-detail-modal').classList.remove('open');
}

function openStatusModal(id,status,payMethod,payStatus) {
  document.getElementById('status-order-id').value        = id;
  document.getElementById('status-select').value          = status;
  document.getElementById('status-payment-method').value  = payMethod||'';
  document.getElementById('status-payment-status').value  = payStatus||'unpaid';
  document.getElementById('order-status-modal').classList.add('open');
}
function closeStatusModal(e) {
  if (e && e.target !== document.getElementById('order-status-modal')) return;
  document.getElementById('order-status-modal').classList.remove('open');
}
async function saveOrderStatus() {
  const id             = document.getElementById('status-order-id').value;
  const status         = document.getElementById('status-select').value;
  const payment_method = document.getElementById('status-payment-method').value || null;
  const payment_status = document.getElementById('status-payment-status').value;
  const data = await apiFetch(`${API}/orders/${id}/status`,{ method:'PUT', body:JSON.stringify({status,payment_method,payment_status}) });
  if (!data) return;
  if (!data.success) { showToast(data.message,'error'); return; }
  showToast('تم تحديث الحالة');
  closeStatusModal();
  loadOrders();
}

async function cancelOrder(id,num) {
  if (!confirm(`إلغاء الأوردر ${num}؟\n(ستُعاد الكميات للمخزون)`)) return;
  const data = await apiFetch(`${API}/orders/${id}/cancel`,{ method:'PUT' });
  if (data?.success) { showToast('تم الإلغاء وإعادة المخزون'); loadOrders(); }
  else showToast(data?.message,'error');
}
async function deleteOrder(id,num) {
  if (!confirm(`حذف الأوردر ${num} نهائياً؟`)) return;
  const data = await apiFetch(`${API}/orders/${id}`,{ method:'DELETE' });
  if (data?.success) { showToast('تم الحذف'); loadOrders(); }
  else showToast(data?.message,'error');
}

/* Print invoice */
async function printOrder(id) {
  const [orderRes, settingsRes] = await Promise.all([
    apiFetch(`${API}/orders/${id}`),
    apiFetch(`${API}/settings`)
  ]);
  if (!orderRes?.data) { showToast('فشل تحميل الأوردر','error'); return; }
  const d = orderRes.data;
  const s = settingsRes?.data || {};
  const cur = s.currency || 'ج';
  const fmtP = n => Number(n||0).toLocaleString('ar-EG',{minimumFractionDigits:2})+' '+cur;

  const win = window.open('','_blank','width=820,height=960');
  win.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="UTF-8"/><title>فاتورة ${esc(d.order_number)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Cairo',sans-serif;background:#fff;color:#111;padding:36px;font-size:13.5px}
.inv-hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;padding-bottom:20px;border-bottom:3px solid #111}
.brand-blk .bn{font-size:2.2rem;font-weight:900;letter-spacing:3px;line-height:1}
.brand-blk .bs{font-size:.7rem;color:#888;letter-spacing:2px;text-transform:uppercase;margin-top:2px}
.brand-blk .bp{font-size:.78rem;color:#555;margin-top:5px}
.brand-blk img{height:48px;width:auto;margin-bottom:8px}
.inv-meta{text-align:left}.inv-num{font-size:.95rem;font-weight:700}
.inv-date{font-size:.8rem;color:#666;margin-top:3px}
.sc{display:inline-block;padding:2px 11px;border-radius:20px;font-size:.72rem;font-weight:700;margin-top:6px}
.s-pending{background:#f3f4f6;color:#6b7280}.s-confirmed,.s-shipped{background:#dbeafe;color:#1d4ed8}
.s-delivered{background:#dcfce7;color:#16a34a}.s-cancelled{background:#fee2e2;color:#dc2626}
.sec-lbl{font-size:.67rem;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#999;margin-bottom:7px}
.cust-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px;padding:16px;background:#f9fafb;border-radius:8px}
.cf .lbl{font-size:.67rem;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
.cf .val{font-weight:600;color:#111}
table{width:100%;border-collapse:collapse;margin-bottom:18px}
thead tr{background:#111;color:#fff}
th{padding:8px 11px;text-align:right;font-size:.75rem;font-weight:600}
td{padding:9px 11px;border-bottom:1px solid #f0f0f0;font-size:.875rem}
.sumtbl{width:260px;margin-right:auto}
.sumtbl td{border:none;padding:5px 10px}
.sumtbl .tot td{font-size:.95rem;font-weight:800;border-top:2px solid #111;padding-top:9px}
.footer{margin-top:32px;padding-top:12px;border-top:1px solid #e5e7eb;text-align:center;font-size:.72rem;color:#999}
@media print{button{display:none!important}@page{margin:1cm}}
</style></head><body>
<div class="inv-hdr">
  <div class="brand-blk">
    ${s.brand_logo?`<img src="${s.brand_logo}" alt="logo"/>`:''}
    <div class="bn">${esc(s.brand_name||'MASAR')}</div>
    <div class="bs">Brand Manager</div>
    ${s.brand_phone?`<div class="bp">${esc(s.brand_phone)}</div>`:''}
    ${s.brand_address?`<div class="bp">${esc(s.brand_address)}</div>`:''}
  </div>
  <div class="inv-meta">
    <div class="inv-num">${esc(d.order_number)}</div>
    <div class="inv-date">${new Date(d.created_at).toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'})}</div>
    <div><span class="sc s-${d.status}">${STATUS_AR[d.status]||d.status}</span></div>
  </div>
</div>
<div class="sec-lbl">بيانات العميل</div>
<div class="cust-grid">
  <div class="cf"><div class="lbl">الاسم</div><div class="val">${esc(d.customer_name||'—')}</div></div>
  <div class="cf"><div class="lbl">الهاتف</div><div class="val">${esc(d.phone||'—')}</div></div>
  <div class="cf"><div class="lbl">طريقة الدفع</div><div class="val">${PAY_LABELS[d.payment_method]||'—'}</div></div>
  <div class="cf" style="grid-column:span 3"><div class="lbl">العنوان</div><div class="val">${esc(d.address||'—')}</div></div>
  ${d.notes?`<div class="cf" style="grid-column:span 3"><div class="lbl">ملاحظات</div><div class="val">${esc(d.notes)}</div></div>`:''}
</div>
<div class="sec-lbl">المنتجات</div>
<table>
  <thead><tr><th>الكود</th><th>المنتج</th><th>اللون</th><th>المقاس</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr></thead>
  <tbody>${d.items.map(i=>`<tr><td>${esc(i.code)}</td><td><strong>${esc(i.name)}</strong></td><td>${esc(i.color||'—')}</td><td>${esc(i.size||'—')}</td><td>${i.quantity}</td><td>${fmtP(i.unit_price)}</td><td><strong>${fmtP(i.total)}</strong></td></tr>`).join('')}</tbody>
</table>
<table class="sumtbl">
  <tr><td>المنتجات</td><td>${fmtP(d.total)}</td></tr>
  <tr><td>الشحن</td><td>${fmtP(d.shipping_price||0)}</td></tr>
  <tr class="tot"><td>الإجمالي</td><td>${fmtP(d.grand_total)}</td></tr>
</table>
<div class="footer">${esc(s.brand_name||'MASAR')} — شكراً لثقتك بنا</div>
<script>window.onload=()=>{window.print()}<\/script>
</body></html>`);
  win.document.close();
}

/* ═══════════════════════════════════════════════════════════════
   EXPENSES
═══════════════════════════════════════════════════════════════ */
async function loadExpenses() {
  const from  = document.getElementById('exp-from')?.value||'';
  const to    = document.getElementById('exp-to')?.value||'';
  const tbody = document.getElementById('expenses-tbody');
  const res   = await apiFetch(`${API}/expenses?from=${from}&to=${to}&limit=200`);
  if (!res?.success) return;

  const total = res.data.reduce((s,e)=>s+e.amount,0);
  document.getElementById('expenses-total').textContent = fmt(total);

  if (!res.data.length) { tbody.innerHTML=`<tr><td colspan="5"><div class="empty-state"><p>لا توجد مصاريف</p></div></td></tr>`; return; }

  const canDel = hasRole('admin','accountant');
  tbody.innerHTML = res.data.map(e=>`
    <tr>
      <td><span class="badge badge-yellow">${esc(e.type)}</span></td>
      <td>${esc(e.details||'—')}</td>
      <td style="color:var(--red);font-weight:700">${fmt(e.amount)}</td>
      <td style="color:var(--white-faint);font-size:.82rem">${fmtDate(e.created_at)}</td>
      <td>${canDel?`<button class="btn-icon btn-danger" onclick="deleteExpense(${e.id})">حذف</button>`:''}</td>
    </tr>`).join('');
}

async function addExpense() {
  const type   = document.getElementById('exp-type').value;
  const details= document.getElementById('exp-details').value;
  const amount = parseFloat(document.getElementById('exp-amount').value);
  if (!type)           { showToast('اختر نوع المصروف','error'); return; }
  if (!amount||amount<=0){ showToast('أدخل مبلغاً صحيحاً','error'); return; }
  const data = await apiFetch(`${API}/expenses`,{ method:'POST', body:JSON.stringify({type,details,amount}) });
  if (data?.success) {
    showToast('تم تسجيل المصروف');
    ['exp-type','exp-details','exp-amount'].forEach(id=>document.getElementById(id).value='');
    loadExpenses();
  } else showToast(data?.message,'error');
}

async function deleteExpense(id) {
  if (!confirm('حذف هذا المصروف؟')) return;
  const data = await apiFetch(`${API}/expenses/${id}`,{ method:'DELETE' });
  if (data?.success) { showToast('تم الحذف'); loadExpenses(); }
  else showToast(data?.message,'error');
}

/* ═══════════════════════════════════════════════════════════════
   LOGS
═══════════════════════════════════════════════════════════════ */
async function loadLogs(page=1) {
  const action = document.getElementById('log-action-filter')?.value||'';
  const from   = document.getElementById('log-from')?.value||'';
  const to     = document.getElementById('log-to')?.value||'';
  const tbody  = document.getElementById('logs-tbody');
  tbody.innerHTML = `<tr class="loading-row"><td colspan="7"><span class="spinner"></span></td></tr>`;
  const res = await apiFetch(`${API}/logs?${new URLSearchParams({action,from,to,page,limit:100})}`);
  if (!res?.success) { tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><p>${res?.message||'غير مصرح'}</p></div></td></tr>`; return; }
  if (!res.data.length) { tbody.innerHTML=`<tr><td colspan="7"><div class="empty-state"><p>لا توجد سجلات</p></div></td></tr>`; return; }

  tbody.innerHTML = res.data.map(l=>{
    const al = l.action.toLowerCase();
    const cls = al.includes('delete')?'del':al.includes('login')||al.includes('logout')?'auth':al.includes('update')||al.includes('cancel')?'warn':'';
    const canUndo = l.snapshot && (l.action==='DELETE_ORDER'||l.action==='DELETE_PRODUCT');
    return `<tr>
      <td style="color:var(--white-faint);font-size:.75rem;white-space:nowrap">${fmtDT(l.created_at)}</td>
      <td class="td-main">${esc(l.user_name||'—')}</td>
      <td><span class="log-action ${cls}">${esc(l.action)}</span></td>
      <td style="color:var(--white-dim)">${esc(l.entity||'—')}</td>
      <td style="color:var(--white-dim)">${l.entity_id||'—'}</td>
      <td style="font-size:.75rem;color:var(--white-faint);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.details||'—')}</td>
      <td>${canUndo?`<button class="btn-icon" onclick="undoLog(${l.id})">استعادة</button>`:''}</td>
    </tr>`;
  }).join('');
  renderPagination('logs-pagination',res.pagination,'loadLogs');
}

async function undoLog(id) {
  if (!confirm('استعادة هذا العنصر المحذوف؟')) return;
  const data = await apiFetch(`${API}/logs/${id}/undo`,{ method:'POST' });
  if (data?.success) { showToast(data.message||'تمت الاستعادة'); loadLogs(); }
  else showToast(data?.message,'error');
}

/* ═══════════════════════════════════════════════════════════════
   USERS
═══════════════════════════════════════════════════════════════ */
const ROLE_CLS = { admin:'role-admin', manager:'role-manager', accountant:'role-accountant', employee:'role-employee', developer:'role-developer' };

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML=`<tr class="loading-row"><td colspan="6"><span class="spinner"></span></td></tr>`;
  const res = await apiFetch(`${API}/auth/users`);
  if (!res?.success) { tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><p>${res?.message||'غير مصرح'}</p></div></td></tr>`; return; }
  const me = getUser()?.id;
  tbody.innerHTML = res.data.map(u=>`
    <tr>
      <td class="td-main">${esc(u.name)}</td>
      <td style="color:var(--white-dim);font-family:'Courier New',monospace;font-size:.85rem">${esc(u.phone)}</td>
      <td><span class="role-badge ${ROLE_CLS[u.role]||''}">${u.role}</span></td>
      <td>${u.is_active?'<span class="badge badge-green">نشط</span>':'<span class="badge badge-red">موقوف</span>'}</td>
      <td style="color:var(--white-faint);font-size:.8rem">${fmtDate(u.created_at)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn-icon" onclick="editUser(${u.id},'${esc(u.name)}','${esc(u.phone)}','${u.role}',${u.is_active})">تعديل</button>
          ${u.id!==me?`<button class="btn-icon btn-danger" onclick="deleteUser(${u.id},'${esc(u.name)}')">حذف</button>`:''}
        </div>
      </td>
    </tr>`).join('');
}

function openUserModal() {
  document.getElementById('user-edit-id').value = '';
  document.getElementById('user-modal-title').textContent = 'مستخدم جديد';
  ['user-name','user-phone','user-password','user-password-edit'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('user-role').value = 'employee';
  document.getElementById('user-active').value = '1';
  document.getElementById('user-pass-group').style.display = '';
  document.getElementById('user-pass-edit-group').style.display = 'none';
  document.getElementById('user-modal').classList.add('open');
}

function editUser(id,name,phone,role,is_active) {
  document.getElementById('user-edit-id').value = id;
  document.getElementById('user-modal-title').textContent = 'تعديل مستخدم';
  document.getElementById('user-name').value = name;
  document.getElementById('user-phone').value = phone;
  document.getElementById('user-role').value = role;
  document.getElementById('user-active').value = String(is_active);
  document.getElementById('user-pass-group').style.display = 'none';
  document.getElementById('user-pass-edit-group').style.display = '';
  document.getElementById('user-password-edit').value = '';
  document.getElementById('user-modal').classList.add('open');
}

function closeUserModal(e) {
  if (e && e.target !== document.getElementById('user-modal')) return;
  document.getElementById('user-modal').classList.remove('open');
}

async function saveUser() {
  const id   = document.getElementById('user-edit-id').value;
  const body = {
    name:      document.getElementById('user-name').value.trim(),
    phone:     document.getElementById('user-phone').value.trim(),
    role:      document.getElementById('user-role').value,
    is_active: parseInt(document.getElementById('user-active').value),
  };
  if (!id) {
    body.password = document.getElementById('user-password').value;
    if (!body.name||!body.phone||!body.password) { showToast('الاسم والهاتف وكلمة المرور مطلوبة','error'); return; }
  } else {
    const p = document.getElementById('user-password-edit').value;
    if (p) body.password = p;
  }
  const data = await apiFetch(id?`${API}/auth/users/${id}`:`${API}/auth/users`,{ method:id?'PUT':'POST', body:JSON.stringify(body) });
  if (!data) return;
  if (!data.success) { showToast(data.message,'error'); return; }
  showToast(id?'تم تحديث المستخدم':'تم إنشاء المستخدم');
  closeUserModal(); loadUsers();
}

async function deleteUser(id,name) {
  if (!confirm(`حذف المستخدم "${name}"؟`)) return;
  const data = await apiFetch(`${API}/auth/users/${id}`,{ method:'DELETE' });
  if (data?.success) { showToast('تم الحذف'); loadUsers(); }
  else showToast(data?.message,'error');
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS
═══════════════════════════════════════════════════════════════ */
async function loadSettings() {
  const res = await apiFetch(`${API}/settings`);
  if (!res?.success) return;
  const s = res.data;
  document.getElementById('set-brand-name').value    = s.brand_name    ||'';
  document.getElementById('set-brand-phone').value   = s.brand_phone   ||'';
  document.getElementById('set-brand-address').value = s.brand_address ||'';
  document.getElementById('set-currency').value      = s.currency      ||'ج';
  if (s.brand_logo) {
    const prev = document.getElementById('logo-preview');
    prev.src = s.brand_logo; prev.style.display = 'block';
  }
}

function previewLogo(input) {
  const file = input.files[0];
  if (!file) return;
  const prev = document.getElementById('logo-preview');
  prev.src = URL.createObjectURL(file); prev.style.display = 'block';
}

async function saveSettings() {
  const fd = new FormData();
  fd.append('brand_name',    document.getElementById('set-brand-name').value.trim());
  fd.append('brand_phone',   document.getElementById('set-brand-phone').value.trim());
  fd.append('brand_address', document.getElementById('set-brand-address').value.trim());
  fd.append('currency',      document.getElementById('set-currency').value.trim()||'ج');
  const logoFile = document.getElementById('logo-file-input').files[0];
  if (logoFile) fd.append('brand_logo_file', logoFile);
  const data = await apiUpload(`${API}/settings`, fd, 'PUT');
  if (data?.success) {
    showToast('تم حفظ الإعدادات');
    _currency = document.getElementById('set-currency').value.trim()||'ج';
    loadSettings();
  } else showToast(data?.message,'error');
}

async function saveApiSettings() {
  const fd = new FormData();
  fd.append('external_api_url', document.getElementById('set-api-url').value.trim());
  fd.append('external_api_key', document.getElementById('set-api-key').value.trim());
  const data = await apiUpload(`${API}/settings`, fd, 'PUT');
  if (data?.success) showToast('تم حفظ إعدادات API');
  else showToast(data?.message,'error');
}

async function changePassword() {
  const cur  = document.getElementById('set-cur-pass').value;
  const nw   = document.getElementById('set-new-pass').value;
  const conf = document.getElementById('set-confirm-pass').value;
  if (!cur||!nw) { showToast('أدخل كلمة المرور الحالية والجديدة','error'); return; }
  if (nw!==conf) { showToast('كلمتا المرور غير متطابقتين','error'); return; }
  if (nw.length<6){ showToast('كلمة المرور يجب أن تكون 6 أحرف+','error'); return; }
  const data = await apiFetch(`${API}/auth/me/password`,{ method:'PUT', body:JSON.stringify({ current_password:cur, new_password:nw }) });
  if (data?.success) {
    showToast('تم تغيير كلمة المرور');
    ['set-cur-pass','set-new-pass','set-confirm-pass'].forEach(id=>document.getElementById(id).value='');
  } else showToast(data?.message,'error');
}

/* ═══════════════════════════════════════════════════════════════
   EXTERNAL PRODUCTS
═══════════════════════════════════════════════════════════════ */
async function testAndImportExternal() {
  showToast('جاري جلب المنتجات...','info');
  const res = await apiFetch(`${API}/external/products`);
  if (!res?.success) { showToast(res?.message||'فشل الجلب','error'); return; }
  _extProducts = res.data;
  document.getElementById('ext-source-badge').innerHTML =
    res.source==='mock'
      ? `<span class="badge badge-yellow">Mock — لم يتم ضبط API بعد</span>`
      : `<span class="badge badge-green">Live API</span>`;
  const tbody = document.getElementById('ext-products-tbody');
  tbody.innerHTML = _extProducts.map((p,idx)=>`
    <tr>
      <td><input type="checkbox" class="ext-check" data-idx="${idx}"/></td>
      <td class="td-code">${esc(p.external_id||p.code||'—')}</td>
      <td class="td-main">${esc(p.name)}</td>
      <td>${esc(p.color||'—')}</td>
      <td>${esc(p.size||'—')}</td>
      <td style="color:var(--green)">${fmt(p.price||0)}</td>
    </tr>`).join('');
  document.getElementById('external-modal').classList.add('open');
}

function toggleAllExternal(cb) {
  document.querySelectorAll('.ext-check').forEach(c=>c.checked=cb.checked);
}

async function importExternal() {
  const selected = [];
  document.querySelectorAll('.ext-check:checked').forEach(cb=>selected.push(_extProducts[parseInt(cb.dataset.idx)]));
  if (!selected.length) { showToast('اختر منتجاً على الأقل','error'); return; }
  const data = await apiFetch(`${API}/external/products/import`,{ method:'POST', body:JSON.stringify({ products:selected }) });
  if (data?.success) {
    showToast(`تم استيراد ${data.data?.inserted?.length||0} منتج`);
    closeExternalModal(); loadProducts();
  } else showToast(data?.message,'error');
}

function closeExternalModal(e) {
  if (e && e.target !== document.getElementById('external-modal')) return;
  document.getElementById('external-modal').classList.remove('open');
}

/* ═══════════════════════════════════════════════════════════
═══════════════════════════════════════════════════════════ */
async function loadTasks(page = 1) {
  const statusFilter   = document.getElementById('tasks-status-filter')?.value   || '';
  const priorityFilter = document.getElementById('tasks-priority-filter')?.value || '';
  const mineFilter     = document.getElementById('tasks-mine-filter')?.value     || '';
  const list = document.getElementById('tasks-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><span class="spinner"></span></div>';

  const res = await apiFetch(`${API}/tasks?status=${statusFilter}&priority=${priorityFilter}&mine=${mineFilter}&page=${page}&limit=20`);
  if (!res?.success) {
    list.innerHTML = `<div class="empty-state"><p>${res?.message || 'فشل التحميل — تأكد من صلاحياتك'}</p></div>`;
    return;
  }
  if (!res.data.length) {
    list.innerHTML = `<div class="empty-state"><p>لا توجد مهام</p>${hasRole('admin','manager') ? '<button class="btn-primary" style="margin-top:12px" onclick="openTaskModal()">+ مهمة جديدة</button>' : ''}</div>`;
    return;
  }

  const TASK_STATUS_LABEL = { pending: 'قيد الانتظار', in_progress: 'جارٍ', completed: 'مكتمل', cancelled: 'ملغي' };
  const TASK_STATUS_CLS   = { pending: 'badge-grey', in_progress: 'badge-blue', completed: 'badge-green', cancelled: 'badge-red' };
  const PRIORITY_CLS      = { high: 'priority-high', medium: 'priority-medium', low: 'priority-low' };
  const canManage = hasRole('admin', 'manager');

  list.innerHTML = res.data.map(t => `
    <div class="task-card" style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:10px;border-right:3px solid ${t.priority==='high'?'var(--red)':t.priority==='medium'?'var(--yellow)':'var(--text-faint)'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span style="font-weight:700;color:var(--text)">${esc(t.title)}</span>
            <span class="badge ${TASK_STATUS_CLS[t.status] || 'badge-grey'}">${TASK_STATUS_LABEL[t.status] || t.status}</span>
            <span class="badge ${PRIORITY_CLS[t.priority] || 'priority-low'}">${t.priority}</span>
          </div>
          ${t.description ? `<div style="color:var(--text-dim);font-size:.82rem;margin-bottom:6px">${esc(t.description)}</div>` : ''}
          <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:.75rem;color:var(--text-faint)">
            <span>المكلّف: <strong style="color:var(--text-dim)">${esc(t.assigned_name || '—')}</strong></span>
            ${t.due_date ? `<span>الموعد: ${fmtDate(t.due_date)}</span>` : ''}
            <span>بواسطة: ${esc(t.creator_name || '—')}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
          ${t.status === 'pending'     ? `<button class="btn-icon" onclick="quickTaskStatus(${t.id},'in_progress')">بدء</button>` : ''}
          ${t.status === 'in_progress' ? `<button class="btn-icon" style="color:var(--green)" onclick="quickTaskStatus(${t.id},'completed')">إتمام</button>` : ''}
          ${canManage ? `<button class="btn-icon btn-danger" onclick="deleteTaskQuick(${t.id})">حذف</button>` : ''}
        </div>
      </div>
    </div>`).join('');

  renderPagination('tasks-pagination', res.pagination, 'loadTasks');
}

async function quickTaskStatus(id, status) {
  const data = await apiFetch(`${API}/tasks/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
  if (data?.success) { showToast('تم تحديث الحالة'); loadTasks(); }
  else showToast(data?.message || 'خطأ', 'error');
}

async function deleteTaskQuick(id) {
  if (!confirm('حذف هذه المهمة؟')) return;
  const data = await apiFetch(`${API}/tasks/${id}`, { method: 'DELETE' });
  if (data?.success) { showToast('تم الحذف'); loadTasks(); }
  else showToast(data?.message || 'خطأ', 'error');
}

function openTaskModal() {
  const modal = document.getElementById('task-modal');
  if (!modal) { showToast('نموذج المهام غير متوفر في هذه النسخة', 'info'); return; }
  // Load users for assignment
  apiFetch(`${API}/auth/users`).then(res => {
    if (!res?.success) return;
    const sel = document.getElementById('task-assigned');
    if (sel) sel.innerHTML = '<option value="">-- اختر موظفاً --</option>' + res.data.map(u => `<option value="${u.id}">${esc(u.name)} (${u.role})</option>`).join('');
  });
  document.getElementById('task-edit-id').value = '';
  document.getElementById('task-modal-title').textContent = 'مهمة جديدة';
  ['task-title', 'task-desc', 'task-due'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  const prio = document.getElementById('task-priority');
  if (prio) prio.value = 'medium';
  const stGrp = document.getElementById('task-status-group');
  if (stGrp) stGrp.style.display = 'none';
  modal.classList.add('open');
}

async function saveTask() {
  const id = document.getElementById('task-edit-id')?.value;
  const body = {
    title:       (document.getElementById('task-title')?.value || '').trim(),
    description: (document.getElementById('task-desc')?.value  || '').trim(),
    assigned_to: parseInt(document.getElementById('task-assigned')?.value || '0'),
    priority:    document.getElementById('task-priority')?.value || 'medium',
    due_date:    document.getElementById('task-due')?.value || null,
  };
  if (id) body.status = document.getElementById('task-status')?.value;
  if (!body.title)       { showToast('العنوان مطلوب', 'error'); return; }
  if (!body.assigned_to) { showToast('اختر موظفاً', 'error');   return; }
  const data = await apiFetch(id ? `${API}/tasks/${id}` : `${API}/tasks`, { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
  if (!data) return;
  if (!data.success) { showToast(data.message, 'error'); return; }
  showToast(id ? 'تم التحديث' : 'تم إنشاء المهمة');
  closeTaskModal();
  loadTasks();
}

function closeTaskModal(e) {
  if (e && e.target !== document.getElementById('task-modal')) return;
  document.getElementById('task-modal')?.classList.remove('open');
}

/* ═══════════════════════════════════════════════════════════
   REQUESTS
═══════════════════════════════════════════════════════════ */
async function loadRequests() {
  const status = document.getElementById('req-status-filter')?.value || '';
  const tbody  = document.getElementById('requests-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="loading-row"><td colspan="7"><span class="spinner"></span></td></tr>';

  const res = await apiFetch(`${API}/requests?status=${status}&limit=100`);
  if (!res?.success) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>${res?.message || 'فشل التحميل'}</p></div></td></tr>`;
    return;
  }
  if (!res.data.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>لا توجد طلبات</p></div></td></tr>`;
    return;
  }

  const REQ_TYPE_AR   = { request:'طلب عام', support:'دعم', issue:'مشكلة', leave:'إجازة' };
  const REQ_BADGE     = { pending:'badge-grey', approved:'badge-green', rejected:'badge-red' };
  const canManage = hasRole('admin', 'manager');

  tbody.innerHTML = res.data.map(r => `
    <tr>
      <td style="font-weight:600;color:var(--text)">${esc(r.title)}</td>
      <td><span class="badge badge-blue">${REQ_TYPE_AR[r.type] || r.type}</span></td>
      <td>${esc(r.user_name || '—')}</td>
      <td><span class="badge ${REQ_BADGE[r.status] || 'badge-grey'}">${r.status}</span></td>
      <td style="color:var(--text-dim);font-size:.8rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.response || '—')}</td>
      <td style="color:var(--text-faint);font-size:.78rem">${fmtDate(r.created_at)}</td>
      <td>
        ${canManage && r.status === 'pending' ? `<button class="btn-icon" onclick="handleRequest(${r.id},'${esc(r.title)}')">رد</button>` : ''}
        ${canManage ? `<button class="btn-icon btn-danger" onclick="deleteRequest(${r.id})">حذف</button>` : ''}
      </td>
    </tr>`).join('');
}

function openRequestModal() {
  const modal = document.getElementById('request-modal');
  if (!modal) { showToast('نموذج الطلبات غير متوفر', 'info'); return; }
  document.getElementById('req-edit-id').value = '';
  document.getElementById('req-modal-title').textContent = 'طلب جديد';
  ['req-title','req-desc'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  const rtEl = document.getElementById('req-type');
  if (rtEl) rtEl.value = 'request';
  const rrgEl = document.getElementById('req-response-group');
  if (rrgEl) rrgEl.style.display = 'none';
  modal.classList.add('open');
}

function handleRequest(id, title) {
  const modal = document.getElementById('request-modal');
  if (!modal) return;
  document.getElementById('req-edit-id').value = id;
  document.getElementById('req-modal-title').textContent = `رد على: ${title}`;
  const rrgEl = document.getElementById('req-response-group');
  if (rrgEl) rrgEl.style.display = 'block';
  modal.classList.add('open');
}

function closeRequestModal(e) {
  if (e && e.target !== document.getElementById('request-modal')) return;
  document.getElementById('request-modal')?.classList.remove('open');
}

async function saveRequest() {
  const id = document.getElementById('req-edit-id')?.value;
  if (id) {
    const status   = document.getElementById('req-status')?.value;
    const response = document.getElementById('req-response')?.value || '';
    const data = await apiFetch(`${API}/requests/${id}`, { method: 'PUT', body: JSON.stringify({ status, response }) });
    if (!data) return;
    if (!data.success) { showToast(data.message, 'error'); return; }
    showToast('تم الرد');
    closeRequestModal();
    loadRequests();
  } else {
    const type        = document.getElementById('req-type')?.value    || 'request';
    const title       = (document.getElementById('req-title')?.value  || '').trim();
    const description = (document.getElementById('req-desc')?.value   || '').trim();
    if (!title) { showToast('العنوان مطلوب', 'error'); return; }
    const data = await apiFetch(`${API}/requests`, { method: 'POST', body: JSON.stringify({ type, title, description }) });
    if (!data) return;
    if (!data.success) { showToast(data.message, 'error'); return; }
    showToast('تم إرسال الطلب');
    closeRequestModal();
    loadRequests();
  }
}

async function deleteRequest(id) {
  if (!confirm('حذف هذا الطلب؟')) return;
  const data = await apiFetch(`${API}/requests/${id}`, { method: 'DELETE' });
  if (data?.success) { showToast('تم الحذف'); loadRequests(); }
  else showToast(data?.message, 'error');
}

/* ═══════════════════════════════════════════════════════════
   LEAVE
═══════════════════════════════════════════════════════════ */
async function loadLeave() {
  const tbody = document.getElementById('leave-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr class="loading-row"><td colspan="7"><span class="spinner"></span></td></tr>';

  const res = await apiFetch(`${API}/leave?limit=100`);
  if (!res?.success) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>${res?.message || 'فشل التحميل'}</p></div></td></tr>`;
    return;
  }
  if (!res.data.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>لا توجد طلبات إجازة</p></div></td></tr>`;
    return;
  }

  const LEAVE_TYPE_AR = { leave: 'إجازة', permission: 'إذن', early_exit: 'خروج مبكر' };
  const LEAVE_BADGE   = { pending: 'badge-grey', approved: 'badge-green', rejected: 'badge-red' };
  const canManage = hasRole('admin', 'manager');

  tbody.innerHTML = res.data.map(lr => `
    <tr>
      <td style="font-weight:600;color:var(--text)">${esc(lr.user_name || '—')}</td>
      <td><span class="badge badge-blue">${LEAVE_TYPE_AR[lr.type] || lr.type}</span></td>
      <td style="color:var(--text-dim);font-size:.8rem">${esc(lr.reason || '—')}</td>
      <td style="color:var(--text-dim);font-size:.78rem">${fmtDate(lr.start_at)}</td>
      <td style="color:var(--text-dim);font-size:.78rem">${fmtDate(lr.end_at)}</td>
      <td><span class="badge ${LEAVE_BADGE[lr.status] || 'badge-grey'}">${lr.status}</span></td>
      <td>
        ${canManage && lr.status === 'pending' ? `
          <div style="display:flex;gap:5px">
            <button class="btn-icon" onclick="handleLeave(${lr.id},'approved')">قبول</button>
            <button class="btn-icon btn-danger" onclick="handleLeave(${lr.id},'rejected')">رفض</button>
          </div>` : ''}
      </td>
    </tr>`).join('');
}

function openLeaveModal() {
  const modal = document.getElementById('leave-modal');
  if (!modal) { showToast('نموذج الإجازات غير متوفر', 'info'); return; }
  document.getElementById('leave-edit-id').value = '';
  document.getElementById('leave-modal-title').textContent = 'طلب إجازة';
  ['leave-reason','leave-hours'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  ['leave-start','leave-end'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  const lt = document.getElementById('leave-type');
  if (lt) lt.value = 'leave';
  const las = document.getElementById('leave-admin-section');
  if (las) las.style.display = 'none';
  modal.classList.add('open');
}

function closeLeaveModal(e) {
  if (e && e.target !== document.getElementById('leave-modal')) return;
  document.getElementById('leave-modal')?.classList.remove('open');
}

async function saveLeave() {
  const type     = document.getElementById('leave-type')?.value    || 'leave';
  const reason   = document.getElementById('leave-reason')?.value  || '';
  const start_at = document.getElementById('leave-start')?.value;
  const end_at   = document.getElementById('leave-end')?.value;
  const hours    = document.getElementById('leave-hours')?.value   || null;
  if (!start_at || !end_at) { showToast('تواريخ البدء والانتهاء مطلوبة', 'error'); return; }
  const data = await apiFetch(`${API}/leave`, { method: 'POST', body: JSON.stringify({ type, reason, start_at, end_at, hours }) });
  if (!data) return;
  if (!data.success) { showToast(data.message, 'error'); return; }
  showToast('تم إرسال طلب الإجازة');
  closeLeaveModal();
  loadLeave();
}

async function handleLeave(id, status) {
  const data = await apiFetch(`${API}/leave/${id}`, { method: 'PUT', body: JSON.stringify({ status }) });
  if (data?.success) { showToast(status === 'approved' ? 'تم القبول' : 'تم الرفض'); loadLeave(); }
  else showToast(data?.message, 'error');
}

/* ═══════════════════════════════════════════════════════════
   PERMISSIONS PAGE
═══════════════════════════════════════════════════════════ */
let _allPermsData   = null;
let _rolePermsState = {};
let _userPermsState = {};

async function loadRolePermissions() {
  if (!_allPermsData) {
    const r = await apiFetch(`${API}/permissions`);
    if (r?.success) _allPermsData = r.data;
  }
  if (!_allPermsData) { showToast('فشل تحميل الصلاحيات', 'error'); return; }
  const role      = document.getElementById('perm-role-select')?.value || 'employee';
  const matrix    = _allPermsData.matrix || {};
  const rolePerms = matrix[role] || {};
  const grid      = document.getElementById('role-perms-grid');
  if (!grid) return;
  _rolePermsState = {};

  const groups = {};
  (_allPermsData.permissions || []).forEach(p => {
    if (!groups[p.group_name]) groups[p.group_name] = [];
    groups[p.group_name].push(p);
  });

  let html = '';
  Object.entries(groups).forEach(([grp, perms]) => {
    html += `<div style="grid-column:1/-1;font-size:.7rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;margin-top:10px;padding-bottom:4px;border-bottom:1px solid var(--border)">${grp}</div>`;
    perms.forEach(p => {
      const allowed = rolePerms[p.key] !== undefined ? rolePerms[p.key] : 0;
      _rolePermsState[p.key] = allowed;
      html += `<div class="perm-item">
        <span class="perm-label">${esc(p.label)}</span>
        <div class="perm-toggle">
          <button class="toggle-btn allow ${allowed ? 'active' : ''}" onclick="setRolePerm('${p.key}',1,this)">✔</button>
          <button class="toggle-btn deny ${!allowed ? 'active' : ''}" onclick="setRolePerm('${p.key}',0,this)">✖</button>
        </div>
      </div>`;
    });
  });
  grid.innerHTML = html;
}

async function setRolePerm(key, val, btn) {
  const role = document.getElementById('perm-role-select')?.value;
  if (!role) return;

  // Optimistic UI update
  const wrap = btn.closest('.perm-toggle');
  wrap.querySelectorAll('.allow').forEach(b => b.classList.toggle('active', val === 1));
  wrap.querySelectorAll('.deny').forEach(b  => b.classList.toggle('active', val === 0));

  // Persist immediately to DB
  const data = await apiFetch(`${API}/permissions/role/${role}`, {
    method: 'PUT',
    body: JSON.stringify({ permissions: { [key]: val } })
  });

  if (data?.success) {
    _rolePermsState[key] = val;
    _allPermsData = null; // invalidate cache so next load is fresh
  } else {
    // Revert UI on failure
    const prev = _rolePermsState[key];
    wrap.querySelectorAll('.allow').forEach(b => b.classList.toggle('active', prev === 1));
    wrap.querySelectorAll('.deny').forEach(b  => b.classList.toggle('active', prev === 0));
    showToast(data?.message || 'فشل حفظ الصلاحية', 'error');
  }
}

async function saveRolePermissions() {
  const role = document.getElementById('perm-role-select')?.value;
  if (!role) return;
  const data = await apiFetch(`${API}/permissions/role/${role}`, { method: 'PUT', body: JSON.stringify({ permissions: _rolePermsState }) });
  if (data?.success) {
    showToast('تم حفظ صلاحيات الدور ✓');
    _allPermsData = null;
    loadRolePermissions(); // reload to confirm DB state
  } else showToast(data?.message || 'فشل الحفظ', 'error');
}

async function loadPermUserList() {
  const res = await apiFetch(`${API}/auth/users`);
  const sel = document.getElementById('perm-user-select');
  if (!sel || !res?.success) return;
  sel.innerHTML = res.data.map(u => `<option value="${u.id}">${esc(u.name)} (${u.role})</option>`).join('');
}

async function loadUserPermissions() {
  const uid = document.getElementById('perm-user-select')?.value;
  if (!uid) return;
  if (!_allPermsData) {
    const r = await apiFetch(`${API}/permissions`);
    if (r?.success) _allPermsData = r.data;
  }
  const res = await apiFetch(`${API}/permissions/user/${uid}`);
  if (!res?.success) return;
  const overrides = res.data.overrides || {};
  const matrix    = _allPermsData.matrix || {};
  const rolePerms = matrix[res.data.user?.role] || {};
  _userPermsState = {};
  const groups = {};
  (_allPermsData.permissions || []).forEach(p => {
    if (!groups[p.group_name]) groups[p.group_name] = [];
    groups[p.group_name].push(p);
  });
  let html = '';
  Object.entries(groups).forEach(([grp, perms]) => {
    html += `<div style="grid-column:1/-1;font-size:.7rem;font-weight:700;color:var(--text-faint);text-transform:uppercase;letter-spacing:1px;margin-top:10px;padding-bottom:4px;border-bottom:1px solid var(--border)">${grp}</div>`;
    perms.forEach(p => {
      const hasOverride  = overrides[p.key] !== undefined;
      const overrideVal  = overrides[p.key];
      const roleDefault  = rolePerms[p.key] || 0;
      _userPermsState[p.key] = hasOverride ? overrideVal : null;
      const isAllow = hasOverride && overrideVal === 1;
      const isDeny  = hasOverride && overrideVal === 0;
      html += `<div class="perm-item">
        <span class="perm-label">${esc(p.label)}</span>
        <div style="display:flex;flex-direction:column;gap:3px">
          <div class="perm-toggle">
            <button class="toggle-btn allow ${isAllow ? 'active' : ''}"   onclick="setUserPerm('${p.key}',1,this)" title="سماح">✔</button>
            <button class="toggle-btn deny ${isDeny ? 'active' : ''}"     onclick="setUserPerm('${p.key}',0,this)" title="رفض">✖</button>
            <button class="toggle-btn inherit ${!hasOverride ? 'active' : ''}" onclick="setUserPerm('${p.key}',null,this)" title="من الدور">↩</button>
          </div>
          <span style="font-size:.62rem;color:var(--text-faint)">افتراضي الدور: ${roleDefault ? '✔' : '✖'}</span>
        </div>
      </div>`;
    });
  });
  const ugrid = document.getElementById('user-perms-grid');
  if (ugrid) ugrid.innerHTML = html;
}

async function setUserPerm(key, val, btn) {
  const uid = document.getElementById('perm-user-select')?.value;
  if (!uid) return;

  // Optimistic UI update
  const wrap = btn.closest('.perm-toggle');
  wrap.querySelectorAll('.allow').forEach(b   => b.classList.toggle('active', val === 1));
  wrap.querySelectorAll('.deny').forEach(b    => b.classList.toggle('active', val === 0));
  wrap.querySelectorAll('.inherit').forEach(b => b.classList.toggle('active', val === null));

  // Persist immediately to DB
  const data = await apiFetch(`${API}/permissions/user/${uid}`, {
    method: 'PUT',
    body: JSON.stringify({ permissions: { [key]: val } })
  });

  if (data?.success) {
    _userPermsState[key] = val;
  } else {
    // Revert UI on failure
    const prev = _userPermsState[key];
    wrap.querySelectorAll('.allow').forEach(b   => b.classList.toggle('active', prev === 1));
    wrap.querySelectorAll('.deny').forEach(b    => b.classList.toggle('active', prev === 0));
    wrap.querySelectorAll('.inherit').forEach(b => b.classList.toggle('active', prev === null));
    showToast(data?.message || 'فشل حفظ الصلاحية', 'error');
  }
}

async function saveUserPermissions() {
  const uid = document.getElementById('perm-user-select')?.value;
  if (!uid) return;
  const data = await apiFetch(`${API}/permissions/user/${uid}`, { method: 'PUT', body: JSON.stringify({ permissions: _userPermsState }) });
  if (data?.success) {
    showToast('تم حفظ صلاحيات المستخدم ✓');
    loadUserPermissions(); // reload to confirm DB state
  } else showToast(data?.message || 'فشل الحفظ', 'error');
}

/* ═══════════════════════════════════════════════════════════
   MISSING STUBS — prevent console errors
═══════════════════════════════════════════════════════════ */









/* ═══════════════════════════════════════════════════════════
   PRINT INVOICE — multi-size (A4 / 80mm / 58mm)
═══════════════════════════════════════════════════════════ */
let _currentOrderId = null;

async function printOrderSize(size, id) {
  const orderId = id || _currentOrderId;
  if (!orderId) return;
  const [oRes, sRes] = await Promise.all([
    apiFetch(`${API}/orders/${orderId}`),
    apiFetch(`${API}/settings`)
  ]);
  if (!oRes?.data) { showToast('فشل تحميل الأوردر','error'); return; }
  const d   = oRes.data;
  const s   = sRes?.data || {};
  const cur = s.currency || 'ج';
  const fmtP = n => Number(n||0).toLocaleString('ar-EG',{minimumFractionDigits:2}) + ' ' + cur;

  const is58 = size === '58mm';
  const is80 = size === '80mm';
  const pageSize  = is58 ? '58mm' : is80 ? '80mm' : 'A4';
  const fontSize  = is58 ? '9px'  : is80 ? '10px' : '13.5px';
  const maxW      = is58 ? '54mm' : is80 ? '76mm' : '100%';
  const padding   = (is58||is80) ? '3mm' : '36px';

  const PAY_LABELS_P = { visa:'Visa', vodafone_cash:'Vodafone Cash', cash_on_delivery:'Cash on Delivery' };
  const STATUS_AR_P  = { pending:'قيد الانتظار', confirmed:'مؤكد', shipped:'تم الشحن', delivered:'تم التسليم', cancelled:'ملغي' };

  const win = window.open('','_blank','width=820,height=960');
  win.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="UTF-8"/>
<title>فاتورة ${esc(d.order_number)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Cairo',sans-serif;background:#fff;color:#111;padding:${padding};font-size:${fontSize};max-width:${maxW}}
.inv-hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:${(is58||is80)?'8px':'24px'};padding-bottom:${(is58||is80)?'6px':'18px'};border-bottom:${(is58||is80)?'1px':'3px'} solid #111}
.bn{font-size:${is58?'1.2rem':is80?'1.5rem':'2rem'};font-weight:900;letter-spacing:3px;line-height:1}
.bs{font-size:.68rem;color:#888;letter-spacing:1.5px;text-transform:uppercase;margin-top:2px}
.inv-num{font-size:${is58?'.78rem':'.9rem'};font-weight:700}
.inv-date{font-size:.7rem;color:#666;margin-top:2px}
.sc{display:inline-block;padding:2px 8px;border-radius:20px;font-size:.66rem;font-weight:700;margin-top:4px}
.s-delivered{background:#dcfce7;color:#16a34a}.s-pending,.s-confirmed,.s-shipped{background:#dbeafe;color:#1d4ed8}.s-cancelled{background:#fee2e2;color:#dc2626}
.cust{margin-bottom:${(is58||is80)?'8px':'18px'};padding:${(is58||is80)?'6px':'14px'};background:#f9fafb;border-radius:6px;font-size:${is58?'.75rem':'.82rem'}}
.cl{color:#999;font-size:.65rem;text-transform:uppercase;margin-bottom:1px}
table{width:100%;border-collapse:collapse;margin-bottom:${(is58||is80)?'8px':'16px'}}
thead tr{background:#111;color:#fff}
th{padding:${(is58||is80)?'4px 5px':'7px 10px'};text-align:right;font-size:${is58?'.65rem':'.72rem'};font-weight:600}
td{padding:${(is58||is80)?'4px 5px':'7px 10px'};border-bottom:1px solid #f0f0f0;font-size:${is58?'.72rem':'.82rem'}}
.sumtbl{width:${(is58||is80)?'100%':'240px'};margin-right:auto}
.sumtbl td{border:none;padding:${(is58||is80)?'3px 5px':'4px 8px'}}
.tot td{font-size:${(is58||is80)?'.82rem':'.9rem'};font-weight:800;border-top:2px solid #111;padding-top:7px}
.footer{margin-top:${(is58||is80)?'8px':'28px'};padding-top:${(is58||is80)?'6px':'10px'};border-top:1px solid #e5e7eb;text-align:center;font-size:.66rem;color:#999}
@media print{button{display:none!important}@page{size:${pageSize};margin:${(is58||is80)?'2mm':'1.5cm'}}}
</style></head><body>
<div class="inv-hdr">
  <div>
    ${s.brand_logo && !is58 ? `<img src="${s.brand_logo}" style="height:${is80?'32px':'44px'};width:auto;margin-bottom:4px" alt="logo"/><br/>` : ''}
    <div class="bn">${esc(s.brand_name||'MASAR')}</div>
    <div class="bs">Brand Manager</div>
    ${s.brand_phone && !is58 ? `<div style="font-size:.72rem;color:#555;margin-top:3px">${esc(s.brand_phone)}</div>` : ''}
  </div>
  <div>
    <div class="inv-num">${esc(d.order_number)}</div>
    <div class="inv-date">${new Date(d.created_at).toLocaleDateString('ar-EG',{year:'numeric',month:'short',day:'numeric'})}</div>
    <div><span class="sc s-${d.status}">${STATUS_AR_P[d.status]||d.status}</span></div>
  </div>
</div>
<div class="cust">
  ${is58
    ? `<div><span class="cl">العميل:</span>${esc(d.customer_name||'—')}</div><div><span class="cl">الهاتف:</span>${esc(d.phone||'—')}</div>`
    : `<div style="display:grid;grid-template-columns:1fr 1fr${!is80?' 1fr':''};gap:10px">
        <div><div class="cl">الاسم</div><div style="font-weight:600">${esc(d.customer_name||'—')}</div></div>
        <div><div class="cl">الهاتف</div><div>${esc(d.phone||'—')}</div></div>
        ${!is80 ? `<div><div class="cl">الدفع</div><div>${PAY_LABELS_P[d.payment_method]||'—'}</div></div>` : ''}
      </div>
      ${d.address && !is58 ? `<div style="margin-top:6px"><div class="cl">العنوان</div><div>${esc(d.address)}</div></div>` : ''}`
  }
</div>
<table>
  <thead><tr><th>${is58?'الصنف':'الكود'}</th>${!is58?'<th>المنتج</th>':''}<th>ك</th><th>سعر</th><th>إجمالي</th></tr></thead>
  <tbody>${d.items.map(i=>`<tr>
    <td>${is58?esc(i.name):esc(i.code)}</td>
    ${!is58?`<td><strong>${esc(i.name)}</strong></td>`:''}
    <td>${i.quantity}</td>
    <td>${fmtP(i.unit_price)}</td>
    <td><strong>${fmtP(i.total)}</strong></td>
  </tr>`).join('')}</tbody>
</table>
<table class="sumtbl">
  <tr><td>المنتجات</td><td>${fmtP(d.total)}</td></tr>
  <tr><td>الشحن</td><td>${fmtP(d.shipping_price||0)}</td></tr>
  <tr class="tot"><td>الإجمالي</td><td>${fmtP(d.grand_total)}</td></tr>
</table>
<div class="footer">${esc(s.brand_name||'MASAR')} — شكراً لثقتك بنا</div>
<script>window.onload=()=>{window.print()}<\/script>
</body></html>`);
  win.document.close();
}

/* ═══════════════════════════════════════════════════════════
   NOTIFICATIONS — admin create / dismiss
═══════════════════════════════════════════════════════════ */
async function createNotification() {
  const msgEl    = document.getElementById('notif-msg');
  const hoursEl  = document.getElementById('notif-hours');
  const authorEl = document.getElementById('notif-show-author');

  const message        = (msgEl?.value || '').trim();
  const duration_hours = parseInt(hoursEl?.value || '6') || 6;
  const show_author    = parseInt(authorEl?.value || '0') || 0;

  if (!message) { showToast('اكتب نص الإشعار', 'error'); return; }

  const data = await apiFetch(`${API}/notifications`, {
    method: 'POST',
    body: JSON.stringify({ message, duration_hours, show_author })
  });

  if (data?.success) {
    showToast('تم إرسال الإشعار ✓');
    if (msgEl) msgEl.value = '';
    // Force re-show banner
    _activeBannerId = null;
    await _loadActiveBanner();
  } else {
    showToast(data?.message || 'فشل إرسال الإشعار', 'error');
  }
}


window.printSingleLabel = async function(productId) {
  // Fetch with auth token
  const res = await apiFetch(`${API}/products/${productId}`);
  if (!res?.success) { showToast('فشل جلب بيانات المنتج', 'error'); return; }
  const p = res.data;
  // Ensure barcode exists — generate if missing
  if (!p.barcode) {
    const bc = await apiFetch(`${API}/barcode/generate/product/${productId}`, { method: 'POST' });
    if (bc?.success) p.barcode = bc.data.barcode;
  }
  openLabelPrint(p);
};

window.openLabelPrint = function(p) {
  const barcode = p.barcode || '0000000000000';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html>
<html dir="rtl">
<head>
  <meta charset="utf-8"/>
  <title>طباعة - ${p.name}</title>
  <style>
    @page { size: 58mm 40mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 58mm; height: 40mm;
      display: flex; align-items: center; justify-content: center;
      font-family: Arial, sans-serif;
      -webkit-print-color-adjust: exact;
    }
    .label {
      width: 56mm; height: 38mm;
      border: 1px solid #000;
      padding: 3px 4px;
      display: flex; flex-direction: column;
      justify-content: space-between;
    }
    .row { display: flex; justify-content: space-between; align-items: center; }
    .name { font-size: 9px; font-weight: bold; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .meta { font-size: 7px; color: #444; }
    .price { font-size: 11px; font-weight: bold; color: #000; }
    .barcode-wrap { text-align: center; }
    svg#bc { width: 100%; height: 28px; }
    .bc-num { font-size: 7px; font-family: monospace; letter-spacing: 1px; margin-top: 1px; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <div class="label">
    <div class="name">${p.name || '—'}</div>
    <div class="row">
      <span class="meta">كود: ${p.code || '—'}</span>
      <span class="meta">${p.size ? 'م: '+p.size : ''} ${p.color ? '| ل: '+p.color : ''}</span>
    </div>
    <div class="barcode-wrap">
      <svg id="bc"></svg>
      <div class="bc-num">${barcode}</div>
    </div>
    <div class="row">
      <span class="meta">MASAR</span>
      <span class="price">${p.price || 0} ج</span>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <script>
    try {
      JsBarcode('#bc', '${barcode}', {
        format: 'CODE128', width: 1.4, height: 28,
        displayValue: false, margin: 0, background: 'transparent'
      });
    } catch(e) { document.getElementById('bc').style.display='none'; }
    setTimeout(() => window.print(), 600);
  <\/script>
</body>
</html>`);
  win.document.close();
};