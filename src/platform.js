// Hosting many bakeries from one server. Each request is routed by its domain:
//   sarahsbakery.com  → Sarah's shop & dashboard (her own database in DATA_DIR/bakeries/sarah/)
//   any other address → the owner console (you), protected by OWNER_PASSWORD
// Bakeries never share data, logins or photos.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from './server.js';
import { openRegistry } from './tenants.js';
import { AppError } from './store.js';
import { MIME, SECURITY_HEADERS, makeLimiter, readJsonBody, parseCookies, clientIpOf, isSecureReq } from './http.js';

const PUBLIC_DIR = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'public');
const OWNER_FILES = new Set(['/owner.js', '/styles.css', '/favicon.svg']);

const UNAVAILABLE = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>…</title>
<style>body{font-family:system-ui,Tahoma,sans-serif;background:#fbf5ec;color:#2b1d14;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:16px}</style>
</head><body><div><div style="font-size:3rem">🥖</div><p>المتجر غير متاح مؤقتًا.</p><p dir="ltr">This shop is temporarily unavailable.</p></div></body></html>`;

export function createPlatform({ dataDir, ownerPassword, trustProxy = false, log = console }) {
  if (!ownerPassword || ownerPassword.length < 10) throw new Error('OWNER_PASSWORD must be at least 10 characters.');
  dataDir = path.resolve(dataDir);
  const registry = openRegistry(dataDir);
  const apps = new Map();
  const limit = makeLimiter();
  const sessions = new Map(); // owner session token -> expiry
  const ownerHash = crypto.createHash('sha256').update(ownerPassword).digest();

  function appFor(slug) {
    if (!apps.has(slug)) {
      const dir = registry.dirFor(slug);
      apps.set(slug, createApp({
        dbFile: path.join(dir, 'bakery.db'), uploadsDir: path.join(dir, 'uploads'), trustProxy,
        log: { info() {}, error: (e) => log.error(`[${slug}]`, e) },
      }));
    }
    return apps.get(slug);
  }

  // ---------- owner console ----------
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...SECURITY_HEADERS, ...headers }); res.end(body); };
  const json = (res, status, data) => send(res, status, JSON.stringify(data), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  const isOwner = (req) => {
    const tok = parseCookies(req).bs_owner;
    const exp = tok && sessions.get(tok);
    return !!exp && exp > Date.now();
  };
  const cookie = (req, tok, maxAge) =>
    `bs_owner=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isSecureReq(req, trustProxy) ? '; Secure' : ''}`;

  function bakeryInfo(b) {
    const info = { ...b, shop_name: '', products: 0, upcoming_bakes: 0, open_orders: 0, has_password: false };
    try {
      const st = appFor(b.slug).store;
      const s = st.getSettings();
      info.shop_name = [s.shop_name_ar, s.shop_name_en].filter(Boolean).join(' · ');
      info.products = st.listProducts({ includeInactive: true }).length;
      info.upcoming_bakes = st.listBakeDays().length;
      info.open_orders = st.listOrders({ status: 'open' }).length;
      info.has_password = st.hasPassword();
    } catch (e) { log.error(e); }
    return info;
  }

  async function ownerApi(req, res, p) {
    const ip = clientIpOf(req, trustProxy);
    if (p === '/api/owner/status' && req.method === 'GET') return { loggedIn: isOwner(req) };
    if (p === '/api/owner/login' && req.method === 'POST') {
      if (!limit(`owner:${ip}`, 8, 15 * 60 * 1000)) throw new AppError('rate_limited', 429);
      const { password } = await readJsonBody(req, 2000);
      const h = crypto.createHash('sha256').update(String(password || '')).digest();
      if (!crypto.timingSafeEqual(h, ownerHash)) throw new AppError('wrong_password', 401);
      const tok = crypto.randomBytes(32).toString('hex');
      sessions.set(tok, Date.now() + 7 * 864e5);
      res.setHeader('Set-Cookie', cookie(req, tok, 7 * 86400));
      return { ok: true };
    }
    if (p === '/api/owner/logout' && req.method === 'POST') {
      sessions.delete(parseCookies(req).bs_owner);
      res.setHeader('Set-Cookie', cookie(req, '', 0));
      return { ok: true };
    }
    if (!isOwner(req)) throw new AppError('unauthorized', 401);

    if (p === '/api/owner/bakeries' && req.method === 'GET') return registry.list().map(bakeryInfo);
    if (p === '/api/owner/bakeries' && req.method === 'POST') {
      const { slug, name, name_ar, domains, password } = await readJsonBody(req, 5000);
      if (typeof password !== 'string' || password.length < 8) throw new AppError('weak_password');
      const b = registry.add({ slug: String(slug || '').trim().toLowerCase(), name, domains: Array.isArray(domains) ? domains : [] });
      const st = appFor(b.slug).store;
      st.setPassword(password);
      // The bakery's own name everywhere from day one (no placeholder text in shared links).
      const en = String(name || '').trim() || String(name_ar || '').trim();
      const ar = String(name_ar || '').trim() || en;
      if (en) st.updateSettings({ shop_name_en: en, shop_name_ar: ar });
      return bakeryInfo(b);
    }
    const m = /^\/api\/owner\/bakeries\/([a-z0-9-]+)(\/[a-z-]+)?$/.exec(p);
    if (!m) throw new AppError('not_found', 404);
    const slug = m[1];
    const action = m[2] || '';
    if (!registry.get(slug)) throw new AppError('bakery_not_found', 404);

    if (action === '/domains' && req.method === 'POST') return bakeryInfo(registry.addDomain(slug, (await readJsonBody(req, 1000)).domain));
    if (action === '/domains' && req.method === 'DELETE') return bakeryInfo(registry.removeDomain(slug, (await readJsonBody(req, 1000)).domain));
    if (action === '/password' && req.method === 'POST') {
      appFor(slug).store.setPassword((await readJsonBody(req, 1000)).password);
      return { ok: true };
    }
    if (action === '/active' && req.method === 'POST') return bakeryInfo(registry.setActive(slug, (await readJsonBody(req, 1000)).active));
    if (action === '/backup' && req.method === 'GET') {
      // Consistent snapshot of the live database (safe while the shop is taking orders).
      const tmp = path.join(os.tmpdir(), `bs-${slug}-${crypto.randomBytes(4).toString('hex')}.db`);
      appFor(slug).store.backupTo(tmp);
      const st = fs.statSync(tmp);
      res.writeHead(200, {
        ...SECURITY_HEADERS, 'Content-Type': 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${slug}-${new Date().toISOString().slice(0, 10)}.db"`,
      });
      fs.createReadStream(tmp).on('close', () => fs.rm(tmp, () => {})).pipe(res);
      return undefined;
    }
    throw new AppError('not_found', 404);
  }

  async function ownerHandler(req, res) {
    const p = new URL(req.url, 'http://local').pathname;
    if (p.startsWith('/api/owner/')) {
      const out = await ownerApi(req, res, p);
      if (out !== undefined) json(res, 200, out);
      return;
    }
    // Caddy asks this before issuing an HTTPS certificate, so only real bakery domains get one.
    if (p === '/internal/tls-check') {
      const b = registry.resolve(new URL(req.url, 'http://local').searchParams.get('domain'));
      return send(res, b ? 200 : 404, b ? 'ok' : 'unknown', { 'Content-Type': 'text/plain' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    const file = p === '/' ? 'owner.html' : OWNER_FILES.has(p) ? p.slice(1) : null;
    if (!file) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const body = await fs.promises.readFile(path.join(PUBLIC_DIR, file));
    send(res, 200, body, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache' });
  }

  async function handler(req, res) {
    try {
      const b = registry.resolve(req.headers.host);
      if (b) {
        if (!b.active) return send(res, 503, UNAVAILABLE, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        return appFor(b.slug).handler(req, res);
      }
      return await ownerHandler(req, res);
    } catch (e) {
      if (e instanceof AppError) return json(res, e.status, { error: e.code, details: e.details });
      log.error(e);
      return json(res, 500, { error: 'server_error' });
    }
  }

  // Back up every bakery (used by `npm run backup` and the daily timer).
  function backupAll(destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    const done = [];
    for (const b of registry.list()) {
      const file = path.join(destDir, `${b.slug}.db`);
      fs.rmSync(file, { force: true });
      appFor(b.slug).store.backupTo(file);
      done.push(file);
    }
    return done;
  }

  return { handler, registry, appFor, backupAll };
}
