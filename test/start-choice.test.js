import assert from 'node:assert/strict';
import test from 'node:test';
import { savedAgo, StartChoice } from '../src/ui/start-choice.js';

const NOW = Date.UTC(2026, 9, 30, 12);

// Just enough of the DOM for the panel: elements with the properties it
// sets, attributes for the rest, focus, and a tree to search.
class Node {
  constructor(doc, tag) {
    Object.assign(this, { doc, tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: new Map(), dataset: {},
      className: '', id: '', type: '', disabled: false, inert: false, onclick: null, onsubmit: null, role: null, text: '' });
    const set = new Set();
    this.classList = { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
  }

  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this.children = []; this.text = String(value); }
  append(...nodes) {
    for (const node of nodes) {
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...nodes);
  }
  replaceWith(node) {
    const { parentNode: parent } = this;
    node.parentNode = parent;
    parent.children[parent.children.indexOf(this)] = node;
    this.parentNode = null;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  focus(options) {
    assert.deepEqual(options, { preventScroll: true });
    this.doc.activeElement = this;
  }
  contains(node) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }
  * walk() { for (const child of this.children) { yield child; yield* child.walk(); } }
  querySelectorAll(selector) {
    assert.equal(selector, 'button, input, textarea');
    return [...this.walk()].filter((node) => node.tagName === 'BUTTON');
  }
  click() { this.onclick?.({}); }
}

