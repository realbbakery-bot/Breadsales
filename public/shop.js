import { i18n, t, esc, money, formatDate, api, errorText, toast } from '/i18n.js';

const $ = (id) => document.getElementById(id);
const state = {
  settings: null,
  products: [],
  pickup: null,
  cart: loadCart(), // Map productId -> qty
  sheet: null, // 'cart' | 'success' | 'track'
  lastOrder: null,
  placing: false,
  form: { customer_name: '', phone: '', pickup_date: '', notes: '' },
};

function loadCart() {
  try { return new Map(JSON.parse(localStorage.getItem('bs_cart') || '[]')); } catch { return new Map(); }
}
function saveCart() {
  try { localStorage.setItem('bs_cart', JSON.stringify([...state.cart])); } catch {}
}
try { Object.assign(state.form, JSON.parse(localStorage.getItem('bs_customer') || '{}'), { pickup_date: '', notes: '' }); } catch {}

const productById = (id) => state.products.find((p) => p.id === id);
const maxFor = (p) => (p.max_per_order ? Math.min(p.stock, p.max_per_order) : p.stock);

function cartLines() {
  const lines = [];
  for (const [id, qty] of state.cart) {
    const p = productById(id);
    if (p && qty > 0) lines.push({ p, qty });
  }
  return lines;
}
const cartTotal = () => cartLines().reduce((s, l) => s + l.p.price * l.qty, 0);
const cartCount = () => cartLines().reduce((s, l) => s + l.qty, 0);

// Drop or clamp items that are no longer available.
function reconcileCart() {
  for (const [id, qty] of state.cart) {
    const p = productById(id);
    if (!p || p.stock <= 0) state.cart.delete(id);
    else if (qty > maxFor(p)) state.cart.set(id, maxFor(p));
  }
  saveCart();
}

function setQty(id, qty) {
  const p = productById(id);
  if (!p) return;
  const q = Math.max(0, Math.min(qty, maxFor(p)));
  if (q === 0) state.cart.delete(id); else state.cart.set(id, q);
  saveCart();
  render();
}

// ---------- rendering ----------
function media(p, cls = '') {
  return p.image_url
    ? `<img src="${esc(p.image_url)}" alt="" loading="lazy" class="${cls}">`
    : `<span aria-hidden="true">${esc(p.emoji || '🍞')}</span>`;
}

function stepper(p, qty) {
  const max = maxFor(p);
  return `<div class="stepper" role="group" aria-label="${esc(i18n.pick(p, 'name'))}">
    <button type="button" data-act="dec" data-id="${p.id}" aria-label="−">−</button>
    <span aria-live="polite">${qty}</span>
    <button type="button" data-act="inc" data-id="${p.id}" aria-label="+" ${qty >= max ? 'disabled' : ''}>+</button>
  </div>`;
}

function renderGrid() {
  const grid = $('grid');
  if (!state.products.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">🧺</div><p>${esc(t('no_products'))}</p></div>`;
    return;
  }
  const open = state.settings.shop_open === '1';
  grid.innerHTML = state.products.map((p) => {
    const qty = state.cart.get(p.id) || 0;
    const out = p.stock <= 0;
    let badge = '';
    if (out) badge = `<span class="badge badge-out">${esc(t('sold_out'))}</span>`;
    else if (p.stock <= 5) badge = `<span class="badge badge-low">${esc(t('only_n_left', { n: p.stock }))}</span>`;
    else badge = `<span class="badge">${esc(t('left_n', { n: p.stock }))}</span>`;
    const action = out || !open
      ? ''
      : qty > 0
        ? stepper(p, qty)
        : `<button class="btn btn-crust btn-sm" type="button" data-act="inc" data-id="${p.id}">+ ${esc(t('add_to_order'))}</button>`;
    const desc = i18n.pick(p, 'desc');
    return `<article class="card ${out ? 'is-out' : ''}">
      <div class="product-media">${media(p)}${badge}</div>
      <div class="product-body">
        <h3 class="product-name">${esc(i18n.pick(p, 'name'))}</h3>
        ${desc ? `<p class="product-desc">${esc(desc)}</p>` : '<div style="flex:1"></div>'}
        ${p.max_per_order ? `<p class="small muted" style="margin:0">${esc(t('max_n', { n: p.max_per_order }))}</p>` : ''}
        <div class="product-foot"><span class="price">${esc(money(p.price, state.settings))}</span>${action}</div>
      </div>
    </article>`;
  }).join('');
}

