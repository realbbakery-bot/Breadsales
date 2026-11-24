import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/store.js';

// Fixed clock: Tuesday 2026-12-01 10:00 local time.
function setup(clock = { t: new Date(2026, 11, 1, 10, 0) }) {
  const s = openStore(':memory:', { now: () => clock.t });
  const bread = s.createProduct({ name_en: 'Sourdough', name_ar: 'خبز العجين المخمّر', price: 25, default_qty: 12, max_per_order: 3 });
  const rye = s.createProduct({ name_en: 'Rye', name_ar: 'خبز الجاودار', price: 30, default_qty: 6 });
  const friday = s.createBakeDay({
    date: '2026-12-04', cutoff_at: '2026-12-03T20:00',
    items: [{ product_id: bread.id, capacity: 5 }, { product_id: rye.id, capacity: 4 }],
  });
  let n = 0;
  const order = (items, extra = {}) => s.placeOrder({
    bake_day_id: friday.id, customer_name: 'Sara', phone: `05512345${String(n++).padStart(2, '0')}`, items, ...extra,
  });
  return { s, bread, rye, friday, order, clock };
}
const remaining = (s, dayId, pid) => s.getBakeDay(dayId).items.find((i) => i.product_id === pid).remaining;

test('an order reserves from the bake day and totals correctly', () => {
  const { s, bread, rye, friday, order } = setup();
  const o = order([{ id: bread.id, qty: 2 }, { id: rye.id, qty: 1 }]);
  assert.equal(o.status, 'new');
  assert.equal(o.total, 80);
  assert.equal(o.pickup_date, '2026-12-04');
  assert.match(o.code, /^[A-Z2-9]{6}$/);
  assert.equal(remaining(s, friday.id, bread.id), 3);
  assert.equal(remaining(s, friday.id, rye.id), 3);
});

test('cannot oversell a bake day; a failed order changes nothing', () => {
  const { s, bread, rye, friday, order } = setup();
  order([{ id: rye.id, qty: 3 }]);
  assert.throws(
    () => order([{ id: bread.id, qty: 1 }, { id: rye.id, qty: 2 }]),
    (e) => e.code === 'out_of_stock' && e.details.available === 1,
  );
  assert.equal(remaining(s, friday.id, bread.id), 5);
  assert.equal(s.listOrders({ status: 'all' }).length, 1);
});

test('the last loaf can only be sold once', () => {
  const { s, bread, friday, order } = setup();
  order([{ id: bread.id, qty: 3 }]);
  order([{ id: bread.id, qty: 2 }]);
  assert.equal(remaining(s, friday.id, bread.id), 0);
  assert.throws(() => order([{ id: bread.id, qty: 1 }]), { code: 'out_of_stock' });
});

test('bake days are independent: selling out Friday does not touch Tuesday', () => {
  const { s, bread, order } = setup();
  const tuesday = s.createBakeDay({ date: '2026-12-08', items: [{ product_id: bread.id, capacity: 10 }] });
  order([{ id: bread.id, qty: 3 }]);
  order([{ id: bread.id, qty: 2 }]);
  const o = s.placeOrder({ bake_day_id: tuesday.id, customer_name: 'Omar', phone: '0500000000', items: [{ id: bread.id, qty: 3 }] });
  assert.equal(o.pickup_date, '2026-12-08');
  assert.equal(remaining(s, tuesday.id, bread.id), 7);
});

test('orders close at the cutoff', () => {
  const { s, bread, friday, order, clock } = setup();
  clock.t = new Date(2026, 11, 3, 19, 59);
  order([{ id: bread.id, qty: 1 }]);
  clock.t = new Date(2026, 11, 3, 20, 0);
  assert.throws(() => order([{ id: bread.id, qty: 1 }]), { code: 'orders_closed_for_day' });
  assert.equal(s.getBakeDay(friday.id).state, 'cutoff');
  assert.equal(s.publicBakeDays().length, 0);
});

test('closed or past bake days, hidden products, items not on the bake day are rejected', () => {
  const { s, bread, rye, friday, order, clock } = setup();
  const cake = s.createProduct({ name_en: 'Cake', price: 100 });
  assert.throws(() => order([{ id: cake.id, qty: 1 }]), { code: 'product_unavailable' });
  s.updateProduct(rye.id, { active: false });
  assert.throws(() => order([{ id: rye.id, qty: 1 }]), { code: 'product_unavailable' });
  s.updateBakeDay(friday.id, { is_open: false });
  assert.throws(() => order([{ id: bread.id, qty: 1 }]), { code: 'bake_day_unavailable' });
  s.updateBakeDay(friday.id, { is_open: true, cutoff_at: '' });
  clock.t = new Date(2026, 11, 5, 9, 0);
  assert.throws(() => order([{ id: bread.id, qty: 1 }]), { code: 'bake_day_unavailable' });
});

test('global shop switch and max per order', () => {
  const { s, bread, order } = setup();
  assert.throws(() => order([{ id: bread.id, qty: 4 }]), { code: 'over_max_per_order' });
  s.updateSettings({ shop_open: false });
  assert.throws(() => order([{ id: bread.id, qty: 1 }]), { code: 'shop_closed' });
});

