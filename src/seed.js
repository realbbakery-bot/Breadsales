// Adds a few sample items so you can try the shop. Run: npm run seed
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const store = openStore(path.join(dataDir, 'bakery.db'));

if (store.listProducts({ includeInactive: true }).length) {
  console.log('Products already exist — nothing added.');
} else {
  const items = [
    { emoji: '🍞', name_en: 'Country Sourdough', name_ar: 'خبز العجين المخمّر', desc_en: '48-hour fermented loaf with a crackly crust.', desc_ar: 'رغيف مخمّر لمدة ٤٨ ساعة بقشرة مقرمشة.', price: 28, stock: 8, max_per_order: 3 },
    { emoji: '🥐', name_en: 'Butter Croissant', name_ar: 'كرواسون بالزبدة', desc_en: 'Flaky, golden and made with real butter.', desc_ar: 'هشّ وذهبي، محضّر بالزبدة الطبيعية.', price: 9, stock: 24 },
    { emoji: '🫓', name_en: 'Za\'atar Manakish', name_ar: 'مناقيش بالزعتر', desc_en: 'Stone-baked flatbread with za\'atar and olive oil.', desc_ar: 'خبز مسطّح بالزعتر وزيت الزيتون.', price: 6, stock: 15 },
    { emoji: '🍪', name_en: 'Date Ma\'amoul (box of 6)', name_ar: 'معمول بالتمر (علبة ٦ قطع)', desc_en: 'Semolina cookies filled with dates.', desc_ar: 'حلوى السميد المحشوة بالتمر.', price: 35, stock: 3 },
    { emoji: '🍰', name_en: 'Saffron Cake', name_ar: 'كعكة الزعفران', desc_en: 'Whole cake, serves 8. Order a day ahead.', desc_ar: 'كعكة كاملة تكفي ٨ أشخاص.', price: 120, stock: 0 },
  ];
  items.forEach((p, i) => store.createProduct({ ...p, sort: i }));
  console.log(`Added ${items.length} sample products.`);
}
store.close();