function renderHeader() {
  const s = state.settings;
  const name = i18n.pick(s, 'shop_name');
  document.title = name;
  $('brandName').textContent = name;
  $('shopName').textContent = name;
  $('tagline').textContent = i18n.pick(s, 'tagline');
  $('closedBanner').classList.toggle('hidden', s.shop_open === '1');
}

function renderCartBar() {
  const n = cartCount();
  const show = n > 0 && state.settings.shop_open === '1' && !state.sheet;
  $('cartBar').classList.toggle('hidden', !show);
  $('cartCount').textContent = n;
  $('cartTotal').textContent = money(cartTotal(), state.settings);
}

function sheetShell(title, body) {
  return `<div class="sheet-backdrop" data-act="close-backdrop">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>${esc(title)}</h2>
        <button class="icon-btn" type="button" data-act="close" aria-label="${esc(t('close'))}">✕</button></div>
      ${body}
    </div></div>`;
}

function renderCartSheet() {
  const lines = cartLines();
  const f = state.form;
  const s = state.settings;
  const items = lines.length
    ? lines.map(({ p, qty }) => `<div class="line-item">
        <div class="li-emoji">${media(p)}</div>
        <div class="li-name">${esc(i18n.pick(p, 'name'))}<div class="small muted">${esc(money(p.price, s))}</div></div>
        ${stepper(p, qty)}
      </div>`).join('')
    : `<div class="empty"><div class="big">🧺</div><p>${esc(t('empty_cart'))}</p></div>`;
  const pickupInfo = i18n.pick(s, 'pickup_info');
  const body = `${items}
    ${lines.length ? `
    <div class="total-row"><span>${esc(t('total'))}</span><span>${esc(money(cartTotal(), s))}</span></div>
    <form id="checkoutForm" novalidate>
      <h3 style="margin:18px 0 10px">${esc(t('customer_details'))}</h3>
      <div id="formError" class="form-error hidden" role="alert"></div>
      <div class="field"><label for="f_name">${esc(t('name'))}</label>
        <input id="f_name" name="customer_name" autocomplete="name" required maxlength="80" placeholder="${esc(t('name_ph'))}" value="${esc(f.customer_name)}"></div>
      <div class="field-row">
        <div class="field"><label for="f_phone">${esc(t('phone'))}</label>
          <input id="f_phone" name="phone" type="tel" dir="ltr" inputmode="tel" autocomplete="tel" required maxlength="20" placeholder="${esc(t('phone_ph'))}" value="${esc(f.phone)}"></div>
        <div class="field"><label for="f_date">${esc(t('pickup_date'))}</label>
          <input id="f_date" name="pickup_date" type="date" required min="${state.pickup.min}" max="${state.pickup.max}" value="${esc(f.pickup_date || state.pickup.min)}"></div>
      </div>
      <div class="field"><label for="f_notes">${esc(t('notes'))}</label>
        <textarea id="f_notes" name="notes" maxlength="500" placeholder="${esc(t('notes_ph'))}">${esc(f.notes)}</textarea></div>
      ${pickupInfo ? `<div class="note">📍 ${esc(pickupInfo)}</div>` : ''}
      <p class="small muted">💳 ${esc(t('pay_note'))}</p>
      <button class="btn btn-primary btn-block" type="submit" ${state.placing ? 'disabled' : ''}>
        ${esc(state.placing ? t('placing') : t('place_order'))} · ${esc(money(cartTotal(), s))}</button>
    </form>` : ''}`;
  return sheetShell(t('your_order'), body);
}

