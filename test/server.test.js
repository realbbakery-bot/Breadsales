import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { localDate, addDays } from '../src/store.js';

let server, base, tmp, app;
const quiet = { info() {}, error() {} };

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'breadsales-'));
  app = createApp({ dbFile: ':memory:', uploadsDir: path.join(tmp, 'uploads'), log: quiet });
  server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function req(method, p, body, cookie) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

test('end-to-end: setup, stock a product, customer orders, baker sees it', async () => {
  // Admin endpoints are locked before login
  assert.equal((await req('GET', '/api/admin/products')).status, 401);

  const st = await req('GET', '/api/admin/status');
  assert.equal(st.data.setupNeeded, true);
  assert.equal((await req('POST', '/api/admin/setup', { code: 'WRONG', password: 'longenough1' })).status, 403);
  const setup = await req('POST', '/api/admin/setup', { code: app.getSetupCode(), password: 'longenough1' });
  assert.equal(setup.status, 200);
  const cookie = setup.cookie;
  assert.ok(cookie.startsWith('bs_session='));

  const prod = await req('POST', '/api/admin/products', { name_en: 'Baguette', name_ar: 'باغيت', price: '6.50' }, cookie);
  assert.equal(prod.status, 200);
  assert.equal(prod.data.price, 6.5);

  const day = await req('POST', '/api/admin/bake-days', {
    date: addDays(localDate(), 3), cutoff_at: '', items: [{ product_id: prod.data.id, capacity: 2 }],
  }, cookie);
  assert.equal(day.status, 200);

  const shop = await req('GET', '/api/shop');
  assert.equal(shop.data.products.length, 1);
  assert.deepEqual(shop.data.bakeDays[0].items, [{ product_id: prod.data.id, remaining: 2 }]);
  assert.equal(shop.data.settings.admin_password_hash, undefined, 'password hash must never leak');

  const order = await req('POST', '/api/orders', {
    customer_name: 'Omar', phone: '0501112233', bake_day_id: day.data.id, items: [{ id: prod.data.id, qty: 2 }],
  });
  assert.equal(order.status, 200);
  assert.equal(order.data.order.total, 13);

  const sold = await req('POST', '/api/orders', {
    customer_name: 'Lina', phone: '0501112244', bake_day_id: day.data.id, items: [{ id: prod.data.id, qty: 1 }],
  });
  assert.equal(sold.status, 409);
  assert.equal(sold.data.error, 'out_of_stock');

  const orders = await req('GET', '/api/admin/orders?status=open', null, cookie);
  assert.equal(orders.data.length, 1);
  assert.equal(orders.data[0].customer_name, 'Omar');

  const cancelled = await req('PUT', `/api/admin/orders/${orders.data[0].id}/status`, { status: 'cancelled' }, cookie);
  assert.equal(cancelled.data.status, 'cancelled');
  assert.equal((await req('GET', '/api/shop')).data.bakeDays[0].items[0].remaining, 2);
});

test('rejects non-JSON posts (CSRF guard) and serves pages', async () => {
  const res = await fetch(base + '/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(res.status, 415);
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/admin')).status, 200);
  assert.equal((await fetch(base + '/../package.json')).status, 404);
  assert.equal((await fetch(base + '/uploads/..%2f..%2fpackage.json')).status, 404);
});

test('shared link previews show the bakery\'s own name, not a generic title', async () => {
  app.store.updateSettings({ shop_name_en: "Sarah's Bakery", shop_name_ar: 'مخبز سارة', tagline_en: 'Sourdough <every> Friday' });
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<title>مخبز سارة · Sarah&#39;s Bakery<\/title>/);
  assert.match(html, /<meta property="og:title" content="مخبز سارة · Sarah&#39;s Bakery">/);
  assert.match(html, /Sourdough &lt;every&gt; Friday/, 'tagline is escaped');
  assert.doesNotMatch(html, /<title>Bakery<\/title>/);
});

test('login rate limiting kicks in', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await req('POST', '/api/admin/login', { password: 'nope' });
  assert.equal(last.status, 429);
});
