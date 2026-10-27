import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleDraft } from '../src/character/creation.js';
import { Roster } from '../src/character/roster.js';
import { DEFAULT_SKIN } from '../src/character/skin.js';
import { CharacterCreator } from '../src/ui/creator.js';

const START = new Date(2026, 9, 26, 12).getTime();

// Just enough of the DOM for the panel: elements with the properties it
// sets, attributes for the rest, focus, and a tree to search.
class Node {
  constructor(doc, tag) {
    Object.assign(this, { doc, tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: new Map(), dataset: {},
      className: '', id: '', type: '', name: '', value: '', checked: false, disabled: false, tabIndex: 0, htmlFor: '',
      maxLength: -1, autocomplete: '', autocapitalize: '', spellcheck: true, placeholder: '', pattern: '', style: '',
      inert: false, onclick: null, oninput: null, onchange: null, onsubmit: null, onfocus: null, text: '' });
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
  }

  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === 'string' ? Object.assign(new Node(this.doc, '#text'), { text: node }) : node;
      child.parentNode = this;
      this.children.push(child);
    }
  }
  replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  focus(options) {
    assert.deepEqual(options, { preventScroll: true });
    this.doc.activeElement = this;
    this.onfocus?.();
  }
  contains(node) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }
  * walk() { for (const child of this.children) { yield child; yield* child.walk(); } }
  querySelectorAll(selector) {
    assert.equal(selector, 'button, input, textarea');
    return [...this.walk()].filter((node) => ['BUTTON', 'INPUT', 'TEXTAREA'].includes(node.tagName));
  }
  find(predicate) { return [...this.walk()].filter(predicate); }
  click() { this.onclick?.({}); }
  enter(value) { this.value = value; this.oninput(); }
}

