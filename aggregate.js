export const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const SLOTS = ['Desayuno', 'Colación 1', 'Comida', 'Colación 2', 'Cena'];
export const DEPARTMENTS = [
  'Frutas y verduras',
  'Carnes y pescados',
  'Deli',
  'Lácteos y huevo',
  'Panadería y tortillas',
  'Abarrotes',
  'Congelados',
  'Otros',
];

const UNIT_ALIASES = {
  g: ['g', 'gr', 'grs', 'gramo', 'gramos'],
  kg: ['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'],
  ml: ['ml', 'mililitro', 'mililitros'],
  l: ['l', 'lt', 'lts', 'litro', 'litros'],
  taza: ['taza', 'tazas', 'tz'],
  cda: ['cda', 'cdas', 'cucharada', 'cucharadas', 'tbsp'],
  cdta: ['cdta', 'cdtas', 'cucharadita', 'cucharaditas', 'tsp'],
  pz: ['pz', 'pza', 'pzas', 'pieza', 'piezas', 'unidad', 'unidades'],
  rebanada: ['rebanada', 'rebanadas', 'reb'],
  lata: ['lata', 'latas'],
  paquete: ['paquete', 'paquetes', 'paq'],
  sobre: ['sobre', 'sobres'],
  diente: ['diente', 'dientes'],
  scoop: ['scoop', 'scoops', 'medida', 'medidas'],
};
const UNIT_LOOKUP = new Map(
  Object.entries(UNIT_ALIASES).flatMap(([unit, aliases]) => aliases.map((a) => [a, unit])),
);
const UNIT_PLURALS = {
  taza: 'tazas', cda: 'cdas', cdta: 'cdtas', rebanada: 'rebanadas', lata: 'latas',
  paquete: 'paquetes', sobre: 'sobres', diente: 'dientes', scoop: 'scoops',
};
const UNICODE_FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const FRAC_CHARS = Object.keys(UNICODE_FRACTIONS).join('');
const QTY_RE = new RegExp(
  `^((?:\\d+\\/\\d+|\\d+(?:[.,]\\d+)?|[${FRAC_CHARS}])(?:\\s*(?:\\d+\\/\\d+|[${FRAC_CHARS}]))?)\\s*`,
);

