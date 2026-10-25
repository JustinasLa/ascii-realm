import assert from 'node:assert/strict';
import test from 'node:test';
import { KINDS, Monster, Monsters, toCells, toMetres } from '../src/entities/monsters.js';
import { loadGame } from './helpers/main-game.js';

// A game on open, loaded land, its notices kept.
async function start(options = {}) {
  const loaded = await loadGame(undefined, { href: 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0&animals=0',
    ...options, real: { Monsters, KINDS } });
  const { game } = loaded;
  game.world.loaded = () => ({ props: [] });
  game.world.isWalkable = () => true;
  game.world.typeAt = () => 1;
  const notes = [];
  game.hud.notify = (text, kind) => notes.push([text, kind]);
  return { ...loaded, notes };
}

// A risen monster of `kind` `metres` straight ahead of the player.
function monsterAhead(game, kind = 'skeleton', metres = 0.8) {
  const [dx, dy] = toCells(Math.sin(game.player.heading) * metres, Math.cos(game.player.heading) * metres);
  const monster = new Monster(game.player.x + dx, game.player.y + dy, { kind: KINDS[kind], risen: true });
  game.monsters.list.push(monster);
  return monster;
}

const cut = (game) => game.player.events.push({ type: 'strike', swing: 'cut', x: game.player.x, y: game.player.y, strength: 1 });
// A rune's blow as the spell system tells it: the health goes, then the game hears.
function spell(game, monster, amount, caster, removes = amount) {
  const wasAlive = monster.alive;
  monster.takeHit(removes, caster.x, caster.y);
  if (wasAlive && !monster.alive) game.monsters.kills++;
  game.monsters.collect(monster);
  game.casting.options.onDamage(monster, amount, { caster });
}

test('a skeleton cut down leaves its bones beside it once, which the player then picks up', async () => {
  const { game, frame, notes } = await start();
  const skeleton = monsterAhead(game);
  skeleton.health = 1;
  cut(game);
  frame();
  assert.equal(skeleton.alive, false);
  const stacks = game.huntDrops.all();
  assert.ok(stacks.some((s) => s.id === 'bone'), 'bones lie there');
  for (const s of stacks) {
    const d = Math.hypot(...toMetres(s.x - skeleton.x, s.y - skeleton.y));
    assert.ok(d >= 1.19 && d <= 3.01, `${d} m from the body`);
  }
  for (let i = 0; i < 60; i++) frame();
  assert.equal(game.huntDrops.all().length, stacks.length, 'no second drop');
  // The same death told again drops nothing more.
  assert.equal(game.loot.credit.claim(skeleton), false);

  for (const s of [...stacks]) {
    game.player.x = s.x;
    game.player.y = s.y;
    for (let i = 0; i < 3; i++) frame();
  }
  assert.ok(game.inventory.slots.some((s) => s?.id === 'bone'));
  assert.ok(notes.some(([text]) => /^Picked up Bone/.test(text)));
  assert.equal(game.huntDrops.all().length, 0);
});

test('a full bag leaves the loot lying until there is room', async () => {
  const { game, frame } = await start();
  for (let i = 0; i < 200 && game.inventory.spaceFor('bone', 1) > 0; i++) game.inventory.add('outlawHood');
  assert.equal(game.inventory.spaceFor('bone', 1), 0, 'the bag is full');
  const skeleton = monsterAhead(game);
  const [stack] = game.loot.drop(skeleton, [{ id: 'bone', count: 2 }]);
  stack.pickupAfter = 0;
  game.player.x = stack.x;
  game.player.y = stack.y;
  for (let i = 0; i < 5; i++) frame();
  assert.equal(stack.count, 2, 'still on the ground');
  assert.deepEqual(game.huntDrops.all(), [stack]);
  game.inventory.slots[game.inventory.slots.findIndex((s) => s?.id === 'outlawHood')] = null;
  for (let i = 0; i < 5; i++) frame();
  assert.equal(game.huntDrops.all().length, 0, 'picked up once there was room');
});

test('a hood the skeleton leaves can be picked up and worn', async () => {
  const { game, frame } = await start();
  const skeleton = monsterAhead(game);
  const [hood] = game.loot.drop(skeleton, [{ id: 'outlawHood', count: 1 }]);
  hood.pickupAfter = 0;
  game.player.x = hood.x;
  game.player.y = hood.y;
  for (let i = 0; i < 3; i++) frame();
  const index = game.inventory.slots.findIndex((s) => s?.id === 'outlawHood');
  assert.ok(index >= 0, 'in the bag');
  assert.equal(game.inventory.slots[index].durability ?? 100, 100);
  game.inventory.equip(index);
  assert.equal(game.inventory.equipment.helm?.id, 'outlawHood');
});

test('only the player\'s own spells earn loot, by the health they really took', async () => {
  const { game, frame } = await start();
  const peer = { x: game.player.x, y: game.player.y, spellPlayer: true };
  // Slain wholly by a friend's spell: nothing drops on this screen.
  const a = monsterAhead(game);
  spell(game, a, a.health + 10, peer);
  frame();
  assert.equal(a.alive, false);
  assert.equal(game.huntDrops.all().length, 0);

  // A cut first, then the friend's spell finishes it: the loot drops.
  const b = monsterAhead(game);
  cut(game);
  frame();
  assert.ok(b.health < b.maxHealth);
  spell(game, b, b.health + 10, peer);
  frame();
  assert.equal(b.alive, false);
  assert.ok(game.huntDrops.all().some((s) => s.id === 'bone'));
  for (const s of game.huntDrops.all()) game.huntDrops.forget(s);

  // A troll's hide shrugs off a rune said to deal 5, losing 0.2: that earns
  // nothing; one that really takes 2 does.
  const troll = monsterAhead(game, 'troll', 1.5);
  spell(game, troll, 5, game.player, 0.2);
  spell(game, troll, troll.health + 10, peer);
  frame();
  assert.equal(troll.alive, false);
  assert.equal(game.huntDrops.all().length, 0);
  const second = monsterAhead(game, 'troll', 1.5);
  spell(game, second, 5, game.player, 2);
  spell(game, second, second.health + 10, peer);
  frame();
  assert.equal(game.loot.credit.claim(second), false, 'claimed by its death');
  // With the roll forced, the troll's tier gives four ingots.
  assert.deepEqual(game.loot.drop(second, [{ id: 'ironIngot', count: 4 }]).map((s) => [s.id, s.count]), [['ironIngot', 4]]);
  for (let i = 0; i < 40; i++) assert.ok(game.loot.roll('troll').every((d) => d.id === 'ironIngot' && d.count === 4));
});
