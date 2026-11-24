import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, localDate } from '../src/store.js';

function setup() {
  const s = openStore(':memory:');
  const bread = s.createProduct({ name_en: 'Sourdough', name_ar: 'خبز العجين المخمر', price: 25, stock: 5 });
  const croissant = s.createProduct({ name_en: 'Croissant', name_ar: 'كرواسون', price: 7.5, stock: 10, max_per_order: 4 });
  const order = (items, extra = {}) => s.placeOrder({
    customer_name: 'Sara', phone: '0551234567', pickup_date: localDate(), items, ...extra,
  });
  return { s, bread, croissant, order };
}

test('placing an order deducts inventory and totals correctly', () => {
  const { s, bread, croissant, order } = setup();
  const o = order([{ id: bread.id, qty: 2 }, { id: croissant.id, qty: 3 }]);
  assert.equal(o.status, 'new');
  assert.equal(o.total, 72.5);
  assert.match(o.code, /^[A-Z2-9]{6}$/);
  assert.equal(s.getProduct(bread.id).stock, 3);
  assert.equal(s.getProduct(croissant.id).stock, 7);
});

test('duplicate lines for the same product are merged', () => {
  const { s, bread, order } = setup();
  const o = order([{ id: bread.id, qty: 1 }, { id: bread.id, qty: 2 }]);
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].qty, 3);
  assert.equal(s.getProduct(bread.id).stock, 2);
});

test('cannot oversell; a failed order changes nothing', () => {
  const { s, bread, croissant, order } = setup();
  assert.throws(
    () => order([{ id: croissant.id, qty: 2 }, { id: bread.id, qty: 6 }]),
    (e) => e.code === 'out_of_stock' && e.details.available === 5,
  );
  // The croissant decrement in the same order must have been rolled back.
  assert.equal(s.getProduct(croissant.id).stock, 10);
  assert.equal(s.getProduct(bread.id).stock, 5);
  assert.equal(s.listOrders({ status: 'all' }).length, 0);
});

test('last item can only be sold once', () => {
  const { s, bread, order } = setup();
  order([{ id: bread.id, qty: 4 }]);
  order([{ id: bread.id, qty: 1 }]);
  assert.equal(s.getProduct(bread.id).stock, 0);
  assert.throws(() => order([{ id: bread.id, qty: 1 }]), { code: 'out_of_stock' });
});

test('max per order is enforced', () => {
  const { croissant, order } = setup();
  assert.throws(() => order([{ id: croissant.id, qty: 5 }]), { code: 'over_max_per_order' });
});

test('hidden products and closed shop reject orders', () => {
  const { s, bread, order } = setup();
  s.updateProduct(bread.id, { active: false });
  assert.throws(() => order([{ id: bread.id, qty: 1 }]), { code: 'product_unavailable' });
  s.updateProduct(bread.id, { active: true });
  s.updateSettings({ shop_open: false });
  assert.throws(() => order([{ id: bread.id, qty: 1 }]), { code: 'shop_closed' });
});

test('input validation', () => {
  const { bread, order } = setup();
  assert.throws(() => order([{ id: bread.id, qty: 1 }], { phone: 'abc' }), { code: 'invalid_phone' });
  assert.throws(() => order([{ id: bread.id, qty: 1 }], { customer_name: ' ' }), { code: 'invalid_name' });
  assert.throws(() => order([{ id: bread.id, qty: 1 }], { pickup_date: '2000-01-01' }), { code: 'invalid_pickup_date' });
  assert.throws(() => order([]), { code: 'empty_order' });
  assert.throws(() => order([{ id: bread.id, qty: 0 }]), { code: 'invalid_item' });
  // Arabic-Indic digits are accepted
  const o = order([{ id: bread.id, qty: 1 }], { phone: '٠٥٥١٢٣٤٥٦٧' });
  assert.equal(o.phone, '0551234567');
});

test('cancelling returns stock exactly once; completed orders cannot be cancelled', () => {
  const { s, bread, order } = setup();
  const o = order([{ id: bread.id, qty: 3 }]);
  assert.equal(s.getProduct(bread.id).stock, 2);
  s.setOrderStatus(o.id, 'cancelled');
  assert.equal(s.getProduct(bread.id).stock, 5);
  s.setOrderStatus(o.id, 'cancelled'); // double-tap is a no-op, not a second restock
  assert.equal(s.getProduct(bread.id).stock, 5);
  assert.throws(() => s.setOrderStatus(o.id, 'ready'), { code: 'order_already_cancelled' });

  const o2 = order([{ id: bread.id, qty: 1 }]);
  s.setOrderStatus(o2.id, 'ready');
  s.setOrderStatus(o2.id, 'completed');
  assert.throws(() => s.setOrderStatus(o2.id, 'cancelled'), { code: 'cannot_cancel_completed' });
});

test('orders survive product deletion with their names intact', () => {
  const { s, bread, order } = setup();
  const o = order([{ id: bread.id, qty: 1 }]);
  s.deleteProduct(bread.id);
  const again = s.getOrder(o.id);
  assert.equal(again.items[0].name_en, 'Sourdough');
  assert.equal(again.items[0].product_id, null);
  s.setOrderStatus(o.id, 'cancelled'); // must not crash
});

test('summary and production list', () => {
  const { s, bread, croissant, order } = setup();
  order([{ id: bread.id, qty: 2 }, { id: croissant.id, qty: 1 }]);
  const o2 = order([{ id: bread.id, qty: 1 }]);
  const o3 = order([{ id: croissant.id, qty: 4 }]);
  s.setOrderStatus(o3.id, 'cancelled');
  s.setOrderStatus(o2.id, 'ready');
  const sum = s.summary(localDate());
  assert.equal(sum.new_count, 1);
  assert.equal(sum.ready_count, 1);
  assert.equal(sum.revenue, 82.5);
  const prod = Object.fromEntries(sum.production.map((p) => [p.name_en, p.qty]));
  assert.deepEqual(prod, { Sourdough: 3, Croissant: 1 });
  assert.equal(sum.low_stock.find((p) => p.id === bread.id).stock, 2);
});

test('order lookup needs code and matching phone', () => {
  const { s, bread, order } = setup();
  const o = order([{ id: bread.id, qty: 1 }]);
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
  s.setPassword('another-pass-99'); // changing password logs out everywhere
  assert.ok(!s.validSession(tok));
});
