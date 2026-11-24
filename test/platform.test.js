import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlatform } from '../src/platform.js';
import { openRegistry, normalizeDomain } from '../src/tenants.js';

let server, base, tmp, platform;
const OWNER = 'owner-secret-123';

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-platform-'));
  platform = createPlatform({ dataDir: tmp, ownerPassword: OWNER, log: { info() {}, error() {} } });
  server = http.createServer(platform.handler);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// Talk to the server as if the request came to a given domain.
function req(host, method, p, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(base + p, {
      method,
      headers: { Host: host, ...(data ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        let json; try { json = JSON.parse(buf); } catch {}
        resolve({ status: res.statusCode, body: buf, data: json, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('domains are validated and normalized', () => {
  assert.equal(normalizeDomain('https://WWW.SarahsBakery.com/shop'), 'www.sarahsbakery.com');
  assert.throws(() => normalizeDomain('not a domain'), { code: 'invalid_domain' });
  const reg = openRegistry(fs.mkdtempSync(path.join(os.tmpdir(), 'bs-reg-')));
  reg.add({ slug: 'sara', domains: ['sarahsbakery.com'] });
  assert.equal(reg.resolve('www.sarahsbakery.com:443').slug, 'sara', 'www and port are tolerated');
  assert.equal(reg.resolve('other.com'), null);
  assert.throws(() => reg.add({ slug: 'x', domains: ['sarahsbakery.com'] }), { code: 'domain_taken' });
  assert.throws(() => reg.add({ slug: 'Bad Slug' }), { code: 'invalid_slug' });
});

test('owner console is locked and only on non-bakery addresses', async () => {
  assert.equal((await req('console.local', 'GET', '/api/owner/bakeries')).status, 401);
  assert.equal((await req('console.local', 'POST', '/api/owner/login', { password: 'nope' })).status, 401);
  const home = await req('console.local', 'GET', '/');
  assert.match(home.body, /Bakeries console/);
});

test('two bakeries on one server are completely separate', async () => {
  const login = await req('console.local', 'POST', '/api/owner/login', { password: OWNER });
  const owner = login.cookie;
  const make = (slug, name, domain, name_ar) =>
    req('console.local', 'POST', '/api/owner/bakeries', { slug, name, name_ar, domains: [domain], password: `${slug}-password` }, owner);
  assert.equal((await make('sara', "Sarah's Bakery", 'sarahsbakery.com', 'مخبز سارة')).status, 200);
  assert.equal((await make('noor', 'Noor Bread', 'noorbread.com')).status, 200);

  // Each domain shows its own brand in the shared-link preview.
  assert.match((await req('sarahsbakery.com', 'GET', '/')).body, /<title>مخبز سارة · Sarah&#39;s Bakery<\/title>/);
  assert.match((await req('www.noorbread.com', 'GET', '/')).body, /<title>Noor Bread<\/title>/);

  // Sarah logs in on her domain and adds a product.
  const sara = (await req('sarahsbakery.com', 'POST', '/api/admin/login', { password: 'sara-password' })).cookie;
  assert.ok(sara);
  assert.equal((await req('sarahsbakery.com', 'POST', '/api/admin/products', { name_en: 'Country loaf', price: 30 }, sara)).status, 200);

  // Noor's shop doesn't see it; Sarah's password and session don't work on Noor's domain.
  assert.equal((await req('noorbread.com', 'GET', '/api/shop')).data.products.length, 0);
  assert.equal((await req('noorbread.com', 'POST', '/api/admin/login', { password: 'sara-password' })).status, 401);
  assert.equal((await req('noorbread.com', 'GET', '/api/admin/products', null, sara)).status, 401);

  // Owner can see both, back one up, and suspend one without touching the other.
  const list = (await req('console.local', 'GET', '/api/owner/bakeries', null, owner)).data;
  assert.deepEqual(list.map((b) => [b.slug, b.products]), [['sara', 1], ['noor', 0]]);
  const backup = await req('console.local', 'GET', '/api/owner/bakeries/sara/backup', null, owner);
  assert.equal(backup.status, 200);
  assert.ok(backup.body.startsWith('SQLite format 3'));
  await req('console.local', 'POST', '/api/owner/bakeries/noor/active', { active: false }, owner);
  assert.equal((await req('noorbread.com', 'GET', '/')).status, 503);
  assert.equal((await req('sarahsbakery.com', 'GET', '/')).status, 200);

  // Baker can download all her data.
  const exp = await req('sarahsbakery.com', 'GET', '/api/admin/export', null, sara);
  assert.equal(exp.data.products[0].name_en, 'Country loaf');

  // Owner password reset logs the baker out.
  await req('console.local', 'POST', '/api/owner/bakeries/sara/password', { password: 'brand-new-pass' }, owner);
  assert.equal((await req('sarahsbakery.com', 'GET', '/api/admin/products', null, sara)).status, 401);

  // HTTPS certificates are only issued for registered bakery domains.
  assert.equal((await req('app:3000', 'GET', '/internal/tls-check?domain=www.sarahsbakery.com')).status, 200);
  assert.equal((await req('app:3000', 'GET', '/internal/tls-check?domain=evil.example')).status, 404);

  // A bakery's dashboard is never reachable from the console address.
  assert.equal((await req('console.local', 'GET', '/admin')).status, 404);

  // Daily backups cover every bakery.
  const files = platform.backupAll(path.join(tmp, 'backups', 'test'));
  assert.equal(files.length, 2);
});
