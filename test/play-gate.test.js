import assert from 'node:assert/strict';
import test from 'node:test';
import { PlayGate } from '../src/ui/play-gate.js';

function page({ action = true } = {}) {
  const classes = new Set();
  const doc = { body: { classList: { add: c => classes.add(c), remove: c => classes.delete(c) } } };
  const label = { textContent: '' };
  const attributes = new Map();
  const button = Object.assign(new EventTarget(), { hidden: true, focused: 0,
    querySelector: () => action ? label : null,
    setAttribute: (name, value) => attributes.set(name, value),
    focus(options) { this.focused++; this.focusOptions = options; } });
  return { doc, button, label, attributes, classes };
}

test('the card shows a start or resume label, gates the page and focuses itself', () => {
  for (const [kind, text, aria] of [['start', 'TAP TO PLAY', 'Tap to play'], ['resume', 'TAP TO RESUME', 'Tap to resume']]) {
    const { doc, button, label, attributes, classes } = page();
    const shown = [];
    const gate = new PlayGate({ button, doc, onShow: k => shown.push(k) });
    assert.equal(gate.waiting, false);
    gate.show(kind);
    assert.equal(gate.waiting, true);
    assert.equal(label.textContent, text);
    assert.equal(attributes.get('aria-label'), aria);
    assert.equal(button.hidden, false);
    assert.ok(classes.has('play-gated'));
    assert.deepEqual(button.focusOptions, { preventScroll: true });
    assert.deepEqual(shown, [kind]);
  }
});

test('a tap hides the card and starts play synchronously, inside the gesture', () => {
  const { doc, button, classes } = page();
  const started = [];
  const gate = new PlayGate({ button, doc, onStart: kind => started.push([kind, gate.waiting, button.hidden]) });
  gate.show('resume');
  button.dispatchEvent(new Event('click'));
  assert.deepEqual(started, [['resume', false, true]], 'already hidden and not waiting when onStart runs');
  assert.ok(!classes.has('play-gated'));
  button.dispatchEvent(new Event('click'));
  assert.equal(started.length, 1, 'a second click does nothing');
});

test('a card already up keeps its kind; unknown kinds are a start; defaults are safe', () => {
  const { doc, button, label } = page({ action: false });
  const gate = new PlayGate({ button, doc });
  gate.show();
  assert.equal(gate.kind, 'start');
  gate.show('resume');
  assert.equal(gate.kind, 'start', 'an untapped start is still a start');
  assert.equal(button.focused, 1);
  gate.start();
  gate.show('sideways');
  assert.equal(gate.kind, 'start');
  assert.equal(label.textContent, '', 'no action span: nothing to relabel');
});
