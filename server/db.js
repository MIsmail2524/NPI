'use strict';
/* ============================================================
   Database — SQLite via Node's built-in driver (no native build).
   Every query in the app goes through prepared statements, so
   user input is never concatenated into SQL.
   Money is stored as INTEGER minor units (e.g. paisa / cents).
   ============================================================ */
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.NPI_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.NPI_DB_PATH || path.join(DATA_DIR, 'npi.sqlite');

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','customer')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT 'wrench',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id                  INTEGER PRIMARY KEY,
  slug                TEXT NOT NULL UNIQUE,
  sku                 TEXT NOT NULL DEFAULT '',
  name                TEXT NOT NULL,
  category_id         INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description         TEXT NOT NULL DEFAULT '',
  specs_json          TEXT NOT NULL DEFAULT '[]',
  uses_json           TEXT NOT NULL DEFAULT '[]',
  price               INTEGER NOT NULL CHECK (price >= 0),
  sale_price          INTEGER CHECK (sale_price IS NULL OR sale_price >= 0),
  stock               INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  icon                TEXT NOT NULL DEFAULT 'wrench',
  sim                 TEXT NOT NULL DEFAULT 'auto',
  featured            INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1,
  bulk_min_qty        INTEGER NOT NULL DEFAULT 0,
  bulk_percent        INTEGER NOT NULL DEFAULT 0,
  images_json         TEXT NOT NULL DEFAULT '[]',
  video_url           TEXT NOT NULL DEFAULT '',
  sold_count          INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);

CREATE TABLE IF NOT EXISTS promotions (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  badge         TEXT NOT NULL DEFAULT '',
  theme         TEXT NOT NULL DEFAULT 'sale' CHECK (theme IN ('jumma','flash','sale','clearance')),
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','amount')),
  value         INTEGER NOT NULL CHECK (value >= 0),
  scope         TEXT NOT NULL CHECK (scope IN ('all','category','products')),
  category_id   INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  days_of_week  TEXT NOT NULL DEFAULT '',
  start_time    TEXT,
  end_time      TEXT,
  starts_on     TEXT,
  ends_on       TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS promotion_products (
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (promotion_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT NOT NULL CHECK (status IN ('pending','confirmed','shipped','delivered','cancelled')),
  customer_name  TEXT NOT NULL,
  phone          TEXT NOT NULL,
  address        TEXT NOT NULL,
  city           TEXT NOT NULL,
  notes          TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cod','bank')),
  subtotal       INTEGER NOT NULL,
  discount       INTEGER NOT NULL,
  delivery_fee   INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  unit_price  INTEGER NOT NULL,
  list_price  INTEGER NOT NULL,
  qty         INTEGER NOT NULL CHECK (qty > 0),
  line_total  INTEGER NOT NULL,
  promo_label TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta      INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  ref        TEXT NOT NULL DEFAULT '',
  user_id    INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_movements(product_id);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT NOT NULL DEFAULT '',
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (product_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  company    TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL DEFAULT '',
  entity_id  TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`);

/* ---------- additive migrations (safe to run on every start) ---------- */
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumn('products', 'motion', "TEXT NOT NULL DEFAULT 'auto'");
addColumn('products', 'price_confirmed', 'INTEGER NOT NULL DEFAULT 1');
addColumn('categories', 'image', "TEXT NOT NULL DEFAULT ''");
addColumn('categories', 'motion', "TEXT NOT NULL DEFAULT 'zoom'");
addColumn('products', 'demo_json', "TEXT NOT NULL DEFAULT '{}'");
addColumn('products', 'tags_json', "TEXT NOT NULL DEFAULT '[]'");

/** Run fn inside a transaction; rolls back on any thrown error. */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

const DEFAULT_SETTINGS = {
  store_name: 'NPI Global Trading',
  tagline: 'Precision & Durability, Stocked',
  hero_title: 'Built tough. Engineered precise.',
  hero_text: 'Hand tools that combine precision engineering with job-site toughness — for workshops, contractors and industrial buyers. Try any tool in our Tool Lab before you buy.',
  announcement: 'Free delivery on orders over Rs. 10,000 · Jumma Deals every Friday',
  currency: 'Rs',
  timezone: 'Asia/Karachi',
  delivery_fee: '25000',          // minor units → Rs. 250
  free_delivery_over: '1000000',  // minor units → Rs. 10,000
  contact_email: 'sales@npiglobaltrading.example',
  contact_phone: '+92 300 0000000',
  contact_whatsapp: '',
  address: 'Lahore, Pakistan',
  bank_details: 'Bank: —\nAccount title: NPI Global Trading\nIBAN: —',
  about_text: 'We built our catalog on a simple idea: precision tools and rugged tools shouldn\'t be separate categories. NPI Global Trading sources and distributes hand tools engineered for accuracy and job-site abuse alike — so contractors, maintenance buyers and retailers get one supplier for both ends of the shelf.',
  allow_orders: '1'
};

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function ensureDefaults() {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
}
ensureDefaults();

module.exports = { db, tx, getSettings, DEFAULT_SETTINGS, DB_PATH };
