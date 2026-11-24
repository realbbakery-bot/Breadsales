// HTTP server: serves the customer shop (/), the baker dashboard (/admin)
// and a small JSON API. No external dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore, AppError } from './store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

// Simple fixed-window rate limiter (per IP + bucket).
function makeLimiter() {
  const hits = new Map();
  return (key, max, windowMs) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return true;
    }
    h.n += 1;
    return h.n <= max;
  };
}

export function createApp({ dbFile, uploadsDir, adminPassword, trustProxy = false, log = console } = {}) {
  const store = openStore(dbFile);
  fs.mkdirSync(uploadsDir, { recursive: true });
  const limit = makeLimiter();

  // First-run admin bootstrap.
  let setupCode = null;
  if (!store.hasPassword()) {
    if (adminPassword) {
      store.setPassword(adminPassword);
      log.info('[breadsales] Admin password set from ADMIN_PASSWORD.');
    } else {
      setupCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      log.info(`[breadsales] No admin password yet. Open /admin and use setup code: ${setupCode}`);
    }
  }

  const clientIp = (req) =>
    (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
    res.end(body);
  }
  function json(res, status, data, headers = {}) {
    send(res, status, JSON.stringify(data), { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });
  }

  function readBody(req, max) {
    return new Promise((resolve, reject) => {
      const ct = String(req.headers['content-type'] || '');
      // Requiring JSON also blocks simple cross-site form posts (CSRF).
      if (!ct.startsWith('application/json')) return reject(new AppError('json_required', 415));
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > max) { reject(new AppError('payload_too_large', 413)); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new AppError('invalid_json')); }
      });
      req.on('error', reject);
    });
  }

  function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }
  const isSecure = (req) => req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
  function sessionCookie(req, token, maxAge) {
    return `bs_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isSecure(req) ? '; Secure' : ''}`;
  }
  const isAdmin = (req) => store.validSession(cookies(req).bs_session);

  function serveFile(res, file, cache) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': cache,
      });
      fs.createReadStream(file).pipe(res);
    });
  }
  function safeJoin(base, rel) {
    const p = path.normalize(path.join(base, rel));
    return p.startsWith(base + path.sep) ? p : null;
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };
  const requireAdmin = (h) => (ctx) => {
    if (!isAdmin(ctx.req)) throw new AppError('unauthorized', 401);
    return h(ctx);
  };
  const idParam = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new AppError('not_found', 404);
    return n;
  };

  // Public
  route('GET', '/api/shop', () => ({
    settings: store.getSettings(),
    products: store.listProducts(),
    bakeDays: store.publicBakeDays(),
  }));

  route('POST', '/api/orders', async ({ req }) => {
    if (!limit(`order:${clientIp(req)}`, 10, 60 * 60 * 1000)) throw new AppError('rate_limited', 429);
    const body = await readBody(req, 20_000);
    return { order: store.placeOrder(body) };
  });

  route('GET', '/api/orders/lookup', ({ req, url }) => {
    if (!limit(`lookup:${clientIp(req)}`, 30, 10 * 60 * 1000)) throw new AppError('rate_limited', 429);
    return { order: store.lookupOrder(url.searchParams.get('code'), url.searchParams.get('phone')) };
  });

  // Admin auth
  route('GET', '/api/admin/status', ({ req }) => ({ setupNeeded: !store.hasPassword(), loggedIn: isAdmin(req) }));

  route('POST', '/api/admin/setup', async ({ req, res }) => {
    if (store.hasPassword()) throw new AppError('already_setup', 409);
    if (!limit(`login:${clientIp(req)}`, 10, 15 * 60 * 1000)) throw new AppError('rate_limited', 429);
    const { code, password } = await readBody(req, 2000);
    if (!setupCode || String(code || '').trim().toUpperCase() !== setupCode) throw new AppError('invalid_setup_code', 403);
    store.setPassword(password);
    setupCode = null;
    res.setHeader('Set-Cookie', sessionCookie(req, store.createSession(), 30 * 86400));
    return { ok: true };
  });

  route('POST', '/api/admin/login', async ({ req, res }) => {
    if (!limit(`login:${clientIp(req)}`, 10, 15 * 60 * 1000)) throw new AppError('rate_limited', 429);
    const { password } = await readBody(req, 2000);
    if (!store.checkPassword(password)) throw new AppError('wrong_password', 401);
    res.setHeader('Set-Cookie', sessionCookie(req, store.createSession(), 30 * 86400));
    return { ok: true };
  });

  route('POST', '/api/admin/logout', ({ req, res }) => {
    store.deleteSession(cookies(req).bs_session);
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return { ok: true };
  });

  route('POST', '/api/admin/password', requireAdmin(async ({ req, res }) => {
    const { current, next } = await readBody(req, 2000);
    if (!store.checkPassword(current)) throw new AppError('wrong_password', 401);
    store.setPassword(next);
    res.setHeader('Set-Cookie', sessionCookie(req, store.createSession(), 30 * 86400));
    return { ok: true };
  }));

  // Admin data
  route('GET', '/api/admin/summary', requireAdmin(({ url }) => store.summary(url.searchParams.get('bake_day_id') || undefined)));
  route('GET', '/api/admin/settings', requireAdmin(() => store.getSettings()));
  route('PUT', '/api/admin/settings', requireAdmin(async ({ req }) => store.updateSettings(await readBody(req, 10_000))));

  route('GET', '/api/admin/products', requireAdmin(() => store.listProducts({ includeInactive: true })));
  route('POST', '/api/admin/products', requireAdmin(async ({ req }) => store.createProduct(await readBody(req, 10_000))));
  route('PUT', '/api/admin/products/:id', requireAdmin(async ({ req, params }) =>
    store.updateProduct(idParam(params.id), await readBody(req, 10_000))));
  route('DELETE', '/api/admin/products/:id', requireAdmin(({ params }) => {
    store.deleteProduct(idParam(params.id));
    return { ok: true };
  }));

  route('GET', '/api/admin/bake-days', requireAdmin(({ url }) => store.listBakeDays({ scope: url.searchParams.get('scope') || 'upcoming' })));
  route('GET', '/api/admin/bake-days/template', requireAdmin(() => store.bakeDayTemplate()));
  route('POST', '/api/admin/bake-days', requireAdmin(async ({ req }) => store.createBakeDay(await readBody(req, 20_000))));
  route('PUT', '/api/admin/bake-days/:id', requireAdmin(async ({ req, params }) =>
    store.updateBakeDay(idParam(params.id), await readBody(req, 20_000))));
  route('DELETE', '/api/admin/bake-days/:id', requireAdmin(({ params }) => {
    store.deleteBakeDay(idParam(params.id));
    return { ok: true };
  }));

  route('GET', '/api/admin/recipes', requireAdmin(() => store.listRecipes()));
  route('PUT', '/api/admin/recipes/:id', requireAdmin(async ({ req, params }) =>
    store.saveRecipe(idParam(params.id), await readBody(req, 50_000))));
  route('DELETE', '/api/admin/recipes/:id', requireAdmin(({ params }) => {
    store.deleteRecipe(idParam(params.id));
    return { ok: true };
  }));

  route('GET', '/api/admin/orders', requireAdmin(({ url }) => store.listOrders({
    status: url.searchParams.get('status') || undefined,
    bakeDayId: url.searchParams.get('bake_day_id') || undefined,
  })));
  route('PUT', '/api/admin/orders/:id/status', requireAdmin(async ({ req, params }) => {
    const { status } = await readBody(req, 1000);
    return store.setOrderStatus(idParam(params.id), status);
  }));

  route('POST', '/api/admin/upload', requireAdmin(async ({ req }) => {
    const { data } = await readBody(req, 4_000_000);
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
    if (!m) throw new AppError('invalid_image');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 2_500_000) throw new AppError('payload_too_large', 413);
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const name = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    await fs.promises.writeFile(path.join(uploadsDir, name), buf);
    return { url: `/uploads/${name}` };
  }));

  // The shop page is served with the bakery's own name, tagline and a product photo baked into
  // <title> and Open Graph tags, so link previews on WhatsApp / Instagram / TikTok show the
  // baker's brand (those previewers don't run JavaScript).
  const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function serveShop(req, res) {
    const template = await fs.promises.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    const st = store.getSettings();
    const title = [...new Set([st.shop_name_ar, st.shop_name_en].filter(Boolean))].join(' · ') || 'Bakery';
    const desc = [...new Set([st.tagline_ar, st.tagline_en].filter(Boolean))].join(' — ');
    const host = String(req.headers.host || '').replace(/[^\w.:-]/g, '');
    const origin = `${isSecure(req) ? 'https' : 'http'}://${host}`;
    const photo = store.listProducts().find((p) => p.image_url)?.image_url;
    const image = photo ? (photo.startsWith('http') ? photo : origin + photo) : '';
    const meta = [
      `<title>${escHtml(title)}</title>`,
      desc && `<meta name="description" content="${escHtml(desc)}">`,
      '<meta property="og:type" content="website">',
      `<meta property="og:title" content="${escHtml(title)}">`,
      desc && `<meta property="og:description" content="${escHtml(desc)}">`,
      host && `<meta property="og:url" content="${escHtml(origin + '/')}">`,
      image && `<meta property="og:image" content="${escHtml(image)}">`,
      `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    ].filter(Boolean).join('\n  ');
    send(res, 200, template.replace('<title>Bakery</title>', meta), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  }

  // ---------- handler ----------
  async function handler(req, res) {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    try {
      if (p.startsWith('/api/')) {
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = r.re.exec(p);
          if (!m) continue;
          const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          const out = await r.handler({ req, res, url, params });
          return json(res, 200, out);
        }
        throw new AppError('not_found', 404);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      if (p.startsWith('/uploads/')) {
        const f = safeJoin(uploadsDir, p.slice('/uploads/'.length));
        return f ? serveFile(res, f, 'public, max-age=31536000, immutable') : send(res, 404, 'Not found');
      }
      if (p === '/' || p === '/index.html') return await serveShop(req, res);
      if (p === '/admin' || p === '/admin/') return serveFile(res, path.join(PUBLIC_DIR, 'admin.html'), 'no-cache');
      const f = safeJoin(PUBLIC_DIR, p);
      return f ? serveFile(res, f, 'no-cache') : send(res, 404, 'Not found');
    } catch (e) {
      if (e instanceof AppError) return json(res, e.status, { error: e.code, details: e.details });
      log.error(e);
      return json(res, 500, { error: 'server_error' });
    }
  }

  return { handler, store, getSetupCode: () => setupCode };
}

// Run directly: `npm start`
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
  const app = createApp({
    dbFile: path.join(dataDir, 'bakery.db'),
    uploadsDir: path.join(dataDir, 'uploads'),
    adminPassword: process.env.ADMIN_PASSWORD,
    trustProxy: process.env.TRUST_PROXY === '1',
  });
  const port = Number(process.env.PORT) || 3000;
  http.createServer(app.handler).listen(port, () => {
    console.log(`[breadsales] Shop:      http://localhost:${port}/`);
    console.log(`[breadsales] Dashboard: http://localhost:${port}/admin`);
  });
}
