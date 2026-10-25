import assert from 'node:assert/strict';
import test from 'node:test';
import { KINDS, Monster, Monsters, toCells, toMetres } from '../src/entities/monsters.js';
import { mulberry32 } from '../src/core/rng.js';
import { WALLET_KEY } from '../src/inventory/wallet.js';
import { rollLoot, rollPay } from '../src/world/loot.js';
import { loadGame } from './helpers/main-game.js';

const SEED = (1 * 104729) ^ 0x1007;

// A localStorage stand-in shared across page loads.
function memory() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}

// A game on open, loaded land, its notices, gains and target views kept.
async function start({ storage = null, ...options } = {}) {
  const loaded = await loadGame(undefined, { href: 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0&animals=0',
    ...options, real: { Monsters, KINDS, ...(storage ? { localStorage: storage } : {}) } });
  const { game } = loaded;
  game.world.loaded = () => ({ props: [] });
  game.world.isWalkable = () => true;
  game.world.typeAt = () => 1;
  const notes = [];
  const gains = [];
  const views = [];
  game.hud.notify = (text, kind) => notes.push([text, kind]);
  game.hud.earned = (cents) => gains.push(cents);
  game.hud.setTarget = (view) => views.push(view);
  // The loot roll is seeded: `spendUntil(test)` spends whole goblin rolls
  // until `test` says the next draws give what it wants.
  let used = 0;
  const peek = (fn) => {
    const random = mulberry32(SEED);
    for (let i = 0; i < used; i++) random();
    let n = 0;
    return { out: fn(() => (n++, random())), n };
  };
  const spendUntil = (wanted) => {
    for (let i = 0; i < 2000 && !wanted(peek); i++) {
      const { n } = peek((r) => rollLoot('goblin', r));
      game.loot.roll('goblin');
      used += n;
    }
    assert.ok(wanted(peek), 'the roll comes round');
  };
  // Notes draws the game itself made, as `fn` would make them.
  const spent = (fn) => { used += peek(fn).n; };
  return { ...loaded, notes, gains, views, spendUntil, spent };
}

function monsterAhead(game, kind, metres = 0.8) {
  const [dx, dy] = toCells(Math.sin(game.player.heading) * metres, Math.cos(game.player.heading) * metres);
  const monster = new Monster(game.player.x + dx, game.player.y + dy, { kind: KINDS[kind], risen: true });
  game.monsters.list.push(monster);
  return monster;
}

const cut = (game) => game.player.events.push({ type: 'strike', swing: 'cut', x: game.player.x, y: game.player.y, strength: 1 });
const walkTo = (game, frame, at, frames = 3) => {
  game.player.x = at.x;
  game.player.y = at.y;
  for (let i = 0; i < frames; i++) frame();
};

test('strike a goblin, it falls, its coin lies labelled by the body, and walking over it fills the pouch', async () => {
  const { game, frame, gains, views, spendUntil } = await start();
  spendUntil((peek) => peek((r) => rollLoot('goblin', r)).out[0]?.id === 'denars');
  const goblin = monsterAhead(game, 'goblin');
  goblin.health = 1;
  cut(game);
  frame();
  assert.equal(goblin.alive, false);
  assert.equal(views.at(-1).name, 'Goblin');
  assert.equal(views.at(-1).slain, true);
  const stacks = game.huntDrops.all();
  assert.deepEqual(stacks.map((s) => [s.id, s.count]), [['denars', 100]]);
  const [coin] = stacks;
  const d = Math.hypot(...toMetres(coin.x - goblin.x, coin.y - goblin.y));
  assert.ok(d >= 1.19 && d <= 3.01, `${d} m from the body`);
  assert.equal(game.wallet.balance, '0.00d');

  for (let i = 0; i < 40; i++) frame();
  walkTo(game, frame, coin);
  assert.equal(game.wallet.cents, 100);
  assert.equal(game.wallet.balance, '1.00d');
  assert.deepEqual(gains, [100], 'one gain told');
  assert.deepEqual(game.huntDrops.all(), []);
  for (let i = 0; i < 600; i++) frame();
  assert.equal(game.wallet.cents, 100, 'paid once');
  assert.deepEqual(game.huntDrops.all(), [], 'no second drop');
});

