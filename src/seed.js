// Adds sample sourdough items and two upcoming bake days. Run: npm run seed
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, localDate, addDays } from './store.js';
import { starterRecipe } from '../public/bakersmath.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const store = openStore(path.join(dataDir, 'bakery.db'));

if (store.listProducts({ includeInactive: true }).length) {
  console.log('Products already exist — nothing added.');
} else {
  const items = [
    { emoji: '🍞', name_en: 'Country Sourdough', name_ar: 'خبز العجين المخمّر الريفي', desc_en: '48-hour fermented loaf with a crackly crust.', desc_ar: 'رغيف مخمّر لمدة ٤٨ ساعة بقشرة مقرمشة.', price: 32, default_qty: 16, max_per_order: 3 },
    { emoji: '🌾', name_en: 'Whole Wheat Sourdough', name_ar: 'خبز العجين المخمّر بالقمح الكامل', desc_en: '50% stone-ground whole wheat.', desc_ar: 'نصفه من دقيق القمح الكامل المطحون بالحجر.', price: 35, default_qty: 8, max_per_order: 2 },
    { emoji: '🫒', name_en: 'Olive & Rosemary', name_ar: 'بالزيتون وإكليل الجبل', desc_en: 'Kalamata olives and fresh rosemary.', desc_ar: 'زيتون كالاماتا وإكليل الجبل الطازج.', price: 40, default_qty: 6 },
    { emoji: '🥖', name_en: 'Sourdough Baguette', name_ar: 'باغيت بالعجين المخمّر', desc_en: 'Thin, crisp and best eaten the same day.', desc_ar: 'رفيعة ومقرمشة، ويُفضَّل تناولها في اليوم نفسه.', price: 14, default_qty: 10 },
    { emoji: '🍪', name_en: 'Sourdough Cookies (box of 6)', name_ar: 'كعك بالعجين المخمّر (علبة ٦ قطع)', desc_en: 'Brown butter and dark chocolate.', desc_ar: 'بالزبدة المحمّصة والشوكولاتة الداكنة.', price: 30, default_qty: 4 },
  ];
  const products = items.map((p, i) => store.createProduct({ ...p, sort: i }));
  const flour = (en, ar, pct) => ({ kind: 'flour', name_en: en, name_ar: ar, pct });
  const water = (pct) => ({ kind: 'water', name_en: 'Water', name_ar: 'ماء', pct });
  const levain = (pct) => ({ kind: 'levain', name_en: 'Levain', name_ar: 'الخميرة الطبيعية', pct });
  const salt = { kind: 'salt', name_en: 'Salt', name_ar: 'ملح', pct: 2 };
  const recipes = [
    starterRecipe(),
    { piece_weight_g: 900, waste_pct: 2, levain_hydration: 100, ingredients: [
      flour('Bread flour', 'دقيق الخبز', 50), flour('Whole wheat flour', 'دقيق القمح الكامل', 50), water(80), levain(20), salt] },
    { piece_weight_g: 950, waste_pct: 2, levain_hydration: 100, ingredients: [
      flour('Bread flour', 'دقيق الخبز', 90), flour('Whole wheat flour', 'دقيق القمح الكامل', 10), water(72), levain(20), salt,
      { kind: 'other', name_en: 'Kalamata olives', name_ar: 'زيتون كالاماتا', pct: 15 },
      { kind: 'other', name_en: 'Fresh rosemary', name_ar: 'إكليل الجبل الطازج', pct: 0.5 }] },
    { piece_weight_g: 350, waste_pct: 3, levain_hydration: 100, ingredients: [
      flour('Bread flour', 'دقيق الخبز', 100), water(70), levain(15), salt] },
  ];
  recipes.forEach((r, i) => store.saveRecipe(products[i].id, r));
  const today = localDate();
  for (const offset of [2, 5]) {
    store.createBakeDay({
      date: addDays(today, offset),
      items: products.map((p) => ({ product_id: p.id, capacity: p.default_qty })),
    });
  }
  console.log(`Added ${items.length} sample products, ${recipes.length} recipes and 2 bake days.`);
}
store.close();
