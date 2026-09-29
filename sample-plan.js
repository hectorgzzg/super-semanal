import { DAYS, SLOTS, parseIngredientLine, guessDepartment } from './aggregate.js';

const MENUS = {
  sandwich: ['Sándwich', ['2 rebanadas de pan integral', '2 rebanadas de jamón de pavo', '1 rebanada de queso panela', '1/4 aguacate']],
  huevos: ['Huevos a la mexicana', ['2 huevos', '1/4 taza de jitomate', '2 cdas de cebolla', '2 tortillas de maíz']],
  avena: ['Avena con plátano', ['1/2 taza de avena', '1 taza de leche descremada', '1 plátano', '1 cda de crema de cacahuate']],
  manzana: ['Fruta', ['1 manzana']],
  yogur: ['Yogur con fresas', ['1 taza de yogur griego', '1/2 taza de fresas']],
  almendras: ['Almendras', ['15 g de almendras']],
  bistec: ['Bistec con arroz', ['250 g de carne de res', '1/2 taza de arroz', '1 taza de brócoli']],
  pollo: ['Pollo a la plancha', ['150 g de pechuga de pollo', '1 taza de ensalada verde', '1/2 taza de frijoles', 'sal al gusto']],
  salmon: ['Salmón con verduras', ['150 g de salmón', '1 taza de calabacita', '1/2 taza de quinoa']],
  pepino: ['Pepino con limón', ['1 pepino', '1 limón']],
  gelatina: ['Gelatina light', ['1 gelatina light']],
  tostadas: ['Tostadas de atún', ['1 lata de atún', '2 tostadas', '1/4 aguacate']],
  quesadillas: ['Quesadillas', ['2 tortillas de maíz', '40 g de queso panela']],
  ensalada: ['Ensalada de pollo', ['100 g de pechuga de pollo', '1 taza de lechuga', '1 cdta de aceite de oliva']],
};

// One row per day, in SLOTS order. A leading "x:" marks the meal as crossed out.
const WEEK = [
  ['sandwich', 'manzana', 'bistec', 'pepino', 'tostadas'],
  ['huevos', 'yogur', 'pollo', 'gelatina', 'quesadillas'],
  ['avena', 'almendras', 'salmon', 'pepino', 'x:quesadillas'],
  ['sandwich', 'manzana', 'bistec', 'gelatina', 'ensalada'],
  ['huevos', 'yogur', 'pollo', 'pepino', 'tostadas'],
  ['avena', 'almendras', 'salmon', 'gelatina', 'ensalada'],
  ['sandwich', 'manzana', 'pollo', 'pepino', 'quesadillas'],
];

export function buildSamplePlan() {
  return {
    days: DAYS.map((day, d) => ({
      day,
      meals: SLOTS.map((slot, s) => {
        const code = WEEK[d][s];
        const crossedOut = code.startsWith('x:');
        const [title, lines] = MENUS[code.replace('x:', '')];
        const ingredients = lines.map(parseIngredientLine).map((i) => ({ ...i, department: guessDepartment(i.name) ?? 'Otros' }));
        return { slot, title, crossedOut, ingredients };
      }),
    })),
  };
}
