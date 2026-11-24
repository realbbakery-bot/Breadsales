import { i18n, t, esc, money, formatDate, formatCutoff, formatDateTime, api, errorText, toast } from '/i18n.js';
import { KINDS, computeDough, aggregate, hydration, flourTotal, starterRecipe, roundGrams } from '/bakersmath.js';

const app = document.getElementById('app');
const sheetRoot = document.getElementById('sheetRoot');
const EMOJIS = ['🍞', '🥖', '🥐', '🥯', '🥨', '🫓', '🧁', '🍰', '🎂', '🍪', '🥧', '🍩', '🍫', '🧇', '🥮', '🍯'];
const TABS = ['today', 'bakedays', 'production', 'orders', 'products', 'settings'];
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtG = (g) => roundGrams(g).toLocaleString('en-US', { maximumFractionDigits: 1 });
const gr = (g) => `${fmtG(g)} ${t('unit_g')}`;

const state = {
  tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today',
  settings: null,
  summary: null,
  sheetDayId: null, // bake day shown on the bake sheet (null = next one)
  bakeDays: [], // for the bake days tab
  allDays: [], // for pickers (recent + upcoming)
  bakeScope: 'upcoming',
  orders: [],
  orderFilter: { status: 'open', bakeDayId: '' },
  products: [],
  editing: null, // product being edited
  editingDay: null, // bake day being edited
  editingRecipe: null, // recipe being edited
  recipes: [],
  prod: { dayId: null, forDay: null, loaves: {}, extra: 1 }, // production planner
  poller: null,
};

// ---------- auth ----------
async function boot() {
  i18n.apply();
  try {
    const s = await api('/api/admin/status');
    if (s.loggedIn) return startApp();
    renderAuth(s.setupNeeded);
  } catch (e) {
    app.innerHTML = `<div class="wrap empty"><div class="big">⚠️</div><p>${esc(errorText(e))}</p></div>`;
  }
}

function renderAuth(setup) {
  app.innerHTML = `<div class="wrap">
    <div class="topbar"><div class="brand"><span class="brand-mark">🥖</span></div>
      <button class="btn btn-sm lang-btn" data-act="lang" type="button">${esc(t('lang_switch'))}</button></div>
    <div class="panel auth-card">
      <h1 style="font-family:var(--font-display);margin:0 0 4px">${esc(t(setup ? 'setup_title' : 'login_title'))}</h1>
      <p class="muted" style="margin-top:0">${esc(t(setup ? 'setup_sub' : 'login_sub'))}</p>
      <form id="authForm" novalidate>
        <div id="formError" class="form-error hidden" role="alert"></div>
        ${setup ? `<div class="field"><label for="a_code">${esc(t('setup_code'))}</label>
          <input id="a_code" name="code" dir="ltr" autocomplete="off" required></div>` : ''}
        <div class="field"><label for="a_pw">${esc(t(setup ? 'new_password' : 'password'))}</label>
          <input id="a_pw" name="password" type="password" dir="ltr" autocomplete="${setup ? 'new-password' : 'current-password'}" required></div>
        <button class="btn btn-primary btn-block" type="submit">${esc(t(setup ? 'create_password' : 'login'))}</button>
      </form>
    </div></div>`;
  app.querySelector('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (setup) await api('/api/admin/setup', { method: 'POST', body: { code: f.elements.code.value, password: f.elements.password.value } });
      else await api('/api/admin/login', { method: 'POST', body: { password: f.elements.password.value } });
      startApp();
    } catch (err) {
      const box = f.querySelector('#formError');
      box.textContent = errorText(err);
      box.classList.remove('hidden');
    }
  });
  (app.querySelector('#a_code') || app.querySelector('#a_pw')).focus();
}

// Any 401 while using the dashboard sends the baker back to the login form.
async function call(path, opts) {
  try {
    return await api(path, opts);
  } catch (e) {
    if (e.status === 401 && !path.endsWith('/password')) renderAuth(false);
    throw e;
  }
}

async function startApp() {
  state.settings = await call('/api/admin/settings');
  renderShell();
  await loadTab();
  if (!state.poller) {
    state.poller = setInterval(() => { if (!document.hidden && !state.editing && !state.editingDay && !state.editingRecipe && state.tab !== 'production') loadTab(true); }, 45_000);
  }
}

// ---------- shell ----------
function renderShell() {
  const s = state.settings;
  const newCount = state.summary?.all_new_orders || 0;
  app.innerHTML = `
    <div class="admin-top"><div class="wrap">
      <div class="topbar">
        <div class="brand"><span class="brand-mark">🥖</span>
          <span class="brand-name">${esc(i18n.pick(s, 'shop_name'))}<div class="small muted" style="font-weight:500">${esc(t('admin_title'))}</div></span></div>
        <div class="row nowrap">
          <a class="btn btn-sm btn-ghost" href="/" target="_blank" rel="noopener" aria-label="${esc(t('view_shop'))}"><span class="hide-sm">${esc(t('view_shop'))}</span> ↗</a>
          <button class="btn btn-sm lang-btn" data-act="lang" type="button">${esc(t('lang_switch'))}</button>
        </div>
      </div>
      <nav class="tabs" role="tablist">
        ${TABS.map((k) => `<button class="tab" role="tab" type="button" data-act="tab" data-tab="${k}" aria-selected="${state.tab === k}">
          ${esc(t(k === 'bakedays' ? 'tab_bake_days' : 'tab_' + k))}${k === 'orders' && newCount ? `<span class="dot">${newCount}</span>` : ''}</button>`).join('')}
      </nav>
    </div></div>
    <main class="wrap" id="view" style="padding-top:16px;padding-bottom:60px"></main>`;
}

const view = () => document.getElementById('view');

async function loadTab(silent) {
  try {
    const sumQ = state.sheetDayId ? `?bake_day_id=${state.sheetDayId}` : '';
    if (state.tab === 'today') {
      [state.summary, state.allDays] = await Promise.all([
        call(`/api/admin/summary${sumQ}`), call('/api/admin/bake-days?scope=all'),
      ]);
    } else if (state.tab === 'bakedays') {
      [state.bakeDays, state.summary] = await Promise.all([
        call(`/api/admin/bake-days?scope=${state.bakeScope}`), call(`/api/admin/summary${sumQ}`),
      ]);
    } else if (state.tab === 'orders') {
      const q = new URLSearchParams({ status: state.orderFilter.status });
      if (state.orderFilter.bakeDayId) q.set('bake_day_id', state.orderFilter.bakeDayId);
      [state.orders, state.summary, state.allDays] = await Promise.all([
        call(`/api/admin/orders?${q}`), call(`/api/admin/summary${sumQ}`), call('/api/admin/bake-days?scope=all'),
      ]);
    } else if (state.tab === 'production') {
      [state.allDays, state.products, state.recipes] = await Promise.all([
        call('/api/admin/bake-days?scope=all'), call('/api/admin/products'), call('/api/admin/recipes'),
      ]);
    } else if (state.tab === 'products') {
      [state.products, state.recipes] = await Promise.all([call('/api/admin/products'), call('/api/admin/recipes')]);
    } else if (state.tab === 'settings') {
      state.settings = await call('/api/admin/settings');
    }
    if (silent && state.tab === 'settings') return; // don't wipe a half-filled form
    if (silent && document.activeElement?.closest('#view input, #view textarea, #view select')) return;
    renderShell();
    renderView();
  } catch (e) {
    if (!silent && e.status !== 401) toast(errorText(e), 'error');
  }
}