function setup({ start = 'welcome', sample = start !== 'welcome', storage = new Map() } = {}) {
  const doc = { activeElement: null, createElement: (tag) => new Node(doc, tag),
    getElementById: (id) => doc.body.find((node) => node.id === id)[0] ?? null };
  doc.body = new Node(doc, 'body');
  const root = new Node(doc, 'div');
  const canvas = new Node(doc, 'canvas');
  doc.body.append(root, canvas);
  let keydown = null;
  const win = { addEventListener: (type, listener, capture) => {
    assert.equal(type, 'keydown');
    assert.equal(capture, true);
    keydown = listener;
  } };
  const previews = [];
  let closed = 0;
  const creator = new CharacterCreator({ root, outside: [canvas], win, doc,
    onPreview: (skin) => previews.push(skin), onClose: () => closed++ });
  const roster = new Roster({ storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    now: () => START, randomId: () => 'c0001' });
  const press = (key, target = doc.activeElement, extra = {}) => {
    const event = { key, target, ...extra, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    keydown(event);
    return event;
  };
  const ui = {
    creator, root, canvas, doc, previews, press, closed: () => closed,
    open: () => creator.open({ roster, now: () => START, start, draft: sample ? sampleDraft(roster, START) : null }),
    title: () => doc.getElementById('creator-title').textContent,
    buttons: () => root.find((node) => node.tagName === 'BUTTON'),
    button: (text) => ui.buttons().find((node) => node.textContent === text),
    message: () => creator.message,
    live: () => root.children[1].textContent,
    submit: () => creator.form.onsubmit({ preventDefault() {} }),
    radios: () => root.find((node) => node.type === 'radio'),
  };
  return ui;
}

test('opening shows Welcome, makes the outside inert and previews the draft', () => {
  const ui = setup();
  assert.equal(ui.creator.isOpen, false);
  ui.open();
  assert.ok(ui.creator.isOpen);
  assert.ok(ui.doc.body.classList.contains('creator-open'));
  assert.equal(ui.canvas.inert, true);
  assert.deepEqual(ui.previews, [DEFAULT_SKIN]);
  const form = ui.creator.form;
  assert.equal(form.getAttribute('role'), 'dialog');
  assert.equal(form.getAttribute('aria-modal'), 'true');
  assert.equal(form.getAttribute('aria-labelledby'), 'creator-title');
  assert.equal(ui.title(), 'Welcome');
  assert.equal(ui.live(), 'Welcome');
  assert.ok(form.textContent.includes('Welcome to Cerrith.'));
  assert.deepEqual(ui.buttons().map((b) => b.textContent), ['Continue']);
  assert.equal(ui.doc.activeElement, ui.button('Continue'));
  ui.submit();
  assert.equal(ui.title(), 'Character creation');
  assert.deepEqual(ui.buttons().map((b) => b.textContent), ['Back', 'Continue']);
  ui.button('Back').click();
  assert.equal(ui.title(), 'Welcome');
});

test('closing restores the page once', () => {
  const ui = setup();
  ui.open();
  ui.creator.close();
  ui.creator.close();
  assert.equal(ui.closed(), 1);
  assert.equal(ui.creator.isOpen, false);
  assert.equal(ui.root.children.length, 0);
  assert.equal(ui.canvas.inert, false);
  assert.equal(ui.doc.body.classList.contains('creator-open'), false);
});

test('Name: Next waits for the rule and shows why', () => {
  const ui = setup({ start: 'name', sample: false });
  ui.open();
  const input = ui.doc.getElementById('creator-name');
  assert.equal(ui.doc.activeElement, input);
  assert.equal(input.getAttribute('enterkeyhint'), 'next');
  assert.equal(ui.live(), 'Step 1 of 7: Name');
  assert.equal(ui.root.find((n) => n.className === 'creator-counter')[0].textContent, 'Step 1 of 7');
  const next = ui.button('Next');
  assert.equal(next.getAttribute('aria-disabled'), 'true');
  assert.equal(ui.message().textContent, 'Name cannot be empty.');
  assert.equal(ui.message().dataset.state, 'hint', 'a muted hint until the player tries');
  ui.button('Back').focus({ preventScroll: true });
  ui.submit();
  assert.equal(ui.message().dataset.state, 'error');
  assert.equal(ui.doc.activeElement, input, 'pressing Next focuses the field');
  input.enter('Al');
  assert.equal(ui.message().textContent, 'Name must be at least 3 characters.');
  input.enter('Brann');
  assert.equal(next.getAttribute('aria-disabled'), 'false');
  assert.equal(ui.message().textContent, '');
  assert.equal(ui.message().dataset.state, 'hint');
  ui.submit();
  assert.equal(ui.title(), 'Class');
});

test('Class and Race are named radio groups that preview the race tone', () => {
  const ui = setup({ start: 'class', sample: false });
  ui.open();
  assert.equal(ui.root.find((n) => n.tagName === 'LEGEND')[0].textContent, 'Class');
  const radios = ui.radios();
  assert.equal(radios.length, 7);
  assert.ok(radios.every((r) => r.name === 'class'));
  assert.equal(ui.doc.activeElement, radios[0], 'nothing is picked; focus is on the first');
  radios[3].checked = true;
  radios[3].onchange();
  assert.equal(ui.creator.flow.sheet.class, 'paladin');
  ui.submit();
  assert.equal(ui.title(), 'Race');
  const cards = ui.root.find((n) => n.className === 'creator-card');
  assert.ok(cards[2].textContent.includes('Maximum age 90'));
  assert.equal(cards[2].children[1].style, 'color: #87d65c');
  ui.radios()[2].onchange();
  assert.equal(ui.previews.at(-1).tone, 'olive');
  ui.button('Back').click();
  assert.equal(ui.doc.activeElement, ui.radios()[3], 'focus returns to the checked card');
});

test('editing from the Summary names its buttons for the review', () => {
  const ui = setup({ start: 'summary' });
  ui.open();
  assert.ok(ui.root.textContent.includes('This page comes in a later update.'));
  ui.creator.flow.edit('race');
  ui.creator.render();
  assert.deepEqual(ui.buttons().map((b) => b.textContent), ['Back to review', 'Save and review']);
});

test('Age: the stepper keeps to the race range and shows the birthday', () => {
  const ui = setup({ start: 'age' });
  ui.open();
  const legend = ui.root.find((n) => n.tagName === 'LEGEND')[0].textContent;
  assert.equal(legend, 'Age (18 to 210 for Elf)');
  const age = ui.doc.getElementById('creator-age');
  assert.equal(ui.doc.activeElement, age);
  assert.equal(age.value, '34');
  const plus = ui.doc.getElementById('creator-age1');
  assert.equal(plus.getAttribute('aria-label'), 'Increase age');
  plus.click();
  assert.equal(ui.creator.flow.age, 35);
  assert.equal(ui.doc.activeElement.id, 'creator-age1', 'focus stays on the button');
  assert.match(ui.message().textContent, /^Born \d\d\.\d\d\.\d+ AE$/);
  ui.creator.flow.setAge(18);
  ui.creator.render();
  assert.equal(ui.doc.getElementById('creator-age-1').disabled, true);
  ui.creator.flow.setAge(210);
  ui.creator.render();
  assert.equal(ui.doc.getElementById('creator-age1').disabled, true);
  ui.doc.getElementById('creator-age-1').click();
  assert.equal(ui.creator.flow.age, 209);
  const typed = ui.doc.getElementById('creator-age');
  const birthday = ui.doc.getElementById('creator-birthday');
  typed.enter('5');
  assert.equal(ui.message().textContent, 'Age must be between 18 and 210 for your race.');
  assert.equal(ui.message().dataset.state, 'error');
  const before = birthday.value;
  typed.enter('50');
  assert.notEqual(birthday.value, before, 'a good age shows its birthday');
  assert.match(birthday.value, /^\d\d\.\d\d\.\d+$/);
  birthday.enter('02.10.345');
  assert.equal(typed.value, '34');
  assert.equal(ui.message().textContent, 'Born 02.10.345 AE');
  birthday.enter('31.02');
  assert.equal(typed.value, '34', 'bad input leaves the other field alone');
  assert.equal(ui.message().textContent, 'Invalid birthday.');
});

test('Age with no race says so', () => {
  const ui = setup({ start: 'age', sample: false });
  ui.open();
  assert.equal(ui.doc.getElementById('creator-age').value, '');
  assert.equal(ui.root.find((n) => n.tagName === 'LEGEND')[0].textContent, 'Age (18 to 18 for your race)');
});

test('Attributes: plus and minus name their cost and why they are blocked', () => {
  const ui = setup({ start: 'attributes', sample: false });
  ui.open();
  const first = ui.doc.getElementById('creator-strength1');
  assert.equal(ui.doc.activeElement, first);
  assert.equal(first.getAttribute('aria-label'), 'Raise Strength to rank 1, costs 1 points');
  assert.equal(ui.message().textContent,
    'Spend exactly 12 attribute points (spent 0). Raise Strength to rank 1, costs 1 points', 'the rule, then the focused button');
  assert.ok(ui.root.textContent.includes('12 points left'));
  assert.ok(ui.root.textContent.includes('Total 0'));
  const minus = ui.doc.getElementById('creator-strength-1');
  assert.equal(minus.getAttribute('aria-disabled'), 'true');
  minus.click();
  assert.equal(ui.creator.flow.sheet.attributes.strength, 0);
  for (let i = 0; i < 3; i++) ui.doc.getElementById('creator-strength1').click();
  assert.equal(ui.doc.activeElement.id, 'creator-strength1');
  assert.ok(ui.root.textContent.includes('Rank 3'));
  assert.ok(ui.root.textContent.includes('5 points left'));
  assert.equal(ui.creator.note, 'Costs 8 points; 5 points available.', 'focus shows why the button is blocked');
  assert.equal(ui.doc.getElementById('creator-strength-1').getAttribute('aria-label'),
    'Lower Strength to rank 2, refunds 4 points');
  ui.creator.flow.sheet.race = 'elf';
  ui.creator.flow.sheet.attributes = { ...ui.creator.flow.sheet.attributes, dexterity: 2, wisdom: 1, charisma: 1 };
  ui.creator.render();
  assert.ok(ui.root.textContent.includes('All points assigned'));
  assert.ok(ui.root.textContent.includes('All points assigned · Elf +3 to each'));
  assert.ok(ui.root.textContent.includes('Total 6'));
  assert.equal(ui.button('Next').getAttribute('aria-disabled'), 'false');
  ui.creator.flow.sheet.attributes = { ...ui.creator.flow.sheet.attributes, intelligence: 1 };
  ui.creator.render();
  assert.ok(ui.root.textContent.includes('1 points over budget'));
});

test('every key stops at the creator while it is open', () => {
  const ui = setup({ start: 'name' });
  const closedKey = ui.press('i', ui.canvas);
  assert.equal(closedKey.stopped, false);
  ui.open();
  const input = ui.doc.getElementById('creator-name');
  const typing = ui.press('i', input);
  assert.ok(typing.stopped, 'no game key runs');
  assert.equal(typing.defaultPrevented, false, 'the letter is still typed');
  const escape = ui.press('Escape', input);
  assert.ok(escape.defaultPrevented);
  assert.ok(ui.creator.isOpen, 'Esc does not dismiss the first creation');
  const stray = ui.press('a', ui.doc.body);
  assert.ok(stray.defaultPrevented);
  assert.equal(ui.doc.activeElement, input, 'a key outside the panel brings focus back');
  const [back, next] = [ui.button('Back'), ui.button('Next')];
  assert.ok(ui.press('Tab', next).defaultPrevented);
  assert.equal(ui.doc.activeElement, input, 'Tab wraps to the first control');
  assert.ok(ui.press('Tab', input, { shiftKey: true }).defaultPrevented);
  assert.equal(ui.doc.activeElement, next, 'Shift+Tab wraps to the last');
  assert.equal(ui.press('Tab', back).defaultPrevented, false, 'Tab inside moves as usual');
});

test('the info page without a field focuses Continue after a failed step', () => {
  const ui = setup({ start: 'creation' });
  ui.open();
  ui.creator.flow.next = () => false;
  ui.submit();
  assert.equal(ui.doc.activeElement, ui.button('Continue'));
});