test('with a full bag the coin is taken and the bone left lying', async () => {
  const { game, frame, gains } = await start();
  for (let i = 0; i < 200 && game.inventory.spaceFor('bone', 1) > 0; i++) game.inventory.add('outlawHood');
  const skeleton = monsterAhead(game, 'skeleton');
  const [coin, bone] = game.loot.drop(skeleton, [{ id: 'denars', count: 73 }, { id: 'bone', count: 1 }]);
  coin.pickupAfter = 0;
  bone.pickupAfter = 0;
  walkTo(game, frame, coin);
  assert.equal(game.wallet.cents, 73);
  assert.deepEqual(gains, [73]);
  walkTo(game, frame, bone);
  assert.equal(bone.count, 1);
  assert.deepEqual(game.huntDrops.all(), [bone]);
  assert.equal(game.collection.prompt(game.player), 'Inventory full · Bone');
});

test('a felled tree now and then turns up coin beside the stump', async () => {
  const { game, frame, spendUntil, spent } = await start();
  const tree = { kind: 'tree', growth: 'mature', x: game.player.x + 2, y: game.player.y + 1 };
  game.harvesting.react = () => [{ status: 'harvested', node: tree, message: 'Felled a oak tree.' }];
  spendUntil((peek) => peek((r) => rollPay('tree', 3, r)).out.length === 0);
  cut(game);
  frame();
  spent((r) => rollPay('tree', 3, r));
  assert.deepEqual(game.huntDrops.all(), [], 'no coin this time');

  spendUntil((peek) => peek((r) => rollPay('tree', 3, r)).out.length > 0);
  cut(game);
  frame();
  const coins = game.huntDrops.all();
  assert.ok(coins.length >= 1 && coins.every((c) => c.id === 'denars' && c.count >= 50 && c.count <= 100));
  const total = coins.reduce((sum, c) => sum + c.count, 0);
  for (let i = 0; i < 40; i++) frame();
  for (const c of coins) walkTo(game, frame, c);
  assert.equal(game.wallet.cents, total);

  // A tree only hit, or something else harvested, pays nothing.
  game.harvesting.react = () => [{ status: 'hit', node: tree }, { status: 'harvested', node: { kind: 'grass' } }];
  spendUntil((peek) => peek((r) => rollPay('tree', 3, r)).out.length > 0);
  cut(game);
  frame();
  assert.deepEqual(game.huntDrops.all(), []);
});

test('struck down, the pouch is kept; TAKE pays a coin once with one notice', async () => {
  const { game, frame, gains, notes, tap } = await start();
  const skeleton = monsterAhead(game, 'skeleton');
  const [coin] = game.loot.drop(skeleton, [{ id: 'denars', count: 100 }]);
  coin.pickupAfter = 0;
  game.player.x = coin.x + 0.6;
  game.player.y = coin.y;
  // No magnet: only the button takes it.
  game.collection.update = () => {};
  tap('TouchInteract');
  frame();
  assert.equal(game.wallet.cents, 100);
  delete game.collection.update;
  for (let i = 0; i < 5; i++) frame();
  assert.deepEqual(gains, [100], 'told once');
  assert.ok(!notes.some(([text]) => /1\.00d/.test(text)), 'no second notice');

  game.player.vitals.health = 0;
  for (let i = 0; i < 400 && !notes.some(([text]) => /struck down/.test(text)); i++) frame();
  assert.ok(notes.some(([text]) => /struck down/.test(text)));
  assert.equal(game.wallet.balance, '1.00d');
});

test('the pouch is still there after the page is loaded again', async () => {
  const storage = memory();
  const first = await start({ storage });
  const [coin] = first.game.loot.drop(monsterAhead(first.game, 'skeleton'), [{ id: 'denars', count: 100 }]);
  coin.pickupAfter = 0;
  walkTo(first.game, first.frame, coin);
  assert.equal(first.game.wallet.cents, 100);
  assert.deepEqual(JSON.parse(storage.map.get(WALLET_KEY)), { v: 1, cents: 100 });

  const second = await start({ storage });
  assert.equal(second.game.wallet.balance, '1.00d', 'before any pickup');
});
