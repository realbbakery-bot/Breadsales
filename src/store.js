// Data layer: products, orders, settings. All inventory changes happen here,
// inside SQLite transactions, so stock can never go below zero.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class AppError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

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
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  max_per_order INTEGER,
  emoji         TEXT NOT NULL DEFAULT '🍞',
  image_url     TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
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
CREATE INDEX IF NOT EXISTS idx_orders_pickup ON orders(pickup_date);
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
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
`;

export const DEFAULT_SETTINGS = {
  shop_name_en: 'My Home Bakery',
  shop_name_ar: 'مخبزي المنزلي',
  tagline_en: 'Freshly baked with love, every day.',
  tagline_ar: 'مخبوزات طازجة تُعدّ بعناية كل يوم.',
  pickup_info_en: 'Pick up from our home kitchen. We will contact you to confirm.',
  pickup_info_ar: 'يُستلم الطلب من مطبخنا المنزلي، وسنتواصل معكم للتأكيد.',
  currency_en: 'SAR',
  currency_ar: 'ر.س',
  decimals: '2',
  whatsapp: '',
  country_code: '966',
  shop_open: '1',
  lead_days: '0',
  max_days_ahead: '14',
};

const PUBLIC_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
export const ORDER_STATUSES = ['new', 'ready', 'completed', 'cancelled'];

// ---------- helpers ----------
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function toMilli(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 1e7) throw new AppError('invalid_price');
  return Math.round(n * 1000);
}

function intOr(v, fallback, { min = -Infinity, max = Infinity } = {}) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError('invalid_number');
  return n;
}

export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return s;
}

function normalizePhone(p) {
  const cleaned = str(p, 30).replace(/[\s\-().]/g, '');
  // Accept Arabic-Indic digits too.
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
    stock: p.stock,
    max_per_order: p.max_per_order,
    emoji: p.emoji,
    image_url: p.image_url,
    active: !!p.active,
    sort: p.sort,
  };
}

// ---------- store ----------
export function openStore(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

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
  function getSetting(key) {
    return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
  }
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
      for (const [k, max] of Object.entries(limits)) {
        if (k in input) setSetting(k, str(input[k], max));
      }
      if ('decimals' in input) setSetting('decimals', intOr(input.decimals, 2, { min: 0, max: 3 }));
      if ('lead_days' in input) setSetting('lead_days', intOr(input.lead_days, 0, { min: 0, max: 30 }));
      if ('max_days_ahead' in input) setSetting('max_days_ahead', intOr(input.max_days_ahead, 14, { min: 0, max: 90 }));
      if ('shop_open' in input) setSetting('shop_open', input.shop_open ? '1' : '0');
      if ('country_code' in input) {
        const cc = str(input.country_code, 6).replace(/[^\d]/g, '');
        if (cc && cc.length > 4) throw new AppError('invalid_number');
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

  function pickupWindow() {
    const s = getSettings();
    const today = localDate();
    const lead = Number(s.lead_days) || 0;
    const ahead = Math.max(lead, Number(s.max_days_ahead) || 0);
    return { today, min: addDays(today, lead), max: addDays(today, ahead) };
  }

  // ----- products -----
  function listProducts({ includeInactive = false } = {}) {
    const rows = db.prepare(
      `SELECT * FROM products ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort ASC, id ASC`
    ).all();
    return rows.map(productRow);
  }
  function getProduct(id) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!p) throw new AppError('product_not_found', 404);
    return productRow(p);
  }
  function productFields(input, existing) {
    const f = {
      name_en: 'name_en' in input ? str(input.name_en, 80) : existing?.name_en ?? '',
      name_ar: 'name_ar' in input ? str(input.name_ar, 80) : existing?.name_ar ?? '',
      desc_en: 'desc_en' in input ? str(input.desc_en, 400) : existing?.desc_en ?? '',
      desc_ar: 'desc_ar' in input ? str(input.desc_ar, 400) : existing?.desc_ar ?? '',
      price_milli: 'price' in input ? toMilli(input.price) : existing ? Math.round(existing.price * 1000) : 0,
      stock: 'stock' in input ? intOr(input.stock, 0, { min: 0, max: 100000 }) : existing?.stock ?? 0,
      max_per_order: 'max_per_order' in input
        ? intOr(input.max_per_order, null, { min: 1, max: 1000 })
        : existing?.max_per_order ?? null,
      emoji: 'emoji' in input ? str(input.emoji, 8) || '🍞' : existing?.emoji ?? '🍞',
      image_url: 'image_url' in input ? str(input.image_url, 300) : existing?.image_url ?? '',
      active: 'active' in input ? (input.active ? 1 : 0) : existing ? (existing.active ? 1 : 0) : 1,
      sort: 'sort' in input ? intOr(input.sort, 0, { min: -10000, max: 10000 }) : existing?.sort ?? 0,
    };
    if (!f.name_en && !f.name_ar) throw new AppError('name_required');
    if (f.image_url && !/^(\/uploads\/[\w.-]+|https:\/\/\S+)$/.test(f.image_url)) throw new AppError('invalid_image');
    return f;
  }
  function createProduct(input = {}) {
    if (!('price' in input)) throw new AppError('invalid_price');
    const f = productFields(input, null);
    const r = db.prepare(
      `INSERT INTO products (name_en, name_ar, desc_en, desc_ar, price_milli, stock, max_per_order, emoji, image_url, active, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(f.name_en, f.name_ar, f.desc_en, f.desc_ar, f.price_milli, f.stock, f.max_per_order, f.emoji, f.image_url, f.active, f.sort);
    return getProduct(Number(r.lastInsertRowid));
  }
  function updateProduct(id, input = {}) {
    const existing = getProduct(id);
    const f = productFields(input, existing);
    db.prepare(
      `UPDATE products SET name_en=?, name_ar=?, desc_en=?, desc_ar=?, price_milli=?, stock=?, max_per_order=?,
       emoji=?, image_url=?, active=?, sort=? WHERE id=?`
    ).run(f.name_en, f.name_ar, f.desc_en, f.desc_ar, f.price_milli, f.stock, f.max_per_order, f.emoji, f.image_url, f.active, f.sort, id);
    return getProduct(id);
  }
  function adjustStock(id, { delta, set } = {}) {
    getProduct(id);
    if (set !== undefined) {
      const n = intOr(set, 0, { min: 0, max: 100000 });
      db.prepare('UPDATE products SET stock = ? WHERE id = ?').run(n, id);
    } else {
      const d = intOr(delta, 0, { min: -100000, max: 100000 });
      db.prepare('UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?').run(d, id);
    }
    return getProduct(id);
  }
  function deleteProduct(id) {
    getProduct(id);
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
  }

  // ----- orders -----
  function hydrateOrder(o) {
    if (!o) return null;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(o.id).map((i) => ({
      product_id: i.product_id,
      name_en: i.name_en,
      name_ar: i.name_ar,
      unit_price: i.unit_price_milli / 1000,
      qty: i.qty,
    }));
    return {
      id: o.id,
      code: o.code,
      customer_name: o.customer_name,
      phone: o.phone,
      pickup_date: o.pickup_date,
      notes: o.notes,
      status: o.status,
      total: o.total_milli / 1000,
      lang: o.lang,
      created_at: o.created_at,
      updated_at: o.updated_at,
      items,
    };
  }

  function placeOrder(input = {}) {
    if (getSetting('shop_open') !== '1') throw new AppError('shop_closed', 409);

    const customer_name = str(input.customer_name, 80);
    if (customer_name.length < 2) throw new AppError('invalid_name');
    const phone = normalizePhone(input.phone);
    const notes = str(input.notes, 500);
    const lang = input.lang === 'ar' ? 'ar' : 'en';

    const pickup_date = str(input.pickup_date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pickup_date)) throw new AppError('invalid_pickup_date');
    const win = pickupWindow();
    if (pickup_date < win.min || pickup_date > win.max) throw new AppError('invalid_pickup_date', 400, win);

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
      const getP = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1');
      const take = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');
      let total = 0;
      const lines = [];
      for (const [id, qty] of wanted) {
        const p = getP.get(id);
        if (!p) throw new AppError('product_unavailable', 409, { id });
        if (p.max_per_order && qty > p.max_per_order) {
          throw new AppError('over_max_per_order', 409, { id, max: p.max_per_order, name_en: p.name_en, name_ar: p.name_ar });
        }
        // Conditional decrement: succeeds only if enough stock is left.
        const r = take.run(qty, id, qty);
        if (r.changes !== 1) {
          throw new AppError('out_of_stock', 409, { id, available: p.stock, name_en: p.name_en, name_ar: p.name_ar });
        }
        total += p.price_milli * qty;
        lines.push({ p, qty });
      }

      let code;
      for (let i = 0; i < 10; i++) {
        code = makeCode();
        if (!db.prepare('SELECT 1 FROM orders WHERE code = ?').get(code)) break;
      }
      const r = db.prepare(
        `INSERT INTO orders (code, customer_name, phone, pickup_date, notes, status, total_milli, lang)
         VALUES (?, ?, ?, ?, ?, 'new', ?, ?)`
      ).run(code, customer_name, phone, pickup_date, notes, total, lang);
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
    // Match on last 6 digits so "+966 5x..." and "05x..." both work.
    if (!o || o.phone.slice(-6) !== p.slice(-6)) throw new AppError('order_not_found', 404);
    const h = hydrateOrder(o);
    return { code: h.code, status: h.status, pickup_date: h.pickup_date, total: h.total, items: h.items, customer_name: h.customer_name };
  }

  function listOrders({ status, date, from, to, limit = 300 } = {}) {
    const where = [];
    const args = [];
    if (status && status !== 'all') {
      if (status === 'open') where.push("status IN ('new','ready')");
      else { if (!ORDER_STATUSES.includes(status)) throw new AppError('invalid_status'); where.push('status = ?'); args.push(status); }
    }
    if (date) { where.push('pickup_date = ?'); args.push(date); }
    if (from) { where.push('pickup_date >= ?'); args.push(from); }
    if (to) { where.push('pickup_date <= ?'); args.push(to); }
    const sql = `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY pickup_date ASC, created_at ASC LIMIT ${Math.min(Number(limit) || 300, 1000)}`;
    return db.prepare(sql).all(...args).map(hydrateOrder);
  }

  function setOrderStatus(id, status) {
    if (!ORDER_STATUSES.includes(status)) throw new AppError('invalid_status');
    return tx(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!o) throw new AppError('order_not_found', 404);
      if (o.status === status) return hydrateOrder(o);
      if (o.status === 'cancelled') throw new AppError('order_already_cancelled', 409);
      if (status === 'cancelled') {
        if (o.status === 'completed') throw new AppError('cannot_cancel_completed', 409);
        // Return reserved items to inventory.
        const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(id);
        const give = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
        for (const it of items) if (it.product_id) give.run(it.qty, it.product_id);
      }
      db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
      return hydrateOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(id));
    });
  }

  // Totals per product for a pickup date: what needs to be ready / handed over.
  function productionList(date) {
    return db.prepare(
      `SELECT oi.product_id, oi.name_en, oi.name_ar, SUM(oi.qty) AS qty
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.pickup_date = ? AND o.status IN ('new','ready')
        GROUP BY COALESCE(oi.product_id, oi.name_en)
        ORDER BY qty DESC`
    ).all(date).map((r) => ({ ...r, qty: Number(r.qty) }));
  }

  function summary(date) {
    const d = date || localDate();
    const row = db.prepare(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'new') AS new_count,
         COUNT(*) FILTER (WHERE status = 'ready') AS ready_count,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
         COALESCE(SUM(total_milli) FILTER (WHERE status != 'cancelled'), 0) AS revenue_milli
       FROM orders WHERE pickup_date = ?`
    ).get(d);
    const openAll = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'new'").get().n;
    const lowStock = db.prepare('SELECT * FROM products WHERE active = 1 AND stock <= 3 ORDER BY stock ASC').all().map(productRow);
    return {
      date: d,
      new_count: Number(row.new_count),
      ready_count: Number(row.ready_count),
      completed_count: Number(row.completed_count),
      revenue: Number(row.revenue_milli) / 1000,
      all_new_orders: Number(openAll),
      low_stock: lowStock,
      production: productionList(d),
    };
  }

  // ----- auth -----
  function hasPassword() {
    return !!getSetting('admin_password_hash');
  }
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
  function deleteSession(token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  return {
    db,
    getSettings, updateSettings, pickupWindow,
    listProducts, getProduct, createProduct, updateProduct, adjustStock, deleteProduct,
    placeOrder, getOrder, lookupOrder, listOrders, setOrderStatus, productionList, summary,
    hasPassword, setPassword, checkPassword, createSession, validSession, deleteSession,
    close: () => db.close(),
  };
}
