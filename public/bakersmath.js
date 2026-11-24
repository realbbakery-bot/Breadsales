// Baker's math, shared by the dashboard and the server (and tested).
//
// Convention (the common home-baker one):
//   • Every ingredient is a percentage of the total FLOUR in the final dough; the flours add up to 100%.
//   • Levain is listed as its own ingredient (e.g. 20%). Its own flour and water are NOT part of the 100%,
//     but they ARE counted in the "overall hydration", which is what the dough actually feels like.
//
// Total dough needed = pieces × piece weight × (1 + loss%).  Flour = total dough ÷ (sum of all % ÷ 100).

export const KINDS = ['flour', 'water', 'levain', 'salt', 'yeast', 'other'];

const round = (n, step) => Math.round(n / step) * step;
// Small amounts (salt, yeast) need decimals; big ones don't.
export const roundGrams = (g) => (g < 50 ? round(g, 0.1) : Math.round(g));

export function flourTotal(ingredients) {
  return ingredients.filter((i) => i.kind === 'flour').reduce((s, i) => s + Number(i.pct || 0), 0);
}

export function hydration(recipe) {
  const ings = recipe.ingredients || [];
  const pct = (kind) => ings.filter((i) => i.kind === kind).reduce((s, i) => s + Number(i.pct || 0), 0);
  const h = Number(recipe.levain_hydration ?? 100) / 100;
  const levain = pct('levain');
  const levainFlour = levain / (1 + h);
  const levainWater = levain - levainFlour;
  const flour = pct('flour');
  const water = pct('water');
  return {
    formula: water, // water ÷ flour, ignoring the levain
    overall: flour + levainFlour > 0 ? ((water + levainWater) / (flour + levainFlour)) * 100 : 0,
    prefermented: flour + levainFlour > 0 ? (levainFlour / (flour + levainFlour)) * 100 : 0,
  };
}

export function computeDough(recipe, pieces) {
  const n = Math.max(0, Number(pieces) || 0);
  const ings = recipe.ingredients || [];
  const totalPct = ings.reduce((s, i) => s + Number(i.pct || 0), 0);
  const pieceWeight = Number(recipe.piece_weight_g) || 0;
  const loss = Number(recipe.waste_pct) || 0;
  const totalDough = n * pieceWeight * (1 + loss / 100);
  const flour = totalPct > 0 ? (totalDough * 100) / totalPct : 0;
  const lines = ings.map((i) => ({ ...i, grams: (flour * Number(i.pct || 0)) / 100 }));
  const h = Number(recipe.levain_hydration ?? 100) / 100;
  const levainTotal = lines.filter((l) => l.kind === 'levain').reduce((s, l) => s + l.grams, 0);
  const levainFlour = levainTotal / (1 + h);
  return {
    pieces: n,
    totalDough,
    flour,
    lines,
    levain: { total: levainTotal, flour: levainFlour, water: levainTotal - levainFlour },
    hydration: hydration(recipe),
  };
}

// Combine several computed batches into one weighing / shopping list.
export function aggregate(batches) {
  const map = new Map();
  let totalDough = 0;
  const levain = { total: 0, flour: 0, water: 0 };
  for (const b of batches) {
    totalDough += b.totalDough;
    levain.total += b.levain.total;
    levain.flour += b.levain.flour;
    levain.water += b.levain.water;
    for (const l of b.lines) {
      const key = `${l.kind}|${(l.name_en || '').trim().toLowerCase()}|${(l.name_ar || '').trim()}`;
      const cur = map.get(key) || { kind: l.kind, name_en: l.name_en, name_ar: l.name_ar, grams: 0 };
      cur.grams += l.grams;
      map.set(key, cur);
    }
  }
  const order = (k) => KINDS.indexOf(k);
  const lines = [...map.values()].sort((a, b) => order(a.kind) - order(b.kind) || b.grams - a.grams);
  return { totalDough, lines, levain };
}

// A sensible starting point for a new sourdough recipe.
export function starterRecipe() {
  return {
    piece_weight_g: 900,
    waste_pct: 2,
    levain_hydration: 100,
    notes_en: '',
    notes_ar: '',
    ingredients: [
      { kind: 'flour', name_en: 'Bread flour', name_ar: 'دقيق الخبز', pct: 90 },
      { kind: 'flour', name_en: 'Whole wheat flour', name_ar: 'دقيق القمح الكامل', pct: 10 },
      { kind: 'water', name_en: 'Water', name_ar: 'ماء', pct: 75 },
      { kind: 'levain', name_en: 'Levain', name_ar: 'الخميرة الطبيعية', pct: 20 },
      { kind: 'salt', name_en: 'Salt', name_ar: 'ملح', pct: 2 },
    ],
  };
}
