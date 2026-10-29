import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { Inventory } from '../src/inventory/inventory.js';
import { Hud, NOTE_FLASH } from '../src/ui/hud.js';
import { byClass, installDocument } from './helpers/dom.js';

const view = { x0: 100, y0: 200, offX: 0, offY: 0, cols: 80, rows: 20, cellW: 20, cellH: 40 };

function mount(t, options = {}) {
  const document = installDocument(t);
  const player = new Player(104, 206);
  const inventory = new Inventory();
  const hud = new Hud({ player, inventory, name: 'Kael', ...options });
  t.after(() => hud.destroy());
  hud.update(0, view);
  const wrap = byClass(document.body, 'hud-inventory-wrap')[0];
  const slots = byClass(document.body, 'hud-slot');
  const hint = byClass(document.body, 'hud-notes-hint')[0];
  const group = byClass(document.body, 'hud-notes')[0];
  const notes = () => slots.map(slot => byClass(slot, 'hud-slot-note')[0].textContent);
  const pitches = () => slots.map(slot => byClass(slot, 'hud-slot-pitch')[0].textContent);
  return { document, player, inventory, hud, wrap, slots, hint, group, notes, pitches };
}

// The DOM as markup would show it: tags, classes (as a set), attributes,
// data, text and hidden state, all the way down.
function serialize(node) {
  return JSON.stringify({
    tag: node.tagName,
    classes: node.className.split(/\s+/).filter(Boolean).sort(),
    attributes: [...node.attributes].sort(),
    data: { ...node.dataset },
    hidden: Boolean(node.hidden),
    text: node._text,
    children: node.children.map(serialize),
  });
}

test('an off-hand instrument shows its notes on eight slots beside the inventory button', (t) => {
  const { hud, wrap, slots, hint, group, notes, pitches } = mount(t);
  assert.equal(slots.length, 8);
  assert.equal(group.hidden, true);
  assert.equal(hint.hidden, true);
  hud.setInstrument({ id: 'lute', shifted: false });
  hud.update(0, view);
  assert.equal(group.hidden, false);
  assert.equal(hint.hidden, false);
  assert.ok(wrap.classList.contains('playing'));
  assert.deepEqual(notes(), ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']);
  assert.deepEqual(pitches(), ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
  assert.equal(hint.textContent, 'Lute | 1-8 notes | Shift chords');
  assert.equal(group.getAttribute('aria-label'),
    'Lute notes. Keys 1 to 8 play notes; hold Shift for chords.');
  for (const slot of slots) assert.ok(slot.classList.contains('note'));
  assert.equal(slots[0].getAttribute('aria-label'), 'Slot 1: note C4');
  assert.equal(slots[0].getAttribute('title'), '1: C4');
});

test('Shift shows chords, or the octave above on the flute, trumpet and bagpipe', (t) => {
  const { hud, slots, hint, group, notes, pitches } = mount(t);
  hud.setInstrument({ id: 'lute', shifted: true });
  hud.update(0, view);
  assert.deepEqual(notes(), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C']);
  assert.equal(pitches()[1], 'D F A');
  assert.equal(slots[1].getAttribute('aria-label'), 'Slot 2: chord Dm, D F A');
  assert.equal(slots[1].getAttribute('title'), '2: Dm (D F A)');
  hud.setInstrument({ id: 'flute', shifted: true });
  hud.update(0, view);
  assert.deepEqual(notes(), ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']);
  assert.deepEqual(pitches(), ['C6', 'D6', 'E6', 'F6', 'G6', 'A6', 'B6', 'C7']);
  assert.equal(hint.textContent, 'Flute | 1-8 notes | Shift 9-16');
  assert.equal(group.getAttribute('aria-label'),
    'Flute notes. Keys 1 to 8 play notes; hold Shift for notes 9 to 16.');
  // The same view again changes nothing.
  const before = slots.map(slot => slot.className);
  hud.setInstrument({ id: 'flute', shifted: true });
  hud.update(0, view);
  assert.deepEqual(slots.map(slot => slot.className), before);
});

test('a played slot lights up for 0.2 s', (t) => {
  const { hud, slots } = mount(t);
  hud.setInstrument({ id: 'kalimba', shifted: false });
  hud.flashSlot(2);
  hud.flashSlot(8);
  hud.flashSlot(-1);
  hud.update(0, view);
  assert.equal(NOTE_FLASH, 0.2);
  assert.ok(slots[2].classList.contains('note-flash'));
  assert.equal(slots.filter(slot => slot.classList.contains('note-flash')).length, 1);
  hud.update(0.15, view);
  assert.ok(slots[2].classList.contains('note-flash'));
  hud.update(0.06, view);
  assert.equal(slots[2].classList.contains('note-flash'), false);
});

test('taking the instrument off leaves the inventory button alone again', (t) => {
  const { hud, wrap, hint, group } = mount(t);
  hud.update(0, view);
  const before = serialize(wrap);
  hud.setInstrument({ id: 'lute', shifted: false });
  hud.update(0, view);
  hud.flashSlot(3);
  hud.setInstrument({ id: 'lute', shifted: true });
  hud.update(0.05, view);
  assert.notEqual(serialize(wrap), before);
  hud.setInstrument(null);
  hud.update(0.3, view);
  assert.equal(hint.hidden, true);
  assert.equal(group.hidden, true);
  assert.equal(wrap.classList.contains('playing'), false);
  // Without an instrument, null and unknown ids change nothing.
  const after = serialize(wrap);
  hud.setInstrument(null);
  hud.setInstrument({ id: 'woodenBuckler', shifted: true });
  hud.update(0, view);
  assert.equal(serialize(wrap), after);
  assert.equal(hud.instrument, null);
});

test('a click on a slot passes its event, so Shift-click can play the second layer', (t) => {
  const selections = [];
  const { slots } = mount(t, { onNote: (index, event) => selections.push([index, event.type]) });
  slots[1].click();
  assert.deepEqual(selections, [[1, 'click']]);
});

test('the strings the note layout adds are ASCII', () => {
  const source = readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  const start = source.indexOf('  setInstrument(view) {');
  const end = source.indexOf('  update(dt, view) {');
  assert.ok(start > 0 && end > start);
  const bad = [...source.slice(start, end)].find(char => !/[\x20-\x7e\n]/.test(char));
  assert.equal(bad, undefined);
});
