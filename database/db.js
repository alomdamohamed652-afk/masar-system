'use strict';
require('dotenv').config();

const Database = require('better-sqlite3');
const path     = require('path');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'masar.db');
const db      = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -32000');
db.pragma('temp_store = MEMORY');

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA — all tables
// ═══════════════════════════════════════════════════════════════════════════
db.exec(`
  -- ── Core users ──────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    phone        TEXT    UNIQUE NOT NULL,
    password     TEXT    NOT NULL,
    role         TEXT    NOT NULL DEFAULT 'employee',
    status       TEXT    NOT NULL DEFAULT 'active',
    avatar_url   TEXT    DEFAULT NULL,
    timezone     TEXT    DEFAULT NULL,
    is_active    INTEGER NOT NULL DEFAULT 1,
    force_logout INTEGER NOT NULL DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ── Permissions ──────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS permissions (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    key  TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    group_name TEXT DEFAULT 'general'
  );

  CREATE TABLE IF NOT EXISTS role_permissions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role       TEXT NOT NULL,
    permission TEXT NOT NULL,
    allowed    INTEGER NOT NULL DEFAULT 1,
    UNIQUE(role, permission)
  );

  CREATE TABLE IF NOT EXISTS user_permissions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    permission TEXT NOT NULL,
    allowed    INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, permission),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- ── Settings ─────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- ── Products ─────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS products (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT UNIQUE NOT NULL,
    name       TEXT NOT NULL,
    color      TEXT DEFAULT '',
    size       TEXT DEFAULT '',
    cost       REAL NOT NULL DEFAULT 0,
    price      REAL NOT NULL DEFAULT 0,
    image_url  TEXT DEFAULT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- ── Inventory ────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS inventory (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER UNIQUE NOT NULL,
    quantity   INTEGER NOT NULL DEFAULT 0,
    sold       INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  -- ── Orders ───────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS orders (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number   TEXT UNIQUE NOT NULL,
    customer_name  TEXT DEFAULT '',
    phone          TEXT DEFAULT '',
    address        TEXT DEFAULT '',
    notes          TEXT DEFAULT '',
    total          REAL NOT NULL DEFAULT 0,
    shipping_price REAL NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT DEFAULT NULL,
    payment_status TEXT NOT NULL DEFAULT 'unpaid',
    created_by     INTEGER DEFAULT NULL,
    updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity   INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL,
    unit_cost  REAL NOT NULL,
    total      REAL NOT NULL,
    FOREIGN KEY (order_id)   REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- ── Expenses ─────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL,
    details    TEXT DEFAULT '',
    amount     REAL NOT NULL,
    created_by INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ── Audit Logs ───────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    user_name  TEXT,
    action     TEXT NOT NULL,
    entity     TEXT,
    entity_id  INTEGER,
    details    TEXT,
    snapshot   TEXT,
    ip         TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ── Notifications ────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message     TEXT NOT NULL,
    created_by  INTEGER,
    show_author INTEGER NOT NULL DEFAULT 0,
    target_role TEXT DEFAULT NULL,
    target_user INTEGER DEFAULT NULL,
    start_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_at      DATETIME DEFAULT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ── Attendance ────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS attendance (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    login_time  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    logout_time DATETIME DEFAULT NULL,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_seconds  INTEGER DEFAULT 0,
    active_seconds INTEGER DEFAULT 0,
    idle_seconds   INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- ── Leave requests ────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS leave_requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    type        TEXT NOT NULL DEFAULT 'leave',
    reason      TEXT DEFAULT '',
    start_at    DATETIME NOT NULL,
    end_at      DATETIME NOT NULL,
    hours       REAL DEFAULT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    approved_by INTEGER DEFAULT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ── Tasks ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    assigned_to INTEGER NOT NULL,
    created_by  INTEGER NOT NULL,
    priority    TEXT NOT NULL DEFAULT 'medium',
    status      TEXT NOT NULL DEFAULT 'pending',
    due_date    DATETIME DEFAULT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by)  REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    comment    TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- ── Requests (employee → admin) ───────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    type        TEXT NOT NULL DEFAULT 'request',
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',
    response    TEXT DEFAULT NULL,
    handled_by  INTEGER DEFAULT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL
  );

  -- ── Sessions (force logout) ───────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    ip         TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen  DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_valid   INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- ── Indexes ───────────────────────────────────────────────────────────────
  CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_user_id      ON logs(user_id);
  CREATE INDEX IF NOT EXISTS idx_logs_entity       ON logs(entity, entity_id);
  CREATE INDEX IF NOT EXISTS idx_products_code     ON products(code);
  CREATE INDEX IF NOT EXISTS idx_attendance_user   ON attendance(user_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned    ON tasks(assigned_to);
  CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_requests_user     ON requests(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_active ON notifications(is_active, end_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_user     ON sessions(user_id, is_valid);
`);