function renderView() {
  const v = view();
  if (!v) return;
  const r = { today: renderToday, bakedays: renderBakeDays, production: renderProduction, orders: renderOrders, products: renderProducts, settings: renderSettings };
  v.innerHTML = r[state.tab]();
}

const statePill = (b) => `<span class="pill pill-${esc(b.state)}">${esc(t('state_' + b.state))}</span>`;
const dayOptions = (selectedId, withAll) =>
  (withAll ? `<option value="">${esc(t('all_bake_days'))}</option>` : '') +
  [...state.allDays].sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((d) => `<option value="${d.id}" ${String(d.id) === String(selectedId) ? 'selected' : ''}>${esc(formatDate(d.date))} · ${esc(t('state_' + d.state))}</option>`).join('');

function capacityRows(b) {
  return b.items.filter((i) => i.capacity > 0 || i.reserved > 0).map((i) => {
    const pct = i.capacity ? Math.min(100, Math.round((i.reserved / i.capacity) * 100)) : 0;
    return `<div class="cap-row">
      <div class="prod-thumb">${i.image_url ? `<img src="${esc(i.image_url)}" alt="">` : esc(i.emoji)}</div>
      <div class="prod-info"><div class="spread"><strong>${esc(i18n.pick(i, 'name'))}</strong>
        <span class="small muted">${esc(t('reserved_of', { r: i.reserved, c: i.capacity }))}</span></div>
        <div class="bar"><span style="width:${pct}%"></span></div></div>
    </div>`;
  }).join('');
}

// ---------- bake sheet ----------
function renderToday() {
  const s = state.summary;
  const st = state.settings;
  if (!s) return `<p class="muted">${esc(t('loading'))}</p>`;
  const shopUrl = location.origin + '/';
  const top = `<div class="panel spread">
      <label class="switch"><input type="checkbox" data-act="toggle-open" ${st.shop_open === '1' ? 'checked' : ''}>
        <span>${esc(t(st.shop_open === '1' ? 'shop_open_on' : 'shop_open_off'))}</span></label>
      ${state.allDays.length ? `<select class="input select-inline" data-act="sheet-day" aria-label="${esc(t('bake_day_label'))}">${dayOptions(s.bake_day?.id)}</select>` : ''}
    </div>`;
  const share = `<div class="panel"><h3>🔗 ${esc(t('share_link'))}</h3>
      <div class="share-box"><input class="input" readonly value="${esc(shopUrl)}">
        <button class="btn btn-sm" type="button" data-act="copy" data-value="${esc(shopUrl)}">${esc(t('copy'))}</button></div></div>`;
  if (!s.bake_day) {
    return top + `<div class="empty"><div class="big">🌾</div><p>${esc(t('no_bake_days_admin'))}</p>
      <button class="btn btn-primary" type="button" data-act="new-day">+ ${esc(t('new_bake_day'))}</button></div>` + share;
  }
  const b = s.bake_day;
  return top + `
    <div class="spread" style="margin-top:4px">
      <h2 class="section-title" style="margin:0">📅 ${esc(formatDate(b.date))}</h2>
      <div class="row">${statePill(b)}<button class="btn btn-sm" type="button" data-act="edit-day" data-id="${b.id}">✏️ ${esc(t('edit'))}</button></div>
    </div>
    ${b.cutoff_at ? `<p class="muted small" style="margin:4px 0 0">⏰ ${esc(t('orders_close', { when: formatCutoff(b.cutoff_at) }))}</p>` : ''}
    <div class="kpis">
      <div class="kpi accent"><div class="v">${s.new_count}</div><div class="l">${esc(t('kpi_new'))}</div></div>
      <div class="kpi"><div class="v">${s.ready_count}</div><div class="l">${esc(t('kpi_ready'))}</div></div>
      <div class="kpi"><div class="v">${s.completed_count}</div><div class="l">${esc(t('kpi_done'))}</div></div>
      <div class="kpi"><div class="v" style="font-size:1.35rem">${esc(money(s.revenue, st))}</div><div class="l">${esc(t('kpi_revenue'))}</div></div>
    </div>
    ${s.all_new_orders ? `<div class="note spread"><span>🔔 ${esc(t('pending_all', { n: s.all_new_orders }))}</span>
      <button class="btn btn-sm btn-crust" type="button" data-act="tab" data-tab="orders">${esc(t('tab_orders'))} →</button></div>` : ''}
    <div class="panel">
      <h3>🧺 ${esc(t('to_bake'))}</h3>
      ${b.items.some((i) => i.reserved > 0)
        ? b.items.filter((i) => i.reserved > 0).map((i) => `<div class="list-row"><span>${esc(i.emoji)} ${esc(i18n.pick(i, 'name'))}</span><span class="qty-big">× ${i.reserved}</span></div>`).join('')
        : `<p class="muted" style="margin:0">${esc(t('nothing_to_prepare'))}</p>`}
    </div>
    <div class="panel"><h3>📊 ${esc(t('how_many'))}</h3>${capacityRows(b) || `<p class="muted" style="margin:0">—</p>`}</div>
    ${share}`;
}

// ---------- bake days ----------
function renderBakeDays() {
  const head = `<div class="spread" style="margin-bottom:14px">
    <button class="btn btn-sm btn-ghost" type="button" data-act="bake-scope">${esc(t(state.bakeScope === 'upcoming' ? 'show_past' : 'show_upcoming'))}</button>
    <button class="btn btn-primary" type="button" data-act="new-day">+ ${esc(t('new_bake_day'))}</button></div>`;
  if (!state.bakeDays.length) return head + `<div class="empty"><div class="big">🌾</div><p>${esc(t('no_bake_days_admin'))}</p></div>`;
  return head + state.bakeDays.map((b) => `
    <article class="order-card bake-card" data-act="edit-day" data-id="${b.id}" tabindex="0">
      <div class="order-head">
        <div><div style="font-weight:700;font-size:1.1rem">📅 ${esc(formatDate(b.date))}</div>
          ${b.cutoff_at ? `<div class="small muted">⏰ ${esc(t('orders_close', { when: formatCutoff(b.cutoff_at) }))}</div>` : ''}</div>
        <div class="row">${statePill(b)}<span class="small muted">${esc(t('orders_n', { n: b.order_count }))}</span></div>
      </div>
      ${capacityRows(b)}
    </article>`).join('');
}

