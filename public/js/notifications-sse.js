/* ═══════════════════════════════════════════════════════════════
   MASAR — Real-time Notifications (SSE + Bell + Sound)
   Drop-in module: load AFTER app.js in index.html. No dependencies.
═══════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  /* ── Config ──────────────────────────────────────────────────── */
  const MAX_ITEMS      = 5;     // max items shown in bell dropdown
  const SOUND_COOLDOWN = 5000;  // minimum ms between sounds (anti-spam)

  /* ── State ───────────────────────────────────────────────────── */
  let _items          = [];     // [{ id, text, time, orderNumber }]
  let _unread         = false;  // controls red dot visibility
  let _lastSound      = 0;      // timestamp of last played sound
  let _userInteracted = false;  // AudioContext requires prior user gesture
  let _es             = null;   // EventSource instance
  let _audioCtx       = null;   // shared AudioContext (created once)

  /* ── User interaction gate ───────────────────────────────────── */
  // Browser policy: AudioContext must be created/resumed after a user gesture.
  // We listen for the first of any interaction type and set the flag once.
  document.addEventListener('click',     () => { _userInteracted = true; }, { once: true });
  document.addEventListener('keydown',   () => { _userInteracted = true; }, { once: true });
  document.addEventListener('touchstart',() => { _userInteracted = true; }, { once: true });

  /* ── Sound ───────────────────────────────────────────────────── */
  // Generated entirely via Web Audio API — no audio file required.
  // Two-tone soft chime (880Hz then 660Hz).
  // Cooldown prevents spam: will not play if called within SOUND_COOLDOWN ms of last play.
  function _playSound() {
    if (!_userInteracted) return;           // gate: no interaction yet
    const now = Date.now();
    if (now - _lastSound < SOUND_COOLDOWN) return; // gate: cooldown
    _lastSound = now;

    try {
      if (!_audioCtx) {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      // Resume context if it was suspended (browser auto-suspend policy)
      if (_audioCtx.state === 'suspended') _audioCtx.resume();

      const ctx = _audioCtx;
      [[880, 0, 0.12], [660, 0.13, 0.22]].forEach(([freq, startAt, endAt]) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + startAt);
        gain.gain.setValueAtTime(0,    ctx.currentTime + startAt);
        gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + endAt);
        osc.start(ctx.currentTime + startAt);
        osc.stop(ctx.currentTime  + endAt + 0.05);
      });
    } catch (_) { /* AudioContext unavailable or blocked — fail silently */ }
  }

  /* ── Bell HTML ───────────────────────────────────────────────── */
  function _bellHTML(suffix) {
    return `
<div class="bell-wrap" id="bell-wrap-${suffix}">
  <button class="bell-btn" id="bell-btn-${suffix}"
          onclick="MasarSSE.toggleDropdown(event)"
          title="الإشعارات" aria-label="الإشعارات">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
    <span class="bell-dot" id="bell-dot-${suffix}" style="display:none"></span>
  </button>
  <div class="bell-dropdown" id="bell-dropdown-${suffix}">
    <div class="bell-dropdown-header">الإشعارات</div>
    <div class="bell-dropdown-list" id="bell-list-${suffix}">
      <div class="bell-empty">لا توجد إشعارات جديدة</div>
    </div>
  </div>
</div>`;
  }

  /* ── Inject bell into DOM ────────────────────────────────────── */
  // Guards with getElementById prevent duplicate injection.
  // Called once from _boot() — safe even if called multiple times.
  function _injectBell() {
    const mobileRight = document.querySelector('.mobile-header-right');
    if (mobileRight && !document.getElementById('bell-btn-mobile')) {
      mobileRight.insertAdjacentHTML('afterbegin', _bellHTML('mobile'));
    }

    const sidebarFooter = document.querySelector('.sidebar-footer');
    if (sidebarFooter && !document.getElementById('bell-btn-sidebar')) {
      sidebarFooter.insertAdjacentHTML('afterbegin', _bellHTML('sidebar'));
    }
  }

  /* ── Render ──────────────────────────────────────────────────── */
  function _render() {
    ['mobile', 'sidebar'].forEach(suffix => {
      const dot  = document.getElementById(`bell-dot-${suffix}`);
      const list = document.getElementById(`bell-list-${suffix}`);
      if (!dot || !list) return;

      dot.style.display = _unread ? 'block' : 'none';

      if (_items.length === 0) {
        list.innerHTML = '<div class="bell-empty">لا توجد إشعارات جديدة</div>';
        return;
      }

      list.innerHTML = _items.slice(0, MAX_ITEMS).map(item => `
        <div class="bell-item">
          <div class="bell-item-icon">🛒</div>
          <div class="bell-item-body">
            <div class="bell-item-text">${_esc(item.text)}</div>
            <div class="bell-item-time">${_timeAgo(item.time)}</div>
          </div>
        </div>
      `).join('');
    });
  }

  /* ── Dropdown toggle ─────────────────────────────────────────── */
  function _toggleDropdown(e) {
    e.stopPropagation();
    const anyOpen = document.querySelector('.bell-dropdown.open');

    // Always close all first
    document.querySelectorAll('.bell-dropdown').forEach(d => d.classList.remove('open'));

    if (!anyOpen) {
      // Open the dropdown belonging to the clicked bell
      const wrap = e.currentTarget.closest('.bell-wrap');
      if (wrap) wrap.querySelector('.bell-dropdown')?.classList.add('open');
      // Mark all as read
      _unread = false;
      _render();
    }
  }

  // Close on outside click
  document.addEventListener('click', () => {
    document.querySelectorAll('.bell-dropdown.open').forEach(d => d.classList.remove('open'));
  });

  /* ── Add item ────────────────────────────────────────────────── */
  function _addItem(item) {
    _items.unshift(item);
    if (_items.length > MAX_ITEMS) _items = _items.slice(0, MAX_ITEMS);
    _unread = true;
    _render();
    _playSound();
  }

  /* ── SSE connection ──────────────────────────────────────────── */
  function _connect() {
    const user = window.MASAR_USER;
    if (!user) return;

    // Only connect for users who have orders.view permission (or admin)
    const isAdmin = user.role === 'admin';
    const perms   = Array.isArray(user.permissions) ? user.permissions : [];
    if (!isAdmin && !perms.includes('orders.view')) return;

    const token = localStorage.getItem('masar_token');
    if (!token) return;

    // Close any existing connection before opening a new one (prevents duplicates)
    if (_es) { _es.close(); _es = null; }

    // EventSource does not support custom request headers.
    // Token is passed as a query parameter; auth middleware reads it as a fallback.
    // See: middleware/auth.js patch instructions in the deployment checklist.
    _es = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(token)}`);

    _es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected') return; // handshake confirmation — ignore
        if (msg.type === 'new_order') {
          const p = msg.payload || {};
          _addItem({
            id:          p.id,
            text:        `أوردر جديد ${p.orderNumber || ''} — ${p.customerName || 'عميل'}`,
            orderNumber: p.orderNumber,
            time:        Date.now(),
          });
        }
      } catch (_) { /* malformed JSON — ignore */ }
    };

    _es.onerror = () => {
      // EventSource readyState values:
      //   0 = CONNECTING  — browser is already retrying, do NOT manually reconnect
      //   1 = OPEN        — healthy, no action needed
      //   2 = CLOSED      — browser gave up (e.g. server returned 403/404/500)
      //                     only in this case do we manually schedule reconnect
      if (_es && _es.readyState === EventSource.CLOSED) {
        _es.close();
        _es = null;
        setTimeout(_connect, 5000); // retry after 5s
      }
      // If readyState === CONNECTING: browser is handling retry — do nothing
    };
  }

  /* ── Styles ──────────────────────────────────────────────────── */
  function _injectStyles() {
    if (document.getElementById('bell-styles')) return; // already injected — skip
    const style = document.createElement('style');
    style.id = 'bell-styles';
    style.textContent = `
