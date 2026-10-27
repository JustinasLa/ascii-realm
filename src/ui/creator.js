// The character creator's panel: one page of the creation flow at a time,
// over the live world. While it is open it owns the keyboard and the rest of
// the page is inert.

import { ATTRIBUTE_NAMES, ATTRIBUTES, CLASSES, GENDERS, RACES, raceOf, RULES, UNSET } from '../character/catalog.js';
import { formatBirthday } from '../character/calendar.js';
import { Creation } from '../character/creation.js';
import { attributeCost, attributeTotals, cluesNeeded } from '../character/rules.js';
import { cleanSkin, LAYERS, OUTER, PALETTES, PRESETS } from '../character/skin.js';

const FOCUSABLE = 'button, input, textarea';
const shown = (iso) => formatBirthday(iso).replace(/ AE$/, '');
// The idle outlaw stands about this many rows tall, and fills this much of
// the screen beside or above the panel.
export const FIGURE_ROWS = 20;
const FILL = 0.6;
// A turn button turns the outlaw an eighth of a turn; a drag across the free
// area turns it a degree for each pixel.
const TURN_STEP = Math.PI / 4;
const DRAG_TURN = Math.PI / 180;
const REGION_NAMES = Object.freeze({ tone: 'Skin tone', hair: 'Hair', shirt: 'Shirt', hose: 'Hose', hood: 'Hood',
  jerkin: 'Jerkin', sleeves: 'Sleeves', bracers: 'Bracers and gloves', boots: 'Boots', cloak: 'Cloak' });
const LAYER_NAMES = Object.freeze({ hood: 'Hood up', jerkin: 'Jerkin', cloak: 'Cloak' });
// The root is the dialog, so the turn buttons beside the panel are in it.
const DIALOG = Object.freeze({ role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'creator-title' });

// The part of the screen the panel leaves free: left of a side panel (one
// past 30 % of the width), else above a bottom sheet.
function freeArea(width, height, panel) {
  const side = panel.width > 0 && panel.left > 0.3 * width;
  return { width: side ? panel.left : width, height: !side && panel.height > 0 ? panel.top : height };
}

// The camera's framing while the creator is open: the cell size, and how far
// from the screen centre the outlaw's middle sits (bias down, biasX right, as
// fractions of the screen) so it stands in the middle of the free area.
export function previewFraming(width, height, panel, [minCell, maxCell]) {
  const free = freeArea(width, height, panel);
  return { cell: Math.max(minCell, Math.min(maxCell, FILL * free.height / FIGURE_ROWS)),
    biasX: free.width / 2 / width - 0.5, bias: free.height / 2 / height - 0.5 };
}

// Whether a prop, or the part of it drawn at depth `y`, would hide the
// framed outlaw: it is drawn in front of the figure and its cells reach into
// the figure's box (`player.foliageBounds`). The creator leaves those out,
// wherever the outlaw stands, since the player can't step clear.
export function hidesPreview(prop, y, player) {
  const { bounds: b } = prop;
  const box = player.foliageBounds;
  if (!b || !box || y <= player.y) return false;
  const x0 = Math.floor(prop.x);
  const y0 = Math.floor(prop.y);
  return x0 + b.maxX >= box.x - box.rx && x0 + b.minX <= box.x + box.rx
    && y0 + b.maxY >= box.y - box.ry && y0 + b.minY <= box.y + box.ry;
}

export class CharacterCreator {
  // `outside` is made inert while the creator is open. `onPreview(skin)`
  // dresses the outlaw in the draft's skin; `onFrame(framing)` frames it
  // between `cells` [smallest, largest]; `onTurn(radians)` turns it;
  // `onClose(character)` runs once it shuts, with the character Create made.
  constructor({ root, outside = [], cells = [4.5, 24], onPreview = () => {}, onFrame = () => {}, onTurn = () => {},
    onClose = () => {}, win = window, doc = document }) {
    Object.assign(this, { root, outside, cells, onPreview, onFrame, onTurn, onClose, win, doc, flow: null });
    // On the window's capture phase, ahead of every game key.
    win.addEventListener('keydown', (event) => this.keydown(event), true);
    // The on-screen keyboard shrinks the visual viewport; on phones the
    // panel keeps to what is left, so its buttons stay above the keyboard.
    const viewport = win.visualViewport;
    const follow = () => {
      const style = doc.documentElement.style;
      style.setProperty('--creator-kb', `${Math.max(0, Math.round(win.innerHeight - viewport.height - viewport.offsetTop))}px`);
      style.setProperty('--creator-kb-top', `${Math.max(0, Math.round(viewport.offsetTop))}px`);
    };
    viewport?.addEventListener('resize', follow);
    viewport?.addEventListener('scroll', follow);
  }