function renderDaySheet() {
  const d = state.editingDay;
  if (!d) { sheetRoot.innerHTML = ''; document.body.style.overflow = ''; return; }
  document.body.style.overflow = 'hidden';
  const isNew = !d.id;
  const byId = new Map(d.items.map((i) => [i.product_id, i]));
  const rows = state.products.filter((p) => p.active || byId.get(p.id)?.capacity).map((p) => {
    const it = byId.get(p.id) || { capacity: 0, reserved: 0 };
    return `<div class="cap-row">
      <div class="prod-thumb">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : esc(p.emoji)}</div>
      <div class="prod-info"><strong>${esc(i18n.pick(p, 'name'))}</strong>
        <div class="small muted">${it.reserved ? esc(t('reserved_of', { r: it.reserved, c: it.capacity })) : esc(money(p.price, state.settings))}</div></div>
      <div class="prod-stock">
        <button class="icon-btn" type="button" data-act="cap" data-id="${p.id}" data-delta="-1" aria-label="−1">−</button>
        <input type="number" inputmode="numeric" min="${it.reserved || 0}" value="${it.capacity}" data-cap="${p.id}" aria-label="${esc(i18n.pick(p, 'name'))}">
        <button class="icon-btn" type="button" data-act="cap" data-id="${p.id}" data-delta="1" aria-label="+1">+</button>
      </div></div>`;
  }).join('');
  sheetRoot.innerHTML = `<div class="sheet-backdrop" data-act="close-backdrop">
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>${esc(t(isNew ? 'new_bake_day' : 'edit_bake_day'))}</h2>
        <button class="icon-btn" type="button" data-act="close" aria-label="${esc(t('close'))}">✕</button></div>
      ${isNew && d.prefilled ? `<div class="note">✨ ${esc(t('prefilled_hint'))}</div>` : ''}
      <form id="dayForm" novalidate>
        <div id="formError" class="form-error hidden" role="alert"></div>
        <div class="field-row">
          <div class="field"><label for="d_date">${esc(t('bake_date'))}</label>
            <input id="d_date" name="date" type="date" required value="${esc(d.date)}" ${d.order_count ? 'disabled' : ''}></div>
          <div class="field"><label for="d_cut">${esc(t('cutoff'))}</label>
            <input id="d_cut" name="cutoff_at" type="datetime-local" value="${esc(d.cutoff_at || '')}">
            <span class="small muted">${esc(t('cutoff_hint'))}</span></div>
        </div>
        <h3 style="margin:8px 0 4px">${esc(t('how_many'))}</h3>
        ${rows || `<p class="muted">${esc(t('no_products_for_bake'))}</p>`}
        <div class="field-row" style="margin-top:14px">
          <div class="field"><label for="d_note_ar">${esc(t('note_ar'))}</label><input id="d_note_ar" name="note_ar" dir="rtl" maxlength="300" value="${esc(d.note_ar || '')}"></div>
          <div class="field"><label for="d_note_en">${esc(t('note_en'))}</label><input id="d_note_en" name="note_en" dir="ltr" maxlength="300" value="${esc(d.note_en || '')}"></div>
        </div>
        <div class="field"><label class="switch"><input type="checkbox" name="is_open" ${d.is_open === false ? '' : 'checked'}> <span>${esc(t('open_for_orders'))}</span></label></div>
        <div class="stack">
          <button class="btn btn-primary btn-block" type="submit">${esc(t('save'))}</button>
          ${!isNew && !d.order_count ? `<button class="btn btn-danger btn-block" type="button" data-act="delete-day">${esc(t('delete'))}</button>` : ''}
        </div>
      </form>
    </div></div>`;
}

function captureDayForm() {
  const f = document.getElementById('dayForm');
  const d = state.editingDay;
  if (!f || !d) return;
  if (!f.elements.date.disabled) d.date = f.elements.date.value;
  d.cutoff_at = f.elements.cutoff_at.value;
  d.note_ar = f.elements.note_ar.value;
  d.note_en = f.elements.note_en.value;
  d.is_open = f.elements.is_open.checked;
  const byId = new Map(d.items.map((i) => [i.product_id, i]));
  f.querySelectorAll('[data-cap]').forEach((inp) => {
    const pid = Number(inp.dataset.cap);
    const cap = Math.max(0, Math.floor(Number(inp.value) || 0));
    if (byId.has(pid)) byId.get(pid).capacity = cap;
    else d.items.push({ product_id: pid, capacity: cap, reserved: 0 });
  });
}

async function openDayEditor(id) {
  if (!state.products.length) state.products = await call('/api/admin/products');
  if (id) {
    const all = [...state.bakeDays, ...state.allDays, state.summary?.bake_day].filter(Boolean);
    let d = all.find((x) => x.id === id);
    if (!d) d = (await call('/api/admin/bake-days?scope=all')).find((x) => x.id === id);
    state.editingDay = structuredClone(d);
  } else {
    const tpl = await call('/api/admin/bake-days/template');
    state.editingDay = { ...tpl, items: tpl.items.map((i) => ({ ...i, reserved: 0 })), prefilled: state.allDays.length > 0 || state.bakeDays.length > 0 };
  }
  renderDaySheet();
}