function whatsappLink(order) {
  const s = state.settings;
  if (!s.whatsapp) return '';
  const lines = order.items.map((i) => `• ${i.qty} × ${i18n.pick(i, 'name')}`).join('\n');
  const text = t('wa_message', {
    code: order.code, date: formatDate(order.pickup_date), lines,
    total: money(order.total, s), name: order.customer_name,
  });
  return `https://wa.me/${s.whatsapp}?text=${encodeURIComponent(text)}`;
}

function renderSuccessSheet() {
  const o = state.lastOrder;
  const wa = whatsappLink(o);
  const pickupInfo = i18n.pick(state.settings, 'pickup_info');
  const body = `<div class="success">
    <div class="big">🎉</div>
    <p>${esc(t('success_body', { name: o.customer_name }))}</p>
    <div class="code-box">${esc(o.code)}</div>
    <p><strong>${esc(t('success_pickup', { date: formatDate(o.pickup_date) }))}</strong></p>
    <div style="text-align:start">
      ${o.items.map((i) => `<div class="line-item"><div class="li-name">${esc(i18n.pick(i, 'name'))}</div><span>× ${i.qty}</span></div>`).join('')}
      <div class="total-row"><span>${esc(t('total'))}</span><span>${esc(money(o.total, state.settings))}</span></div>
    </div>
    ${pickupInfo ? `<div class="note" style="text-align:start">📍 ${esc(pickupInfo)}</div>` : ''}
    <div class="stack">
      ${wa ? `<a class="btn btn-wa btn-block" href="${esc(wa)}" target="_blank" rel="noopener">💬 ${esc(t('send_whatsapp'))}</a>` : ''}
      <button class="btn btn-block" type="button" data-act="close">${esc(t('new_order'))}</button>
    </div></div>`;
  return sheetShell(t('success_title'), body);
}

function renderTrackSheet(result) {
  const body = `<form id="trackForm" novalidate>
      <div id="formError" class="form-error hidden" role="alert"></div>
      <div class="field-row">
        <div class="field"><label for="t_code">${esc(t('order_code'))}</label>
          <input id="t_code" name="code" dir="ltr" autocapitalize="characters" maxlength="12" required></div>
        <div class="field"><label for="t_phone">${esc(t('phone'))}</label>
          <input id="t_phone" name="phone" type="tel" dir="ltr" inputmode="tel" maxlength="20" required value="${esc(state.form.phone)}"></div>
      </div>
      <button class="btn btn-crust btn-block" type="submit">${esc(t('find_order'))}</button>
    </form>
    ${result ? `<div class="panel" style="margin-top:16px">
      <div class="spread"><span class="order-code">${esc(result.code)}</span>
        <span class="pill pill-${esc(result.status)}">${esc(t('status_' + result.status))}</span></div>
      <p class="small muted" style="margin:6px 0">${esc(t('success_pickup', { date: formatDate(result.pickup_date) }))}</p>
      ${result.items.map((i) => `<div class="list-row"><span>${esc(i18n.pick(i, 'name'))}</span><span>× ${i.qty}</span></div>`).join('')}
      <div class="total-row"><span>${esc(t('total'))}</span><span>${esc(money(result.total, state.settings))}</span></div>
    </div>` : ''}`;
  return sheetShell(t('track_title'), body);
}

function renderSheet(trackResult) {
  const root = $('sheetRoot');
  if (!state.sheet) { root.innerHTML = ''; document.body.style.overflow = ''; return; }
  document.body.style.overflow = 'hidden';
  if (state.sheet === 'cart') root.innerHTML = renderCartSheet();
  else if (state.sheet === 'success') root.innerHTML = renderSuccessSheet();
  else if (state.sheet === 'track') root.innerHTML = renderTrackSheet(trackResult);
}

function render() {
  if (!state.settings) return;
  renderHeader();
  renderGrid();
  renderCartBar();
  if (state.sheet === 'cart') {
    // Preserve typed values & focus while re-rendering the cart sheet.
    captureForm();
    const active = document.activeElement?.id;
    renderSheet();
    if (active) document.getElementById(active)?.focus();
  }
}

