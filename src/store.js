// Data layer. The model fits weekly / twice-weekly bakers:
//   products  = the catalog (names, price, photo)
//   bake days = a date + an order cutoff + how many of each item will be baked (capacity)
//   orders    = reserve from one bake day; remaining = capacity − reserved (non-cancelled)
// Orders are checked and inserted inside one IMMEDIATE transaction, so a bake day can
// never be oversold.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { KINDS, flourTotal } from '../public/bakersmath.js';

export class AppError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const SCHEMA_VERSION = 3;
const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name_en       TEXT NOT NULL DEFAULT '',
  name_ar       TEXT NOT NULL DEFAULT '',
  desc_en       TEXT NOT NULL DEFAULT '',
  desc_ar       TEXT NOT NULL DEFAULT '',
  price_milli   INTEGER NOT NULL CHECK (price_milli >= 0),
  default_qty   INTEGER NOT NULL DEFAULT 0 CHECK (default_qty >= 0),
  max_per_order INTEGER,
  emoji         TEXT NOT NULL DEFAULT '🍞',
  image_url     TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bake_days (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL UNIQUE,          -- YYYY-MM-DD (bake & pickup day)
  cutoff_at  TEXT,                          -- YYYY-MM-DDTHH:MM local time; orders close after this
  note_en    TEXT NOT NULL DEFAULT '',
  note_ar    TEXT NOT NULL DEFAULT '',
  is_open    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bake_items (
  bake_day_id INTEGER NOT NULL REFERENCES bake_days(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  capacity    INTEGER NOT NULL CHECK (capacity >= 0),
  PRIMARY KEY (bake_day_id, product_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  bake_day_id   INTEGER NOT NULL REFERENCES bake_days(id),
  customer_name TEXT NOT NULL,
  phone         TEXT NOT NULL,
  pickup_date   TEXT NOT NULL,
  notes         TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'new',
  total_milli   INTEGER NOT NULL,
  lang          TEXT NOT NULL DEFAULT 'en',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_bake_day ON orders(bake_day_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id       INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name_en          TEXT NOT NULL,
  name_ar          TEXT NOT NULL,
  unit_price_milli INTEGER NOT NULL,
  qty              INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS recipes (
  product_id       INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  piece_weight_g   REAL NOT NULL CHECK (piece_weight_g > 0),
  waste_pct        REAL NOT NULL DEFAULT 0,
  levain_hydration REAL NOT NULL DEFAULT 100,
  notes_en         TEXT NOT NULL DEFAULT '',
  notes_ar         TEXT NOT NULL DEFAULT '',
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES recipes(product_id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  name_en    TEXT NOT NULL DEFAULT '',
  name_ar    TEXT NOT NULL DEFAULT '',
  pct        REAL NOT NULL CHECK (pct >= 0),
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
`;

export const DEFAULT_SETTINGS = {
  shop_name_en: 'My Home Bakery',
  shop_name_ar: 'مخبزي المنزلي',
  tagline_en: 'Naturally leavened sourdough, baked to order.',
  tagline_ar: 'خبز العجين المخمّر طبيعيًا، يُخبز حسب الطلب.',
  pickup_info_en: 'Pick up from our home kitchen on bake day. We will contact you to confirm.',
  pickup_info_ar: 'يُستلم الطلب من مطبخنا المنزلي في يوم الخَبز، وسنتواصل معكم للتأكيد.',
  currency_en: 'SAR',
  currency_ar: 'ر.س',
  decimals: '2',
  whatsapp: '',
  country_code: '966',
  shop_open: '1',
  cutoff_days_before: '1',
  cutoff_time: '20:00',
};

const PUBLIC_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
export const ORDER_STATUSES = ['new', 'ready', 'completed', 'cancelled'];

// ---------- helpers ----------
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function toMilli(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (String(v ?? '').trim() === '' || !Number.isFinite(n) || n < 0 || n > 1e7) throw new AppError('invalid_price');
  return Math.round(n * 1000);
}

function intOr(v, fallback, { min = -Infinity, max = Infinity } = {}) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError('invalid_number');
  return n;
}

const pad = (n) => String(n).padStart(2, '0');
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function localDateTime(d = new Date()) {
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isDateTime = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s);

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  let s = '';
  for (const b of crypto.randomBytes(6)) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

function normalizePhone(p) {
  const cleaned = str(p, 30).replace(/[\s\-().]/g, '');
  const western = cleaned.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  if (!/^\+?\d{6,15}$/.test(western)) throw new AppError('invalid_phone');
  return western;
}

function productRow(p) {
  return {
    id: p.id,
    name_en: p.name_en,
    name_ar: p.name_ar,
    desc_en: p.desc_en,
    desc_ar: p.desc_ar,
    price: p.price_milli / 1000,
    default_qty: p.default_qty,
    max_per_order: p.max_per_order,
    emoji: p.emoji,
    image_url: p.image_url,
    active: !!p.active,
    sort: p.sort,
  };
}

// ---------- store ----------
export function openStore(file = ':memory:', { now = () => new Date() } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');

  const version = db.prepare('PRAGMA user_version').get().user_version;
  const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'products'").get();
  if (hasTables && version < 2) {
    throw new Error(`Database ${file} uses an older format (v${version}). Start with an empty DATA_DIR.`);
  }
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  // ----- settings -----
  const getSetting = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  function setSetting(key, value) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value));
  }
  function getSettings() {
    const out = {};
    for (const k of PUBLIC_SETTING_KEYS) out[k] = getSetting(k) ?? DEFAULT_SETTINGS[k];
    return out;
  }
  function updateSettings(input = {}) {
    const limits = {
      shop_name_en: 80, shop_name_ar: 80, tagline_en: 200, tagline_ar: 200,
      pickup_info_en: 500, pickup_info_ar: 500, currency_en: 10, currency_ar: 10,
    };
    tx(() => {
      for (const [k, max] of Object.entries(limits)) if (k in input) setSetting(k, str(input[k], max));
      if ('decimals' in input) setSetting('decimals', intOr(input.decimals, 2, { min: 0, max: 3 }));
      if ('cutoff_days_before' in input) setSetting('cutoff_days_before', intOr(input.cutoff_days_before, 1, { min: 0, max: 14 }));
      if ('cutoff_time' in input) {
        const tm = str(input.cutoff_time, 5);
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(tm)) throw new AppError('invalid_time');
        setSetting('cutoff_time', tm);
      }
      if ('shop_open' in input) setSetting('shop_open', input.shop_open ? '1' : '0');
      if ('country_code' in input) {
        const cc = str(input.country_code, 6).replace(/[^\d]/g, '');
        if (cc.length > 4) throw new AppError('invalid_number');
        setSetting('country_code', cc);
      }
      if ('whatsapp' in input) {
        const w = str(input.whatsapp, 20).replace(/[^\d]/g, '');
        if (w && (w.length < 8 || w.length > 15)) throw new AppError('invalid_whatsapp');
        setSetting('whatsapp', w);
      }
    });
    return getSettings();
  }

  // ----- products (catalog) -----
  function listProducts({ includeInactive = false } = {}) {
    return db.prepare(
      `SELECT * FROM products ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort ASC, id ASC`
    ).all().map(productRow);
  }
  function getProduct(id) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!p) throw new AppError('product_not_found', 404);
    return productRow(p);
  }
  function productFields(input, ex) {
    const has = (k) => k in input;
    const f = {
      name_en: has('name_en') ? str(input.name_en, 80) : ex?.name_en ?? '',
      name_ar: has('name_ar') ? str(input.name_ar, 80) : ex?.name_ar ?? '',
      desc_en: has('desc_en') ? str(input.desc_en, 400) : ex?.desc_en ?? '',
      desc_ar: has('desc_ar') ? str(input.desc_ar, 400) : ex?.desc_ar ?? '',
      price_milli: has('price') ? toMilli(input.price) : Math.round((ex?.price ?? 0) * 1000),
      default_qty: has('default_qty') ? intOr(input.default_qty, 0, { min: 0, max: 10000 }) : ex?.default_qty ?? 0,
      max_per_order: has('max_per_order') ? intOr(input.max_per_order, null, { min: 1, max: 1000 }) : ex?.max_per_order ?? null,
      emoji: has('emoji') ? str(input.emoji, 8) || '🍞' : ex?.emoji ?? '🍞',
      image_url: has('image_url') ? str(input.image_url, 300) : ex?.image_url ?? '',
      active: has('active') ? (input.active ? 1 : 0) : ex ? (ex.active ? 1 : 0) : 1,
      sort: has('sort') ? intOr(input.sort, 0, { min: -10000, max: 10000 }) : ex?.sort ?? 0,
    };
    if (!f.name_en && !f.name_ar) throw new AppError('name_required');
    if (f.image_url && !/^(\/uploads\/[\w.-]+|https:\/\/\S+)$/.test(f.image_url)) throw new AppError('invalid_image');
    return f;
  }
  function createProduct(input = {}) {
    if (!('price' in input)) throw new AppError('invalid_price');
    const f = productFields(input, null);
    const r = db.prepare(
      `INSERT INTO products (name_en, name_ar, desc_en, desc_ar, price_milli, default_qty, max_per_order, emoji, image_url, active, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(f.name_en, f.name_ar, f.desc_en, f.desc_ar, f.price_milli, f.default_qty, f.max_per_order, f.emoji, f.image_url, f.active, f.sort);
    return getProduct(Number(r.lastInsertRowid));
  }
  function updateProduct(id, input = {}) {
    const f = productFields(input, getProduct(id));
    db.prepare(
      `UPDATE products SET name_en=?, name_ar=?, desc_en=?, desc_ar=?, price_milli=?, default_qty=?, max_per_order=?,
       emoji=?, image_url=?, active=?, sort=? WHERE id=?`
    ).run(f.name_en, f.name_ar, f.desc_en, f.desc_ar, f.price_milli, f.default_qty, f.max_per_order, f.emoji, f.image_url, f.active, f.sort, id);
    return getProduct(id);
  }
  function deleteProduct(id) {
    getProduct(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  }

  // ----- bake days -----
  const reservedStmt = db.prepare(
    `SELECT COALESCE(SUM(oi.qty), 0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.bake_day_id = ? AND oi.product_id = ? AND o.status != 'cancelled'`
  );
  const reserved = (bakeDayId, productId) => Number(reservedStmt.get(bakeDayId, productId).n);

  function bakeDayState(b) {
    const nowStr = localDateTime(now());
    if (b.date < localDate(now())) return 'past';
    if (!b.is_open) return 'closed';
    if (b.cutoff_at && nowStr >= b.cutoff_at) return 'cutoff';
    return 'open';
  }

  function hydrateBakeDay(b) {
    const items = db.prepare(
      `SELECT bi.product_id, bi.capacity, p.name_en, p.name_ar, p.emoji, p.image_url, p.active, p.sort
         FROM bake_items bi JOIN products p ON p.id = bi.product_id
        WHERE bi.bake_day_id = ? ORDER BY p.sort, p.id`
    ).all(b.id).map((i) => {
      const r = reserved(b.id, i.product_id);
      return {
        product_id: i.product_id, name_en: i.name_en, name_ar: i.name_ar, emoji: i.emoji, image_url: i.image_url,
        active: !!i.active, capacity: i.capacity, reserved: r, remaining: Math.max(0, i.capacity - r),
      };
    });
    const counts = db.prepare(
      `SELECT COUNT(*) FILTER (WHERE status != 'cancelled') AS orders,
              COUNT(*) FILTER (WHERE status = 'new') AS new_orders
         FROM orders WHERE bake_day_id = ?`
    ).get(b.id);
    return {
      id: b.id, date: b.date, cutoff_at: b.cutoff_at, note_en: b.note_en, note_ar: b.note_ar,
      is_open: !!b.is_open, state: bakeDayState(b), items,
      order_count: Number(counts.orders), new_count: Number(counts.new_orders),
    };
  }

  function getBakeDay(id) {
    const b = db.prepare('SELECT * FROM bake_days WHERE id = ?').get(id);
    if (!b) throw new AppError('bake_day_not_found', 404);
    return hydrateBakeDay(b);
  }

  function listBakeDays({ scope = 'upcoming' } = {}) {
    const today = localDate(now());
    const rows = scope === 'all'
      ? db.prepare('SELECT * FROM bake_days ORDER BY date DESC LIMIT 60').all()
      : db.prepare('SELECT * FROM bake_days WHERE date >= ? ORDER BY date ASC').all(today);
    return rows.map(hydrateBakeDay);
  }

  // What customers see: open bake days with remaining quantities for active products.
  function publicBakeDays() {
    return listBakeDays().filter((b) => b.state === 'open').map((b) => ({
      id: b.id, date: b.date, cutoff_at: b.cutoff_at, note_en: b.note_en, note_ar: b.note_ar,
      items: b.items.filter((i) => i.active && i.capacity > 0).map((i) => ({ product_id: i.product_id, remaining: i.remaining })),
    }));
  }

  function defaultCutoff(date) {
    const s = getSettings();
    return `${addDays(date, -Number(s.cutoff_days_before || 0))}T${s.cutoff_time || '20:00'}`;
  }

  // Pre-filled form for a new bake day: a week after the latest one, same quantities.
  function bakeDayTemplate() {
    const last = db.prepare('SELECT * FROM bake_days ORDER BY date DESC LIMIT 1').get();
    const today = localDate(now());
    let date = last ? addDays(last.date, 7) : addDays(today, 2);
    while (date < today || db.prepare('SELECT 1 FROM bake_days WHERE date = ?').get(date)) date = addDays(date, 7);
    const lastItems = last
      ? new Map(db.prepare('SELECT product_id, capacity FROM bake_items WHERE bake_day_id = ?').all(last.id).map((r) => [r.product_id, r.capacity]))
      : null;
    return {
      date,
      cutoff_at: defaultCutoff(date),
      note_en: '', note_ar: '', is_open: true,
      items: listProducts().map((p) => ({ product_id: p.id, capacity: lastItems?.get(p.id) ?? p.default_qty })),
    };
  }

  function bakeDayFields(input, existing) {
    const date = 'date' in input ? str(input.date, 10) : existing?.date;
    if (!date || !isDate(date)) throw new AppError('invalid_date');
    let cutoff_at = 'cutoff_at' in input ? str(input.cutoff_at, 16) || null : existing?.cutoff_at ?? defaultCutoff(date);
    if (cutoff_at && !isDateTime(cutoff_at)) throw new AppError('invalid_cutoff');
    if (cutoff_at && cutoff_at > `${date}T23:59`) throw new AppError('cutoff_after_bake_day');
    return {
      date, cutoff_at,
      note_en: 'note_en' in input ? str(input.note_en, 300) : existing?.note_en ?? '',
      note_ar: 'note_ar' in input ? str(input.note_ar, 300) : existing?.note_ar ?? '',
      is_open: 'is_open' in input ? (input.is_open ? 1 : 0) : existing ? (existing.is_open ? 1 : 0) : 1,
    };
  }

  function saveBakeItems(bakeDayId, items) {
    if (!Array.isArray(items)) return;
    const upsert = db.prepare(
      `INSERT INTO bake_items (bake_day_id, product_id, capacity) VALUES (?, ?, ?)
       ON CONFLICT(bake_day_id, product_id) DO UPDATE SET capacity = excluded.capacity`
    );
    for (const it of items) {
      const pid = Number(it?.product_id);
      const cap = intOr(it?.capacity, 0, { min: 0, max: 10000 });
      if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(pid)) throw new AppError('product_not_found', 404);
      const r = reserved(bakeDayId, pid);
      if (cap < r) {
        const p = getProduct(pid);
        throw new AppError('capacity_below_reserved', 409, { reserved: r, name_en: p.name_en, name_ar: p.name_ar });
      }
      upsert.run(bakeDayId, pid, cap);
    }
  }

  function createBakeDay(input = {}) {
    const f = bakeDayFields(input, null);
    return tx(() => {
      if (db.prepare('SELECT 1 FROM bake_days WHERE date = ?').get(f.date)) throw new AppError('bake_day_exists', 409);
      const r = db.prepare('INSERT INTO bake_days (date, cutoff_at, note_en, note_ar, is_open) VALUES (?, ?, ?, ?, ?)')
        .run(f.date, f.cutoff_at, f.note_en, f.note_ar, f.is_open);
      const id = Number(r.lastInsertRowid);
      saveBakeItems(id, input.items);
      return getBakeDay(id);
    });
  }

  function updateBakeDay(id, input = {}) {
    const existing = getBakeDay(id);
    const f = bakeDayFields(input, existing);
    return tx(() => {
      if (f.date !== existing.date) {
        if (existing.order_count > 0) throw new AppError('bake_day_has_orders', 409);
        if (db.prepare('SELECT 1 FROM bake_days WHERE date = ? AND id != ?').get(f.date, id)) throw new AppError('bake_day_exists', 409);
      }
      db.prepare('UPDATE bake_days SET date=?, cutoff_at=?, note_en=?, note_ar=?, is_open=? WHERE id=?')
        .run(f.date, f.cutoff_at, f.note_en, f.note_ar, f.is_open, id);
      saveBakeItems(id, input.items);
      return getBakeDay(id);
    });
  }

  function deleteBakeDay(id) {
    getBakeDay(id);
    if (db.prepare('SELECT 1 FROM orders WHERE bake_day_id = ?').get(id)) throw new AppError('bake_day_has_orders', 409);
    db.prepare('DELETE FROM bake_days WHERE id = ?').run(id);
  }

  // ----- recipes (baker's percentages) -----
  function recipeRow(r) {
    return {
      product_id: r.product_id,
      piece_weight_g: r.piece_weight_g,
      waste_pct: r.waste_pct,
      levain_hydration: r.levain_hydration,
      notes_en: r.notes_en,
      notes_ar: r.notes_ar,
      ingredients: db.prepare('SELECT kind, name_en, name_ar, pct FROM recipe_ingredients WHERE product_id = ? ORDER BY sort, id')
        .all(r.product_id).map((i) => ({ ...i })),
    };
  }
  function listRecipes() {
    return db.prepare('SELECT * FROM recipes').all().map(recipeRow);
  }
  function getRecipe(productId) {
    const r = db.prepare('SELECT * FROM recipes WHERE product_id = ?').get(productId);
    if (!r) throw new AppError('recipe_not_found', 404);
    return recipeRow(r);
  }
  function num(v, { min, max }) {
    const n = Number(v);
    if (v === '' || v === null || v === undefined || !Number.isFinite(n) || n < min || n > max) throw new AppError('invalid_number');
    return n;
  }
  function saveRecipe(productId, input = {}) {
    getProduct(productId);
    const piece = num(input.piece_weight_g, { min: 1, max: 100000 });
    const waste = num(input.waste_pct ?? 0, { min: 0, max: 50 });
    const levH = num(input.levain_hydration ?? 100, { min: 0, max: 500 });
    if (!Array.isArray(input.ingredients) || input.ingredients.length === 0 || input.ingredients.length > 40) {
      throw new AppError('invalid_recipe');
    }
    const ings = input.ingredients.map((i) => {
      if (!KINDS.includes(i?.kind)) throw new AppError('invalid_recipe');
      const name_en = str(i.name_en, 60);
      const name_ar = str(i.name_ar, 60);
      if (!name_en && !name_ar) throw new AppError('ingredient_name_required');
      return { kind: i.kind, name_en, name_ar, pct: num(i.pct, { min: 0, max: 1000 }) };
    });
    // Baker's math only works when the flours add up to 100%.
    const ft = flourTotal(ings);
    if (Math.abs(ft - 100) > 0.01) throw new AppError('flour_must_total_100', 400, { total: Math.round(ft * 100) / 100 });
    return tx(() => {
      db.prepare(
        `INSERT INTO recipes (product_id, piece_weight_g, waste_pct, levain_hydration, notes_en, notes_ar) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(product_id) DO UPDATE SET piece_weight_g = excluded.piece_weight_g, waste_pct = excluded.waste_pct,
           levain_hydration = excluded.levain_hydration, notes_en = excluded.notes_en, notes_ar = excluded.notes_ar,
           updated_at = datetime('now')`
      ).run(productId, piece, waste, levH, str(input.notes_en, 1000), str(input.notes_ar, 1000));
      db.prepare('DELETE FROM recipe_ingredients WHERE product_id = ?').run(productId);
      const add = db.prepare('INSERT INTO recipe_ingredients (product_id, kind, name_en, name_ar, pct, sort) VALUES (?, ?, ?, ?, ?, ?)');
      ings.forEach((i, idx) => add.run(productId, i.kind, i.name_en, i.name_ar, i.pct, idx));
      return getRecipe(productId);
    });
  }
  function deleteRecipe(productId) {
    db.prepare('DELETE FROM recipes WHERE product_id = ?').run(productId);
  }

  // ----- orders -----
  function hydrateOrder(o) {
    if (!o) return null;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(o.id).map((i) => ({
      product_id: i.product_id, name_en: i.name_en, name_ar: i.name_ar, unit_price: i.unit_price_milli / 1000, qty: i.qty,
    }));
    return {
      id: o.id, code: o.code, bake_day_id: o.bake_day_id, customer_name: o.customer_name, phone: o.phone,
      pickup_date: o.pickup_date, notes: o.notes, status: o.status, total: o.total_milli / 1000, lang: o.lang,
      created_at: o.created_at, updated_at: o.updated_at, items,
    };
  }

  function placeOrder(input = {}) {
    if (getSetting('shop_open') !== '1') throw new AppError('shop_closed', 409);

    const customer_name = str(input.customer_name, 80);
    if (customer_name.length < 2) throw new AppError('invalid_name');
    const phone = normalizePhone(input.phone);
    const notes = str(input.notes, 500);
    const lang = input.lang === 'ar' ? 'ar' : 'en';
    const bakeDayId = Number(input.bake_day_id);
    if (!Number.isInteger(bakeDayId)) throw new AppError('bake_day_not_found', 404);

    if (!Array.isArray(input.items) || input.items.length === 0) throw new AppError('empty_order');
    if (input.items.length > 50) throw new AppError('too_many_items');
    const wanted = new Map();
    for (const it of input.items) {
      const id = Number(it?.id);
      const qty = Number(it?.qty);
      if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 1000) throw new AppError('invalid_item');
      wanted.set(id, (wanted.get(id) || 0) + qty);
    }

    return tx(() => {
      const b = db.prepare('SELECT * FROM bake_days WHERE id = ?').get(bakeDayId);
      if (!b) throw new AppError('bake_day_not_found', 404);
      const st = bakeDayState(b);
      if (st !== 'open') throw new AppError(st === 'cutoff' ? 'orders_closed_for_day' : 'bake_day_unavailable', 409);

      const getLine = db.prepare(
        `SELECT p.*, bi.capacity FROM products p JOIN bake_items bi ON bi.product_id = p.id
          WHERE p.id = ? AND bi.bake_day_id = ? AND p.active = 1`
      );
      let total = 0;
      const lines = [];
      for (const [id, qty] of wanted) {
        const p = getLine.get(id, bakeDayId);
        if (!p || p.capacity <= 0) throw new AppError('product_unavailable', 409, { id });
        if (p.max_per_order && qty > p.max_per_order) {
          throw new AppError('over_max_per_order', 409, { id, max: p.max_per_order, name_en: p.name_en, name_ar: p.name_ar });
        }
        // Safe: the IMMEDIATE transaction holds the write lock between this check and the insert.
        const available = p.capacity - reserved(bakeDayId, id);
        if (qty > available) {
          throw new AppError('out_of_stock', 409, { id, available: Math.max(0, available), name_en: p.name_en, name_ar: p.name_ar });
        }
        total += p.price_milli * qty;
        lines.push({ p, qty });
      }

      let code;
      do { code = makeCode(); } while (db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code));
      const r = db.prepare(
        `INSERT INTO orders (code, bake_day_id, customer_name, phone, pickup_date, notes, status, total_milli, lang)
         VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?)`
      ).run(code, bakeDayId, customer_name, phone, b.date, notes, total, lang);
      const orderId = Number(r.lastInsertRowid);
      const addItem = db.prepare(
        'INSERT INTO order_items (order_id, product_id, name_en, name_ar, unit_price_milli, qty) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const { p, qty } of lines) addItem.run(orderId, p.id, p.name_en, p.name_ar, p.price_milli, qty);
      return hydrateOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId));
    });
  }

  function getOrder(id) {
    const o = hydrateOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
    if (!o) throw new AppError('order_not_found', 404);
    return o;
  }

  function lookupOrder(code, phone) {
    const c = str(code, 12).toUpperCase();
    let p;
    try { p = normalizePhone(phone); } catch { throw new AppError('order_not_found', 404); }
    const o = db.prepare('SELECT * FROM orders WHERE code = ?').get(c);
    // Match on the last 6 digits so "+966 5x…" and "05x…" both work.
    if (!o || o.phone.slice(-6) !== p.slice(-6)) throw new AppError('order_not_found', 404);
    const h = hydrateOrder(o);
    return { code: h.code, status: h.status, pickup_date: h.pickup_date, total: h.total, items: h.items, customer_name: h.customer_name };
  }

  function listOrders({ status, bakeDayId, limit = 500 } = {}) {
    const where = [];
    const args = [];
    if (status && status !== 'all') {
      if (status === 'open') where.push("status IN ('new','ready')");
      else {
        if (!ORDER_STATUSES.includes(status)) throw new AppError('invalid_status');
        where.push('status = ?');
        args.push(status);
      }
    }
    if (bakeDayId) { where.push('bake_day_id = ?'); args.push(Number(bakeDayId)); }
    const sql = `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY pickup_date ASC, created_at ASC LIMIT ${Math.min(Number(limit) || 500, 1000)}`;
    return db.prepare(sql).all(...args).map(hydrateOrder);
  }

  // Cancelled orders stop counting as reserved, so the items free up automatically.
  function setOrderStatus(id, status) {
    if (!ORDER_STATUSES.includes(status)) throw new AppError('invalid_status');
    return tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!o) throw new AppError('order_not_found', 404);
      if (o.status === status) return hydrateOrder(o);
      if (o.status === 'cancelled') throw new AppError('order_already_cancelled', 409);
      if (status === 'cancelled' && o.status === 'completed') throw new AppError('cannot_cancel_completed', 409);
      db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
      return hydrateOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
    });
  }

  // The baker's bake sheet for one bake day.
  function summary(bakeDayId) {
    let b;
    if (bakeDayId) b = getBakeDay(Number(bakeDayId));
    else {
      const next = db.prepare('SELECT id FROM bake_days WHERE date >= ? ORDER BY date ASC LIMIT 1').get(localDate(now()))
        ?? db.prepare('SELECT id FROM bake_days ORDER BY date DESC LIMIT 1').get();
      if (next) b = getBakeDay(next.id);
    }
    const allNew = Number(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'").get().n);
    if (!b) return { bake_day: null, all_new_orders: allNew };
    const row = db.prepare(
      `SELECT COUNT(*) FILTER (WHERE status = 'new') AS new_count,
              COUNT(*) FILTER (WHERE status = 'ready') AS ready_count,
              COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
              COALESCE(SUM(total_milli) FILTER (WHERE status != 'cancelled'), 0) AS revenue_milli
         FROM orders WHERE bake_day_id = ?`
    ).get(b.id);
    return {
      bake_day: b,
      new_count: Number(row.new_count),
      ready_count: Number(row.ready_count),
      completed_count: Number(row.completed_count),
      revenue: Number(row.revenue_milli) / 1000,
      all_new_orders: allNew,
    };
  }

  // ----- auth -----
  const hasPassword = () => !!getSetting('admin_password_hash');
  function setPassword(pw) {
    if (typeof pw !== 'string' || pw.length < 8 || pw.length > 200) throw new AppError('weak_password');
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(pw, salt, 64);
    setSetting('admin_password_hash', `${salt.toString('hex')}:${hash.toString('hex')}`);
    db.prepare('DELETE FROM sessions').run();
  }
  function checkPassword(pw) {
    const stored = getSetting('admin_password_hash');
    if (!stored || typeof pw !== 'string') return false;
    const [saltHex, hashHex] = stored.split(':');
    const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  }
  function createSession(days = 30) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, Date.now() + days * 864e5);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    return token;
  }
  function validSession(token) {
    if (!token) return false;
    const r = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
    return !!r && r.expires_at > Date.now();
  }
  const deleteSession = (token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token);

  return {
    db,
    getSettings, updateSettings,
    listProducts, getProduct, createProduct, updateProduct, deleteProduct,
    listBakeDays, publicBakeDays, getBakeDay, bakeDayTemplate, createBakeDay, updateBakeDay, deleteBakeDay,
    listRecipes, getRecipe, saveRecipe, deleteRecipe,
    placeOrder, getOrder, lookupOrder, listOrders, setOrderStatus, summary,
    hasPassword, setPassword, checkPassword, createSession, validSession, deleteSession,
    close: () => db.close(),
  };
}
