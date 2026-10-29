import assert from 'node:assert/strict';
import test from 'node:test';
import { makeOreBlock } from '../src/world/props.js';
import { loadGame } from './helpers/main-game.js';

// A game with one iron block a stride north of the player.
async function start() {
  const loaded = await loadGame(undefined, { href: 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0&animals=0' });
  const { game } = loaded;
  const block = makeOreBlock({ x: game.player.x, y: game.player.y - 4, ore: 'iron', host: 'granite', seed: 3 });
  const props = [block];
  // Mining's view of the land; the page draws its stand-in world as before.
  game.mining.world = { propsIn: () => props.filter((p) => !p.mined), chunk: () => ({ props }), mined: new Set(),
    coverGrass: () => {} };
  game.world.loaded = () => ({ props: [] });
  game.player.heading = Math.PI;
  const notes = [];
  game.hud.notify = (text) => notes.push(text);
  const prompts = [];
  game.hud.setPrompt = (text) => prompts.push(text);
  return { ...loaded, block, notes, prompts };
}

test('the outlaw sets out with the sword drawn and a stone pickaxe in the bag', async () => {
  const { game } = await start();
  assert.equal(game.inventory.equipment.mainHand.id, 'shortSword');
  assert.deepEqual(game.inventory.slots.filter(Boolean), [{ id: 'stonePickaxe', count: 1 }]);
});

test('swinging a pickaxe at ore mines it, and the ore lies with the loot', async () => {
  const { game, frame, block, notes, prompts } = await start();
  frame();
  assert.equal(prompts.at(-1), 'Iron ore · needs a stone pickaxe');
  game.inventory.equip(game.inventory.slots.findIndex((s) => s?.id === 'stonePickaxe'));
  frame();
  assert.equal(prompts.at(-1), 'Iron ore · stone pickaxe');
  for (let i = 0; i < 3; i++) {
    game.player.events.push({ type: 'strike', swing: 'cut', x: game.player.x, y: game.player.y - 4, strength: 1 });
    frame();
  }
  assert.deepEqual(notes.filter((n) => /ore/.test(n)), ['Mining iron ore: 1/3', 'Mining iron ore: 2/3', 'Mined iron ore.']);
  assert.ok(block.mined);
  assert.ok(game.huntDrops.all().some((s) => s.id === 'rawIron'));
  assert.equal(game.mining.nearby(game.player, 'stone'), null);
  frame();
  assert.equal(prompts.at(-1), '', 'no ore left to offer');
});

test('a glowcap in reach takes the prompt over the ore', async () => {
  const { game, frame, prompts } = await start();
  game.mushrooms.nearby = () => ({ cooldown: 0 });
  frame();
  assert.equal(prompts.at(-1), '[E] Disturb glowcap · release spores');
  game.mushrooms.nearby = () => ({ cooldown: game.mushrooms.time + 5 });
  frame();
  assert.equal(prompts.at(-1), 'Glowcap · spores settling…');
});

test('ore blocks near the view are baked a few a frame as their fine bakes are queued', async () => {
  // Out of view; as the real fineOf does, asking for a prop's fine bake reads its cells.
  const { game, frame } = await loadGame(undefined, { href: 'http://localhost/?debug&animals=0',
    real: { fineOf: (p) => p.cells, propInView: () => false } });
  const near = Array.from({ length: 10 }, (_, i) => makeOreBlock({ x: game.player.x + 2000 + i * 6, y: game.player.y,
    ore: 'coal', host: 'basalt', seed: 10 + i }));
  game.world.propsIn = () => near;
  frame();
  assert.equal(near.filter((b) => !b.unbaked).length, 4);
  frame();
  assert.equal(near.filter((b) => !b.unbaked).length, 8);
});