  get isOpen() { return this.flow !== null; }

  // `options` go to the flow: `roster`, `now`, `start` (a page id), `draft`.
  open(options) {
    this.flow = new Creation(options);
    this.doc.body.classList.add('creator-open');
    for (const node of this.outside) node.inert = true;
    for (const [key, value] of Object.entries(DIALOG)) this.root.setAttribute(key, value);
    this.live = this.el('p', { className: 'creator-live', role: 'status' });
    this.stage = this.turner();
    this.turn(true);
    this.refit();
  }

  close(character = null) {
    if (!this.flow) return;
    this.flow = null;
    this.root.replaceChildren();
    for (const key of Object.keys(DIALOG)) this.root.removeAttribute(key);
    this.doc.body.classList.remove('creator-open');
    for (const node of this.outside) node.inert = false;
    this.onClose(character);
  }

  // Frames the outlaw again for the panel as laid out now, after a resize
  // or a turn of the phone. Pages keep the panel's size, so they don't.
  refit() {
    if (!this.flow) return;
    const { innerWidth: width, innerHeight: height } = this.win;
    const panel = this.form.getBoundingClientRect();
    const free = freeArea(width, height, panel);
    this.stage.style = `width: ${free.width}px; height: ${free.height}px`;
    this.onFrame(previewFraming(width, height, panel, this.cells));
  }

  // The free area over the outlaw: a drag across it turns the figure, and so
  // do its two buttons. Only the first finger down turns it, until it lifts.
  turner() {
    let drag = null;
    const button = (sign, text, label) => this.el('button', { type: 'button', textContent: text, 'aria-label': label,
      onclick: () => this.onTurn(sign * TURN_STEP) });
    const stage = this.el('div', { className: 'creator-stage',
      onpointerdown: (event) => {
        if (event.target !== stage || drag) return;
        drag = { id: event.pointerId, x: event.clientX };
        stage.setPointerCapture(event.pointerId);
      },
      onpointermove: (event) => {
        if (drag?.id !== event.pointerId) return;
        this.onTurn((event.clientX - drag.x) * DRAG_TURN);
        drag.x = event.clientX;
      } },
    this.el('div', { className: 'creator-turn' }, button(-1, '‹', 'Turn left'), button(1, '›', 'Turn right')));
    stage.onpointerup = stage.onpointercancel = (event) => { if (drag?.id === event.pointerId) drag = null; };
    return stage;
  }

  // Dresses the outlaw in the draft's skin, with the hood down while the
  // tone or hair is being picked, so the face shows.
  preview() {
    const { skin } = this.flow.draft;
    this.onPreview(this.peek ? cleanSkin({ ...skin, layers: { ...skin.layers, hood: false } }) : skin);
  }

  look(peek) {
    if (this.peek === peek) return;
    this.peek = peek;
    this.preview();
  }