// ═══════════════════════════════════════════════════════════════════════════
// LIVE MIGRATIONS
// ═══════════════════════════════════════════════════════════════════════════
const runMigrations = (table, migrations) => {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    migrations.forEach(({ col, sql }) => {
      if (!cols.includes(col)) { try { db.exec(sql); } catch(e) { console.warn(`Migration warn [${table}.${col}]:`, e.message); } }
    });
  } catch(e) { console.warn(`Migration table check failed [${table}]:`, e.message); }
};

runMigrations('users', [
  { col: 'status',       sql: "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'" },
  { col: 'avatar_url',   sql: "ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL" },
  { col: 'timezone',     sql: "ALTER TABLE users ADD COLUMN timezone TEXT DEFAULT NULL" },
  { col: 'force_logout', sql: "ALTER TABLE users ADD COLUMN force_logout INTEGER NOT NULL DEFAULT 0" },
]);
runMigrations('orders', [
  { col: 'phone',          sql: "ALTER TABLE orders ADD COLUMN phone TEXT DEFAULT ''" },
  { col: 'address',        sql: "ALTER TABLE orders ADD COLUMN address TEXT DEFAULT ''" },
  { col: 'shipping_price', sql: "ALTER TABLE orders ADD COLUMN shipping_price REAL DEFAULT 0" },
  { col: 'status',         sql: "ALTER TABLE orders ADD COLUMN status TEXT DEFAULT 'pending'" },
  { col: 'payment_method', sql: "ALTER TABLE orders ADD COLUMN payment_method TEXT DEFAULT NULL" },
  { col: 'payment_status', sql: "ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'unpaid'" },
  { col: 'created_by',     sql: "ALTER TABLE orders ADD COLUMN created_by INTEGER DEFAULT NULL" },
  { col: 'updated_at',     sql: "ALTER TABLE orders ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP" },
  { col: 'barcode',        sql: "ALTER TABLE orders ADD COLUMN barcode TEXT DEFAULT NULL" },
]);
runMigrations('expenses', [
  { col: 'created_by', sql: "ALTER TABLE expenses ADD COLUMN created_by INTEGER DEFAULT NULL" },
]);
runMigrations('products', [
  { col: 'image_url',  sql: "ALTER TABLE products ADD COLUMN image_url TEXT DEFAULT NULL" },
  { col: 'updated_at', sql: "ALTER TABLE products ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP" },
  { col: 'barcode',    sql: "ALTER TABLE products ADD COLUMN barcode TEXT DEFAULT NULL" },
]);
runMigrations('logs', [
  { col: 'snapshot', sql: "ALTER TABLE logs ADD COLUMN snapshot TEXT DEFAULT NULL" },
]);

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════
const PERMISSIONS = [
  // Dashboard
  ['dashboard.view',    'عرض Dashboard',        'dashboard'],
  ['dashboard.stats',   'إحصائيات متقدمة',      'dashboard'],
  // Products
  ['products.view',     'عرض المنتجات',          'products'],
  ['products.create',   'إضافة منتج',            'products'],
  ['products.edit',     'تعديل منتج',            'products'],
  ['products.delete',   'حذف منتج',             'products'],
  // Orders
  ['orders.view',       'عرض الأوردرات',         'orders'],
  ['orders.create',     'إنشاء أوردر',           'orders'],
  ['orders.edit',       'تعديل أوردر',           'orders'],
  ['orders.delete',     'حذف أوردر',            'orders'],
  ['orders.cancel',     'إلغاء أوردر',           'orders'],
  ['orders.status',     'تغيير حالة الأوردر',    'orders'],
  // Inventory
  ['inventory.view',    'عرض المخزون',           'inventory'],
  ['inventory.edit',    'تعديل المخزون',         'inventory'],
  // Expenses
  ['expenses.view',     'عرض المصاريف',          'expenses'],
  ['expenses.create',   'إضافة مصروف',           'expenses'],
  ['expenses.delete',   'حذف مصروف',            'expenses'],
  // Users & System
  ['users.view',        'عرض المستخدمين',        'system'],
  ['users.manage',      'إدارة المستخدمين',      'system'],
  ['logs.view',         'عرض السجلات',           'system'],
  ['settings.manage',   'إدارة الإعدادات',       'system'],
  ['permissions.manage','إدارة الصلاحيات',       'system'],
  // Notifications
  ['notifications.manage','إدارة الإشعارات',     'system'],
  // Tasks
  ['tasks.view',        'عرض المهام',            'tasks'],
  ['tasks.create',      'إنشاء مهام',            'tasks'],
  ['tasks.manage',      'إدارة كل المهام',        'tasks'],
  // Requests
  ['requests.view',     'عرض الطلبات',           'requests'],
  ['requests.manage',   'إدارة الطلبات',         'requests'],
  // Attendance
  ['attendance.view',   'عرض الحضور',            'hr'],
  ['attendance.manage', 'إدارة الحضور',          'hr'],
  // Leave
  ['leave.request',     'طلب إجازة',             'hr'],
  ['leave.manage',      'إدارة الإجازات',        'hr'],
];

