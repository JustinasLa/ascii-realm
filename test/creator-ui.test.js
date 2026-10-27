import assert from 'node:assert/strict';
import test from 'node:test';
import { sampleDraft } from '../src/character/creation.js';
import { Roster } from '../src/character/roster.js';
import { DEFAULT_SKIN } from '../src/character/skin.js';
import { CharacterCreator, FIGURE_ROWS, hidesPreview, previewFraming } from '../src/ui/creator.js';

const START = new Date(2026, 9, 26, 12).getTime();

// Just enough of the DOM for the panel: elements with the properties it
// sets, attributes for the rest, focus, and a tree to search.
class Node {
  constructor(doc, tag) {
    Object.assign(this, { doc, tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: new Map(), dataset: {},
      className: '', id: '', type: '', name: '', value: '', checked: false, disabled: false, tabIndex: 0, htmlFor: '',
      maxLength: -1, autocomplete: '', autocapitalize: '', spellcheck: true, placeholder: '', pattern: '', style: '',
      inert: false, onclick: null, oninput: null, onchange: null, onsubmit: null, onfocus: null, onbeforeinput: null, rows: 2,
      onpointerdown: null, onpointermove: null, onpointerup: null, onpointercancel: null, captured: null, text: '' });
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
  // A node taken out of the tree loses its pointer capture, as in a browser.
  replaceChildren(...nodes) {
    for (const child of this.children) Object.assign(child, { parentNode: null, captured: null });
    this.children = [];
    this.text = '';
    this.append(...nodes);
  }
  replaceWith(node) {
    const { parentNode: parent } = this;
    Object.assign(node, { parentNode: parent });
    parent.children[parent.children.indexOf(this)] = node;
    this.parentNode = null;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
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
  getBoundingClientRect() { return this.doc.panel; }
  setPointerCapture(id) { this.captured = id; }
  click() { this.onclick?.({}); }
  enter(value) { this.value = value; this.oninput(); }
}

function setup({ start = 'welcome', sample = start !== 'welcome', storage = new Map(), viewport } = {}) {
  const vars = new Map();
  const doc = { activeElement: null, createElement: (tag) => new Node(doc, tag),
    getElementById: (id) => doc.body.find((node) => node.id === id)[0] ?? null,
    documentElement: { style: { setProperty: (key, value) => vars.set(key, value) } },
    panel: { left: 0, top: 422, width: 390, height: 422 } };
  doc.body = new Node(doc, 'body');
  const root = new Node(doc, 'div');
  const canvas = new Node(doc, 'canvas');
  doc.body.append(root, canvas);
  let keydown = null;
  // Timers run when the test says.
  const timers = new Map();
  let timerId = 0;
  const win = { innerWidth: 390, innerHeight: 844, visualViewport: viewport,
    setTimeout: (run, ms) => { timers.set(++timerId, { run, ms }); return timerId; }, clearTimeout: (id) => timers.delete(id),
    addEventListener: (type, listener, capture) => {
    assert.equal(type, 'keydown');
    assert.equal(capture, true);
    keydown = listener;
  } };
  const previews = [];
  const frames = [];
  const created = [];
  const turns = [];
  let closed = 0;
  const creator = new CharacterCreator({ root, outside: [canvas], win, doc, cells: [4.5, 24],
    onPreview: (skin) => previews.push(skin), onFrame: (framing) => frames.push(framing), onTurn: (by) => turns.push(by),
    onClose: (character) => { closed++; created.push(character); } });
  const roster = new Roster({ storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    now: () => START, randomId: () => 'c0001' });
  const press = (key, target = doc.activeElement, extra = {}) => {
    const event = { key, target, ...extra, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    keydown(event);
    return event;
  };
  const ui = {
    creator, root, canvas, doc, previews, frames, created, turns, vars, win, roster, press, timers, closed: () => closed,
    open: () => creator.open({ roster, now: () => START, start, draft: sample ? sampleDraft(roster, START) : null }),
    title: () => doc.getElementById('creator-title').textContent,
    buttons: () => creator.form.find((node) => node.tagName === 'BUTTON'),
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
  assert.equal(ui.root.getAttribute('role'), 'dialog', 'the dialog holds the panel and the turn buttons');
  assert.equal(ui.root.getAttribute('aria-modal'), 'true');
  assert.equal(ui.root.getAttribute('aria-labelledby'), 'creator-title');
  assert.equal(form.getAttribute('role'), null);
  assert.equal(ui.title(), 'Welcome');
  assert.equal(ui.live(), 'Welcome');
  assert.ok(form.textContent.includes('Welcome to Cerrith.'));
  assert.deepEqual(ui.buttons().map((b) => b.textContent), ['Continue']);
  assert.equal(ui.doc.activeElement, ui.button('Continue'));
  ui.submit();
  assert.equal(ui.title(), 'Character creation');
  assert.deepEqual(ui.buttons().map((b) => b.textContent), ['Continue'], 'info pages offer Continue only');
  ui.submit();
  ui.submit();
  assert.equal(ui.creator.flow.page.id, 'name');
  ui.button('Back').click();
  assert.equal(ui.creator.flow.page.id, 'name-info', 'a step goes back to the info page before it');
});

test('closing restores the page once', () => {
  const ui = setup();
  ui.open();
  ui.creator.close();
  ui.creator.close();
  assert.equal(ui.closed(), 1);
  assert.equal(ui.creator.isOpen, false);
  assert.equal(ui.root.children.length, 0);
  assert.deepEqual(['role', 'aria-modal', 'aria-labelledby'].map((key) => ui.root.getAttribute(key)), [null, null, null]);
  assert.equal(ui.canvas.inert, false);
  assert.equal(ui.doc.body.classList.contains('creator-open'), false);
});

test('Name: Next waits for the rule and shows why', () => {
  const ui = setup({ start: 'name', sample: false });
  ui.open();
  const input = ui.doc.getElementById('creator-name');
  assert.equal(ui.doc.activeElement, input);
  assert.equal(input.getAttribute('enterkeyhint'), 'next');
  assert.equal(ui.live(), 'Step 1 of 8: Name');
  assert.equal(ui.root.find((n) => n.className === 'creator-counter')[0].textContent, 'Step 1 of 8');
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
  ui.doc.getElementById('creator-age').enter('30');
  assert.equal(ui.doc.getElementById('creator-age-1').disabled, false, 'a typed age frees the stepper');
  ui.doc.getElementById('creator-age').enter('210');
  assert.equal(ui.doc.getElementById('creator-age1').disabled, true, 'and holds it at the top');
  ui.doc.getElementById('creator-age').enter('5');
  assert.equal(ui.doc.getElementById('creator-age1').disabled, true, 'a bad age leaves it as it was');
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
  const right = ui.root.find((node) => node.getAttribute('aria-label') === 'Turn right')[0];
  assert.equal(ui.press('Tab', next).defaultPrevented, false, 'from the panel on to the turn buttons');
  assert.ok(ui.press('Tab', right).defaultPrevented);
  assert.equal(ui.doc.activeElement, input, 'Tab wraps to the first control');
  assert.ok(ui.press('Tab', input, { shiftKey: true }).defaultPrevented);
  assert.equal(ui.doc.activeElement, right, 'Shift+Tab wraps to the last');
  assert.equal(ui.press('Tab', back).defaultPrevented, false, 'Tab inside moves as usual');
});

test('a radio group is one Tab stop, so Tab wraps from any of its radios', () => {
  const ui = setup({ start: 'skin' });
  ui.open();
  const input = (id) => ui.doc.getElementById(id);
  input('creator-preset-drover').onchange();
  const right = ui.root.find((node) => node.getAttribute('aria-label') === 'Turn right')[0];
  assert.ok(ui.press('Tab', input('creator-preset-drover'), { shiftKey: true }).defaultPrevented, 'the checked preset, not the first');
  assert.ok(ui.doc.activeElement === right);
  ui.press('Tab', right);
  assert.ok(ui.doc.activeElement === input('creator-preset-drover'), 'Tab enters the group at its checked radio');
  ui.creator.close();
  const race = setup({ start: 'race', sample: false });
  race.open();
  const radios = race.radios();
  assert.ok(radios.every((radio) => !radio.checked));
  assert.ok(race.press('Tab', radios[2], { shiftKey: true }).defaultPrevented, 'none checked: any radio of the group');
  race.press('Tab', race.doc.activeElement);
  assert.ok(race.doc.activeElement === radios[0], 'none checked: the first');
});

test('the info page without a field focuses Continue after a failed step', () => {
  const ui = setup({ start: 'creation' });
  ui.open();
  ui.creator.flow.next = () => false;
  ui.submit();
  assert.equal(ui.doc.activeElement, ui.button('Continue'));
});

test('Description: a counted paragraph where Enter continues, then an optional gender', () => {
  const ui = setup({ start: 'description', sample: false });
  ui.open();
  const text = ui.doc.getElementById('creator-description');
  assert.equal(ui.doc.activeElement, text);
  assert.equal(text.tagName, 'TEXTAREA');
  assert.equal(text.getAttribute('enterkeyhint'), 'next');
  const count = () => ui.root.find((n) => n.className === 'creator-counter')[1].textContent;
  assert.equal(count(), '0 / 256 (at least 32)');
  assert.equal(ui.live(), 'Step 6 of 8: Description');
  const gender = ui.radios();
  assert.deepEqual(gender.map((r) => r.parentNode.textContent), ['Male', 'Female', 'Other', 'Unset']);
  assert.equal(gender[3].checked, true, 'Unset by default');
  gender[2].onchange();
  assert.equal(ui.creator.flow.sheet.gender, 'other');
  assert.equal(text.getAttribute('aria-describedby'), 'creator-description-count', 'the count is read on focus');
  assert.equal(ui.doc.getElementById('creator-description-count').textContent, count());
  text.enter('  A scarred ranger');
  text.enter('  A scarred ranger with a soft voice.  ');
  assert.equal(count(), '35 / 256 (at least 32)', 'trimmed, as the rule counts');
  assert.equal(ui.live(), 'Step 6 of 8: Description', 'not announced while typing');
  assert.equal(ui.timers.size, 1, 'each key restarts the pause');
  const [pause] = ui.timers.values();
  assert.equal(pause.ms, 300);
  pause.run();
  assert.equal(ui.live(), '35 / 256 (at least 32)', 'announced once typing pauses');
  let prevented = 0;
  text.onbeforeinput({ inputType: 'insertText', preventDefault: () => prevented++ });
  assert.equal(ui.title(), 'Description', 'typing goes on');
  text.onbeforeinput({ inputType: 'insertLineBreak', preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.equal(ui.creator.flow.page.id, 'clues-info', 'Enter continues instead of a new line');
  ui.creator.turn(ui.creator.flow.back());
  ui.doc.getElementById('creator-description').onbeforeinput({ inputType: 'insertParagraph', preventDefault() {} });
  assert.equal(ui.title(), 'Clues');
});

test('Clues: added one at a time with a counter, removed, and limited to ten', () => {
  const ui = setup({ start: 'clues', sample: false });
  ui.open();
  const status = () => ui.root.find((n) => n.className === 'creator-counter').slice(1).map((n) => n.textContent);
  assert.deepEqual(status(), ['0 of 2 required (at most 10) · 12–48 characters each', '0/48 · need 12 more']);
  const field = () => ui.doc.getElementById('creator-clue');
  assert.equal(ui.doc.activeElement, field());
  field().enter('Short');
  assert.equal(status()[1], '5/48 · need 7 more');
  ui.button('Add').click();
  assert.equal(ui.message().textContent, 'Needs at least 2 clues. Each clue must be 12 to 48 characters.');
  assert.equal(ui.message().dataset.state, 'error');
  field().enter('x'.repeat(50));
  assert.equal(status()[1], '50/48 · 2 over');
  field().enter('Smells of pine resin');
  assert.equal(status()[1], '20/48');
  assert.equal(field().getAttribute('aria-describedby'), 'creator-clue-count');
  [...ui.timers.values()][0].run();
  assert.equal(ui.live(), '20/48');
  ui.button('Add').click();
  assert.deepEqual(ui.creator.flow.sheet.clues, ['Smells of pine resin']);
  assert.equal(field().value, '', 'the field empties');
  assert.equal(ui.doc.activeElement, field());
  field().enter('Hums under her breath');
  ui.submit();
  assert.equal(ui.title(), 'Clues', 'Enter, Done or Next adds a typed clue rather than continues');
  assert.deepEqual(ui.creator.flow.sheet.clues, ['Smells of pine resin', 'Hums under her breath']);
  assert.equal(ui.timers.size, 0, 'a new page drops a pending count');
  field().enter('Too short');
  ui.submit();
  assert.equal(ui.title(), 'Clues', 'a typed clue that fails stays, with why');
  assert.equal(ui.message().textContent, 'Each clue must be 12 to 48 characters.');
  assert.equal(ui.creator.flow.sheet.clues.length, 2);
  field().enter('');
  const remove = ui.doc.getElementById('creator-remove0');
  assert.equal(remove.getAttribute('aria-label'), 'Remove clue 1');
  remove.click();
  assert.deepEqual(ui.creator.flow.sheet.clues, ['Hums under her breath']);
  assert.equal(ui.doc.activeElement.id, 'creator-remove0', 'focus moves to the next clue');
  ui.doc.getElementById('creator-remove0').click();
  assert.equal(ui.doc.activeElement, field(), 'or to the field');
  ui.creator.flow.sheet.clues = Array.from({ length: 10 }, (_, i) => `A clue numbered ${i}`);
  ui.creator.render();
  assert.equal(status()[0], 'Clue limit reached.');
  assert.equal(field().disabled, true);
  assert.equal(ui.button('Add').disabled, true);
  assert.equal(ui.doc.activeElement, ui.button('Next'));
  ui.submit();
  assert.equal(ui.title(), 'Skin');
});

test('Summary: every row with its Edit, which returns there', () => {
  const ui = setup({ start: 'summary' });
  ui.open();
  assert.equal(ui.live(), 'Review your character');
  assert.equal(ui.root.find((n) => n.className === 'creator-counter')[0].textContent, '');
  assert.deepEqual(ui.root.find((n) => n.tagName === 'DT').map((n) => n.children[0].text),
    ['Name', 'Gender', 'Class', 'Race', 'Age', 'Attributes', 'Description', 'Clues', 'Skin']);
  assert.equal(ui.root.find((n) => n.tagName === 'DD')[0].textContent, 'Arwen Vale');
  assert.deepEqual(ui.buttons().slice(-2).map((b) => b.textContent), ['Back', 'Create character']);
  const create = ui.button('Create character');
  assert.equal(create.getAttribute('aria-disabled'), 'false');
  assert.equal(ui.doc.activeElement, create);
  const edit = ui.buttons().find((b) => b.getAttribute('aria-label') === 'Edit gender');
  edit.click();
  assert.equal(ui.title(), 'Description', 'gender is set on the Description step');
  ui.submit();
  assert.equal(ui.title(), 'Review your character');
  assert.equal(ui.doc.activeElement.getAttribute('aria-label'), 'Edit gender', 'focus returns to the row');
  ui.button('Back').click();
  ui.submit();
  assert.equal(ui.doc.activeElement, ui.button('Create character'), 'only straight after an edit');
  ui.button('Back').click();
  assert.equal(ui.title(), 'Skin');
});

test('Summary: a failing step blocks Create with Review links', () => {
  const ui = setup({ start: 'summary' });
  ui.open();
  ui.creator.flow.setAge(180);
  ui.creator.flow.set('race', 'orc');
  ui.creator.flow.set('description', 'short');
  ui.creator.render();
  const alert = ui.root.find((n) => n.getAttribute('role') === 'alert')[0];
  assert.ok(alert.textContent.startsWith('Review these steps before creating your character:'));
  assert.ok(alert.textContent.includes('Review Age Age must be between 18 and 90 for your race.'));
  assert.equal(ui.doc.activeElement, alert, 'focus goes to the problems');
  assert.equal(ui.message().textContent, '', 'listed once, in the alert');
  assert.equal(ui.button('Create character').getAttribute('aria-disabled'), 'true');
  ui.button('Create character').focus({ preventScroll: true });
  ui.submit();
  assert.equal(ui.closed(), 0);
  assert.equal(ui.doc.activeElement, ui.root.find((n) => n.getAttribute('role') === 'alert')[0]);
  ui.button('Review Age').click();
  assert.equal(ui.title(), 'Age');
  assert.deepEqual(ui.buttons().slice(-2).map((b) => b.textContent), ['Back to review', 'Save and review']);
});

test('Create saves the character and closes with it, once', () => {
  const ui = setup({ start: 'summary' });
  ui.open();
  ui.submit();
  assert.equal(ui.closed(), 1);
  assert.equal(ui.created[0].sheet.name, 'Arwen Vale');
  assert.equal(ui.roster.active.id, ui.created[0].id);
  assert.equal(ui.creator.isOpen, false);
});

test('Create refused: the cooldown with its opening time, or a name taken meanwhile', () => {
  const storage = new Map();
  const ui = setup({ start: 'summary', storage });
  for (const [id, name] of [['c0002', 'Bryn'], ['c0003', 'Cora']]) {
    const draft = sampleDraft(ui.roster, START);
    assert.ok(ui.roster.create({ ...draft, id, sheet: { ...draft.sheet, name } }).ok);
  }
  ui.open();
  ui.creator.flow.set('name', 'Brann');
  ui.creator.render();
  assert.equal(ui.button('Create character').getAttribute('aria-disabled'), 'true');
  assert.equal(ui.message().textContent,
    `You are on cooldown from switching characters. Opens ${new Date(START + 4 * 86_400_000).toLocaleString()}.`);
  ui.submit();
  assert.equal(ui.closed(), 0);

  const other = setup({ start: 'summary' });
  other.open();
  other.creator.flow.create = () => ({ ok: false, reason: 'This character needs a new id.' });
  other.submit();
  assert.equal(other.message().textContent, 'This character needs a new id.');
  assert.equal(other.closed(), 0);
});

test('Create refused: another tab took the name meanwhile, and Review Name fixes it', () => {
  const storage = new Map();
  const ui = setup({ start: 'summary', storage });
  ui.open();
  assert.equal(ui.button('Create character').getAttribute('aria-disabled'), 'false');
  // A second tab on the same storage makes a character with the same name.
  const tab = new Roster({ storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    now: () => START, randomId: () => 'c0009' });
  assert.ok(tab.create(sampleDraft(tab, START)).ok);
  ui.submit();
  assert.equal(ui.closed(), 0, 'nothing is made');
  assert.deepEqual(ui.roster.characters.map((c) => c.id), ['c0009'], 'this tab now sees the other one');
  const alert = ui.root.find((n) => n.getAttribute('role') === 'alert')[0];
  assert.ok(alert.textContent.includes('Review Name Name already in use.'));
  assert.equal(ui.doc.activeElement, alert);
  assert.equal(ui.button('Create character').getAttribute('aria-disabled'), 'true');
  ui.button('Review Name').click();
  assert.equal(ui.title(), 'Name');
  assert.equal(ui.message().textContent, 'Name already in use.');
  ui.doc.getElementById('creator-name').enter('Arwen Dale');
  ui.submit();
  assert.equal(ui.title(), 'Review your character', 'Save and review returns');
  ui.submit();
  assert.equal(ui.closed(), 1);
  assert.equal(ui.created[0].sheet.name, 'Arwen Dale');
  assert.deepEqual(JSON.parse(storage.get('ascii-realm-characters')).characters.map((c) => c.sheet.name),
    ['Arwen Vale', 'Arwen Dale'], 'both tabs\' characters are saved');
});

test('a prop hides the framed outlaw when it is drawn in front and reaches into its box', () => {
  const player = { y: 10, foliageBounds: { x: 0, y: 0, rx: 6, ry: 14 } };
  const tree = { x: 8.7, y: 30, bounds: { minX: -3, maxX: 3, minY: -40, maxY: 0 } };
  assert.equal(hidesPreview(tree, 30, player), true, 'its crown covers the figure');
  assert.equal(hidesPreview(tree, 10, player), false, 'drawn at the figure\'s depth or behind, it is covered instead');
  assert.equal(hidesPreview({ ...tree, x: 10.2 }, 30, player), false, 'clear to the right');
  assert.equal(hidesPreview({ ...tree, x: -9.5 }, 30, player), false, 'clear to the left');
  assert.equal(hidesPreview({ ...tree, y: 55 }, 55, player), false, 'too far in front to reach up to it');
  assert.equal(hidesPreview({ ...tree, y: 14, bounds: { minX: -3, maxX: 3, minY: -40, maxY: -30 } }, 14, player), false,
    'wholly above it');
  assert.equal(hidesPreview({ x: 0, y: 30 }, 30, player), false, 'not measured');
  assert.equal(hidesPreview(tree, 30, { y: 10, foliageBounds: null }), false, 'no figure yet');
});

test('the framing puts the outlaw in the middle of the free area', () => {
  const cells = [4.5, 24];
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
  const portrait = previewFraming(390, 844, { left: 0, top: 422, width: 390, height: 422 }, cells);
  near(portrait.cell, 0.6 * 422 / FIGURE_ROWS);
  near(portrait.bias, -0.25);
  near(portrait.biasX, 0);
  const landscape = previewFraming(844, 390, { left: 422, top: 0, width: 422, height: 390 }, cells);
  near(landscape.cell, 0.6 * 390 / FIGURE_ROWS);
  near(landscape.biasX, -0.25);
  near(landscape.bias, 0);
  const desktop = previewFraming(1280, 800, { left: 824, top: 16, width: 440, height: 768 }, cells);
  near(desktop.cell, 24, 'held to the largest cell');
  near(desktop.biasX, 412 / 1280 - 0.5);
  const tiny = previewFraming(320, 200, { left: 0, top: 40, width: 320, height: 160 }, cells);
  near(tiny.cell, 4.5, 'and the smallest');
  const none = previewFraming(390, 844, { left: 0, top: 0, width: 0, height: 0 }, cells);
  assert.deepEqual(none, { cell: Math.min(24, 0.6 * 844 / FIGURE_ROWS), biasX: 0, bias: 0 }, 'a panel not laid out frames the whole screen');
});

test('opening frames the outlaw, and refit frames it again for the new layout', () => {
  const ui = setup();
  ui.creator.refit();
  assert.equal(ui.frames.length, 0, 'nothing while closed');
  ui.open();
  assert.equal(ui.frames.length, 1);
  assert.equal(ui.frames[0].bias, -0.25);
  Object.assign(ui.win, { innerWidth: 844, innerHeight: 390 });
  ui.doc.panel = { left: 424, top: 0, width: 420, height: 390 };
  ui.creator.refit();
  assert.equal(ui.frames[1].bias, 0);
  assert.equal(ui.frames[1].biasX, 212 / 844 - 0.5);
  ui.creator.close();
  assert.deepEqual(ui.created, [null], 'closed without a character');
});

test('on phones the panel keeps above the on-screen keyboard', () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  const ui = setup({ viewport });
  const change = (type, height, offsetTop) => {
    Object.assign(viewport, { height, offsetTop });
    viewport.dispatchEvent(new Event(type));
    return [ui.vars.get('--creator-kb'), ui.vars.get('--creator-kb-top')];
  };
  assert.deepEqual(change('resize', 508.4, 0), ['336px', '0px'], 'portrait: the keyboard covers the bottom');
  assert.deepEqual(change('scroll', 508, 120), ['216px', '120px'], 'the visual viewport scrolled down');
  Object.assign(ui.win, { innerWidth: 844, innerHeight: 390 });
  assert.deepEqual(change('resize', 190, 0), ['200px', '0px'], 'landscape');
  assert.deepEqual(change('resize', 390, 0), ['0px', '0px'], 'and back when it hides');
  assert.deepEqual(change('resize', 400, -5), ['0px', '0px'], 'never negative');
  setup();
});

test('Skin: presets, swatches and layers repaint the outlaw and name the pick', () => {
  const ui = setup({ start: 'skin' });
  ui.open();
  assert.equal(ui.live(), 'Step 8 of 8: Skin');
  const legends = () => ui.root.find((n) => n.tagName === 'LEGEND').map((n) => n.textContent);
  assert.deepEqual(legends(), ['Preset: Outlaw', 'Skin tone: Weathered', 'Hair: Umber', 'Shirt: Undyed linen', 'Hose: Pewter',
    'Hood: Ash', 'Jerkin: Tan', 'Sleeves: Umber', 'Bracers and gloves: Saddle', 'Boots: Brown', 'Cloak: Charcoal']);
  const input = (id) => ui.doc.getElementById(id);
  assert.equal(ui.doc.activeElement, input('creator-preset-outlaw'), 'focus on the picked preset');
  assert.equal(input('creator-preset-outlaw').checked, true);
  assert.equal(input('creator-tone-weathered').getAttribute('aria-label'), 'Weathered');
  assert.equal(input('creator-tone-weathered').name, 'creator-tone');
  assert.equal(ui.message().textContent, 'Optional: you can change your skin at any time.');
  assert.equal(ui.button('Next').getAttribute('aria-disabled'), 'false');
  const swatch = input('creator-hood-night').parentNode;
  assert.equal(swatch.className, 'creator-swatch');
  assert.equal(swatch.children[1].style, 'background: rgb(38,40,50)');

  input('creator-preset-drover').onchange();
  assert.equal(ui.previews.at(-1).cloak, 'peat', 'a preset repaints at once');
  assert.equal(input('creator-preset-drover').checked, true);
  assert.equal(input('creator-preset-outlaw').checked, false);
  assert.equal(input('creator-layer-hood').checked, false, 'its layers show');
  assert.equal(input('creator-layer-hood').getAttribute('role'), 'switch');
  assert.ok(legends().includes('Cloak: Peat'));
  input('creator-boots-tan').onchange();
  assert.equal(legends()[0], 'Preset: Custom');
  assert.equal(input('creator-boots-tan').checked, true);
  assert.equal(input('creator-boots-brown').checked, false);
  input('creator-layer-cloak').checked = false;
  input('creator-layer-cloak').onchange();
  assert.equal(ui.previews.at(-1).layers.cloak, false);
  assert.equal(ui.creator.flow.draft.skin.layers.cloak, false);
});

test('Skin: the hood comes down while the tone or hair is picked', () => {
  const ui = setup({ start: 'skin' });
  ui.open();
  const input = (id) => ui.doc.getElementById(id);
  const count = ui.previews.length;
  input('creator-tone-olive').focus({ preventScroll: true });
  assert.equal(ui.previews.at(-1).layers.hood, false, 'the face shows');
  assert.equal(ui.creator.flow.draft.skin.layers.hood, true, 'only in the preview');
  input('creator-hair-grey').focus({ preventScroll: true });
  assert.equal(ui.previews.length, count + 1, 'moving within the group repaints nothing');
  input('creator-tone-olive').onchange();
  assert.equal(ui.previews.at(-1).tone, 'olive');
  assert.equal(ui.previews.at(-1).layers.hood, false);
  assert.ok(ui.creator.flow.draft.toneChosen);
  input('creator-shirt-oat').focus({ preventScroll: true });
  assert.equal(ui.previews.at(-1).layers.hood, true, 'and goes back up for the clothes');
  input('creator-hair-flax').onchange();
  assert.equal(ui.previews.at(-1).layers.hood, false, 'a tap that does not focus works too');
  input('creator-layer-jerkin').focus({ preventScroll: true });
  assert.equal(ui.previews.at(-1).layers.hood, true);
  const fieldset = (id) => input(id).parentNode.parentNode;
  fieldset('creator-tone-olive').onclick();
  assert.equal(ui.previews.at(-1).layers.hood, false, 'tapping the tone already picked shows the face');
  fieldset('creator-boots-brown').onclick();
  assert.equal(ui.previews.at(-1).layers.hood, true, 'tapping clothes already picked puts the hood back');
  fieldset('creator-preset-outlaw').onclick();
  assert.equal(ui.previews.at(-1).layers.hood, true);
  input('creator-hair-grey').onchange();
  ui.submit();
  assert.equal(ui.title(), 'Review your character');
  assert.equal(ui.previews.at(-1).layers.hood, true, 'leaving the page puts it back up');
  const row = ui.root.find((n) => n.tagName === 'DD').at(-1);
  assert.equal(row.textContent, 'Outlaw · Olive skin · Grey hair', 'the tone and hair keep the preset');
  ui.buttons().find((b) => b.getAttribute('aria-label') === 'Edit skin').click();
  assert.equal(ui.title(), 'Skin');
  ui.submit();
  assert.equal(ui.doc.activeElement.getAttribute('aria-label'), 'Edit skin');
});

test('the turn buttons and a drag across the free area turn the outlaw', () => {
  const ui = setup();
  ui.open();
  const stage = ui.root.children[2];
  assert.equal(stage.className, 'creator-stage');
  assert.equal(stage.style, 'width: 390px; height: 422px', 'over the free area above the sheet');
  const turn = (label) => ui.root.find((n) => n.getAttribute('aria-label') === label)[0];
  turn('Turn right').click();
  turn('Turn left').click();
  assert.deepEqual(ui.turns, [Math.PI / 4, -Math.PI / 4]);
  ui.turns.length = 0;
  stage.onpointerdown({ target: turn('Turn right'), pointerId: 1, clientX: 100 });
  stage.onpointermove({ pointerId: 1, clientX: 140 });
  assert.deepEqual(ui.turns, [], 'pressing a button is not a drag');
  stage.onpointerdown({ target: stage, pointerId: 2, clientX: 100 });
  assert.equal(stage.captured, 2);
  stage.onpointermove({ pointerId: 2, clientX: 130 });
  stage.onpointermove({ pointerId: 3, clientX: 300 });
  stage.onpointermove({ pointerId: 2, clientX: 120 });
  assert.deepEqual(ui.turns, [30 * Math.PI / 180, -10 * Math.PI / 180], 'a degree a pixel, one finger only');
  stage.onpointerdown({ target: stage, pointerId: 3, clientX: 0 });
  assert.equal(stage.captured, 2, 'a second finger does not take over');
  stage.onpointerup({ pointerId: 3 });
  stage.onpointermove({ pointerId: 2, clientX: 125 });
  assert.equal(ui.turns.length, 3, 'nor does lifting it stop the turn');
  stage.onpointercancel({ pointerId: 2 });
  stage.onpointermove({ pointerId: 2, clientX: 200 });
  assert.equal(ui.turns.length, 3, 'until the first lets go');
  stage.onpointerdown({ target: stage, pointerId: 3, clientX: 0 });
  stage.onpointermove({ pointerId: 3, clientX: 10 });
  assert.equal(ui.turns.length, 4, 'then another finger may turn it');
  ui.submit();
  assert.equal(ui.root.children[2], stage, 'the same free area on every page');
  stage.onpointerup({ pointerId: 3 });
  stage.onpointerdown({ target: stage, pointerId: 4, clientX: 0 });
  const page = ui.title();
  ui.submit();
  assert.notEqual(ui.title(), page, 'a second finger moves on a page mid-turn');
  assert.equal(stage.captured, 4, 'another page keeps the finger turning the outlaw');
  stage.onpointerup({ pointerId: 4 });
  stage.onpointerdown({ target: stage, pointerId: 5, clientX: 0 });
  stage.onlostpointercapture({ pointerId: 5 });
  stage.onpointerdown({ target: stage, pointerId: 6, clientX: 0 });
  assert.equal(stage.captured, 6, 'losing the capture lets the next finger turn it');
  ui.win.innerWidth = 844;
  ui.doc.panel = { left: 424, top: 0, width: 420, height: 390 };
  ui.creator.refit();
  assert.equal(stage.style, 'width: 424px; height: 844px', 'left of a side panel');
});