test('input validation', () => {
  const { bread, order } = setup();
  assert.throws(() => order([{ id: bread.id, qty: 1 }], { phone: 'abc' }), { code: 'invalid_phone' });
  assert.throws(() => order([{ id: bread.id, qty: 1 }], { customer_name: ' ' }), { code: 'invalid_name' });
  assert.throws(() => order([{ id: bread.id, qty: 1 }], { bake_day_id: 999 }), { code: 'bake_day_not_found' });
  assert.throws(() => order([]), { code: 'empty_order' });
  assert.throws(() => order([{ id: bread.id, qty: 0 }]), { code: 'invalid_item' });
  const o = order([{ id: bread.id, qty: 1 }], { phone: '٠٥٥١٢٣٤٥٦٧' });
  assert.equal(o.phone, '0551234567');
});

test('cancelling frees the items; double cancel is a no-op; completed cannot be cancelled', () => {
  const { s, bread, friday, order } = setup();
  const o = order([{ id: bread.id, qty: 3 }]);
  assert.equal(remaining(s, friday.id, bread.id), 2);
  s.setOrderStatus(o.id, 'cancelled');
  s.setOrderStatus(o.id, 'cancelled');
  assert.equal(remaining(s, friday.id, bread.id), 5);
  assert.throws(() => s.setOrderStatus(o.id, 'ready'), { code: 'order_already_cancelled' });
  const o2 = order([{ id: bread.id, qty: 1 }]);
  s.setOrderStatus(o2.id, 'completed');
  assert.throws(() => s.setOrderStatus(o2.id, 'cancelled'), { code: 'cannot_cancel_completed' });
});

test('baker can raise capacity but not drop it below what is already reserved', () => {
  const { s, bread, friday, order } = setup();
  order([{ id: bread.id, qty: 3 }]);
  s.updateBakeDay(friday.id, { items: [{ product_id: bread.id, capacity: 8 }] });
  assert.equal(remaining(s, friday.id, bread.id), 5);
  assert.throws(
    () => s.updateBakeDay(friday.id, { items: [{ product_id: bread.id, capacity: 2 }] }),
    (e) => e.code === 'capacity_below_reserved' && e.details.reserved === 3,
  );
  assert.throws(() => s.updateBakeDay(friday.id, { date: '2026-12-05' }), { code: 'bake_day_has_orders' });
  assert.throws(() => s.deleteBakeDay(friday.id), { code: 'bake_day_has_orders' });
});

test('bake day validation', () => {
  const { s } = setup();
  assert.throws(() => s.createBakeDay({ date: '2026-12-04' }), { code: 'bake_day_exists' });
  assert.throws(() => s.createBakeDay({ date: 'friday' }), { code: 'invalid_date' });
  assert.throws(() => s.createBakeDay({ date: '2026-12-10', cutoff_at: '2026-12-11T08:00' }), { code: 'cutoff_after_bake_day' });
  const d = s.createBakeDay({ date: '2026-12-10' });
  assert.equal(d.cutoff_at, '2026-12-09T20:00', 'default cutoff = day before at 20:00');
  s.deleteBakeDay(d.id);
});

test('template for the next bake day copies last week', () => {
  const { s, bread, rye } = setup();
  const tpl = s.bakeDayTemplate();
  assert.equal(tpl.date, '2026-12-11');
  assert.equal(tpl.cutoff_at, '2026-12-10T20:00');
  const caps = Object.fromEntries(tpl.items.map((i) => [i.product_id, i.capacity]));
  assert.deepEqual(caps, { [bread.id]: 5, [rye.id]: 4 });
});

test('bake sheet summary', () => {
  const { s, bread, rye, friday, order } = setup();
  order([{ id: bread.id, qty: 2 }, { id: rye.id, qty: 1 }]);
  const o2 = order([{ id: bread.id, qty: 1 }]);
  const o3 = order([{ id: rye.id, qty: 2 }]);
  s.setOrderStatus(o3.id, 'cancelled');
  s.setOrderStatus(o2.id, 'ready');
  const sum = s.summary();
  assert.equal(sum.bake_day.id, friday.id);
  assert.equal(sum.new_count, 1);
  assert.equal(sum.ready_count, 1);
  assert.equal(sum.revenue, 105);
  const r = Object.fromEntries(sum.bake_day.items.map((i) => [i.name_en, [i.reserved, i.remaining]]));
  assert.deepEqual(r, { Sourdough: [3, 2], Rye: [1, 3] });
});

test('orders survive product deletion with their names intact', () => {
  const { s, bread, order } = setup();
  const o = order([{ id: bread.id, qty: 1 }]);
  s.deleteProduct(bread.id);
  assert.equal(s.getOrder(o.id).items[0].name_en, 'Sourdough');
  s.setOrderStatus(o.id, 'cancelled');
});

test('order lookup needs code and matching phone', () => {
  const { s, bread, order } = setup();
  const o = order([{ id: bread.id, qty: 1 }], { phone: '0551234567' });
  assert.equal(s.lookupOrder(o.code.toLowerCase(), '+966 55 123 4567').status, 'new');
  assert.throws(() => s.lookupOrder(o.code, '0500000000'), { code: 'order_not_found' });
});

test('passwords and sessions', () => {
  const s = openStore(':memory:');
  assert.equal(s.hasPassword(), false);
  assert.throws(() => s.setPassword('short'), { code: 'weak_password' });
  s.setPassword('crusty-loaf-42');
  assert.ok(s.checkPassword('crusty-loaf-42'));
  assert.ok(!s.checkPassword('wrong'));
  const tok = s.createSession();
  assert.ok(s.validSession(tok));
  s.setPassword('another-pass-99');
  assert.ok(!s.validSession(tok));
});