  // An element; props the element has are set, the rest are attributes.
  el(tag, props = {}, ...children) {
    const node = this.doc.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key in node) node[key] = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }

  turn(moved) {
    if (!moved) return;
    Object.assign(this, { touched: false, note: null, peek: false });
    this.preview();
    this.render();
  }

  render(focusId = null) {
    const { flow } = this;
    const { page, counter } = flow;
    Object.assign(this, { first: null, problems: false, clue: null });
    this.win.clearTimeout(this.pause);
    const step = counter ? `Step ${counter.n} of ${counter.total}` : '';
    this.message = this.el('p', { className: 'creator-message', role: 'status' });
    this.next = this.el('button', { type: 'submit', className: 'creator-primary',
      textContent: page.kind === 'info' ? 'Continue' : page.kind === 'summary' ? 'Create character'
        : flow.returning ? 'Save and review' : 'Next' });
    const back = flow.index > 0 && page.kind !== 'info' ? this.el('button', { type: 'button', textContent: flow.returning ? 'Back to review' : 'Back',
      onclick: () => this.turn(flow.back()) }) : '';
    this.form = this.el('form', { className: 'creator-panel', onsubmit: (event) => { event.preventDefault(); this.submit(); } },
    this.el('header', {}, this.el('p', { className: 'creator-counter', textContent: step }),
      this.el('h2', { id: 'creator-title', tabIndex: -1, textContent: page.title })),
    this.el('div', { className: 'creator-body' }, ...this.content(page)), this.message,
    this.el('footer', {}, back, this.next));
    this.live.textContent = counter ? `${step}: ${page.title}` : page.title;
    this.root.replaceChildren(this.form, this.live, this.stage);
    this.refresh();
    ((focusId && this.doc.getElementById(focusId)) || this.first || this.next).focus({ preventScroll: true });
  }

  content(page) {
    if (page.kind === 'info') return page.lines.map((line) => this.el('p', { textContent: line }));
    if (page.id === 'name') return this.name();
    if (page.id === 'class') return this.choices('Class', CLASSES, 'class', (c) => [c.line]);
    if (page.id === 'race') return this.choices('Race', RACES, 'race', (r) => [...r.lines, `Maximum age ${r.maxAge}`]);
    if (page.id === 'age') return this.age();
    if (page.id === 'attributes') return this.attributes();
    if (page.id === 'description') return this.description();
    if (page.id === 'clues') return this.clues();
    if (page.id === 'skin') return this.skin();
    return this.summary();
  }

  // Next stays focusable while the step fails; pressing it shows why.
  // A typed clue is added instead, however the form was sent: Enter, a
  // phone keyboard's Done, or Next.
  submit() {
    if (this.clue?.value.trim()) return this.addClue();
    if (this.flow.page.kind === 'summary' && !this.flow.error) return this.create();
    if (this.flow.next()) return this.turn(true);
    this.touched = true;
    this.refresh();
    (this.first ?? this.next).focus({ preventScroll: true });
  }

  refresh() {
    const error = this.flow.error;
    this.next.setAttribute('aria-disabled', String(Boolean(error)));
    // The Summary lists its problems itself.
    this.message.textContent = [this.problems ? null : error, this.note].filter(Boolean).join(' ');
    this.message.dataset.state = error && this.touched ? 'error' : 'hint';
  }

  change(apply) {
    apply();
    this.touched = true;
    this.preview();
    this.refresh();
  }

  name() {
    const input = this.el('input', { id: 'creator-name', value: this.flow.sheet.name, maxLength: 96, autocomplete: 'off',
      autocapitalize: 'words', autocorrect: 'off', spellcheck: false, enterkeyhint: 'next',
      oninput: () => this.change(() => this.flow.set('name', input.value)) });
    this.first = input;
    return [this.el('label', { htmlFor: 'creator-name', textContent: 'Name · 3–24 letters' }), input];
  }

  // One paragraph, so Enter continues, even from phone keyboards that send
  // no Enter key; then the optional gender.
  description() {
    const { flow } = this;
    const { min, max } = RULES.description;
    const text = this.el('textarea', { id: 'creator-description', rows: 4, maxLength: 512, value: flow.sheet.description,
      autocapitalize: 'sentences', autocorrect: 'on', enterkeyhint: 'next',
      oninput: () => this.change(() => { flow.set('description', text.value); counted(); }),
      onbeforeinput: (event) => {
        if (event.inputType !== 'insertLineBreak' && event.inputType !== 'insertParagraph') return;
        event.preventDefault();
        this.submit();
      } });
    const [count, counted] = this.counter(text, () => `${flow.sheet.description.trim().length} / ${max} (at least ${min})`);
    const gender = this.choices('Gender (optional)', [...GENDERS, { id: null, name: UNSET }], 'gender', () => []);
    gender[0].className = 'creator-row';
    this.first = text;
    return [this.el('label', { htmlFor: 'creator-description', textContent: 'Appearance and manner' }), text, count, ...gender];
  }

  // Clues are added one at a time, each checked as it is added.
  clues() {
    const { flow } = this;
    const { min, max, most } = RULES.clues;
    const { clues } = flow.sheet;
    const full = clues.length >= most;
    const input = this.el('input', { id: 'creator-clue', maxLength: 96, autocomplete: 'off', autocapitalize: 'sentences',
      enterkeyhint: 'done', disabled: full, 'aria-label': 'New clue', oninput: () => counted() });
    const [count, counted] = this.counter(input, () => {
      const n = input.value.trim().length;
      return `${n}/${max}${n < min ? ` · need ${min - n} more` : n > max ? ` · ${n - max} over` : ''}`;
    });
    this.clue = input;
    this.first = full ? null : input;
    const remove = (i) => () => {
      flow.removeClue(i);
      this.redo(i < flow.sheet.clues.length ? `creator-remove${i}` : 'creator-clue');
    };
    return [this.el('p', { className: 'creator-counter', textContent: full ? 'Clue limit reached.'
      : `${clues.length} of ${cluesNeeded(flow.sheet)} required (at most ${most}) · ${min}–${max} characters each` }),
    this.el('div', { className: 'creator-stepper' }, input,
      this.el('button', { type: 'button', textContent: 'Add', disabled: full, onclick: () => this.addClue() })), count,
    this.el('ol', { className: 'creator-clues' }, ...clues.map((clue, i) => this.el('li', {}, this.el('span', { textContent: clue }),
      this.el('button', { type: 'button', id: `creator-remove${i}`, textContent: 'Remove', 'aria-label': `Remove clue ${i + 1}`,
        onclick: remove(i) }))))];
  }

  addClue() {
    const { ok, message } = this.flow.addClue(this.clue.value);
    if (ok) return this.redo('creator-clue');
    Object.assign(this, { touched: true, note: message });
    this.refresh();
  }

  // A count shown under `field` as it is typed. The field names it, so it
  // is read on focus, and it is announced once typing pauses for 300 ms, so
  // a screen reader isn't flooded. Returns the count and its update.
  counter(field, text) {
    const count = this.el('p', { id: `${field.id}-count`, className: 'creator-counter', textContent: text() });
    field.setAttribute('aria-describedby', count.id);
    return [count, () => {
      count.textContent = text();
      this.win.clearTimeout(this.pause);
      this.pause = this.win.setTimeout(() => { this.live.textContent = count.textContent; }, 300);
    }];
  }

  // A preset, then a swatch for each region and the layers worn. Each pick
  // repaints the outlaw at once and updates every group's legend and mark.
  // A tap that neither focuses nor changes a swatch still shows the face.
  skin() {
    const { flow } = this;
    const syncs = [];
    const pick = (apply, peek) => () => {
      this.peek = peek;
      this.change(apply);
      for (const sync of syncs) sync();
    };
    const group = (key, title, items, picked, apply, peek = false) => {
      const legend = this.el('legend');
      const inputs = items.map((item) => this.el('input', { type: 'radio', name: `creator-${key}`, id: `creator-${key}-${item.id}`,
        'aria-label': item.name, onfocus: () => this.look(peek), onchange: pick(() => apply(item.id), peek) }));
      syncs.push(() => {
        const id = picked();
        legend.textContent = `${title}: ${items.find((item) => item.id === id)?.name ?? 'Custom'}`;
        inputs.forEach((input, i) => { input.checked = items[i].id === id; });
      });
      const swatch = key !== 'preset';
      return [inputs, this.el('fieldset', { className: swatch ? 'creator-swatches' : 'creator-row', onclick: () => this.look(peek) }, legend, ...items.map((item, i) =>
        this.el('label', { className: swatch ? 'creator-swatch' : 'creator-card' }, inputs[i],
          swatch ? this.el('span', { style: `background: rgb(${item.color})` }) : this.el('b', { textContent: item.name }))))];
    };
    const regions = (list, peek) => list.map((region) => group(region, REGION_NAMES[region], PALETTES[region],
      () => flow.draft.skin[region], (id) => flow.setRegion(region, id), peek)[1]);
    const [presets, presetSet] = group('preset', 'Preset', PRESETS, () => flow.preset?.id, (id) => flow.wearPreset(id));
    const layers = LAYERS.map((layer) => {
      const input = this.el('input', { type: 'checkbox', role: 'switch', id: `creator-layer-${layer}`,
        onfocus: () => this.look(false), onchange: pick(() => flow.setLayer(layer, input.checked), false) });
      syncs.push(() => { input.checked = flow.draft.skin.layers[layer]; });
      return this.el('label', { className: 'creator-card' }, input, this.el('b', { textContent: LAYER_NAMES[layer] }));
    });
    const body = regions(['tone', 'hair'], true);
    const clothes = regions(['shirt', 'hose', ...OUTER], false);
    for (const sync of syncs) sync();
    this.first = presets.find((input) => input.checked) ?? presets[0];
    this.note = 'Optional: you can change your skin at any time.';
    return [presetSet, this.el('h3', { textContent: 'Body' }),
      this.el('p', { className: 'creator-counter', textContent: 'The hood comes down while you pick these, so the face shows.' }),
      ...body, this.el('h3', { textContent: 'Clothes' }), ...clothes, this.el('h3', { textContent: 'Layers' }),
      this.el('div', { className: 'creator-row' }, ...layers)];
  }

  // Every row with its Edit, and every step checked again before Create.
  summary() {
    const { flow } = this;
    const edit = (step) => () => {
      this.editing = step;
      flow.edit(step);
      this.turn(true);
    };
    const problems = flow.review;
    const { ok, opensAt } = flow.allowed;
    if (!ok && opensAt) this.note = `Opens ${new Date(opensAt).toLocaleString()}.`;
    const edits = {};
    const rows = flow.rows.flatMap(({ step, label, value }) => [this.el('dt', {}, label,
      edits[step] = this.el('button', { type: 'button', textContent: 'Edit', 'aria-label': `Edit ${label.toLowerCase()}`,
        onclick: edit(step) })), this.el('dd', { textContent: value })]);
    const alert = problems.length ? this.el('div', { className: 'creator-review', role: 'alert', tabIndex: -1 },
      this.el('p', { textContent: 'Review these steps before creating your character:' }),
      ...problems.map(({ step, label, message }) => this.el('p', {},
        this.el('button', { type: 'button', textContent: `Review ${label}`, onclick: edit(step) }), ` ${message}`))) : '';
    this.problems = Boolean(alert);
    // Focus goes to the problems, or back to the row just edited, else Create.
    this.first = alert || edits[this.editing] || null;
    this.editing = null;
    return [alert, this.el('dl', { className: 'creator-summary' }, ...rows)];
  }

  // Create is the player's first tap: play starts inside it. Another tab
  // may have taken the name or the last slot meanwhile, which the Summary
  // then shows.
  create() {
    const result = this.flow.create();
    if (result.ok) return this.close(result.character);
    this.redo(null, result.errors || result.reason === this.flow.error ? null : result.reason);
  }

  // A named radio group of cards; nothing is picked until the player picks.
  choices(legend, list, field, lines) {
    const inputs = list.map((item) => this.el('input', { type: 'radio', name: field, value: item.id,
      checked: this.flow.sheet[field] === item.id, onchange: () => this.change(() => this.flow.set(field, item.id)) }));
    this.first = inputs.find((input) => input.checked) ?? inputs[0];
    return [this.el('fieldset', {}, this.el('legend', { textContent: legend }), ...list.map((item, i) =>
      this.el('label', { className: 'creator-card' }, inputs[i], this.el('b', { textContent: item.name, style: `color: ${item.colour ?? 'inherit'}` }),
        ...lines(item).map((line) => this.el('span', { textContent: line })))))];
  }

  age() {
    const { flow } = this;
    const race = raceOf(flow.sheet.race);
    const max = race?.maxAge ?? RULES.minAge;
    const born = () => `Born ${formatBirthday(flow.sheet.birthday)}`;
    const step = (delta, text, label) => this.el('button', { type: 'button', id: `creator-age${delta}`, textContent: text,
      'aria-label': label, onclick: () =>
        flow.setAge(Math.max(RULES.minAge, Math.min(max, flow.age + delta))) && this.redo(`creator-age${delta}`, born()) });
    const steps = [step(-1, '−', 'Decrease age'), step(1, '+', 'Increase age')];
    const limit = () => { [steps[0].disabled, steps[1].disabled] = [flow.age <= RULES.minAge, flow.age >= max]; };
    limit();
    // Each field shows what the other one's valid input gives, and the
    // stepper follows a valid age.
    const typed = (type, other, value) => () => this.change(() => {
      type();
      const valid = !Object.keys(flow.pending).length;
      if (valid) { other.value = value(); limit(); }
      this.note = valid ? born() : null;
    });
    const age = this.el('input', { id: 'creator-age', value: String(flow.age ?? ''), inputmode: 'numeric', pattern: '[0-9]*', 'aria-label': 'Age' });
    const birthday = this.el('input', { id: 'creator-birthday', value: shown(flow.sheet.birthday), inputmode: 'decimal',
      autocomplete: 'off', placeholder: 'DD.MM.YYYY' });
    age.oninput = typed(() => flow.typeAge(age.value), birthday, () => shown(flow.sheet.birthday));
    birthday.oninput = typed(() => flow.typeBirthday(birthday.value), age, () => String(flow.age));
    this.first = age;
    return [this.el('fieldset', {}, this.el('legend', { textContent: `Age (${RULES.minAge} to ${max} for ${race?.name ?? 'your race'})` }),
      this.el('div', { className: 'creator-stepper' }, steps[0], age, steps[1]),
      this.el('label', { htmlFor: 'creator-birthday', textContent: 'Birthday (AE)' }), birthday)];
  }

  attributes() {
    const { flow } = this;
    const totals = attributeTotals(flow.sheet);
    const race = raceOf(flow.sheet.race);
    const left = flow.left;
    const rows = ATTRIBUTES.map((key) => {
      const rank = flow.sheet.attributes[key];
      const name = ATTRIBUTE_NAMES[key];
      const button = (delta, text, label) => {
        const blocked = flow.rankBlock(key, delta);
        return this.el('button', { type: 'button', id: `creator-${key}${delta}`, textContent: text, 'aria-label': label,
          'aria-disabled': String(Boolean(blocked)), onfocus: () => { this.note = blocked ?? label; this.refresh(); },
          onclick: () => flow.rank(key, delta) && this.redo(`creator-${key}${delta}`) });
      };
      return this.el('div', { className: 'creator-attribute' }, this.el('span', { textContent: name }),
        button(-1, '−', `Lower ${name} to rank ${rank - 1}, refunds ${attributeCost(rank) - attributeCost(rank - 1)} points`),
        this.el('span', { textContent: `Rank ${rank}` }),
        button(1, '+', `Raise ${name} to rank ${rank + 1}, costs ${attributeCost(rank + 1) - attributeCost(rank)} points`),
        this.el('span', { textContent: `Total ${totals[key]}` }));
    });
    this.first = rows[0].children[3];
    return [this.el('p', { className: 'creator-counter',
      textContent: `${left > 0 ? `${left} points left` : left ? `${-left} points over budget` : 'All points assigned'}${
        race ? ` · ${race.name} +${RULES.raceBonus} to each` : ''}` }), ...rows];
  }

  // Draws the page again after a change, keeping focus on the control used.
  redo(focusId, note = null) {
    Object.assign(this, { touched: true, note });
    this.render(focusId);
  }

  // Every key stops here while the creator is open, so no game key runs;
  // typing, radio arrows and buttons still work. Esc can't dismiss the first
  // creation, and Tab wraps inside the panel. A radio group is one Tab stop,
  // entered at its checked radio, if any.
  keydown(event) {
    if (!this.flow) return;
    event.stopImmediatePropagation();
    const nodes = [...this.root.querySelectorAll(FOCUSABLE)].filter((node) => !node.disabled);
    const group = (node) => (node.type === 'radio' ? nodes.filter((n) => n.type === 'radio' && n.name === node.name) : [node]);
    const [from, wrap] = event.shiftKey ? [nodes[0], nodes.at(-1)] : [nodes.at(-1), nodes[0]];
    let to = null;
    if (event.key === 'Escape') event.preventDefault();
    else if (!this.root.contains(event.target)) to = this.first ?? this.next;
    else if (event.key === 'Tab' && group(from).includes(event.target)) to = group(wrap).find((n) => n.checked) ?? wrap;
    if (!to) return;
    event.preventDefault();
    to.focus({ preventScroll: true });
  }
}
