import {
  DAYS, SLOTS, DEPARTMENTS, aggregate, groupByDepartment, toPlainText, shoppingLine, formatParts, mergeByName,
  parseIngredientLine, ingredientToLine, normalizeName, normalizeUnit, guessDepartment, itemKey, capitalize,
} from './aggregate.js';
import { extractPlan, DEFAULT_MODEL } from './gemini.js';
import { buildSamplePlan } from './sample-plan.js';

const KEYS = { state: 'mealplan.state.v1', settings: 'mealplan.settings.v1', staples: 'mealplan.staples.v1' };

const app = document.getElementById('app');
const settingsDialog = document.getElementById('settings');

const load = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

let settings = { apiKey: '', model: DEFAULT_MODEL, ...load(KEYS.settings, {}) };
if (settings.model === 'gemini-2.5-flash') settings.model = DEFAULT_MODEL;
const staples = new Set(load(KEYS.staples, []));
let state = load(KEYS.state, null) ?? freshState();
// Older saves keyed the pantry by "name|unit"; rebuild the queue by name.
if (state.queue.some((k) => k.includes('|'))) {
  state.queue = mergeByName(state.items).filter((i) => !staples.has(i.key)).map((i) => i.key);
  state.decisions = {};
  state.index = 0;
  if (state.step === 'list') state.step = 'pantry';
}
let image = null; // { url, base64, mimeType } — kept in memory only

function freshState() {
  return { step: 'upload', plan: null, items: [], queue: [], index: 0, decisions: {}, checked: {}, createdAt: new Date().toISOString() };
}

const persist = () => save(KEYS.state, state);

function go(step) {
  state.step = step;
  persist();
  render();
  window.scrollTo(0, 0);
}

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// ---------- Stepper ----------

const listReady = () => state.items.length > 0 && state.queue.every((k) => state.decisions[k]);

function renderStepper() {
  const reachable = { upload: true, review: !!state.plan, pantry: state.queue.length > 0, list: listReady() };
  for (const btn of document.querySelectorAll('#stepper button')) {
    const step = btn.dataset.step;
    btn.disabled = !reachable[step];
    btn.classList.toggle('active', step === state.step);
    btn.toggleAttribute('aria-current', step === state.step);
  }
}

document.getElementById('stepper').addEventListener('click', (e) => {
  const step = e.target.closest('button[data-step]')?.dataset.step;
  if (step && step !== state.step) go(step);
});

// ---------- Step 1: upload ----------

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo abrir la imagen. Usa una foto JPG o PNG.'));
    };
    img.src = url;
  });
}

async function prepareImage(file, maxSide = 1600) {
  const { img, url } = await loadImage(file);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return { url, mimeType: 'image/jpeg', base64: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] };
}

function normalizePlan(raw) {
  const byDay = new Map((raw?.days ?? []).map((d) => [d.day, d]));
  return {
    days: DAYS.map((day) => {
      const meals = byDay.get(day)?.meals ?? [];
      return {
        day,
        meals: SLOTS.map((slot) => {
          const m = meals.find((x) => x.slot === slot) ?? {};
          return {
            slot,
            title: m.title ?? '',
            crossedOut: !!m.crossedOut,
            ingredients: (m.ingredients ?? [])
              .filter((i) => i?.name)
              .map((i) => ({
                name: String(i.name).trim(),
                qty: typeof i.qty === 'number' ? i.qty : null,
                unit: i.unit || 'pz',
                department: guessDepartment(i.name) ?? (DEPARTMENTS.includes(i.department) ? i.department : 'Otros'),
              })),
          };
        }),
      };
    }),
  };
}

function startReview(plan) {
  state = { ...freshState(), plan: normalizePlan(plan) };
  go('review');
}