function setup() {
  const doc = { activeElement: null, createElement: (tag) => new Node(doc, tag) };
  doc.body = new Node(doc, 'body');
  const root = new Node(doc, 'div');
  const canvas = new Node(doc, 'canvas');
  doc.body.append(root, canvas);
  let keydown = null;
  const win = { addEventListener: (type, listener, capture) => {
    assert.deepEqual([type, capture], ['keydown', true]);
    keydown = listener;
  } };
  const chosen = [];
  const choice = new StartChoice({ root, outside: [canvas], win, doc, now: () => NOW, onChoose: (action) => chosen.push(action) });
  const press = (key, target = doc.activeElement, extra = {}) => {
    const event = { key, target, ...extra, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    keydown(event);
    return event;
  };
  const ui = {
    choice, root, canvas, doc, chosen, press,
    title: () => [...root.walk()].find((node) => node.tagName === 'H2').textContent,
    lines: () => [...root.walk()].filter((node) => node.tagName === 'P' && node.parentNode.className === 'creator-body')
      .map((node) => node.textContent),
    buttons: () => root.querySelectorAll('button, input, textarea').map((node) => node.textContent),
    button: (text) => root.querySelectorAll('button, input, textarea').find((node) => node.textContent === text),
    submit: () => choice.form.onsubmit({ preventDefault() {} }),
  };
  return ui;
}

const SAVE = { who: 'Mara', day: 3, savedAt: NOW - 3 * 60_000, hasBody: true, newerFeatures: false };

test('"saved … ago" counts seconds, minutes and hours, then gives the date', () => {
  assert.equal(savedAgo(NOW - 12_000, NOW), '12 s ago');
  assert.equal(savedAgo(NOW + 5000, NOW), '0 s ago');
  assert.equal(savedAgo(NOW - 3 * 60_000, NOW), '3 min ago');
  assert.equal(savedAgo(NOW - 2 * 3600_000, NOW), '2 h ago');
  assert.equal(savedAgo(NOW - 2 * 86_400_000, NOW), 'on 28 October');
});

test('Welcome back says who, the day and when, holds the page, and Continue is the primary', () => {
  const ui = setup();
  assert.equal(ui.choice.isOpen, false);
  ui.choice.open('continue', SAVE);
  assert.deepEqual([ui.choice.isOpen, ui.choice.mode], [true, 'continue']);
  assert.ok(ui.doc.body.classList.contains('creator-open'));
  assert.equal(ui.canvas.inert, true);
  assert.deepEqual(['role', 'aria-modal', 'aria-labelledby'].map((key) => ui.root.getAttribute(key)), ['dialog', 'true', 'start-title']);
  assert.equal(ui.title(), 'Welcome back');
  assert.deepEqual(ui.lines(), ['Mara: day 4, saved 3 min ago.', 'Carry on where you left off, or start this world over.']);
  assert.deepEqual(ui.buttons(), ['New game', 'Continue']);
  assert.equal(ui.doc.activeElement, ui.button('Continue'));
  assert.equal(ui.button('Continue').className, 'creator-primary');
  ui.submit();
  assert.deepEqual(ui.chosen, ['continue'], 'Enter picks Continue');
  assert.deepEqual([ui.button('Continue').disabled, ui.button('New game').disabled], [true, true]);
  assert.equal(ui.choice.message.textContent, 'Opening your save…');
  ui.submit();
  assert.deepEqual(ui.chosen, ['continue'], 'nothing more while busy');
  ui.choice.fail('Storage full: not saved.');
  assert.deepEqual([ui.choice.message.textContent, ui.choice.message.dataset.state], ['Storage full: not saved.', 'error']);
  assert.equal(ui.button('Continue').disabled, false);
  ui.choice.close();
  assert.deepEqual([ui.choice.isOpen, ui.root.children.length, ui.canvas.inert], [false, 0, false]);
  assert.equal(ui.doc.body.classList.contains('creator-open'), false);
  assert.equal(ui.root.getAttribute('role'), null);
  ui.choice.close();
});

test('the summary leaves out what the save lacks, and a newer save offers no New game', () => {
  const ui = setup();
  ui.choice.open('continue', { ...SAVE, day: null, savedAt: 0 });
  assert.equal(ui.lines()[0], 'Mara.');
  ui.choice.open('continue', { ...SAVE, day: 0, savedAt: 0 });
  assert.equal(ui.lines()[0], 'Mara: day 1.');
  ui.choice.open('continue', { ...SAVE, hasBody: false });
  assert.equal(ui.lines()[0], 'Mara hasn\'t set out on this world yet.');
  ui.choice.open('continue', { ...SAVE, newerFeatures: true });
  assert.deepEqual(ui.lines().slice(1), ['Carry on where you left off.',
    'Parts of this save come from a newer version, so this page won\'t save.']);
  assert.deepEqual(ui.buttons(), ['Continue']);
});

test('New game asks first with Keep my save focused; Esc and Keep go back, Start over chooses', () => {
  const ui = setup();
  ui.choice.open('continue', SAVE);
  ui.button('New game').click();
  assert.deepEqual(ui.buttons(), ['Keep my save', 'Start over']);
  assert.equal(ui.doc.activeElement, ui.button('Keep my save'));
  const ask = ui.choice.asking;
  assert.deepEqual([ask.className, ask.role], ['creator-discard', 'alertdialog']);
  assert.match(ask.textContent, /^Start this world over\?Every character's place and bag/);
  const esc = ui.press('Escape');
  assert.deepEqual([esc.stopped, esc.defaultPrevented], [true, true]);
  assert.deepEqual(ui.buttons(), ['New game', 'Continue']);
  assert.equal(ui.doc.activeElement, ui.button('Continue'));
  ui.button('New game').click();
  ui.button('Keep my save').click();
  assert.deepEqual(ui.buttons(), ['New game', 'Continue']);
  ui.button('New game').click();
  ui.press('Tab', ui.canvas);
  assert.equal(ui.doc.activeElement, ui.button('Keep my save'), 'focus comes back into the question');
  ui.button('Start over').click();
  assert.deepEqual(ui.chosen, ['new']);
  assert.equal(ui.choice.message.textContent, 'Starting over…');
  assert.deepEqual(ui.buttons(), ['New game', 'Continue']);
});

test('the keyboard stays in the panel: Tab wraps, Esc dismisses nothing, focus outside comes back', () => {
  const ui = setup();
  assert.equal(ui.press('KeyW', ui.canvas).stopped, false, 'a closed panel leaves keys alone');
  ui.choice.open('continue', SAVE);
  const esc = ui.press('Escape');
  assert.deepEqual([esc.stopped, ui.choice.isOpen], [true, true]);
  const key = ui.press('KeyW', ui.button('Continue'));
  assert.deepEqual([key.stopped, key.defaultPrevented], [true, false]);
  ui.press('Tab', ui.button('Continue'));
  assert.equal(ui.doc.activeElement, ui.button('New game'), 'Tab from the last wraps to the first');
  ui.press('Tab', ui.button('New game'), { shiftKey: true });
  assert.equal(ui.doc.activeElement, ui.button('Continue'), 'Shift+Tab from the first wraps to the last');
  const inside = ui.press('Tab', ui.button('New game'));
  assert.equal(inside.defaultPrevented, false, 'Tab between buttons moves as usual');
  ui.press('KeyW', ui.canvas);
  assert.equal(ui.doc.activeElement, ui.button('Continue'));
});

test('each notice screen has its title, lines and buttons', () => {
  const screens = {
    newer: ['A newer save', ['This save was made by a newer version of the game.',
      'Reload to get it. If you play here, nothing is saved.'], ['Play without saving', 'Reload'], 'reload'],
    'other-tab': ['Open in another tab', ['This world is being played in another tab. Close it, then try again.'],
      ['Play without saving', 'Try again'], 'retry'],
    stale: ['Saved in another tab', ['This world was played in another tab while this page was away, so this page stopped saving.',
      'Reload to carry on from that save.'], ['Play without saving', 'Reload'], 'reload'],
  };
  for (const [mode, [title, lines, buttons, primary]] of Object.entries(screens)) {
    const ui = setup();
    ui.choice.open(mode);
    assert.deepEqual([ui.title(), ui.lines(), ui.buttons()], [title, lines, buttons], mode);
    ui.submit();
    ui.choice.open(mode);
    ui.button('Play without saving').click();
    assert.deepEqual(ui.chosen, [primary, 'decline'], mode);
  }
});
