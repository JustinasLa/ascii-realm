import assert from 'node:assert/strict';
import test from 'node:test';
import { toCells } from '../src/entities/monsters.js';
import { TARGET } from '../src/core/target.js';
import { loadGame } from './helpers/main-game.js';

const DEG = Math.PI / 180;

// A game whose HUD keeps every target view it is given.
async function start(options) {
  const loaded = await loadGame(undefined, options);
  const views = [];
  loaded.game.hud.setTarget = (view) => views.push(view);
  loaded.game.world.loaded = () => ({ props: [] });
  return { ...loaded, views, last: () => views.at(-1) };
}

// An animal `metres` from the player at `angle` off their facing, alone.
function animalAt(game, kind, metres, angle = 0) {
  const [dx, dy] = toCells(Math.sin(angle) * metres, Math.cos(angle) * metres);
  const animal = game.animals.spawn(kind, { x: game.player.x + dx, y: game.player.y + dy, count: 1 }).members[0];
  game.animals.calm();
  return animal;
}

// A monster in the stand-in list that the sword's cut always reaches.
function monsterAt(game, id, metres, angle = 0, name = 'Skeleton') {
  const [dx, dy] = toCells(Math.sin(angle) * metres, Math.cos(angle) * metres);
  const monster = { id, kind: { name, radius: 0.6 }, alive: true, state: 'chase', health: 60, maxHealth: 60,
    x: game.player.x + dx, y: game.player.y + dy };
  game.monsters.list.push(monster);
  return monster;
}

const cut = (game) => game.player.events.push({ type: 'strike', swing: 'cut', x: game.player.x, y: game.player.y, strength: 1 });

test('a sword cut on a deer makes it the target, shown with its health', async () => {
  const { game, frame, last } = await start();
  frame();
  assert.equal(last(), null, 'nothing is targeted at first');
  const deer = animalAt(game, 'deer', 1);
  cut(game);
  frame();
  assert.equal(game.target.entity, deer);
  assert.deepEqual({ ...last() }, { id: `animal:${deer.id}`, name: 'Deer', health: deer.health, maxHealth: deer.maxHealth,
    note: '', slain: false });
  assert.ok(deer.health < deer.maxHealth);
});

test('an arrow that strikes a rabbit makes it the target', async () => {
  const { game, frame, last } = await start();
  const rabbit = animalAt(game, 'rabbit', 5);
  game.projectiles.launch({ x: game.player.x, y: game.player.y, h: 13 * 1.1, aimTarget: { x: rabbit.x, y: rabbit.y },
    projectile: { kind: 'arrow' }, strength: 1, damage: 4 });
  for (let i = 0; i < 40 && !game.target.entity; i++) frame();
  assert.equal(game.target.entity, rabbit);
  assert.equal(last().name, 'Rabbit');
});

test('one swing through a skeleton and a deer targets the one ahead, or the one the assist turned to', async () => {
  const { game, frame } = await start();
  const deer = animalAt(game, 'deer', 1, 30 * DEG);
  const skeleton = monsterAt(game, 1, 1, 5 * DEG);
  game.monsters.strike = (event) => event.type === 'strike' ? [skeleton] : [];
  cut(game);
  frame();
  assert.ok(deer.health < deer.maxHealth, 'the deer was struck too');
  assert.equal(game.target.entity, skeleton, 'the skeleton is nearer straight ahead');

  // STRIKE on a touch screen turns to the nearest foe ahead, which wins
  // over the one more nearly straight ahead; J does not.
  for (const [key, expect] of [['TouchStrike', 'near'], ['KeyJ', 'ahead']]) {
    const touch = await start({ coarse: true });
    const near = monsterAt(touch.game, 2, 1, 20 * DEG);
    const ahead = monsterAt(touch.game, 3, 1.4, 0);
    touch.game.monsters.strike = (event) => event.type === 'strike' ? [ahead, near] : [];
    touch.tap(key);
    for (let i = 0; i < 40 && !touch.game.target.entity; i++) touch.frame(0.02);
    assert.equal(touch.game.target.entity, expect === 'near' ? near : ahead, key);
  }
});

test('a wound the player did not deal selects nothing', async () => {
  const { game, frame, last } = await start();
  const deer = animalAt(game, 'deer', 3);
  // A bite from something else in the wild.
  game.animals.hurt(deer, 10, { x: deer.x + 1, y: deer.y });
  frame();
  assert.ok(deer.health < deer.maxHealth);
  assert.equal(game.target.entity, null);
  assert.equal(last(), null);
});

test('a rune of the player\'s own marks what it struck; another\'s does not', async () => {
  const { game, frame, last } = await start();
  const { onDamage } = game.casting.options;
  const troll = monsterAt(game, 4, 3, 0, 'Troll');
  onDamage(troll, 10, { caster: {} });
  frame();
  assert.equal(game.target.entity, null);
  onDamage(troll, 10, { caster: game.player });
  frame();
  assert.equal(game.target.entity, troll);
  assert.equal(last().id, 'monster:4');
});

