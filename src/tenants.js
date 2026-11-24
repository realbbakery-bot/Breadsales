// Registry of hosted bakeries: which domain belongs to which bakery.
// Stored as DATA_DIR/bakeries.json; each bakery's data lives in DATA_DIR/bakeries/<slug>/.
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './store.js';

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DOMAIN_RE = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

export function normalizeDomain(d) {
  const v = String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!DOMAIN_RE.test(v)) throw new AppError('invalid_domain');
  return v;
}

// Host header → bare host (no port, lowercase).
export const bareHost = (host) => String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

export function openRegistry(dataDir) {
  const file = path.join(dataDir, 'bakeries.json');
  let cache = null;
  let mtime = 0;
  let checkedAt = 0;

  function load() {
    // Re-read at most every 2 s, and only if the file changed.
    const now = Date.now();
    if (cache && now - checkedAt < 2000) return cache;
    checkedAt = now;
    let st = null;
    try { st = fs.statSync(file); } catch {}
    if (!st) { cache = { bakeries: [] }; mtime = 0; return cache; }
    if (!cache || st.mtimeMs !== mtime) {
      cache = JSON.parse(fs.readFileSync(file, 'utf8'));
      mtime = st.mtimeMs;
    }
    return cache;
  }

  function save(data) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file); // atomic replace
    cache = data;
    mtime = fs.statSync(file).mtimeMs;
    checkedAt = Date.now();
  }

  const list = () => load().bakeries.map((b) => ({ ...b, domains: [...b.domains] }));
  const get = (slug) => list().find((b) => b.slug === slug) || null;

  function ownerOf(domain) {
    return list().find((b) => b.domains.includes(domain)) || null;
  }

  // Matches the exact host, or the same host with/without "www.".
  function resolve(host) {
    const h = bareHost(host);
    if (!h) return null;
    const alt = h.startsWith('www.') ? h.slice(4) : `www.${h}`;
    return ownerOf(h) || ownerOf(alt);
  }

  function add({ slug, domains = [], name = '' }) {
    if (!SLUG_RE.test(slug || '')) throw new AppError('invalid_slug');
    const data = structuredClone(load());
    if (data.bakeries.some((b) => b.slug === slug)) throw new AppError('slug_taken', 409);
    const ds = [...new Set(domains.map(normalizeDomain))];
    for (const d of ds) if (ownerOf(d)) throw new AppError('domain_taken', 409, { domain: d });
    const b = { slug, name: String(name).slice(0, 80), domains: ds, active: true, created_at: new Date().toISOString() };
    data.bakeries.push(b);
    save(data);
    return b;
  }

  function update(slug, fn) {
    const data = structuredClone(load());
    const b = data.bakeries.find((x) => x.slug === slug);
    if (!b) throw new AppError('bakery_not_found', 404);
    fn(b);
    save(data);
    return { ...b };
  }

  function addDomain(slug, domain) {
    const d = normalizeDomain(domain);
    const owner = ownerOf(d);
    if (owner && owner.slug !== slug) throw new AppError('domain_taken', 409, { domain: d });
    return update(slug, (b) => { if (!b.domains.includes(d)) b.domains.push(d); });
  }

  function removeDomain(slug, domain) {
    const d = normalizeDomain(domain);
    return update(slug, (b) => { b.domains = b.domains.filter((x) => x !== d); });
  }

  // Suspending keeps all data but takes the shop and dashboard offline (e.g. unpaid subscription).
  const setActive = (slug, active) => update(slug, (b) => { b.active = !!active; });

  const dirFor = (slug) => path.join(dataDir, 'bakeries', slug);

  return { file, list, get, resolve, add, addDomain, removeDomain, setActive, dirFor };
}
