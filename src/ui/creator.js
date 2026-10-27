// The character creator's panel: one page of the creation flow at a time,
// over the live world. While it is open it owns the keyboard and the rest of
// the page is inert.

import { ATTRIBUTE_NAMES, ATTRIBUTES, CLASSES, GENDERS, RACES, raceOf, RULES, UNSET } from '../character/catalog.js';
import { formatBirthday } from '../character/calendar.js';
import { Creation } from '../character/creation.js';
import { attributeCost, attributeTotals, cluesNeeded } from '../character/rules.js';

const FOCUSABLE = 'button, input, textarea';
const shown = (iso) => formatBirthday(iso).replace(/ AE$/, '');
// The idle outlaw stands about this many rows tall, and fills this much of
// the screen beside or above the panel.
export const FIGURE_ROWS = 20;
const FILL = 0.6;

// The camera's framing while the creator is open: the cell size, and how far
// from the screen centre the outlaw's middle sits (bias down, biasX right, as
// fractions of the screen) so it stands in the middle of the free area. A
// panel past 30 % of the width is a side panel with the free area to its
// left; otherwise it is a bottom sheet with the free area above.
export function previewFraming(width, height, panel, [minCell, maxCell]) {
  const side = panel.width > 0 && panel.left > 0.3 * width;
  const free = { width: side ? panel.left : width, height: !side && panel.height > 0 ? panel.top : height };
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
  // between `cells` [smallest, largest]; `onClose(character)` runs once it
  // shuts, with the character Create made.
  constructor({ root, outside = [], cells = [4.5, 24], onPreview = () => {}, onFrame = () => {}, onClose = () => {},
    win = window, doc = document }) {
    Object.assign(this, { root, outside, cells, onPreview, onFrame, onClose, win, doc, flow: null });
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
    this.live = this.el('p', { className: 'creator-live', role: 'status' });
    this.turn(true);
    this.refit();
  }

  close(character = null) {
    if (!this.flow) return;
    this.flow = null;
    this.root.replaceChildren();
    this.doc.body.classList.remove('creator-open');
    for (const node of this.outside) node.inert = false;
    this.onClose(character);
  }

  // Frames the outlaw again for the panel as laid out now, after a resize
  // or a turn of the phone. Pages keep the panel's size, so they don't.
  refit() {
    if (!this.flow) return;
    this.onFrame(previewFraming(this.win.innerWidth, this.win.innerHeight, this.form.getBoundingClientRect(), this.cells));
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
    Object.assign(this, { touched: false, note: null });
    this.onPreview(this.flow.draft.skin);
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
    this.form = this.el('form', { className: 'creator-panel', role: 'dialog', 'aria-modal': 'true',
      'aria-labelledby': 'creator-title', onsubmit: (event) => { event.preventDefault(); this.submit(); } },
    this.el('header', {}, this.el('p', { className: 'creator-counter', textContent: step }),
      this.el('h2', { id: 'creator-title', tabIndex: -1, textContent: page.title })),
    this.el('div', { className: 'creator-body' }, ...this.content(page)), this.message,
    this.el('footer', {}, back, this.next));
    this.live.textContent = counter ? `${step}: ${page.title}` : page.title;
    this.root.replaceChildren(this.form, this.live);
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
    this.onPreview(this.flow.draft.skin);
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
  // creation, and Tab wraps inside the panel.
  keydown(event) {
    if (!this.flow) return;
    event.stopImmediatePropagation();
    const nodes = [...this.form.querySelectorAll(FOCUSABLE)].filter((node) => !node.disabled);
    let to = null;
    if (event.key === 'Escape') event.preventDefault();
    else if (!this.root.contains(event.target)) to = this.first ?? this.next;
    else if (event.key === 'Tab' && event.target === (event.shiftKey ? nodes[0] : nodes.at(-1))) {
      to = event.shiftKey ? nodes.at(-1) : nodes[0];
    }
    if (!to) return;
    event.preventDefault();
    to.focus({ preventScroll: true });
  }
}