/* ── Bell wrapper ─────────────────────────────── */
.bell-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

/* ── Bell button ──────────────────────────────── */
.bell-btn {
  position: relative;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--white-faint, #888);
  padding: 6px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color .2s, background .2s;
  line-height: 1;
}
.bell-btn:hover {
  color: var(--green, #22c55e);
  background: rgba(34,197,94,.08);
}
.bell-btn svg { width: 20px; height: 20px; display: block; }

/* ── Red dot (unread indicator) ───────────────── */
.bell-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  background: #ef4444;
  border-radius: 50%;
  border: 2px solid var(--sidebar-bg, #111);
  pointer-events: none;
}

/* ── Dropdown panel ───────────────────────────── */
.bell-dropdown {
  display: none;
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 280px;
  background: var(--card-bg, #1a1a1a);
  border: 1px solid var(--border, #2a2a2a);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,.4);
  z-index: 9000;
  overflow: hidden;
}
.bell-dropdown.open { display: block; }

/* Flip right in mobile header (RTL layout) */
.mobile-header .bell-dropdown { left: auto; right: 0; }

.bell-dropdown-header {
  padding: 12px 16px 10px;
  font-size: .8rem;
  font-weight: 700;
  color: var(--white-faint, #888);
  border-bottom: 1px solid var(--border, #2a2a2a);
  text-transform: uppercase;
  letter-spacing: .5px;
}

/* ── Dropdown list ────────────────────────────── */
.bell-dropdown-list { max-height: 280px; overflow-y: auto; }

.bell-empty {
  padding: 20px 16px;
  text-align: center;
  color: var(--white-faint, #666);
  font-size: .82rem;
}

/* ── Notification item ────────────────────────── */
.bell-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border, #1f1f1f);
  transition: background .15s;
}
.bell-item:last-child { border-bottom: none; }
.bell-item:hover      { background: rgba(255,255,255,.03); }

.bell-item-icon {
  font-size: 1.1rem;
  line-height: 1;
  margin-top: 2px;
  flex-shrink: 0;
}
.bell-item-body  { flex: 1; min-width: 0; }
.bell-item-text  {
  font-size: .82rem;
  color: var(--text, #e5e5e5);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bell-item-time  {
  font-size: .72rem;
  color: var(--white-faint, #555);
  margin-top: 2px;
}

/* ── Sidebar bell (full-width row) ────────────── */
.sidebar-footer .bell-wrap   { display: block; margin-bottom: 6px; }
.sidebar-footer .bell-btn    {
  width: 100%;
  justify-content: flex-start;
  gap: 10px;
  padding: 8px 12px;
  font-size: .85rem;
  color: var(--white-faint, #888);
  border-radius: 8px;
}
.sidebar-footer .bell-btn::after   { content: 'الإشعارات'; }
.sidebar-footer .bell-dropdown     {
  left: 0; right: 0;
  min-width: 240px;
  top: auto;
  bottom: calc(100% + 4px);
}
    `;
    document.head.appendChild(style);
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60)   return 'الآن';
    if (s < 3600) return `${Math.floor(s / 60)} د`;
    return `${Math.floor(s / 3600)} س`;
  }

  /* ── Public API ──────────────────────────────────────────────── */
  window.MasarSSE = {
    toggleDropdown: _toggleDropdown,
    connect:        _connect,
    addItem:        _addItem,  // exposed for manual testing in console
  };

  /* ── Boot ────────────────────────────────────────────────────── */
  function _boot() {
    _injectStyles();
    _injectBell();
    _render();
    _connect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot(); // DOM already ready
  }

})();
