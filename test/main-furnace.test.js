import assert from 'node:assert/strict';
import test from 'node:test';
import { createProp } from '../src/world/props.js';
import { loadGame } from './helpers/main-game.js';

const HREF = 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0&animals=0';

// A localStorage stand-in shared between page loads.
function storage() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key) };
}

// A game with the spawn furnace a few columns east of the outlaw.
async function start(localStorage = storage()) {
  const loaded = await loadGame(undefined, { href: HREF, real: { localStorage, propDepthSlices: () => null } });
  const { game } = loaded;
  const furnace = createProp('furnace', game.player.x + 9, game.player.y - 1, { seed: 3 });
  furnace.id = 'r:spawn:11';
  game.world.propsIn = () => [furnace];
  // The stand-in bag is shut, so play is blocked only by the furnace.
  game.inventoryScreen.isOpen = false;
  const prompts = [];
  game.hud.setPrompt = (text) => prompts.push(text);
  return { ...loaded, furnace, prompts, localStorage };
}

const seconds = (frame, s) => { for (let i = 0; i < s * 60; i++) frame(1 / 60); };

test('beside a furnace E opens it, it smelts on game time and its slots are kept', async () => {
  const { game, frame, tap, blocked, touch, prompts, localStorage } = await start();
  frame();
  assert.equal(prompts.at(-1), '[E] Use furnace');
  assert.equal(touch.interactions.at(-1).label, 'SMELT');
  game.inventory.add('rawIron', 2);
  game.inventory.add('coal', 1);
  tap('KeyE');
  frame();
  assert.deepEqual(game.furnaceScreen.opened, ['r:spawn:11']);
  assert.equal(blocked(), true, 'play stops while it is open');
  assert.equal(touch.interactions.at(-1), null, 'no touch button over the screen');
  // Loaded through the store, as the screen's rows do.
  const at = (id) => game.inventory.slots.findIndex((stack) => stack?.id === id);
  assert.equal(game.furnaces.putIn('r:spawn:11', game.inventory, at('rawIron')).ok, true);
  assert.equal(game.furnaces.putIn('r:spawn:11', game.inventory, at('coal')).ok, true);
  const updates = game.furnaceScreen.updates;
  seconds(frame, 20);
  assert.ok(game.furnaceScreen.updates > updates, 'the screen follows the furnace each frame');
  const furnace = game.furnaces.get('r:spawn:11');
  assert.deepEqual(furnace.output, { id: 'ironIngot', count: 2 });
  assert.equal(game.furnaces.lit('r:spawn:11'), true);
  game.furnaceScreen.close();
  assert.equal(blocked(), false);
  const burn = furnace.burn;
  seconds(frame, 10);
  assert.ok(furnace.burn < burn - 9, 'the burn keeps falling with the screen shut');
  const saved = JSON.parse(localStorage.map.get('ascii-realm-furnaces-1'));
  assert.deepEqual(saved.furnaces['r:spawn:11'].output, { id: 'ironIngot', count: 2 });
  // Leaving the page saves the gauges as they are (kept for going back to,
  // as a phone does when switching away).
  game.furnaces.get('r:spawn:11').burn = 33;
  const { window, document } = await start(localStorage);
  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  const again = await start(localStorage);
  assert.deepEqual(again.game.furnaces.get('r:spawn:11').output, { id: 'ironIngot', count: 2 });
  assert.ok(document);
});

test('the furnace is saved when the page is hidden or left', async () => {
  const { game, setHidden, window, localStorage } = await start();
  const furnace = game.furnaces.get('r:spawn:11');
  furnace.put('fuel', { id: 'coal', count: 3 });
  setHidden(true);
  assert.equal(JSON.parse(localStorage.map.get('ascii-realm-furnaces-1')).furnaces['r:spawn:11'].fuel.count, 3);
  furnace.put('fuel', { id: 'coal', count: 1 });
  setHidden(false);
  assert.equal(JSON.parse(localStorage.map.get('ascii-realm-furnaces-1')).furnaces['r:spawn:11'].fuel.count, 3,
    'showing the page again saves nothing');
  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  assert.equal(JSON.parse(localStorage.map.get('ascii-realm-furnaces-1')).furnaces['r:spawn:11'].fuel.count, 4);
});

test('a lit furnace in view glows and lights the ground; an unlit one does not', async () => {
  const glows = [];
  const lights = [];
  const localStorage = storage();
  const loaded = await loadGame(undefined, { href: HREF, real: { localStorage, propDepthSlices: () => null,
    drawFurnaceGlow: (r, view, prop) => glows.push(prop.id), lightFurnace: (r, view, prop) => lights.push(prop.id) } });
  const { game, frame } = loaded;
  const furnace = createProp('furnace', game.player.x + 30, game.player.y - 1, { seed: 3 });
  furnace.id = 's:4';
  game.world.propsIn = () => [furnace];
  // The grass draws each prop in its place among its blades.
  game.grass.drawLayered = (r, world, view, time, drawables) => drawables.forEach((d) => d.draw());
  frame();
  assert.deepEqual([glows, lights], [[], []]);
  Object.assign(game.furnaces.get('s:4'), { input: { id: 'rawCopper', count: 3 }, fuel: { id: 'coal', count: 1 } });
  frame();
  assert.deepEqual([glows, lights], [['s:4'], ['s:4']]);
});

test('a glowcap prompt still shows with no furnace in reach, and none shows while the screen is open', async () => {
  const { game, frame, prompts, furnace } = await start();
  furnace.x += 40;
  game.mushrooms.nearby = () => ({ cooldown: 0 });
  frame();
  assert.equal(prompts.at(-1), '[E] Disturb glowcap · release spores');
  furnace.x -= 40;
  frame();
  assert.equal(prompts.at(-1), '[E] Use furnace', 'the furnace comes first, as E does');
  game.furnaceScreen.open('r:spawn:11');
  frame();
  assert.equal(prompts.at(-1), '');
});

test('the bag is covered while the furnace is open, and the furnace speaks through the HUD', async () => {
  const { game } = await start();
  const notes = [];
  game.hud.notify = (...args) => notes.push(args);
  assert.equal(game.inventoryScreen.isCovered(), false);
  game.furnaceScreen.open('r:spawn:11');
  assert.equal(game.inventoryScreen.isCovered(), true);
  game.furnaceScreen.onNotify('Took Iron Ingot x2.', 'info');
  assert.deepEqual(notes, [['Took Iron Ingot x2.', 'info']]);
});