function captureForm() {
  const form = $('checkoutForm');
  if (!form) return;
  for (const k of Object.keys(state.form)) if (form.elements[k]) state.form[k] = form.elements[k].value;
}

function openSheet(name, arg) { state.sheet = name; renderCartBar(); renderSheet(arg); }
function closeSheet() {
  captureForm();
  if (state.sheet === 'success') state.form.notes = '';
  state.sheet = null;
  renderSheet();
  renderCartBar();
}

// ---------- data ----------
async function loadShop() {
  const data = await api('/api/shop');
  state.settings = data.settings;
  state.products = data.products;
  state.pickup = data.pickup;
  reconcileCart();
}

async function refresh() {
  try { await loadShop(); render(); } catch {}
}

async function placeOrder(form) {
  captureForm();
  const errBox = $('formError');
  const f = state.form;
  const showErr = (msg) => { errBox.textContent = msg; errBox.classList.remove('hidden'); errBox.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  if (f.customer_name.trim().length < 2) return showErr(t('err_invalid_name'));
  if (!/^\+?[\d\s\-()٠-٩]{6,20}$/.test(f.phone.trim())) return showErr(t('err_invalid_phone'));
  if (!f.pickup_date) return showErr(t('err_invalid_pickup_date'));

  state.placing = true;
  renderSheet();
  try {
    const { order } = await api('/api/orders', {
      method: 'POST',
      body: {
        customer_name: f.customer_name, phone: f.phone, pickup_date: f.pickup_date, notes: f.notes, lang: i18n.lang,
        items: cartLines().map(({ p, qty }) => ({ id: p.id, qty })),
      },
    });
    try { localStorage.setItem('bs_customer', JSON.stringify({ customer_name: f.customer_name, phone: f.phone })); } catch {}
    state.lastOrder = order;
    state.cart.clear();
    saveCart();
    state.placing = false;
    await refresh();
    openSheet('success');
  } catch (e) {
    state.placing = false;
    if (['out_of_stock', 'product_unavailable', 'shop_closed'].includes(e.code)) await refresh();
    renderSheet();
    if (state.sheet === 'cart' && $('formError')) showErrAfter(errorText(e));
    else toast(errorText(e), 'error');
  }
}
function showErrAfter(msg) {
  const box = $('formError');
  box.textContent = msg;
  box.classList.remove('hidden');
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function trackOrder(form) {
  const code = form.elements.code.value.trim();
  const phone = form.elements.phone.value.trim();
  if (!code || !phone) return;
  try {
    const { order } = await api(`/api/orders/lookup?code=${encodeURIComponent(code)}&phone=${encodeURIComponent(phone)}`);
    renderSheet(order);
  } catch (e) {
    const box = $('formError');
    box.textContent = errorText(e);
    box.classList.remove('hidden');
  }
}

// ---------- events ----------
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'close-backdrop' && e.target !== el) return;
  const id = Number(el.dataset.id);
  if (act === 'inc') setQty(id, (state.cart.get(id) || 0) + 1);
  else if (act === 'dec') setQty(id, (state.cart.get(id) || 0) - 1);
  else if (act === 'close' || act === 'close-backdrop') closeSheet();
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.id === 'checkoutForm') placeOrder(e.target);
  if (e.target.id === 'trackForm') trackOrder(e.target);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.sheet) closeSheet(); });
$('cartBtn').addEventListener('click', () => openSheet('cart'));
$('trackLink').addEventListener('click', (e) => { e.preventDefault(); openSheet('track'); });
$('langBtn').addEventListener('click', () => i18n.toggle());
i18n.onChange(() => { captureForm(); render(); if (state.sheet && state.sheet !== 'cart') renderSheet(); });

// Keep stock fresh while the page is open.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.placing) refresh(); });
setInterval(() => { if (!document.hidden && !state.placing && state.sheet !== 'cart') refresh(); }, 60_000);

i18n.apply();
loadShop().then(render).catch((e) => {
  $('grid').innerHTML = `<div class="empty"><div class="big">⚠️</div><p>${esc(errorText(e))}</p></div>`;
});