const ROLE_DEFAULTS = {
  admin:      PERMISSIONS.map(p => p[0]),  // all
  manager:    ['dashboard.view','dashboard.stats','products.view','products.create','products.edit','orders.view','orders.create','orders.edit','orders.cancel','orders.status','inventory.view','inventory.edit','tasks.view','tasks.create','tasks.manage','requests.view','requests.manage','attendance.view','leave.manage'],
  accountant: ['dashboard.view','dashboard.stats','expenses.view','expenses.create','expenses.delete','orders.view','inventory.view'],
  employee:   ['dashboard.view','orders.view','orders.create','inventory.view','tasks.view','requests.view','leave.request'],
  developer:  ['dashboard.view','dashboard.stats','logs.view','settings.manage'],
};

// Insert permissions if not exist
const insertPerm = db.prepare("INSERT OR REPLACE INTO permissions (key, label, group_name) VALUES (?,?,?)");
PERMISSIONS.forEach(([key, label, group]) => insertPerm.run(key, label, group));

// Insert role defaults
const insertRolePerm = db.prepare("INSERT OR REPLACE INTO role_permissions (role, permission, allowed) VALUES (?,?,1)");
Object.entries(ROLE_DEFAULTS).forEach(([role, perms]) => {
  perms.forEach(p => insertRolePerm.run(role, p));
});

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT SETTINGS
// ═══════════════════════════════════════════════════════════════════════════
const settingsDefaults = [
  ['brand_name',        'MASAR'],
  ['brand_address',     ''],
  ['brand_phone',       ''],
  ['brand_logo',        ''],
  ['currency',          'ج'],
  ['timezone',          'Africa/Cairo'],
  ['jwt_secret',        process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex')],
  ['external_api_url',  process.env.EXTERNAL_API_URL || ''],
  ['external_api_key',  process.env.EXTERNAL_API_KEY || ''],
  ['idle_timeout_mins', '15'],
  ['session_hours',     '12'],
];
const upsertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
settingsDefaults.forEach(([k, v]) => upsertSetting.run(k, v));

// ═══════════════════════════════════════════════════════════════════════════
// FIRST-RUN ADMIN
// ═══════════════════════════════════════════════════════════════════════════
const adminExists = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 12);
  db.prepare("INSERT INTO users (name, phone, password, role, status) VALUES (?, ?, ?, 'admin', 'active')")
    .run('Admin', '01000000000', hash);
  console.log('\n  ✅ Admin seeded → phone: 01000000000 | pass: admin123\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if user has permission (user override > role default)
 */
function userHasPerm(userId, perm) {
  // 1. Check user override first
  const override = db.prepare(
    "SELECT allowed FROM user_permissions WHERE user_id=? AND permission=?"
  ).get(userId, perm);
  if (override !== undefined) return override.allowed === 1;

  // 2. Fall back to role
  const user = db.prepare("SELECT role FROM users WHERE id=?").get(userId);
  if (!user) return false;
  const rolePerm = db.prepare(
    "SELECT allowed FROM role_permissions WHERE role=? AND permission=?"
  ).get(user.role, perm);
  return rolePerm ? rolePerm.allowed === 1 : false;
}

db.userHasPerm = userHasPerm;

// ═══════════════════════════════════════════════════════════════════════════
// BARCODE HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function generateBarcode(type, id) {
  // 13-digit: prefix(2) + id_padded(6) + ts_fragment(4) + check(1)
  const prefix = type === 'P' ? '20' : '30';
  const idPart = String(id).padStart(6, '0').slice(-6);
  const tsPart = String(Date.now()).slice(-4);
  const body   = prefix + idPart + tsPart; // 12 digits
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + ((10 - (sum % 10)) % 10);
}

function ensureBarcode(type, id, table) {
  const row = db.prepare(`SELECT barcode FROM ${table} WHERE id=?`).get(id);
  if (row?.barcode) return row.barcode;
  let barcode, attempts = 0;
  do {
    barcode = generateBarcode(type, id + attempts);
    attempts++;
  } while (
    db.prepare(`SELECT id FROM ${table} WHERE barcode=?`).get(barcode) && attempts < 20
  );
  db.prepare(`UPDATE ${table} SET barcode=? WHERE id=?`).run(barcode, id);
  return barcode;
}

db.generateBarcode = generateBarcode;
db.ensureBarcode   = ensureBarcode;
module.exports = db;
