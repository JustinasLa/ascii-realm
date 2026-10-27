import assert from 'node:assert/strict';
import test from 'node:test';
import { ROSTER_KEY } from '../src/character/roster.js';
import { cleanSkin, DEFAULT_SKIN, PALETTES, presetSkin, PRESETS } from '../src/character/skin.js';
import { loadGame } from './helpers/main-game.js';

// A localStorage stand-in that records every write.
function memory(entries = {}) {
  const map = new Map(Object.entries(entries));
  const writes = [];
  return { map, writes, getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); map.set(key, String(value)); } };
}
const roster = (skin) => JSON.stringify({ v: 1, rev: 1, active: 'c0002', characters: [
  { id: 'c0001', createdAt: 1, switchedAt: null, sheet: { name: 'Bryn' }, skin: { tone: 'sage' } },
  { id: 'c0002', createdAt: 2, switchedAt: 3, sheet: { name: 'Zoë' }, skin },
] });

test('start-up dresses the outlaw in the active character\'s skin', async () => {
  const skin = { tone: 'olive', hair: 'black', cloak: 'night', layers: { hood: false }, wings: 'yes' };
  const storage = memory({ [ROSTER_KEY]: roster(skin) });
  const { game } = await loadGame(undefined, { real: { localStorage: storage } });
  assert.deepEqual(game.player.skin, cleanSkin(skin));
  assert.ok(Object.isFrozen(game.player.skin));
  assert.deepEqual(storage.writes, [], 'reading the skin writes nothing');
});

test('without a character, or with an empty skin slot, the outlaw is today\'s', async () => {
  assert.equal((await loadGame()).game.player.skin, DEFAULT_SKIN);
  const storage = memory({ [ROSTER_KEY]: roster(null) });
  assert.equal((await loadGame(undefined, { real: { localStorage: storage } })).game.player.skin, DEFAULT_SKIN);
});

test('?debug can change the skin by preset or by value, without saving it', async () => {
  const storage = memory({ [ROSTER_KEY]: roster(null) });
  const { game } = await loadGame(undefined, { real: { localStorage: storage } });
  assert.equal(game.setSkin('drover'), presetSkin('drover'));
  assert.equal(game.player.skin, presetSkin('drover'));
  const ember = game.setSkin({ tone: 'ember', layers: { hood: false } });
  assert.deepEqual(ember, cleanSkin({ tone: 'ember', layers: { hood: false } }));
  assert.equal(game.player.skin, ember);
  assert.equal(game.setSkin('nope'), DEFAULT_SKIN);
  assert.equal(game.setSkin(42), DEFAULT_SKIN);
  assert.equal(game.skins.PRESETS, PRESETS);
  assert.equal(game.skins.PALETTES, PALETTES);
  assert.deepEqual(storage.writes, []);
  assert.equal(game.characters.active.skin, null);
});

test('a skin set while the game is frozen shows on the model at once', async () => {
  const { game, frame, model, modelUpdates } = await loadGame();
  frame();
  const updates = modelUpdates();
  assert.equal(model.gear.applied.length, 0, 'running, the model dresses itself in update');
  game.freeze = true;
  const skin = game.setSkin('greenwood');
  frame();
  assert.equal(modelUpdates(), updates, 'the pose holds');
  assert.deepEqual(model.gear.applied.at(-1), [game.player.equipment, skin]);
});
