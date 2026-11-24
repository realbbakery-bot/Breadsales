// Owner console: add bakeries, connect their domains, reset passwords, suspend, back up.
const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MESSAGES = {
  wrong_password: 'Wrong password.',
  rate_limited: 'Too many attempts — wait 15 minutes.',
  weak_password: 'Passwords need at least 8 characters.',
  invalid_slug: 'Short name: lowercase letters, numbers and dashes only (e.g. sarahs-bakery).',
  slug_taken: 'That short name is already used.',
  invalid_domain: 'That does not look like a domain (e.g. sarahsbakery.com).',
  domain_taken: 'That domain is already connected to a bakery.',
  unauthorized: 'Please log in again.',
};
const msg = (e) => MESSAGES[e?.code] || 'Something went wrong.';

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) { const e = new Error(data?.error); e.code = data?.error; e.status = res.status; throw e; }
  return data;
}

function toast(text, kind = 'success') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 40);
const randomPassword = () => {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map((x) => a[x % a.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
};

function renderLogin() {
  app.innerHTML = `<div class="panel auth-card">
    <h1 style="margin:0 0 6px">🥖 Bakeries console</h1>
    <p class="muted" style="margin-top:0">Owner access only.</p>
    <form id="login"><div id="err" class="form-error hidden"></div>
      <div class="field"><label for="pw">Owner password</label><input id="pw" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary btn-block">Log in</button></form></div>`;
  document.getElementById('login').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/owner/login', 'POST', { password: document.getElementById('pw').value }); load(); }
    catch (err) { const b = document.getElementById('err'); b.textContent = msg(err); b.classList.remove('hidden'); }
  };
  document.getElementById('pw').focus();
}

function card(b) {
  const proto = location.protocol;
  return `<article class="order-card" data-slug="${esc(b.slug)}">
    <div class="order-head">
      <div><div style="font-weight:700;font-size:1.1rem">${esc(b.shop_name || b.name || b.slug)}</div>
        <div class="small muted">${esc(b.slug)} · ${b.products} items · ${b.upcoming_bakes} upcoming bakes · ${b.open_orders} open orders</div></div>
      <span class="pill ${b.active ? 'pill-open' : 'pill-closed'}">${b.active ? 'Live' : 'Suspended'}</span>
    </div>
    <div class="row" style="margin:10px 0">
      ${b.domains.length ? b.domains.map((d) => `<span class="pill pill-completed" style="font-size:.85rem">
        <a href="${proto}//${esc(d)}/" target="_blank" rel="noopener">${esc(d)}</a>
        <button class="btn-ghost" style="border:0;background:none;cursor:pointer" data-act="rm-domain" data-domain="${esc(d)}" aria-label="Remove ${esc(d)}">✕</button></span>`).join('')
        : '<span class="small muted">No domain connected yet.</span>'}
    </div>
    <form class="row" data-form="domain"><input class="input" name="domain" placeholder="add domain, e.g. www.sarahsbakery.com" style="flex:1;min-width:200px" dir="ltr">
      <button class="btn btn-sm">Connect domain</button></form>
    <div class="order-actions">
      ${b.domains[0] ? `<a class="btn btn-sm" href="${proto}//${esc(b.domains[0])}/admin" target="_blank" rel="noopener">Open dashboard ↗</a>` : ''}
      <button class="btn btn-sm" data-act="reset-pw">Reset baker password</button>
      <a class="btn btn-sm" href="/api/owner/bakeries/${esc(b.slug)}/backup">⬇ Backup</a>
      <button class="btn btn-sm ${b.active ? 'btn-danger' : 'btn-crust'}" data-act="toggle">${b.active ? 'Suspend' : 'Reactivate'}</button>
    </div>
  </article>`;
}

async function load() {
  let list;
  try { list = await api('/api/owner/bakeries'); } catch (e) { if (e.status === 401) return renderLogin(); throw e; }
  app.innerHTML = `
    <div class="spread" style="margin-bottom:10px"><h1 style="margin:0">🥖 Bakeries</h1>
      <button class="btn btn-sm btn-ghost" data-act="logout">Log out</button></div>
    <div class="note">Each bakery is reached only through its own domain, and customers never see this console.
      To connect a domain, the baker adds a DNS record pointing it to this server (see the hosting guide),
      then you add that domain here.</div>
    <details class="panel" ${list.length ? '' : 'open'}><summary style="font-weight:700;cursor:pointer">+ Add a bakery</summary>
      <form id="add" style="margin-top:12px"><div id="err" class="form-error hidden"></div>
        <div class="field-row">
          <div class="field"><label>Bakery name (English)</label><input name="name" required dir="ltr" placeholder="Sarah's Bakery"></div>
          <div class="field"><label>Bakery name (Arabic)</label><input name="name_ar" dir="rtl" placeholder="مخبز سارة"></div>
        </div>
        <div class="field"><label>Short name (internal, letters/numbers/dashes)</label><input name="slug" required dir="ltr" placeholder="sarahs-bakery"></div>
        <div class="field"><label>Domain (optional now, can be added later)</label><input name="domain" dir="ltr" placeholder="sarahsbakery.com"></div>
        <div class="field"><label>Baker's first password (give it to her; she can change it)</label>
          <div class="row"><input name="password" required dir="ltr" style="flex:1" class="input">
          <button type="button" class="btn btn-sm" data-act="gen">Generate</button></div></div>
        <button class="btn btn-primary btn-block">Create bakery</button>
      </form></details>
    ${list.length ? list.map(card).join('') : '<p class="muted">No bakeries yet.</p>'}`;
  const f = document.getElementById('add');
  f.elements.password.value = randomPassword();
  f.elements.name.oninput = () => { if (!f.elements.slug.dataset.touched) f.elements.slug.value = slugify(f.elements.name.value); };
  f.elements.slug.oninput = () => { f.elements.slug.dataset.touched = '1'; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const v = (k) => f.elements[k].value.trim();
    try {
      await api('/api/owner/bakeries', 'POST', { name: v('name'), name_ar: v('name_ar'), slug: v('slug'), domains: v('domain') ? [v('domain')] : [], password: v('password') });
      prompt('Bakery created. Copy the baker\'s first password and send it to her privately:', v('password'));
      load();
    } catch (err) { const b = document.getElementById('err'); b.textContent = msg(err); b.classList.remove('hidden'); }
  };
}

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-form="domain"]');
  if (!f) return;
  e.preventDefault();
  const slug = f.closest('[data-slug]').dataset.slug;
  try { await api(`/api/owner/bakeries/${slug}/domains`, 'POST', { domain: f.elements.domain.value }); toast('Domain connected'); load(); }
  catch (err) { toast(msg(err), 'error'); }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const slug = el.closest('[data-slug]')?.dataset.slug;
  try {
    if (el.dataset.act === 'logout') { await api('/api/owner/logout', 'POST', {}); renderLogin(); }
    else if (el.dataset.act === 'gen') { document.getElementById('add').elements.password.value = randomPassword(); }
    else if (el.dataset.act === 'rm-domain') {
      if (!confirm(`Disconnect ${el.dataset.domain}? The shop stops answering on it.`)) return;
      await api(`/api/owner/bakeries/${slug}/domains`, 'DELETE', { domain: el.dataset.domain }); load();
    } else if (el.dataset.act === 'reset-pw') {
      const pw = randomPassword();
      if (!confirm(`Set this bakery's dashboard password to:\n\n${pw}\n\nShe will be logged out everywhere.`)) return;
      await api(`/api/owner/bakeries/${slug}/password`, 'POST', { password: pw });
      prompt('New password (copy it for the baker):', pw);
    } else if (el.dataset.act === 'toggle') {
      const suspend = el.textContent.trim() === 'Suspend';
      if (suspend && !confirm('Suspend this bakery? The shop and dashboard go offline; all data is kept.')) return;
      await api(`/api/owner/bakeries/${slug}/active`, 'POST', { active: !suspend }); load();
    }
  } catch (err) { toast(msg(err), 'error'); }
});

api('/api/owner/status').then((s) => (s.loggedIn ? load() : renderLogin())).catch(() => renderLogin());
