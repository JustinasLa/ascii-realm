import assert from 'node:assert/strict';
import test from 'node:test';
import { SpellControls } from '../src/spells/controls.js';

// Storage initialization does not depend on rendering or browser events.
class Controls extends SpellControls {
  buildWheel() {}
  listen() {}
}

test('unavailable browser storage still permits rune selection and binding', t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  let reads = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { reads++; throw new Error('Storage denied'); },
  });
  const spells = [{ id: 'fire-shard', element: 'oseni' }, { id: 'ice-shard', element: 'seithr' }];
  const casting = { available: spells, selected: '' };
  let bound;
  const controls = new Controls(casting, { onBind: spell => { bound = spell; } });
  assert.equal(casting.selected, 'fire-shard');
  controls.bind(spells[1]);
  assert.equal(casting.selected, 'ice-shard');
  assert.equal(bound, spells[1]);
  assert.equal(reads, 1);

  const saved = new Map([['ascii-realm:rune', 'fire-shard']]);
  const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const explicit = new Controls(casting, { storage });
  assert.equal(casting.selected, 'fire-shard');
  explicit.bind(spells[1]);
  assert.equal(saved.get('ascii-realm:rune'), 'ice-shard');
  new Controls(casting, { storage: null });
  assert.equal(reads, 1, 'explicit storage avoids the browser getter');
});

// The wheel text names the CAST button on phones and the R key elsewhere.
test('the rune wheel names CAST on phones and R elsewhere', () => {
  const spells = [{ id: 'fire-shard', name: 'Fire Shard', element: 'oseni' }];
  const casting = { available: spells, selected: 'fire-shard', spells: new Map(spells.map(s => [s.id, s])),
    variant: () => ({}), modifiers: () => ({ mana: 12 }), hasAura: () => false };
  let phone = false;
  const controls = new Controls(casting, { storage: null, phone: () => phone });
  controls.colors = { ink: 'ink', muted: 'muted', quiet: 'quiet' };
  const text = lines => lines.map(runs => runs.map(([t]) => t).join(''));
  controls.menu.open();
  assert.ok(text(controls.hubLines('fire-shard')).includes('Bound to [R]'));
  phone = true;
  assert.ok(text(controls.hubLines('fire-shard')).includes('Tap CAST to cast'));
  assert.ok(text(controls.hubLines('')).includes('Choose a school'));

  controls.menu.enter(controls.menu.groups[0]);
  controls.waiting = [false];
  assert.deepEqual(text(controls.entryLines(spells[0], 0, 'fire-shard', 16)), ['Fire Shard', '12 mana', '[CAST]']);
  assert.deepEqual(text(controls.entryLines(spells[0], 0, '', 16)), ['Fire Shard', '12 mana']);
  phone = false;
  assert.deepEqual(text(controls.entryLines(spells[0], 0, 'fire-shard', 16)), ['Fire Shard', '12 mana [R]']);
});

test('a phone flip redraws the open wheel even when nothing else changed', () => {
  const casting = { available: [{ id: 'fire-shard', element: 'oseni' }], selected: 'fire-shard' };
  let phone = false, renders = 0;
  const controls = new Controls(casting, { storage: null, phone: () => phone });
  controls.render = () => { renders++; };
  controls.menu.open();
  controls.spots = [];
  controls.paint();
  controls.paint();
  assert.equal(renders, 1);
  phone = true;
  controls.paint();
  assert.equal(renders, 2);
});
