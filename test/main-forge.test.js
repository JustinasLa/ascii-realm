import assert from 'node:assert/strict';
import test from 'node:test';
import { fireForge, loadForge } from '../src/crafting/alloys.js';
import { createProp } from '../src/world/props.js';
import { loadGame } from './helpers/main-game.js';

const HREF = 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0&animals=0';
const ID = 'r:spawn:12';

// A localStorage stand-in shared between page loads.
function storage() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key) };
}

// A game with the spawn forge a few columns east of the outlaw.
async function start(localStorage = storage(), real = {}) {
  const loaded = await loadGame(undefined, { href: HREF, real: { localStorage, propDepthSlices: () => null, ...real } });
  const { game } = loaded;
  const forge = createProp('alloy-forge', game.player.x + 10, game.player.y - 1, { seed: 3 });
  forge.id = ID;
  const props = [forge];
  game.world.propsIn = () => props;
  game.inventoryScreen.isOpen = false;
  const prompts = [];
  game.hud.setPrompt = (text) => prompts.push(text);
  const notes = [];
  game.hud.notify = (...args) => notes.push(args);
  return { ...loaded, forge, props, prompts, notes, localStorage };
}

const seconds = (frame, s) => { for (let i = 0; i < s * 60; i++) frame(1 / 60); };
const at = (game, id) => game.inventory.slots.findIndex((stack) => stack?.id === id);

test('beside the forge E opens it; a discovery flares, glows for a while and the book is kept', async () => {
  const { game, frame, tap, blocked, touch, prompts, notes, forge, localStorage } = await start();
  frame();
  assert.equal(prompts.at(-1), '[E] Use alloy forge');
  assert.equal(touch.interactions.at(-1).label, 'FORGE');
  game.inventory.add('ironIngot', 1);
  game.inventory.add('rawTin', 1);
  game.inventory.add('coal', 1);
  tap('KeyE');
  frame();
  assert.deepEqual(game.forgeScreen.opened, [ID]);
  assert.equal(blocked(), true, 'play stops while it is open');
  assert.equal(game.inventoryScreen.isCovered(), true);
  assert.equal(touch.interactions.at(-1), null);
  const { book } = game.forgeScreen;
  assert.equal(book, game.alloyBook);
  for (const id of ['ironIngot', 'rawTin']) book.saved(ID, (f) => loadForge(f, game.inventory, at(game, id)));
  // The screen's rolls are true random, or come from debug.alloyRandom when it is set.
  const roll = game.forgeScreen.random();
  assert.ok(roll >= 0 && roll < 1);
  game.alloyRandom = () => 0;
  assert.equal(game.forgeScreen.random(), 0);
  const done = book.saved(ID, (f) => fireForge(f, game.inventory, book, ID, game.forgeScreen.random));
  assert.equal(done.outcome, 'new');
  const sparks = [];
  game.dust.sparks = (...args) => sparks.push(args);
  game.forgeScreen.onDiscover(ID, done.alloy);
  assert.deepEqual(sparks, [[forge.x, forge.y - 4, 18]], 'sparks fly from the forge it was opened on');
  game.forgeScreen.onNotify(done.message, 'discovery');
  assert.deepEqual(notes.at(-1), ['You discovered Ferranite!', 'discovery']);
  // The bag names the ingot after its alloy.
  const ingot = game.inventory.slots[at(game, 'alloyIngot')];
  assert.equal(game.inventoryScreen.describe(ingot).name, 'Ferranite');
  const version = game.inventoryScreen.describeVersion();
  assert.equal(book.rename('Moon_Iron').ok, true);
  assert.equal(game.inventoryScreen.describeVersion(), version + 1);
  game.forgeScreen.close();
  assert.equal(blocked(), false);
  assert.equal(book.lit(ID), true);
  const updates = game.forgeScreen.updates;
  seconds(frame, 10.1);
  assert.ok(game.forgeScreen.updates > updates, 'the screen follows the book each frame');
  assert.equal(book.lit(ID), false, 'the hearth cools after ten seconds of game time');
  assert.equal(JSON.parse(localStorage.map.get('ascii-realm-alloys-1')).alloys[0].name, 'Moon Iron');
  const again = await start(localStorage);
  assert.equal(again.game.alloyBook.get('a1').name, 'Moon Iron');
});

test('the naming window running out is told through the screen', async () => {
  const { game, frame } = await start();
  game.alloyBook.record('ironIngot|rawTin', { kind: 'alloy', alloy: { name: 'Ferranite', colour: 'B0B3B5',
    base: 'ironIngot', catalysts: ['rawTin'], type: 'metal', tier: 1, stats: {}, hits: {}, xp: 0 } });
  seconds(frame, 59);
  assert.deepEqual(game.forgeScreen.told, []);
  seconds(frame, 1.1);
  assert.deepEqual(game.forgeScreen.told.map((done) => done.message), ['Naming timed out.']);
});

test('the furnace comes before the forge, and the forge before a glowcap', async () => {
  const { game, frame, prompts, props, forge, touch } = await start();
  game.mushrooms.nearby = () => ({ cooldown: 0 });
  frame();
  assert.equal(prompts.at(-1), '[E] Use alloy forge');
  const furnace = createProp('furnace', forge.x - 4, forge.y, { seed: 3 });
  furnace.id = 'r:spawn:11';
  props.push(furnace);
  frame();
  assert.equal(prompts.at(-1), '[E] Use furnace');
  assert.equal(touch.interactions.at(-1).label, 'SMELT');
  props.length = 0;
  frame();
  assert.equal(prompts.at(-1), '[E] Disturb glowcap · release spores');
});

test('a lit forge in view glows and lights the ground; a cold one does not', async () => {
  const glows = [];
  const lights = [];
  const { game, frame } = await start(storage(), {
    drawFurnaceGlow: (r, view, prop) => glows.push(prop.id), lightFurnace: (r, view, prop) => lights.push(prop.id) });
  game.grass.drawLayered = (r, world, view, time, drawables) => drawables.forEach((d) => d.draw());
  frame();
  assert.deepEqual([glows, lights], [[], []]);
  game.alloyBook.glow(ID);
  frame();
  assert.deepEqual([glows, lights], [[ID], [ID]]);
});

test('the book is saved when the page is hidden or left', async () => {
  const { game, setHidden, window, localStorage } = await start();
  game.inventory.add('ironIngot', 1);
  game.alloyBook.forge(ID).add('ironIngot');
  setHidden(true);
  assert.equal(JSON.parse(localStorage.map.get('ascii-realm-alloys-1')).forges[ID].base, 'ironIngot');
  game.alloyBook.forge(ID).add('rawTin');
  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  assert.deepEqual(JSON.parse(localStorage.map.get('ascii-realm-alloys-1')).forges[ID].catalysts, ['rawTin']);
});