function renderUpload() {
  const status = h('p', { class: 'status', role: 'status' });
  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle('error', isError);
  };
  const preview = h('img', { class: 'preview', alt: 'Vista previa del plan', hidden: !image, src: image?.url });
  const readBtn = h('button', { class: 'btn primary big', disabled: !image, onClick: read }, 'Leer plan con IA');

  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*',
    onChange: async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        if (image) URL.revokeObjectURL(image.url);
        image = await prepareImage(file);
        preview.src = image.url;
        preview.hidden = false;
        readBtn.disabled = false;
        setStatus('');
      } catch (err) {
        setStatus(err.message, true);
      }
    },
  });

  async function read() {
    if (!settings.apiKey) {
      setStatus('Primero agrega tu clave de API de Gemini en Ajustes.', true);
      openSettings();
      return;
    }
    readBtn.disabled = true;
    setStatus('Leyendo tu plan… puede tardar 10–30 segundos.');
    try {
      const { plan: result, model } = await extractPlan({ ...image, imageBase64: image.base64, apiKey: settings.apiKey, model: settings.model });
      if (model !== settings.model) {
        settings = { ...settings, model };
        save(KEYS.settings, settings);
      }
      const found = (result?.days ?? []).some((d) => d.meals?.some((m) => m.ingredients?.length));
      if (!found) throw new Error('No encontré comidas en la imagen. ¿Es una foto clara del plan completo?');
      startReview(result);
    } catch (err) {
      setStatus(err.message, true);
      readBtn.disabled = false;
    }
  }

  return h('section', { class: 'stack' },
    h('div', { class: 'card stack' },
      h('h2', {}, 'Sube la foto de tu plan semanal'),
      h('p', { class: 'muted' }, 'Tabla con 7 días × Desayuno, Colación 1, Comida, Colación 2 y Cena. Las comidas tachadas no se contarán.'),
      h('label', { class: 'dropzone' }, 'Toca para tomar o elegir una foto', fileInput),
      preview,
      readBtn,
      status,
    ),
    h('div', { class: 'card row' },
      h('button', { class: 'btn', onClick: () => startReview({}) }, 'Capturar manualmente'),
      h('button', { class: 'btn', onClick: () => startReview(buildSamplePlan()) }, 'Usar plan de ejemplo'),
    ),
  );
}

// ---------- Step 2: review ----------

function linesToIngredients(text, previous) {
  const hints = new Map(previous.map((i) => [normalizeName(i.name), i.department]));
  return text
    .split('\n')
    .map(parseIngredientLine)
    .filter(Boolean)
    .map((i) => ({ ...i, department: guessDepartment(i.name) ?? hints.get(normalizeName(i.name)) ?? 'Otros' }));
}