async function saveDay(form) {
  captureDayForm();
  const d = state.editingDay;
  const body = {
    cutoff_at: d.cutoff_at, note_ar: d.note_ar, note_en: d.note_en, is_open: d.is_open,
    items: d.items.map((i) => ({ product_id: i.product_id, capacity: i.capacity })),
  };
  if (!d.order_count) body.date = d.date;
  try {
    const saved = d.id
      ? await call(`/api/admin/bake-days/${d.id}`, { method: 'PUT', body })
      : await call('/api/admin/bake-days', { method: 'POST', body });
    state.editingDay = null;
    state.sheetDayId = saved.id;
    renderDaySheet();
    toast(t('saved'), 'success');
    loadTab();
  } catch (err) {
    const box = form.querySelector('#formError');
    box.textContent = errorText(err);
    box.classList.remove('hidden');
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// ---------- orders ----------
// wa.me needs an international number; customers usually type local ones (05…).
function waCustomer(o) {
  const cc = state.settings.country_code || '';
  let d = o.phone.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (cc && d.startsWith('0')) d = cc + d.replace(/^0+/, '');
  else if (cc && !d.startsWith(cc)) d = cc + d;
  return `https://wa.me/${d}`;
}

function renderOrders() {
  const f = state.orderFilter;
  const st = state.settings;
  const statuses = ['open', 'new', 'ready', 'completed', 'cancelled', 'all'];
  const label = (k) => (k === 'open' ? t('filter_open') : k === 'all' ? t('filter_all') : t('status_' + k));
  const filters = `<div class="panel">
    <div class="tabs" style="padding:0">${statuses.map((k) => `<button type="button" class="tab" data-act="ofilter" data-status="${k}" aria-selected="${f.status === k}">${esc(label(k))}</button>`).join('')}</div>
    <div class="row" style="margin-top:10px">
      <select class="input select-inline" data-act="oday" aria-label="${esc(t('bake_day_label'))}">${dayOptions(f.bakeDayId, true)}</select>
    </div></div>`;
  if (!state.orders.length) return filters + `<div class="empty"><div class="big">📭</div><p>${esc(t('no_orders'))}</p></div>`;
  return filters + state.orders.map((o) => `
    <article class="order-card status-${esc(o.status)}">
      <div class="order-head">
        <div>
          <div style="font-weight:700;font-size:1.05rem">${esc(o.customer_name)}</div>
          <div class="small muted"><span class="order-code">${esc(o.code)}</span> · ${esc(t('placed_at'))} ${esc(formatDateTime(o.created_at))}</div>
        </div>
        <span class="pill pill-${esc(o.status)}">${esc(t('status_' + o.status))}</span>
      </div>
      <div class="small" style="margin-top:6px">📅 <strong>${esc(formatDate(o.pickup_date))}</strong> · 📞 <span dir="ltr">${esc(o.phone)}</span></div>
      <ul class="order-items">
        ${o.items.map((i) => `<li><span>${i.qty} × ${esc(i18n.pick(i, 'name'))}</span><span class="muted">${esc(money(i.unit_price * i.qty, st))}</span></li>`).join('')}
        <li style="font-weight:700;border-top:1px dashed var(--line);padding-top:6px"><span>${esc(t('total'))}</span><span>${esc(money(o.total, st))}</span></li>
      </ul>
      ${o.notes ? `<div class="order-notes">📝 ${esc(o.notes)}</div>` : ''}
      <div class="order-actions">
        ${o.status === 'new' ? `<button class="btn btn-sm btn-crust" type="button" data-act="ostatus" data-id="${o.id}" data-status="ready">✓ ${esc(t('mark_ready'))}</button>` : ''}
        ${o.status === 'new' || o.status === 'ready' ? `<button class="btn btn-sm ${o.status === 'ready' ? 'btn-crust' : ''}" type="button" data-act="ostatus" data-id="${o.id}" data-status="completed">🤝 ${esc(t('mark_completed'))}</button>` : ''}
        <a class="btn btn-sm btn-wa" href="${esc(waCustomer(o))}" target="_blank" rel="noopener">💬 ${esc(t('whatsapp_customer'))}</a>
        <a class="btn btn-sm" href="tel:${esc(o.phone)}">📞 ${esc(t('call'))}</a>
        ${o.status === 'new' || o.status === 'ready' ? `<button class="btn btn-sm btn-danger" type="button" data-act="ostatus" data-id="${o.id}" data-status="cancelled">${esc(t('cancel_order'))}</button>` : ''}
      </div>
    </article>`).join('');
}

// ---------- products (menu) ----------
function renderProducts() {
  const st = state.settings;
  const head = `<div class="spread" style="margin-bottom:14px">
    <h2 class="section-title" style="margin:0">${esc(t('tab_products'))}</h2>
    <button class="btn btn-primary" type="button" data-act="new-product">+ ${esc(t('add_product'))}</button></div>`;
  if (!state.products.length) return head + `<div class="empty"><div class="big">🥐</div><p>${esc(t('no_products_admin'))}</p></div>`;
  return head + state.products.map((p) => `
    <div class="prod-row ${p.active ? '' : 'inactive'}" data-act="edit-product" data-id="${p.id}" style="cursor:pointer">
      <div class="prod-thumb">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : esc(p.emoji || '🍞')}</div>
      <div class="prod-info">
        <div class="n">${esc(i18n.pick(p, 'name'))}</div>
        <div class="small muted">${esc(money(p.price, st))}${p.active ? '' : ` · ${esc(t('hidden'))}`}${p.max_per_order ? ` · ${esc(t('max_n', { n: p.max_per_order }))}` : ''}</div>
      </div>
      <button class="btn btn-sm ${state.recipes.some((r) => r.product_id === p.id) ? '' : 'btn-ghost'}" type="button" data-act="edit-recipe" data-id="${p.id}">🧪 ${esc(t(state.recipes.some((r) => r.product_id === p.id) ? 'recipe' : 'add_recipe'))}</button>
    </div>`).join('');
}

function renderProductSheet() {
  const p = state.editing;
  if (!p) { sheetRoot.innerHTML = ''; document.body.style.overflow = ''; return; }
  document.body.style.overflow = 'hidden';
  const isNew = !p.id;
  const emoji = p.emoji || '🍞';
  sheetRoot.innerHTML = `<div class="sheet-backdrop" data-act="close-backdrop">
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>${esc(t(isNew ? 'new_product' : 'edit_product'))}</h2>
        <button class="icon-btn" type="button" data-act="close" aria-label="${esc(t('close'))}">✕</button></div>
      <form id="productForm" novalidate>
        <div id="formError" class="form-error hidden" role="alert"></div>
        <div class="field-row">
          <div class="field"><label for="p_name_ar">${esc(t('name_ar'))}</label><input id="p_name_ar" name="name_ar" dir="rtl" lang="ar" maxlength="80" value="${esc(p.name_ar || '')}"></div>
          <div class="field"><label for="p_name_en">${esc(t('name_en'))}</label><input id="p_name_en" name="name_en" dir="ltr" lang="en" maxlength="80" value="${esc(p.name_en || '')}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="p_desc_ar">${esc(t('desc_ar'))}</label><textarea id="p_desc_ar" name="desc_ar" dir="rtl" lang="ar" maxlength="400">${esc(p.desc_ar || '')}</textarea></div>
          <div class="field"><label for="p_desc_en">${esc(t('desc_en'))}</label><textarea id="p_desc_en" name="desc_en" dir="ltr" lang="en" maxlength="400">${esc(p.desc_en || '')}</textarea></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="p_price">${esc(t('price'))} (${esc(i18n.pick(state.settings, 'currency'))})</label>
            <input id="p_price" name="price" type="number" inputmode="decimal" min="0" step="any" dir="ltr" required value="${p.price ?? ''}"></div>
          <div class="field"><label for="p_default">${esc(t('default_qty'))}</label>
            <input id="p_default" name="default_qty" type="number" inputmode="numeric" min="0" step="1" dir="ltr" value="${p.default_qty ?? 0}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="p_max">${esc(t('max_per_order'))}</label>
            <input id="p_max" name="max_per_order" type="number" inputmode="numeric" min="1" step="1" dir="ltr" value="${p.max_per_order ?? ''}"></div>
          <div class="field"><label for="p_sort">${esc(t('sort'))}</label>
            <input id="p_sort" name="sort" type="number" inputmode="numeric" step="1" dir="ltr" value="${p.sort ?? 0}"></div>
        </div>
        <div class="field"><label>${esc(t('emoji'))}</label>
          <div class="emoji-pick">${EMOJIS.map((e) => `<button type="button" data-act="emoji" data-emoji="${e}" aria-pressed="${e === emoji}">${e}</button>`).join('')}</div>
          <input type="hidden" name="emoji" value="${esc(emoji)}"></div>
        <div class="field"><label>${esc(t('photo'))}</label>
          <div class="row">
            ${p.image_url ? `<img class="photo-preview" src="${esc(p.image_url)}" alt="">` : ''}
            <label class="btn btn-sm"><input type="file" accept="image/*" data-act="photo" class="hidden">📷 ${esc(t('choose_photo'))}</label>
            ${p.image_url ? `<button class="btn btn-sm btn-ghost" type="button" data-act="photo-remove">${esc(t('remove_photo'))}</button>` : ''}
          </div>
          <input type="hidden" name="image_url" value="${esc(p.image_url || '')}"></div>
        <div class="field"><label class="switch"><input type="checkbox" name="active" ${p.active === false ? '' : 'checked'}> <span>${esc(t('visible'))}</span></label></div>
        <div class="stack">
          <button class="btn btn-primary btn-block" type="submit">${esc(t('save'))}</button>
          ${isNew ? '' : `<button class="btn btn-danger btn-block" type="button" data-act="delete-product">${esc(t('delete'))}</button>`}
        </div>
      </form>
    </div></div>`;
}

// Keep in-progress edits when the sheet re-renders (emoji/photo changes, language switch).
function captureProductForm() {
  const f = document.getElementById('productForm');
  const e = state.editing;
  if (!f || !e) return;
  for (const k of ['name_ar', 'name_en', 'desc_ar', 'desc_en', 'emoji', 'image_url', 'price', 'default_qty', 'max_per_order', 'sort']) e[k] = f.elements[k].value;
  e.active = f.elements.active.checked;
}

// Resize photos in the browser so uploads stay small and fast on mobile data.
function resizeImage(file, maxSize = 1000) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.84));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('invalid_image')); };
    img.src = url;
  });
}

