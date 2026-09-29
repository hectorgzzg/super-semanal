import { DAYS, SLOTS, DEPARTMENTS } from './aggregate.js';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
// Tried in order when the configured model returns 404 (retired or not enabled for this key).
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.5-flash-lite'];

export class GeminiError extends Error {}

const INGREDIENT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    qty: { type: ['number', 'null'] },
    unit: { type: 'string' },
    department: { type: 'string', enum: DEPARTMENTS },
  },
  required: ['name', 'qty', 'unit', 'department'],
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'string', enum: DAYS },
          meals: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                slot: { type: 'string', enum: SLOTS },
                title: { type: 'string' },
                crossedOut: { type: 'boolean' },
                ingredients: { type: 'array', items: INGREDIENT_SCHEMA },
              },
              required: ['slot', 'title', 'crossedOut', 'ingredients'],
            },
          },
        },
        required: ['day', 'meals'],
      },
    },
  },
  required: ['days'],
};

const PROMPT = `You are reading a photo of a weekly nutrition plan written in Spanish.
It is a table with 7 days (${DAYS.join(', ')}) and 5 meal slots (${SLOTS.join(', ')}).
Slot names in the image may differ (e.g. "Snack 1", "Media mañana", "Almuerzo"): map them to the 5 slots in their order.
Each cell has a dish title followed by a list of ingredients with quantities.

Rules:
- Transcribe only what is written. Never invent ingredients or quantities.
- qty: a number. Convert fractions (1/4 -> 0.25, 1 1/2 -> 1.5). Use null when no quantity is written.
- unit: one of g, kg, ml, l, taza, cda, cdta, pz, rebanada, lata, paquete, sobre, diente, scoop.
  Only use a unit that is literally written on that same line next to the quantity.
  Never copy a unit from another line or guess one. If no unit word is written, use "pz"
  (e.g. "1/2 aguacate" -> qty 0.5, unit "pz"; "2 huevos" -> qty 2, unit "pz").
  Use "al gusto" when there is no quantity.
- name: short generic ingredient name in Spanish, singular, lowercase, without quantity or unit
  (e.g. "pan integral", "jamón de pavo", "aguacate").
- department: the supermarket department where it is usually bought.
  Cold cuts and cheeses (jamón, salchicha, queso panela, queso manchego…) go to "Deli".
  Packaged snacks such as chicharrón de cerdo go to "Abarrotes".
- crossedOut: true if the whole cell/meal is crossed out, struck through, scribbled over or marked with an X.
  If only one ingredient line is crossed out, omit that ingredient.
- If a cell offers alternatives ("o"), include only the first option.
- If a cell refers to another day (e.g. "igual que el lunes") or spans several days, repeat its content for each day.
- If a cell is empty or illegible, return the slot with title "" and no ingredients.`;

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function errorFrom(res, model) {
  let message = '';
  try {
    message = (await res.json())?.error?.message ?? '';
  } catch {
    /* non-JSON error body */
  }
  console.error(`Gemini ${model} → HTTP ${res.status}`, message);
  const detail = message ? ` (${model}: ${message})` : ` (${model})`;
  let err;
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key/i.test(message))) {
    err = new GeminiError('La clave de API no es válida. Revísala en Ajustes.');
  } else if (res.status === 404) {
    err = new GeminiError(`El modelo "${model}" no está disponible para tu clave. Prueba otro en Ajustes.`);
  } else if (res.status === 429) {
    err = new GeminiError(`Llegaste al límite gratuito de Gemini. Espera un minuto e intenta de nuevo.${detail}`);
  } else if (res.status >= 500) {
    err = new GeminiError(`Gemini no está disponible en este momento. Intenta de nuevo en unos segundos.${detail}`);
  } else {
    err = new GeminiError(`Error de Gemini (${res.status})${detail}`);
  }
  err.status = res.status;
  err.tryNextModel = res.status === 404 || TRANSIENT.has(res.status);
  return err;
}

/** Returns { plan, model } where model is the one that actually answered. */
export async function extractPlan({ imageBase64, mimeType, apiKey, model = DEFAULT_MODEL }) {
  const candidates = [...new Set([model, DEFAULT_MODEL, ...FALLBACK_MODELS])];
  let firstError;
  for (const candidate of candidates) {
    try {
      return { plan: await callModel({ imageBase64, mimeType, apiKey, model: candidate }), model: candidate };
    } catch (err) {
      if (!err.tryNextModel) throw err;
      // Prefer reporting a real outage/quota over "model not found" from a fallback.
      if (!firstError || firstError.status === 404) firstError = err;
    }
  }
  throw firstError;
}

async function callModel({ imageBase64, mimeType, apiKey, model }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: imageBase64 } }, { text: PROMPT }] }],
    // Gemini 3.x degrades with low temperature, so it's left at the default.
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: PLAN_SCHEMA },
  });

  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
      });
    } catch {
      throw new GeminiError('No hay conexión con Gemini. Revisa tu internet.');
    }
    if (res.ok || !TRANSIENT.has(res.status) || attempt >= MAX_ATTEMPTS) break;
    await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 500);
  }
  if (!res.ok) throw await errorFrom(res, model);

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('');
  if (!text) throw new GeminiError('Gemini no devolvió resultados. Intenta con una foto más clara.');
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError('No pude interpretar la respuesta de Gemini. Intenta de nuevo.');
  }
}