function renderReview() {
  const summary = h('p', { class: 'muted' });
  const unitWarning = h('p', { class: 'hint warn', hidden: true });
  const updateSummary = () => {
    const meals = state.plan.days.flatMap((d) => d.meals);
    const crossed = meals.filter((m) => m.crossedOut).length;
    const withFood = meals.filter((m) => !m.crossedOut && m.ingredients.length).length;
    summary.textContent = `${withFood} comidas se contarán · ${crossed} tachadas`;

    const byName = new Map();
    for (const item of aggregate(state.plan)) {
      const n = normalizeName(item.name);
      byName.set(n, [...(byName.get(n) ?? []), item]);
    }
    const mixed = [...byName.values()].filter((list) => list.length > 1);
    unitWarning.hidden = !mixed.length;
    unitWarning.textContent = mixed.length
      ? 'Revisa unidades mezcladas: ' + mixed
          .map((list) => `${capitalize(list[0].name)} (${list.map((i) => `${i.unit} en ${i.uses.join(', ')}`).join(' / ')})`)
          .join('; ')
      : '';
  };
  updateSummary();

  const mealEditor = (meal) => {
    const wrap = h('div', { class: `meal${meal.crossedOut ? ' crossed' : ''}` });
    const textarea = h('textarea', {
      rows: Math.max(2, meal.ingredients.length + 1),
      value: meal.ingredients.map(ingredientToLine).join('\n'),
      placeholder: 'Un ingrediente por línea, p. ej. 250 g de carne de res',
      'aria-label': `Ingredientes: ${meal.slot}`,
      onInput: () => {
        meal.ingredients = linesToIngredients(textarea.value, meal.ingredients);
        persist();
        updateSummary();
      },
    });
    wrap.append(
      h('div', { class: 'meal-head' },
        h('span', { class: 'slot' }, meal.slot),
        h('input', {
          type: 'text',
          value: meal.title,
          placeholder: 'Platillo',
          'aria-label': `Platillo: ${meal.slot}`,
          onInput: (e) => { meal.title = e.target.value; persist(); },
        }),
        h('label', { class: 'row' },
          h('input', {
            type: 'checkbox',
            checked: meal.crossedOut,
            onChange: (e) => {
              meal.crossedOut = e.target.checked;
              wrap.classList.toggle('crossed', meal.crossedOut);
              persist();
              updateSummary();
            },
          }),
          'Tachado',
        ),
      ),
      textarea,
    );
    return wrap;
  };

  const calculate = () => {
    state.items = aggregate(state.plan);
    const names = mergeByName(state.items);
    const keys = new Set(names.map((i) => i.key));
    state.decisions = Object.fromEntries(Object.entries(state.decisions).filter(([k]) => keys.has(k)));
    state.queue = names.filter((i) => !staples.has(i.key)).map((i) => i.key);
    state.index = 0;
    state.checked = {};
    if (!state.items.length) {
      summary.textContent = 'No hay ingredientes para calcular. Agrega al menos uno.';
      summary.classList.add('error');
      return;
    }
    go(state.queue.length ? 'pantry' : 'list');
  };

  return h('section', {},
    h('div', { class: 'card' },
      h('h2', {}, 'Revisa lo que leyó la IA'),
      h('p', { class: 'muted' }, 'Corrige cantidades y marca como "Tachado" lo que no vas a comer. Formato: "cantidad unidad de ingrediente".'),
    ),
    state.plan.days.map((day) =>
      h('details', { class: 'card day', open: true },
        h('summary', {}, day.day),
        day.meals.map(mealEditor),
      ),
    ),
    h('div', { class: 'sticky-actions stack' },
      unitWarning,
      summary,
      h('button', { class: 'btn primary big', onClick: calculate }, 'Calcular ingredientes'),
    ),
  );
}

// ---------- Step 3: pantry ----------

function next() {
  if (state.index + 1 >= state.queue.length) {
    go('list');
  } else {
    state.index++;
    persist();
    render();
  }
}

