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