export function stripAccents(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function capitalize(s) {
  const str = String(s ?? '');
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const unitKey = (raw) => stripAccents(String(raw ?? '').toLowerCase().trim()).replace(/\.$/, '');

export function canonicalUnit(raw) {
  const key = unitKey(raw);
  if (key === 'al gusto') return 'al gusto';
  return UNIT_LOOKUP.get(key) ?? key;
}

/** Returns a summable unit (kg→g, l→ml) and the factor to convert quantities into it. */
export function normalizeUnit(raw) {
  const unit = canonicalUnit(raw) || 'pz';
  if (unit === 'kg') return { unit: 'g', factor: 1000 };
  if (unit === 'l') return { unit: 'ml', factor: 1000 };
  return { unit, factor: 1 };
}

function singularWord(w) {
  if (w.length <= 3) return w;
  if (w.endsWith('ces')) return w.slice(0, -3) + 'z';
  if (/[lrndj]es$/.test(w)) return w.slice(0, -2);
  if (/[aeiou]s$/.test(w)) return w.slice(0, -1);
  return w;
}

export function normalizeName(name) {
  return stripAccents(String(name ?? '').toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singularWord)
    .join(' ');
}

export function itemKey(name, unit) {
  return `${normalizeName(name)}|${unit}`;
}

export function parseQty(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  const s = String(value)
    .trim()
    .replace(/,/g, '.')
    .replace(new RegExp(`[${FRAC_CHARS}]`, 'g'), (c) => ` ${UNICODE_FRACTIONS[c]}`)
    .trim();
  if (!s) return null;
  let total = 0;
  for (const token of s.split(/\s+/)) {
    const frac = token.match(/^(\d+)\/(\d+)$/);
    if (frac && Number(frac[2]) !== 0) total += Number(frac[1]) / Number(frac[2]);
    else if (/^\d+(\.\d+)?$/.test(token)) total += Number(token);
    else return null;
  }
  return total;
}

export function formatNumber(n) {
  if (n == null) return '';
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.01) return String(whole);
  for (const [val, str] of [[0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4']]) {
    if (Math.abs(frac - val) < 0.02) return whole ? `${whole} ${str}` : str;
  }
  return String(Math.round(n * 100) / 100);
}

const round2 = (n) => String(Math.round(n * 100) / 100);
const unitLabel = (qty, unit) => (qty > 1 && UNIT_PLURALS[unit] ? UNIT_PLURALS[unit] : unit);

export function formatAmount(qty, unit) {
  if (qty == null || unit === 'al gusto') return '';
  if (unit === 'g') return qty >= 1000 ? `${round2(qty / 1000)} kg` : `${round2(qty)} g`;
  if (unit === 'ml') return qty >= 1000 ? `${round2(qty / 1000)} l` : `${round2(qty)} ml`;
  return `${formatNumber(qty)} ${unitLabel(qty, unit)}`;
}

/** Parses "2 rebanadas de pan integral", "1/4 aguacate", "sal al gusto". */
export function parseIngredientLine(line) {
  let rest = String(line ?? '').trim().replace(/^[-•*·]\s*/, '');
  if (!rest) return null;
  rest = rest.replace(/\s*\bal gusto\b\s*/i, ' ').trim();
  let qty = null;
  let unit = 'pz';
  const m = rest.match(QTY_RE);
  if (m) {
    qty = parseQty(m[1]);
    rest = rest.slice(m[0].length);
    const w = rest.match(/^([^\s\d]+)\s*/);
    if (w && UNIT_LOOKUP.has(unitKey(w[1]))) {
      unit = UNIT_LOOKUP.get(unitKey(w[1]));
      rest = rest.slice(w[0].length);
    }
  }
  rest = rest.replace(/^de\s+/i, '').trim();
  if (!rest) return null;
  if (qty == null) unit = 'al gusto';
  return { name: rest, qty, unit };
}

export function ingredientToLine({ name, qty, unit }) {
  if (qty == null || unit === 'al gusto') return `${name} al gusto`;
  if (!unit || unit === 'pz') return `${formatNumber(qty)} ${name}`;
  return `${formatNumber(qty)} ${unitLabel(qty, unit)} de ${name}`;
}

const DEPARTMENT_KEYWORDS = {
  'Frutas y verduras': [
    'aguacate', 'jitomate', 'tomate', 'cebolla', 'ajo', 'lechuga', 'espinaca', 'zanahoria', 'pepino',
    'calabaza', 'calabacita', 'brocoli', 'coliflor', 'chile', 'pimiento', 'apio', 'nopal', 'papa', 'camote',
    'champinon', 'elote', 'platano', 'manzana', 'pera', 'fresa', 'mango', 'papaya', 'melon', 'sandia',
    'pina', 'uva', 'naranja', 'limon', 'toronja', 'kiwi', 'mora', 'arandano', 'frutos rojos', 'cilantro',
    'perejil', 'ejote', 'betabel', 'jicama', 'guayaba', 'durazno', 'ensalada', 'verdura', 'fruta', 'pepinillo',
  ],
  'Carnes y pescados': [
    'pollo', 'pechuga', 'res', 'carne', 'cerdo', 'puerco', 'pavo', 'salmon', 'pescado',
    'tilapia', 'camaron', 'bistec', 'molida', 'chorizo', 'lomo', 'filete', 'arrachera', 'muslo',
  ],
  Deli: [
    'jamon', 'salchicha', 'salami', 'pepperoni', 'mortadela', 'tocino', 'pechuga de pavo', 'queso', 'panela',
    'manchego', 'oaxaca', 'chihuahua', 'gouda', 'parmesano', 'mozzarella',
  ],
  'Lácteos y huevo': [
    'leche', 'yogur', 'yogurt', 'huevo', 'clara', 'crema', 'mantequilla', 'requeson',
    'jocoque', 'kefir', 'leche de almendra', 'queso cottage',
  ],
  'Panadería y tortillas': ['pan', 'tortilla', 'bolillo', 'tostada', 'bagel', 'pita', 'wrap', 'baguette'],
  Abarrotes: [
    'chicharron', 'arroz', 'frijol', 'lenteja', 'garbanzo', 'avena', 'pasta', 'aceite', 'sal', 'pimienta', 'azucar', 'miel',
    'atun', 'granola', 'cereal', 'almendra', 'nuez', 'cacahuate', 'crema de cacahuate', 'chia', 'linaza',
    'harina', 'salsa', 'vinagre', 'canela', 'cafe', 'proteina', 'galleta', 'quinoa', 'amaranto', 'mayonesa',
    'mostaza', 'consome', 'caldo', 'sardina', 'palomita', 'gelatina', 'stevia', 'splenda', 'aceituna',
  ],
  Congelados: ['congelado', 'congelada', 'helado'],
};
const KEYWORD_INDEX = Object.entries(DEPARTMENT_KEYWORDS)
  .flatMap(([dept, words]) => words.map((w) => [normalizeName(w), dept]))
  .sort((a, b) => b[0].length - a[0].length);

/** Best-effort department from the ingredient name, or null when unknown. */
export function guessDepartment(name) {
  const padded = ` ${normalizeName(name)} `;
  return KEYWORD_INDEX.find(([kw]) => padded.includes(` ${kw} `))?.[1] ?? null;
}

/** Sums ingredients across all non-crossed-out meals, grouped by normalized name + unit. */
export function aggregate(plan) {
  const map = new Map();
  for (const day of plan?.days ?? []) {
    for (const meal of day.meals ?? []) {
      if (meal.crossedOut) continue;
      for (const ing of meal.ingredients ?? []) {
        const name = String(ing.name ?? '').trim();
        if (!name) continue;
        const { unit, factor } = normalizeUnit(ing.unit);
        const qty = parseQty(ing.qty);
        const key = itemKey(name, unit);
        let item = map.get(key);
        if (!item) {
          // Local rules win over the AI so store-specific placement stays consistent.
          const department = guessDepartment(name)
            ?? (DEPARTMENTS.includes(ing.department) ? ing.department : 'Otros');
          item = { key, name, qty: null, unit, department, uses: [] };
          map.set(key, item);
        }
        if (qty != null) item.qty = (item.qty ?? 0) + qty * factor;
        item.uses.push(`${day.day} · ${meal.slot}`);
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function groupByDepartment(items) {
  const groups = new Map(DEPARTMENTS.map((d) => [d, []]));
  for (const item of items) (groups.get(item.department) ?? groups.get('Otros')).push(item);
  return [...groups]
    .filter(([, list]) => list.length)
    .map(([dept, list]) => [dept, list.sort((a, b) => a.name.localeCompare(b.name, 'es'))]);
}

/** Combines items that share a name but not a unit (e.g. 1 rebanada + 70 g) into one entry with `parts`. */
export function mergeByName(items) {
  const map = new Map();
  for (const item of items) {
    const key = normalizeName(item.name);
    const part = { qty: item.qty, unit: item.unit };
    const existing = map.get(key);
    if (existing) {
      existing.parts.push(part);
      existing.uses.push(...(item.uses ?? []));
    } else {
      map.set(key, { key, name: item.name, department: item.department, uses: [...(item.uses ?? [])], parts: [part] });
    }
  }
  return [...map.values()];
}

export function formatParts(parts) {
  return parts.map((p) => formatAmount(p.qty, p.unit)).filter(Boolean).join(' + ');
}

export function shoppingLine(item) {
  const amount = item.parts ? formatParts(item.parts) : formatAmount(item.qty, item.unit);
  return amount ? `${capitalize(item.name)} — ${amount}` : capitalize(item.name);
}

export function toPlainText(groups, title) {
  const lines = [title, ''];
  for (const [dept, items] of groups) {
    lines.push(dept.toUpperCase());
    for (const item of items) lines.push(`☐ ${shoppingLine(item)}`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}