function renderPantry() {
  state.index = Math.min(state.index, state.queue.length - 1);
  const names = mergeByName(state.items);
  const item = names.find((i) => i.key === state.queue[state.index]);
  const decision = state.decisions[item.key];
  const skipped = names.length - state.queue.length;

  const decide = (status, replacement) => {
    state.decisions[item.key] = { status, replacement };
    next();
  };

  const replaceInput = h('input', { type: 'text', value: ingredientToLine({ name: item.name, ...item.parts[0] }), 'aria-label': 'Reemplazo' });
  const replaceError = h('p', { class: 'error', role: 'alert' });
  const replaceForm = h('div', { class: 'card stack', hidden: true },
    h('label', { class: 'field' }, 'Reemplazar por (cantidad, unidad e ingrediente)', replaceInput),
    replaceError,
    h('div', { class: 'row' },
      h('button', {
        class: 'btn primary',
        onClick: () => {
          const parsed = parseIngredientLine(replaceInput.value);
          if (!parsed) {
            replaceError.textContent = 'Escribe el ingrediente, p. ej. "500 g de pechuga de pollo".';
            return;
          }
          decide('need', parsed);
        },
      }, 'Agregar reemplazo a la lista'),
      h('button', { class: 'btn', onClick: () => { replaceForm.hidden = true; } }, 'Cancelar'),
    ),
  );

  const choice = (status, label, extra = {}) =>
    h('button', {
      class: `btn${decision?.status === status && !decision?.replacement ? ' selected' : ''}${extra.primary ? ' primary' : ''}`,
      onClick: () => decide(status),
    }, label);

  const decisionText = decision
    ? decision.replacement
      ? `Elegiste: reemplazar por ${ingredientToLine(decision.replacement)}`
      : `Elegiste: ${decision.status === 'have' ? 'lo tengo' : 'lo necesito'}`
    : '';

  return h('section', {},
    h('div', { class: 'card pantry-card stack' },
      h('progress', { max: state.queue.length, value: state.index }),
      h('p', { class: 'muted' }, `${state.index + 1} de ${state.queue.length}${skipped ? ` · ${skipped} básicos omitidos` : ''}`),
      h('h2', {}, capitalize(item.name)),
      h('p', { class: 'amount' }, formatParts(item.parts) || 'Al gusto'),
      h('p', { class: 'muted' }, `Se usa en: ${item.uses.join(', ')}`),
      decisionText && h('p', { class: 'muted' }, decisionText),
      h('p', {}, '¿Ya lo tienes en casa?'),
      h('div', { class: 'pantry-actions' },
        choice('have', 'Lo tengo'),
        choice('need', 'Lo necesito', { primary: true }),
        h('button', {
          class: `btn${decision?.replacement ? ' selected' : ''}`,
          onClick: () => { replaceForm.hidden = false; replaceInput.focus(); },
        }, 'Reemplazar'),
        h('button', {
          class: 'btn',
          title: 'No volveré a preguntar por este ingrediente',
          onClick: () => {
            staples.add(normalizeName(item.name));
            save(KEYS.staples, [...staples]);
            decide('have');
          },
        }, 'Siempre lo tengo'),
      ),
    ),
    replaceForm,
    h('div', { class: 'row' },
      h('button', {
        class: 'btn ghost',
        disabled: state.index === 0,
        onClick: () => { state.index--; persist(); render(); },
      }, '← Anterior'),
    ),
  );
}

// ---------- Step 4: shopping list ----------

function buildShoppingGroups() {
  const merged = new Map();
  const replaced = new Set();
  for (const item of state.items) {
    const nameKey = normalizeName(item.name);
    const d = state.decisions[nameKey];
    if (d?.status !== 'need') continue;
    let entry = { ...item, department: guessDepartment(item.name) ?? item.department };
    if (d.replacement) {
      // One replacement covers every unit variant of the original ingredient.
      if (replaced.has(nameKey)) continue;
      replaced.add(nameKey);
      const { unit, factor } = normalizeUnit(d.replacement.unit);
      const name = d.replacement.name;
      entry = {
        key: itemKey(name, unit),
        name,
        qty: d.replacement.qty == null ? null : d.replacement.qty * factor,
        unit,
        department: guessDepartment(name) ?? item.department,
      };
    }
    const existing = merged.get(entry.key);
    if (!existing) merged.set(entry.key, entry);
    else if (entry.qty != null) existing.qty = (existing.qty ?? 0) + entry.qty;
  }
  return groupByDepartment(mergeByName([...merged.values()]));
}