async function saveProduct(form) {
  captureProductForm();
  const e = state.editing;
  const body = {
    name_ar: e.name_ar, name_en: e.name_en, desc_ar: e.desc_ar, desc_en: e.desc_en,
    price: e.price, default_qty: e.default_qty === '' ? 0 : e.default_qty, max_per_order: e.max_per_order,
    sort: e.sort === '' ? 0 : e.sort, emoji: e.emoji, image_url: e.image_url, active: e.active,
  };
  try {
    if (e.id) await call(`/api/admin/products/${e.id}`, { method: 'PUT', body });
    else await call('/api/admin/products', { method: 'POST', body });
    state.editing = null;
    renderProductSheet();
    toast(t('saved'), 'success');
    loadTab();
  } catch (err) {
    const box = form.querySelector('#formError');
    box.textContent = errorText(err);
    box.classList.remove('hidden');
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// ---------- settings ----------
function renderSettings() {
  const s = state.settings;
  const input = (k, extra = '') => `<div class="field"><label for="s_${k}">${esc(t(k))}</label>
    <input id="s_${k}" name="${k}" value="${esc(s[k])}" ${extra}></div>`;
  const area = (k, extra = '') => `<div class="field"><label for="s_${k}">${esc(t(k))}</label>
    <textarea id="s_${k}" name="${k}" ${extra}>${esc(s[k])}</textarea></div>`;
  return `
    <form id="settingsForm" novalidate>
      <div id="formError" class="form-error hidden" role="alert"></div>
      <div class="panel"><h3>🏠 ${esc(t('s_identity'))}</h3>
        <div class="field-row">${input('shop_name_ar', 'dir="rtl" maxlength="80"')}${input('shop_name_en', 'dir="ltr" maxlength="80"')}</div>
        <div class="field-row">${input('tagline_ar', 'dir="rtl" maxlength="200"')}${input('tagline_en', 'dir="ltr" maxlength="200"')}</div>
        <div class="field-row">${input('currency_ar', 'dir="rtl" maxlength="10"')}${input('currency_en', 'dir="ltr" maxlength="10"')}</div>
        <div class="field-row">
          <div class="field"><label for="s_decimals">${esc(t('decimals'))}</label>
            <select id="s_decimals" name="decimals">${[0, 1, 2, 3].map((n) => `<option ${String(n) === s.decimals ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          ${input('whatsapp', `dir="ltr" inputmode="tel" placeholder="${esc(t('whatsapp_ph'))}"`)}
        </div>
        ${input('country_code', 'dir="ltr" inputmode="numeric" maxlength="4"')}
      </div>
      <div class="panel"><h3>🧾 ${esc(t('s_ordering'))}</h3>
        <div class="field"><label class="switch"><input type="checkbox" name="shop_open" ${s.shop_open === '1' ? 'checked' : ''}> <span>${esc(t('shop_status'))}</span></label></div>
        ${area('pickup_info_ar', 'dir="rtl" maxlength="500"')}${area('pickup_info_en', 'dir="ltr" maxlength="500"')}
      </div>
      <div class="panel"><h3>⏰ ${esc(t('s_bake_defaults'))}</h3>
        <div class="field-row">${input('cutoff_days_before', 'type="number" min="0" max="14" dir="ltr"')}${input('cutoff_time', 'type="time" dir="ltr"')}</div>
      </div>
      <button class="btn btn-primary btn-block" type="submit">${esc(t('save'))}</button>
    </form>
    <div class="panel" style="margin-top:16px"><h3>🔒 ${esc(t('s_security'))}</h3>
      <form id="pwForm" novalidate>
        <div class="field-row">
          <div class="field"><label for="pw_cur">${esc(t('current_password'))}</label><input id="pw_cur" name="current" type="password" dir="ltr" autocomplete="current-password"></div>
          <div class="field"><label for="pw_new">${esc(t('new_password'))}</label><input id="pw_new" name="next" type="password" dir="ltr" autocomplete="new-password"></div>
        </div>
        <div class="row"><button class="btn btn-crust" type="submit">${esc(t('change_password'))}</button>
          <a class="btn" href="/api/admin/export">⬇ ${esc(t('export_data'))}</a>
          <button class="btn btn-ghost" type="button" data-act="logout">${esc(t('logout'))}</button></div>
      </form>
    </div>`;
}

async function saveSettings(form) {
  const el = form.elements;
  const body = {};
  for (const k of ['shop_name_ar', 'shop_name_en', 'tagline_ar', 'tagline_en', 'currency_ar', 'currency_en', 'decimals',
    'whatsapp', 'country_code', 'pickup_info_ar', 'pickup_info_en', 'cutoff_days_before', 'cutoff_time']) body[k] = el[k].value;
  body.shop_open = el.shop_open.checked;
  try {
    state.settings = await call('/api/admin/settings', { method: 'PUT', body });
    toast(t('saved'), 'success');
    renderShell();
    renderView();
  } catch (err) {
    const box = form.querySelector('#formError');
    box.textContent = errorText(err);
    box.classList.remove('hidden');
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// ---------- recipes (baker's math) ----------
const pctStr = (n) => (Math.round(n * 10) / 10).toLocaleString('en-US');

function openRecipeEditor(productId) {
  const existing = state.recipes.find((r) => r.product_id === productId);
  const base = existing ? structuredClone(existing) : { product_id: productId, ...starterRecipe() };
  state.editingRecipe = { ...base, isNew: !existing, tryN: Math.max(1, state.products.find((p) => p.id === productId)?.default_qty || 10) };
  renderRecipeSheet();
}

function renderRecipeSheet() {
  const r = state.editingRecipe;
  if (!r) { sheetRoot.innerHTML = ''; document.body.style.overflow = ''; return; }
  document.body.style.overflow = 'hidden';
  const p = state.products.find((x) => x.id === r.product_id) || {};
  const num = (name, val, extra = '') => `<div class="field"><label for="r_${name}">${esc(t(name))}</label>
    <input id="r_${name}" name="${name}" type="number" inputmode="decimal" step="any" min="0" dir="ltr" value="${esc(val)}" ${extra}></div>`;
  const ingRows = r.ingredients.map((i, idx) => `
    <div class="ing-row" data-idx="${idx}">
      <div class="ing-top">
        <select name="kind" aria-label="${esc(t('ingredients'))}">${KINDS.map((k) => `<option value="${k}" ${k === i.kind ? 'selected' : ''}>${esc(t('kind_' + k))}</option>`).join('')}</select>
        <div class="pct-box"><input name="pct" type="number" inputmode="decimal" step="any" min="0" dir="ltr" value="${esc(i.pct)}" aria-label="%"><span>%</span></div>
        <button class="icon-btn" type="button" data-act="rm-ing" data-idx="${idx}" aria-label="${esc(t('remove'))}">✕</button>
      </div>
      <div class="field-row ing-names">
        <input class="input" name="name_ar" dir="rtl" maxlength="60" placeholder="${esc(t('ing_name_ar'))}" value="${esc(i.name_ar || '')}">
        <input class="input" name="name_en" dir="ltr" maxlength="60" placeholder="${esc(t('ing_name_en'))}" value="${esc(i.name_en || '')}">
      </div>
    </div>`).join('');
  sheetRoot.innerHTML = `<div class="sheet-backdrop" data-act="close-backdrop">
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>🧪 ${esc(i18n.pick(p, 'name'))}</h2>
        <button class="icon-btn" type="button" data-act="close" aria-label="${esc(t('close'))}">✕</button></div>
      <p class="small muted" style="margin-top:0">${esc(t('math_explainer'))}</p>
      <form id="recipeForm" novalidate>
        <div id="formError" class="form-error hidden" role="alert"></div>
        <div class="field-row">${num('piece_weight_g', r.piece_weight_g, 'min="1"')}${num('waste_pct', r.waste_pct)}</div>
        ${num('levain_hydration', r.levain_hydration)}
        <h3 style="margin:8px 0">${esc(t('ingredients'))}</h3>
        ${ingRows}
        <button class="btn btn-sm" type="button" data-act="add-ing" style="margin:6px 0 14px">${esc(t('add_ingredient'))}</button>
        <div id="recipePreview"></div>
        <div class="field-row" style="margin-top:14px">
          <div class="field"><label for="r_notes_ar">${esc(t('recipe_notes_ar'))}</label><textarea id="r_notes_ar" name="notes_ar" dir="rtl" maxlength="1000">${esc(r.notes_ar || '')}</textarea></div>
          <div class="field"><label for="r_notes_en">${esc(t('recipe_notes_en'))}</label><textarea id="r_notes_en" name="notes_en" dir="ltr" maxlength="1000">${esc(r.notes_en || '')}</textarea></div>
        </div>
        <div class="stack">
          <button class="btn btn-primary btn-block" type="submit">${esc(t('save'))}</button>
          ${r.isNew ? '' : `<button class="btn btn-danger btn-block" type="button" data-act="delete-recipe">${esc(t('delete_recipe'))}</button>`}
        </div>
      </form>
    </div></div>`;
  renderRecipePreview();
}

function captureRecipeForm() {
  const f = document.getElementById('recipeForm');
  const r = state.editingRecipe;
  if (!f || !r) return;
  for (const k of ['piece_weight_g', 'waste_pct', 'levain_hydration', 'notes_ar', 'notes_en']) r[k] = f.elements[k].value;
  r.ingredients = [...f.querySelectorAll('.ing-row')].map((row) => ({
    kind: row.querySelector('[name=kind]').value,
    pct: row.querySelector('[name=pct]').value,
    name_ar: row.querySelector('[name=name_ar]').value,
    name_en: row.querySelector('[name=name_en]').value,
  }));
  const tryInput = document.getElementById('r_try');
  if (tryInput) r.tryN = Math.max(0, Math.floor(Number(tryInput.value) || 0));
}

function doughTable(d) {
  return `<table class="dough-table"><tbody>
    ${d.lines.map((l) => `<tr><td>${esc(i18n.pick(l, 'name'))}<span class="kind-tag">${esc(t('kind_' + l.kind))}</span></td>
      ${l.pct !== undefined ? `<td class="muted"><bdi>${pctStr(Number(l.pct))}%</bdi></td>` : ''}<td class="g">${gr(l.grams)}</td></tr>`).join('')}
  </tbody></table>`;
}

function renderRecipePreview() {
  const box = document.getElementById('recipePreview');
  const r = state.editingRecipe;
  if (!box || !r) return;
  const ft = flourTotal(r.ingredients.map((i) => ({ ...i, pct: Number(i.pct) || 0 })));
  const ok = Math.abs(ft - 100) <= 0.01;
  const h = hydration({ ...r, ingredients: r.ingredients.map((i) => ({ ...i, pct: Number(i.pct) || 0 })) });
  const d = computeDough({ ...r, ingredients: r.ingredients.map((i) => ({ ...i, pct: Number(i.pct) || 0 })) }, r.tryN);
  box.innerHTML = `<div class="panel" style="background:var(--bg)">
    <div class="${ok ? 'ok-line' : 'form-error'}" style="margin-bottom:8px">${esc(ok ? t('flour_total_ok') : t('flour_total_bad', { n: pctStr(ft) }))}</div>
    <p class="small" style="margin:0 0 10px">💧 ${esc(t('hydration_line', { f: pctStr(h.formula), o: pctStr(h.overall), p: pctStr(h.prefermented) }))}</p>
    <div class="row" style="margin-bottom:6px"><label for="r_try"><strong>${esc(t('try_batch'))}</strong></label>
      <input id="r_try" class="input" type="number" inputmode="numeric" min="0" step="1" dir="ltr" value="${r.tryN}" style="width:90px;min-height:38px;padding:6px 10px"></div>
    ${ok ? `${doughTable(d)}<div class="total-row small"><span>${esc(t('total_dough'))}</span><span>${gr(d.totalDough)}</span></div>` : ''}
  </div>`;
}

async function saveRecipe(form) {
  captureRecipeForm();
  const r = state.editingRecipe;
  try {
    await call(`/api/admin/recipes/${r.product_id}`, {
      method: 'PUT',
      body: {
        piece_weight_g: r.piece_weight_g, waste_pct: r.waste_pct, levain_hydration: r.levain_hydration,
        notes_ar: r.notes_ar, notes_en: r.notes_en, ingredients: r.ingredients,
      },
    });
    closeSheets();
    toast(t('saved'), 'success');
    loadTab();
  } catch (err) {
    const box = form.querySelector('#formError');
    box.textContent = errorText(err);
    box.classList.remove('hidden');
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// ---------- production planner ----------
function prodDay() {
  const days = state.allDays;
  if (!days.length) return null;
  const chosen = days.find((d) => d.id === state.prod.dayId);
  if (chosen) return chosen;
  const upcoming = days.filter((d) => d.date >= todayISO()).sort((a, b) => (a.date < b.date ? -1 : 1));
  return upcoming[0] || [...days].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
}

function prodProducts(day) {
  const inDay = new Set(day.items.map((i) => i.product_id));
  return state.products.filter((p) => p.active || inDay.has(p.id));
}

function renderProduction() {
  const day = prodDay();
  if (!day) {
    return `<div class="empty"><div class="big">🌾</div><p>${esc(t('no_production'))}</p>
      <button class="btn btn-primary" type="button" data-act="new-day">+ ${esc(t('new_bake_day'))}</button></div>`;
  }
  const items = new Map(day.items.map((i) => [i.product_id, i]));
  if (state.prod.forDay !== day.id) {
    state.prod.forDay = day.id;
    state.prod.dayId = day.id;
    state.prod.loaves = Object.fromEntries(day.items.map((i) => [i.product_id, i.capacity]));
  }
  const recipes = new Map(state.recipes.map((r) => [r.product_id, r]));
  const batches = [];
  const cards = prodProducts(day).map((p) => {
    const n = state.prod.loaves[p.id] || 0;
    const reserved = items.get(p.id)?.reserved || 0;
    const r = recipes.get(p.id);
    let body = '';
    if (!r) {
      body = `<div class="spread" style="margin-top:8px"><span class="muted small">${esc(t('no_recipe'))}</span>
        <button class="btn btn-sm no-print" type="button" data-act="edit-recipe" data-id="${p.id}">🧪 ${esc(t('add_recipe'))}</button></div>`;
    } else if (n > 0) {
      const d = computeDough(r, n);
      batches.push(d);
      body = `<div class="spread small" style="margin:8px 0 2px"><strong>${esc(t('total_dough'))}: ${gr(d.totalDough)}</strong>
        <span class="muted">${esc(t('dough_for', { n, w: fmtG(Number(r.piece_weight_g)) }))}${Number(r.waste_pct) ? ` <bdi>+${pctStr(Number(r.waste_pct))}%</bdi>` : ''}</span></div>
        ${doughTable(d)}`;
    }
    return `<div class="panel prod-card">
      <div class="spread">
        <div class="row" style="flex-wrap:nowrap;min-width:0">
          <div class="prod-thumb">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : esc(p.emoji || '🍞')}</div>
          <div style="min-width:0"><strong>${esc(i18n.pick(p, 'name'))}</strong>
            <div class="small muted">${esc(t('reserved_n', { n: reserved }))}</div></div>
        </div>
        <div class="prod-stock">
          <button class="icon-btn no-print" type="button" data-act="prod-step" data-id="${p.id}" data-delta="-1" aria-label="−1">−</button>
          <input id="loaves-${p.id}" type="number" inputmode="numeric" min="${reserved}" step="1" value="${n}" data-loaves="${p.id}" aria-label="${esc(t('loaves'))}">
          <button class="icon-btn no-print" type="button" data-act="prod-step" data-id="${p.id}" data-delta="1" aria-label="+1">+</button>
        </div>
      </div>${body}</div>`;
  }).join('');

  const agg = aggregate(batches);
  const weighing = batches.length ? `<div class="panel weigh-panel">
      <h3>⚖️ ${esc(t('weighing_list'))}</h3>
      <table class="dough-table"><tbody>
        ${agg.lines.map((l) => `<tr><td>${esc(i18n.pick(l, 'name'))}<span class="kind-tag">${esc(t('kind_' + l.kind))}</span></td><td class="g">${gr(l.grams)}</td></tr>`).join('')}
      </tbody></table>
      <div class="total-row"><span>${esc(t('total_dough'))}</span><span>${gr(agg.totalDough)}</span></div>
      ${agg.levain.total > 0 ? `<div class="note" style="margin-bottom:0">🫙 <strong>${esc(t('levain_to_build'))}: ${gr(agg.levain.total)}</strong>
        <div class="small">${esc(t('levain_split', { flour: fmtG(agg.levain.flour), water: fmtG(agg.levain.water) }))}</div></div>` : ''}
    </div>` : '';

  return `
    <div class="panel no-print">
      <div class="spread">
        <select class="input select-inline" data-act="prod-day" aria-label="${esc(t('bake_day_label'))}">${dayOptions(day.id)}</select>
        <button class="btn btn-sm" type="button" data-act="print">🖨️ ${esc(t('print'))}</button>
      </div>
      <p class="small muted" style="margin:10px 0">${esc(t('prod_intro'))}</p>
      ${day.state === 'cutoff' || day.state === 'past' ? `<div class="note">⏰ ${esc(t('mix_after_cutoff'))}</div>` : ''}
      <div class="row">
        <button class="btn btn-sm" type="button" data-act="prod-planned">${esc(t('use_planned'))}</button>
        <button class="btn btn-sm" type="button" data-act="prod-orders">${esc(t('use_orders'))}</button>
        <label class="row small" style="gap:6px">${esc(t('extra'))}
          <input id="prod-extra" class="input" type="number" min="0" step="1" dir="ltr" value="${state.prod.extra}" style="width:70px;min-height:36px;padding:4px 8px"></label>
      </div>
    </div>
    <h2 class="section-title" style="margin:6px 0 12px">📅 ${esc(formatDate(day.date))} ${statePill(day)}</h2>
    ${cards}
    ${weighing}
    <button class="btn btn-primary btn-block no-print" type="button" data-act="prod-apply" style="margin-top:6px">✅ ${esc(t('apply_capacity'))}</button>`;
}

function rerenderProduction(focusId) {
  renderView();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); try { const v = el.value; el.value = ''; el.value = v; } catch {} }
  }
}

async function applyProduction() {
  const day = prodDay();
  const inDay = new Set(day.items.map((i) => i.product_id));
  const items = prodProducts(day)
    .filter((p) => inDay.has(p.id) || (state.prod.loaves[p.id] || 0) > 0)
    .map((p) => ({ product_id: p.id, capacity: state.prod.loaves[p.id] || 0 }));
  await call(`/api/admin/bake-days/${day.id}`, { method: 'PUT', body: { items } });
  toast(t('applied'), 'success');
  state.allDays = await call('/api/admin/bake-days?scope=all');
  renderView();
}

// ---------- events ----------
function closeSheets() {
  state.editing = null;
  state.editingDay = null;
  state.editingRecipe = null;
  sheetRoot.innerHTML = '';
  document.body.style.overflow = '';
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'close-backdrop' && e.target !== el) return;
  try {
    if (act === 'lang') {
      captureProductForm();
      captureDayForm();
      captureRecipeForm();
      i18n.toggle();
    } else if (act === 'tab') {
      state.tab = el.dataset.tab;
      history.replaceState(null, '', '#' + state.tab);
      renderShell();
      view().innerHTML = `<p class="muted">${esc(t('loading'))}</p>`;
      await loadTab();
    } else if (act === 'ofilter') {
      state.orderFilter.status = el.dataset.status;
      await loadTab();
    } else if (act === 'ostatus') {
      const status = el.dataset.status;
      if (status === 'cancelled' && !confirm(t('confirm_cancel'))) return;
      el.disabled = true;
      await call(`/api/admin/orders/${el.dataset.id}/status`, { method: 'PUT', body: { status } });
      await loadTab();
    } else if (act === 'bake-scope') {
      state.bakeScope = state.bakeScope === 'upcoming' ? 'all' : 'upcoming';
      await loadTab();
    } else if (act === 'new-day') {
      await openDayEditor(null);
    } else if (act === 'edit-day') {
      await openDayEditor(Number(el.dataset.id));
    } else if (act === 'cap') {
      const inp = document.querySelector(`[data-cap="${el.dataset.id}"]`);
      inp.value = Math.max(Number(inp.min) || 0, (Number(inp.value) || 0) + Number(el.dataset.delta));
    } else if (act === 'delete-day') {
      if (!confirm(t('confirm_delete_day'))) return;
      await call(`/api/admin/bake-days/${state.editingDay.id}`, { method: 'DELETE' });
      state.sheetDayId = null;
      closeSheets();
      await loadTab();
    } else if (act === 'edit-recipe') {
      if (!state.products.length) state.products = await call('/api/admin/products');
      if (!state.recipes.length) state.recipes = await call('/api/admin/recipes');
      openRecipeEditor(Number(el.dataset.id));
    } else if (act === 'add-ing') {
      captureRecipeForm();
      state.editingRecipe.ingredients.push({ kind: 'other', name_en: '', name_ar: '', pct: 0 });
      renderRecipeSheet();
    } else if (act === 'rm-ing') {
      captureRecipeForm();
      state.editingRecipe.ingredients.splice(Number(el.dataset.idx), 1);
      renderRecipeSheet();
    } else if (act === 'delete-recipe') {
      if (!confirm(t('confirm_delete_recipe'))) return;
      await call(`/api/admin/recipes/${state.editingRecipe.product_id}`, { method: 'DELETE' });
      closeSheets();
      await loadTab();
    } else if (act === 'prod-step') {
      const id = Number(el.dataset.id);
      const min = Number(document.getElementById(`loaves-${id}`)?.min) || 0;
      state.prod.loaves[id] = Math.max(min, (state.prod.loaves[id] || 0) + Number(el.dataset.delta));
      rerenderProduction();
    } else if (act === 'prod-planned') {
      const day = prodDay();
      state.prod.loaves = Object.fromEntries(day.items.map((i) => [i.product_id, i.capacity]));
      rerenderProduction();
    } else if (act === 'prod-orders') {
      const day = prodDay();
      const extra = state.prod.extra;
      state.prod.loaves = Object.fromEntries(day.items.map((i) => [i.product_id, i.reserved > 0 ? i.reserved + extra : 0]));
      rerenderProduction();
    } else if (act === 'prod-apply') {
      el.disabled = true;
      await applyProduction();
    } else if (act === 'print') {
      window.print();
    } else if (act === 'new-product') {
      state.editing = { active: true, emoji: '🍞', default_qty: 0, sort: 0 };
      renderProductSheet();
    } else if (act === 'edit-product') {
      state.editing = { ...state.products.find((p) => p.id === Number(el.dataset.id)) };
      renderProductSheet();
    } else if (act === 'emoji') {
      captureProductForm();
      state.editing.emoji = el.dataset.emoji;
      renderProductSheet();
    } else if (act === 'photo-remove') {
      captureProductForm();
      state.editing.image_url = '';
      renderProductSheet();
    } else if (act === 'delete-product') {
      if (!confirm(t('confirm_delete'))) return;
      await call(`/api/admin/products/${state.editing.id}`, { method: 'DELETE' });
      closeSheets();
      await loadTab();
    } else if (act === 'close' || act === 'close-backdrop') {
      closeSheets();
    } else if (act === 'copy') {
      try { await navigator.clipboard.writeText(el.dataset.value); toast(t('copied'), 'success'); } catch {}
    } else if (act === 'logout') {
      await api('/api/admin/logout', { method: 'POST', body: {} });
      renderAuth(false);
    }
  } catch (err) {
    if (err.status !== 401) toast(errorText(err), 'error');
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  const act = el.dataset?.act;
  try {
    if (act === 'toggle-open') {
      state.settings = await call('/api/admin/settings', { method: 'PUT', body: { shop_open: el.checked } });
      renderView();
    } else if (act === 'sheet-day') {
      state.sheetDayId = Number(el.value) || null;
      await loadTab();
    } else if (act === 'prod-day') {
      state.prod.dayId = Number(el.value) || null;
      state.prod.forDay = null;
      renderView();
    } else if (act === 'oday') {
      state.orderFilter.bakeDayId = el.value;
      await loadTab();
    } else if (act === 'photo' && el.files?.[0]) {
      captureProductForm();
      toast(t('uploading'));
      const data = await resizeImage(el.files[0]);
      const { url } = await call('/api/admin/upload', { method: 'POST', body: { data } });
      state.editing.image_url = url;
      renderProductSheet();
    }
  } catch (err) {
    if (err.status !== 401) toast(errorText(err.code ? err : { code: 'invalid_image' }), 'error');
  }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'productForm') return saveProduct(f);
  if (f.id === 'dayForm') return saveDay(f);
  if (f.id === 'recipeForm') return saveRecipe(f);
  if (f.id === 'settingsForm') return saveSettings(f);
  if (f.id === 'pwForm') {
    try {
      await call('/api/admin/password', { method: 'POST', body: { current: f.elements.current.value, next: f.elements.next.value } });
      f.reset();
      toast(t('saved'), 'success');
    } catch (err) { toast(errorText(err), 'error'); }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (state.editing || state.editingDay || state.editingRecipe)) closeSheets();
  if (e.key === 'Enter' && e.target.classList?.contains('bake-card')) e.target.click();
});

i18n.onChange(() => {
  if (!state.settings) { boot(); return; }
  renderShell();
  renderView();
  if (state.editing) renderProductSheet();
  if (state.editingDay) renderDaySheet();
  if (state.editingRecipe) renderRecipeSheet();
});

// Live updates: recipe preview and loaf counts.
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.closest?.('#recipeForm')) {
    captureRecipeForm();
    renderRecipePreview();
    if (el.id === 'r_try') { const f = document.getElementById('r_try'); f.focus(); const v = f.value; f.value = ''; f.value = v; }
    return;
  }
  if (el.dataset?.loaves) {
    state.prod.loaves[Number(el.dataset.loaves)] = Math.max(0, Math.floor(Number(el.value) || 0));
    rerenderProduction(el.id);
  } else if (el.id === 'prod-extra') {
    state.prod.extra = Math.max(0, Math.floor(Number(el.value) || 0));
  }
});

boot();
