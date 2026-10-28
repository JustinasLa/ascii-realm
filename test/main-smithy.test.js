import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseRecipe, finishSmithy, hitSmithy, loadSmithy } from '../src/crafting/smithing.js';
import { createProp } from '../src/world/props.js';
import { loadGame } from './helpers/main-game.js';

const HREF = 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0&animals=0';
const ID = 'r:spawn:13';

// A localStorage stand-in shared between page loads.
function storage() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key) };
}

// A game with the spawn weapon station a few columns east of the outlaw.
async function start(localStorage = storage()) {
  const loaded = await loadGame(undefined, { href: HREF, real: { localStorage, propDepthSlices: () => null } });
  const { game } = loaded;
  const station = createProp('weapon-station', game.player.x + 12, game.player.y - 1, { seed: 3, variant: 0 });
  station.id = ID;
  const props = [station];
  game.world.propsIn = () => props;
  game.inventoryScreen.isOpen = false;
  const prompts = [];
  game.hud.setPrompt = (text) => prompts.push(text);
  return { ...loaded, station, props, prompts, localStorage };
}

const at = (game, id) => game.inventory.slots.findIndex((stack) => stack?.id === id);
const seconds = (frame, s) => { for (let i = 0; i < s * 60; i++) frame(1 / 60); };

test('beside the weapon station E opens it; a sword is smithed, sparks fly and the bag describes it', async () => {
  const { game, frame, tap, blocked, touch, prompts, station } = await start();
  frame();
  assert.equal(prompts.at(-1), '[E] Use weapon station');
  assert.deepEqual(touch.interactions.at(-1), { kind: 'smithy', label: 'SMITH', ariaLabel: 'Use the weapon station' });
  tap('KeyE');
  frame();
  assert.deepEqual(game.smithyScreen.opened, [ID]);
  assert.equal(blocked(), true, 'play stops while it is open');
  assert.equal(game.inventoryScreen.isCovered(), true);
  assert.equal(touch.interactions.at(-1), null);
  const { book } = game.smithyScreen;
  assert.equal(book, game.alloyBook);
  game.inventory.add('ironIngot', 4);
  book.savedBench(ID, (s) => chooseRecipe(s, 'shortSword'));
  for (let i = 0; i < 4; i++) book.savedBench(ID, (s) => loadSmithy(s, game.inventory, at(game, 'ironIngot'), book));
  for (let i = 0; i < 16; i++) book.savedBench(ID, (s) => hitSmithy(s, 'hit', book), { later: true });
  for (let i = 0; i < 4; i++) book.savedBench(ID, (s) => hitSmithy(s, 'smallHit', book), { later: true });
  const sparks = [];
  game.dust.sparks = (...args) => sparks.push(args);
  game.smithyScreen.onHit(ID, 'hit');
  assert.deepEqual(sparks, [[station.x, station.y - 3, 4]], 'a hit throws sparks from the anvil it was opened on');
  // The roll is true random, or debug.smithRandom when it is set.
  const roll = game.smithyScreen.random();
  assert.ok(roll >= 0 && roll < 1);
  game.smithRandom = () => 0.6;
  assert.equal(game.smithyScreen.random(), 0.6);
  const done = book.savedBench(ID, (s) => finishSmithy(s, game.inventory, book, game.smithyScreen.random));
  assert.deepEqual(done.lines.slice(0, 2), ['Hit Percentage: 100%', 'Quality: Masterwork']);
  game.smithyScreen.onFinish(ID, done);
  assert.deepEqual(sparks.at(-1), [station.x, station.y - 3, 12]);
  const sword = game.inventory.slots[at(game, 'shortSword')];
  assert.equal(sword.forged.metal, 'Iron');
  assert.equal(game.inventoryScreen.describe(sword).name, 'Iron Short Sword');
  assert.equal(game.inventoryScreen.describe({ id: 'ironIngot', count: 1 }), null, 'plain items keep their own text');
  game.smithyScreen.close();
  assert.equal(blocked(), false);
});

test('the forge comes before the weapon station, and the station before a glowcap', async () => {
  const { game, frame, prompts, props, station, touch } = await start();
  game.mushrooms.nearby = () => ({ cooldown: 0 });
  frame();
  assert.equal(prompts.at(-1), '[E] Use weapon station');
  const forge = createProp('alloy-forge', station.x - 4, station.y, { seed: 3 });
  forge.id = 'r:spawn:12';
  props.push(forge);
  frame();
  assert.equal(prompts.at(-1), '[E] Use alloy forge');
  assert.equal(touch.interactions.at(-1).label, 'FORGE');
  props.length = 0;
  frame();
  assert.equal(prompts.at(-1), '[E] Disturb glowcap · release spores');
});

test('a piece mid-work is kept: hits within two seconds, and on leaving the page', async () => {
  const { game, frame, window, localStorage } = await start();
  const book = game.alloyBook;
  game.inventory.add('ironIngot', 4);
  book.savedBench(ID, (s) => chooseRecipe(s, 'dagger'));
  for (let i = 0; i < 4; i++) book.savedBench(ID, (s) => loadSmithy(s, game.inventory, at(game, 'ironIngot'), book));
  book.savedBench(ID, (s) => hitSmithy(s, 'hit', book), { later: true });
  const saved = () => JSON.parse(localStorage.map.get('ascii-realm-alloys-1')).benches[ID];
  assert.deepEqual(saved().done, {});
  seconds(frame, 2.1);
  assert.deepEqual(saved().done, { hit: 1 });
  book.savedBench(ID, (s) => hitSmithy(s, 'hit', book), { later: true });
  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  assert.deepEqual(saved().done, { hit: 2 });
  const again = await start(localStorage);
  assert.deepEqual(again.game.alloyBook.bench(ID).toJSON(),
    { recipe: 'dagger', units: ['ironIngot', 'ironIngot', 'ironIngot', 'ironIngot'], done: { hit: 2 }, output: null });
});
