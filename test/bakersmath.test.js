import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDough, aggregate, hydration, starterRecipe, roundGrams } from '../public/bakersmath.js';
import { openStore } from '../src/store.js';

const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('scales a sourdough formula from loaf count', () => {
  const r = starterRecipe(); // 90/10 flour, 75 water, 20 levain, 2 salt = 197%; 900 g loaves, 2% loss
  const d = computeDough(r, 10);
  near(d.totalDough, 9180);
  near(d.flour, 9180 / 1.97);
  const g = Object.fromEntries(d.lines.map((l) => [l.name_en, l.grams]));
  near(g['Bread flour'], d.flour * 0.9);
  near(g.Water, d.flour * 0.75);
  near(g.Salt, d.flour * 0.02);
  // Ingredients add back up to the dough weight.
  near(d.lines.reduce((s, l) => s + l.grams, 0), d.totalDough);
  // 100% hydration levain splits evenly.
  near(d.levain.flour, d.levain.water);
});

test('overall hydration counts the levain', () => {
  const h = hydration(starterRecipe());
  near(h.formula, 75);
  near(h.overall, (85 / 110) * 100); // (75 + 10) / (100 + 10)
  near(h.prefermented, (10 / 110) * 100);
  const stiff = hydration({ ...starterRecipe(), levain_hydration: 50 });
  assert.ok(stiff.overall < h.overall);
});

test('aggregates shared ingredients across breads', () => {
  const a = computeDough(starterRecipe(), 4);
  const b = computeDough(starterRecipe(), 6);
  const all = aggregate([a, b]);
  const ten = computeDough(starterRecipe(), 10);
  near(all.totalDough, ten.totalDough);
  near(all.lines.find((l) => l.name_en === 'Water').grams, ten.lines.find((l) => l.name_en === 'Water').grams);
  assert.equal(all.lines[0].kind, 'flour');
});

test('zero loaves and rounding', () => {
  assert.equal(computeDough(starterRecipe(), 0).totalDough, 0);
  assert.equal(roundGrams(9.3456), 9.3);
  assert.equal(roundGrams(418.6), 419);
});

test('recipes are stored and validated', () => {
  const s = openStore(':memory:');
  const p = s.createProduct({ name_en: 'Sourdough', price: 30 });
  const saved = s.saveRecipe(p.id, starterRecipe());
  assert.equal(saved.ingredients.length, 5);
  assert.equal(s.listRecipes().length, 1);
  const bad = { ...starterRecipe(), ingredients: [{ kind: 'flour', name_en: 'Flour', pct: 90 }, { kind: 'water', name_en: 'Water', pct: 70 }] };
  assert.throws(() => s.saveRecipe(p.id, bad), (e) => e.code === 'flour_must_total_100' && e.details.total === 90);
  assert.throws(() => s.saveRecipe(p.id, { ...starterRecipe(), piece_weight_g: 0 }), { code: 'invalid_number' });
  assert.throws(() => s.saveRecipe(p.id, { ...starterRecipe(), ingredients: [{ kind: 'flour', pct: 100 }] }), { code: 'ingredient_name_required' });
  s.deleteProduct(p.id);
  assert.equal(s.listRecipes().length, 0, 'recipe goes with its product');
});