function renderList() {
  const groups = buildShoppingGroups();
  const date = new Date(state.createdAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
  const title = `Lista de compras – semana del ${date}`;
  const text = toPlainText(groups, title);
  const feedback = h('p', { class: 'muted', role: 'status' });
  const pre = h('pre', { class: 'export' }, text);
  const exportBox = h('details', {}, h('summary', {}, 'Ver texto para copiar'), pre);

  // Fallback for when the async Clipboard API is blocked (e.g. after the share sheet steals focus).
  const legacyCopy = () => {
    exportBox.open = true;
    const range = document.createRange();
    range.selectNodeContents(pre);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return document.execCommand('copy');
  };

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopy();
    }
    feedback.textContent = ok
      ? 'Copiado. Pégalo en Samsung Notes, Keep o donde prefieras.'
      : 'No se pudo copiar automáticamente; el texto de abajo ya está seleccionado, usa Cmd/Ctrl+C.';
  };
  const share = async () => {
    try {
      await navigator.share({ title, text });
    } catch (err) {
      if (err.name !== 'AbortError') feedback.textContent = 'No se pudo compartir desde este dispositivo; usa "Copiar lista".';
    }
  };
  const newWeek = () => {
    if (!confirm('¿Empezar una semana nueva? Se borrará el plan actual.')) return;
    if (image) URL.revokeObjectURL(image.url);
    image = null;
    state = freshState();
    go('upload');
  };

  const itemRow = (item) => {
    const li = h('li', { class: state.checked[item.key] ? 'done' : '' });
    li.append(h('label', {},
      h('input', {
        type: 'checkbox',
        checked: !!state.checked[item.key],
        onChange: (e) => {
          state.checked[item.key] = e.target.checked;
          li.classList.toggle('done', e.target.checked);
          persist();
        },
      }),
      h('span', {}, shoppingLine(item)),
    ));
    return li;
  };

  const count = groups.reduce((n, [, items]) => n + items.length, 0);

  return h('section', {},
    h('div', { class: 'card stack' },
      h('h2', {}, title),
      count
        ? h('div', { class: 'row' },
            h('button', { class: 'btn primary', onClick: copy }, 'Copiar lista'),
            'share' in navigator && h('button', { class: 'btn', onClick: share }, 'Compartir'),
          )
        : h('p', {}, 'No necesitas comprar nada esta semana.'),
      feedback,
    ),
    count > 0 && h('div', { class: 'card shopping' },
      groups.map(([dept, items]) => [h('h3', {}, dept), h('ul', {}, items.map(itemRow))]),
    ),
    count > 0 && h('div', { class: 'card' }, exportBox),
    h('div', { class: 'row' },
      state.queue.length > 0 && h('button', { class: 'btn', onClick: () => { state.index = 0; go('pantry'); } }, 'Revisar despensa otra vez'),
      h('button', { class: 'btn danger', onClick: newWeek }, 'Nueva semana'),
    ),
  );
}

// ---------- Settings ----------

function renderStaples() {
  const list = document.getElementById('staples-list');
  list.replaceChildren(
    ...(staples.size
      ? [...staples].sort().map((s) =>
          h('li', {}, capitalize(s), h('button', {
            type: 'button',
            class: 'btn ghost',
            onClick: () => { staples.delete(s); save(KEYS.staples, [...staples]); renderStaples(); },
          }, 'Quitar')))
      : [h('li', { class: 'muted' }, 'Ninguno todavía. Usa "Siempre lo tengo" en la despensa.')]),
  );
}

function openSettings() {
  document.getElementById('api-key').value = settings.apiKey;
  document.getElementById('model').value = settings.model;
  renderStaples();
  settingsDialog.showModal();
}

document.getElementById('open-settings').addEventListener('click', openSettings);
document.getElementById('forget-key').addEventListener('click', () => {
  document.getElementById('api-key').value = '';
});
settingsDialog.addEventListener('close', () => {
  if (settingsDialog.returnValue !== 'save') return;
  settings = {
    apiKey: document.getElementById('api-key').value.trim(),
    model: document.getElementById('model').value.trim() || DEFAULT_MODEL,
  };
  save(KEYS.settings, settings);
});

// ---------- Render ----------

const SCREENS = { upload: renderUpload, review: renderReview, pantry: renderPantry, list: renderList };

function render() {
  if (state.step === 'review' && !state.plan) state.step = 'upload';
  if (state.step === 'pantry' && !state.queue.length) state.step = state.items.length ? 'list' : 'upload';
  if (state.step === 'list' && !listReady()) state.step = state.plan ? 'review' : 'upload';
  renderStepper();
  app.replaceChildren(SCREENS[state.step]?.() ?? renderUpload());
}

render();
