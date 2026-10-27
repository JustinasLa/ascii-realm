import assert from 'node:assert/strict';
import test from 'node:test';
import { Roster, ROSTER_KEY } from '../src/character/roster.js';
import { loadGame } from './helpers/main-game.js';

// A localStorage stand-in that records every write.
function memory(entries = {}) {
  const map = new Map(Object.entries(entries));
  const writes = [];
  return { map, writes, getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); map.set(key, String(value)); } };
}

test('?debug exposes an empty roster and start-up writes nothing', async () => {
  const storage = memory({ 'ascii-realm-name': 'Ash' });
  const { game } = await loadGame(undefined, { real: { localStorage: storage } });
  assert.ok(game.characters instanceof Roster);
  assert.deepEqual(game.characters.characters, []);
  assert.equal(game.characters.suggestedName, 'Ash');
  assert.equal(game.characters.bypassCooldown, true);
  assert.equal(game.characters.storage, storage);
  assert.deepEqual(storage.writes, []);
  assert.equal(storage.map.get('ascii-realm-name'), 'Ash');
});

test('the roster hears other tabs through the window', async () => {
  const storage = memory();
  const { game, window } = await loadGame(undefined, { real: { localStorage: storage } });
  // Another tab creates a character on 26.10.379 AE.
  const other = new Roster({ storage, now: () => new Date(2026, 9, 26, 12).getTime() });
  const draft = other.newDraft();
  draft.sheet = { ...draft.sheet, name: 'Kael', race: 'human', birthday: '0349-01-01', class: 'bard',
    description: 'A quiet wanderer with a lute on his back.',
    attributes: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 3, charisma: 1 },
    clues: ['Hums under his breath', 'Smells of wood smoke'] };
  assert.equal(other.create(draft).ok, true);
  window.dispatchEvent(Object.assign(new Event('storage'), { key: ROSTER_KEY }));
  assert.equal(game.characters.active.sheet.name, 'Kael');
});

test('without ?debug there is no game object, and play starts as before', async () => {
  const loaded = await loadGame(undefined, { href: 'http://localhost/' });
  assert.equal(loaded.game, undefined);
});