test('the target is shown slain for a moment after it dies, then cleared', async () => {
  const { game, frame, last } = await start();
  const rabbit = animalAt(game, 'rabbit', 1);
  rabbit.health = 1;
  cut(game);
  frame();
  assert.equal(rabbit.alive, false);
  assert.equal(last().slain, true);
  assert.equal(last().note, 'slain');
  for (let i = 0; i < (TARGET.slainHold - 0.2) * 60; i++) frame();
  assert.equal(last().slain, true, 'still held');
  for (let i = 0; i < 0.4 * 60; i++) frame();
  assert.equal(last(), null);
  assert.equal(game.target.entity, null);
});

test('a target that leaves the world, or a fall in battle, clears the frame', async () => {
  const { game, frame, last } = await start();
  const skeleton = monsterAt(game, 2, 1);
  game.monsters.strike = (event) => event.type === 'strike' ? [skeleton] : [];
  cut(game);
  frame();
  assert.equal(last().name, 'Skeleton');
  // Released or despawned while still alive: gone on the next frame.
  game.monsters.list.length = 0;
  frame();
  assert.equal(last(), null);

  const deer = animalAt(game, 'deer', 1);
  cut(game);
  frame();
  assert.equal(game.target.entity, deer);
  game.player.vitals.health = 0;
  frame();
  assert.equal(game.target.entity, null);
});

test('a second STRIKE the swing turns away keeps the foe the first one aimed at', async () => {
  const { game, tap, frame } = await start({ coarse: true });
  const near = monsterAt(game, 2, 1, 20 * DEG);
  const ahead = monsterAt(game, 3, 1.4, 0);
  game.monsters.strike = (event) => event.type === 'strike' ? [ahead, near] : [];
  tap('TouchStrike');
  frame(0.02);
  assert.equal(game.target.entity, null, 'the cut has not landed yet');
  // Pressed again mid-swing with the near foe out of reach of the assist:
  // the swing turns the press away and still cuts at the near one.
  const attack = game.player.attack;
  game.player.attack = () => false;
  const { x, y } = near;
  near.x = game.player.x + 100;
  tap('TouchStrike');
  frame(0.02);
  Object.assign(near, { x, y });
  game.player.attack = attack;
  for (let i = 0; i < 40 && !game.target.entity; i++) frame(0.02);
  assert.equal(game.target.entity, near);
});

test('an arrow landing after a rune in the same frame is the later blow, and wins', async () => {
  const { game, frame } = await start();
  const troll = monsterAt(game, 4, 3, 0, 'Troll');
  const rabbit = animalAt(game, 'rabbit', 5);
  // The rune strikes the troll every frame, before the arrow moves.
  const update = game.casting.update.bind(game.casting);
  game.casting.update = (dt) => {
    update(dt);
    game.casting.options.onDamage(troll, 1, { caster: game.player });
  };
  game.projectiles.launch({ x: game.player.x, y: game.player.y, h: 13 * 1.1, aimTarget: { x: rabbit.x, y: rabbit.y },
    projectile: { kind: 'arrow' }, strength: 1, damage: 4 });
  const marked = [];
  for (let i = 0; i < 40 && rabbit.health === rabbit.maxHealth; i++) {
    frame();
    marked.push(game.target.entity);
  }
  assert.ok(rabbit.health < rabbit.maxHealth, 'the arrow struck');
  assert.equal(marked.at(-2), troll, 'the rune marked the troll before the arrow landed');
  assert.equal(game.target.entity, rabbit);
});

test('separate rune impacts in one frame apply in landing order; within one, the hit ahead wins', async () => {
  const { game, frame } = await start();
  const ahead = monsterAt(game, 5, 3, 0, 'Troll');
  const aside = monsterAt(game, 6, 3, 60 * DEG, 'Goblin');
  let impacts = [];
  const update = game.casting.update.bind(game.casting);
  game.casting.update = (dt) => {
    update(dt);
    for (const { ctx, hits } of impacts) for (const struck of hits) game.casting.options.onDamage(struck, 1, ctx);
    impacts = [];
  };
  // The rune straight ahead lands first, then another off to the side.
  impacts = [{ ctx: { caster: game.player }, hits: [ahead] }, { ctx: { caster: game.player }, hits: [aside] }];
  frame();
  assert.equal(game.target.entity, aside, 'the later impact wins');
  // One impact through both picks the one straight ahead.
  impacts = [{ ctx: { caster: game.player }, hits: [aside, ahead] }];
  frame();
  assert.equal(game.target.entity, ahead);
});
