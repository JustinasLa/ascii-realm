// The character creator's panel: one page of the creation flow at a time,
// over the live world. While it is open it owns the keyboard and the rest of
// the page is inert.

import { ATTRIBUTE_NAMES, ATTRIBUTES, CLASSES, RACES, raceOf, RULES } from '../character/catalog.js';
import { formatBirthday } from '../character/calendar.js';
import { Creation } from '../character/creation.js';
import { attributeCost, attributeTotals } from '../character/rules.js';

const FOCUSABLE = 'button, input, textarea';
const shown = (iso) => formatBirthday(iso).replace(/ AE$/, '');

export class CharacterCreator {
  // `outside` is made inert while the creator is open. `onPreview(skin)`
  // dresses the outlaw in the draft's skin; `onClose` runs once it shuts.
  constructor({ root, outside = [], onPreview = () => {}, onClose = () => {}, win = window, doc = document }) {
    Object.assign(this, { root, outside, onPreview, onClose, doc, flow: null });
    // On the window's capture phase, ahead of every game key.
    win.addEventListener('keydown', (event) => this.keydown(event), true);
  }

  get isOpen() { return this.flow !== null; }

  // `options` go to the flow: `roster`, `now`, `start` (a page id), `draft`.
  open(options) {
    this.flow = new Creation(options);
    this.doc.body.classList.add('creator-open');
    for (const node of this.outside) node.inert = true;
    this.live = this.el('p', { className: 'creator-live', role: 'status' });
    this.turn(true);
  }

  close() {
    if (!this.flow) return;
    this.flow = null;
    this.root.replaceChildren();
    this.doc.body.classList.remove('creator-open');
    for (const node of this.outside) node.inert = false;
    this.onClose();
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
    this.first = null;
    const step = counter ? `Step ${counter.n} of ${counter.total}` : '';
    this.message = this.el('p', { className: 'creator-message', role: 'status' });
    this.next = this.el('button', { type: 'submit', className: 'creator-primary',
      textContent: page.kind === 'info' ? 'Continue' : flow.returning ? 'Save and review' : 'Next' });
    const back = flow.index > 0 ? this.el('button', { type: 'button', textContent: flow.returning ? 'Back to review' : 'Back',
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
    return [this.el('p', { textContent: 'This page comes in a later update.' })];
  }

  // Next stays focusable while the step fails; pressing it shows why.
  submit() {
    if (this.flow.next()) return this.turn(true);
    this.touched = true;
    this.refresh();
    (this.first ?? this.next).focus({ preventScroll: true });
  }

  refresh() {
    const error = this.flow.error;
    this.next.setAttribute('aria-disabled', String(Boolean(error)));
    this.message.textContent = [error, this.note].filter(Boolean).join(' ');
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
      'aria-label': label, disabled: delta < 0 ? flow.age <= RULES.minAge : flow.age >= max, onclick: () =>
        flow.setAge(Math.max(RULES.minAge, Math.min(max, flow.age + delta))) && this.redo(`creator-age${delta}`, born()) });
    // Each field shows what the other one's valid input gives.
    const typed = (type, other, value) => () => this.change(() => {
      type();
      const valid = !Object.keys(flow.pending).length;
      if (valid) other.value = value();
      this.note = valid ? born() : null;
    });
    const age = this.el('input', { id: 'creator-age', value: String(flow.age ?? ''), inputmode: 'numeric', pattern: '[0-9]*', 'aria-label': 'Age' });
    const birthday = this.el('input', { id: 'creator-birthday', value: shown(flow.sheet.birthday), inputmode: 'decimal',
      autocomplete: 'off', placeholder: 'DD.MM.YYYY' });
    age.oninput = typed(() => flow.typeAge(age.value), birthday, () => shown(flow.sheet.birthday));
    birthday.oninput = typed(() => flow.typeBirthday(birthday.value), age, () => String(flow.age));
    this.first = age;
    return [this.el('fieldset', {}, this.el('legend', { textContent: `Age (${RULES.minAge} to ${max} for ${race?.name ?? 'your race'})` }),
      this.el('div', { className: 'creator-stepper' }, step(-1, '−', 'Decrease age'), age, step(1, '+', 'Increase age')),
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
