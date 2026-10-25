import assert from 'node:assert/strict';
import test from 'node:test';
import { toCells, toMetres } from '../src/entities/monsters.js';
import { loadGame } from './helpers/main-game.js';

test('the game runs frames with a herd about, drawn once its figures arrive', async () => {
  const { game, frame, loadAnimalFigures } = await loadGame();
  const [dx, dy] = toCells(12, 0);
  game.animals.spawn('deer', { x: game.player.x + dx, y: game.player.y + dy, count: 3 });
  for (let i = 0; i < 10; i++) frame();
  assert.equal(game.animals.list.length, 3);
  assert.equal(game.animals.events.length, 0, 'their events are spent each frame');
  const seen = { updates: 0, rasterised: 0 };
  await loadAnimalFigures({
    update: (dt, list) => { seen.updates++; assert.equal(list, game.animals.list); },
    rasterise: (view, list) => {
      seen.rasterised++;
      return list.map((animal) => ({ animal, cells: [], contacts: [{ x: animal.x, y: animal.y }], depth: animal.y,
        shadow: [0.7, 0.25], base: 0 }));
    },
  });
  for (let i = 0; i < 5; i++) frame();
  assert.ok(seen.updates >= 5 && seen.rasterised >= 5);
  assert.ok(game.animalFigures, 'the figures are on the debug handle');
  // Paused, the animals keep still.
  game.freeze = true;
  const before = game.animals.list.map((a) => [a.x, a.y]);
  frame();
  assert.deepEqual(game.animals.list.map((a) => [a.x, a.y]), before);
});

test('a noise the player makes reaches the animals through the frame', async () => {
  const { game, frame } = await loadGame();
  const [dx] = toCells(10, 0);
  game.animals.spawn('deer', { x: game.player.x + dx, y: game.player.y, count: 1 });
  game.animals.calm();
  game.player.events.push({ type: 'strike', x: game.player.x, y: game.player.y, strength: 1 });
  frame();
  assert.equal(game.animals.list[0].state, 'flee');
});

test('?animals=0 leaves the land empty and never loads the figures', async () => {
  const { game, frame } = await loadGame({ x: 0, y: 0 }, { href: 'http://localhost/?debug&animals=0' });
  game.animals.spawn('rabbit', { x: game.player.x, y: game.player.y });
  frame();
  assert.equal(game.animals.enabled, false);
  assert.equal(game.animals.list.length, 0);
  assert.equal(game.animalFigures, undefined);
});

test('?deer, ?rabbits and ?wolves cap each kind', async () => {
  const { game } = await loadGame({ x: 0, y: 0 }, { href: 'http://localhost/?debug&deer=2&rabbits=0&wolves=1' });
  assert.deepEqual(game.animals.counts, { deer: 2, rabbit: 0, wolf: 1 });
  const plain = await loadGame({ x: 0, y: 0 });
  assert.equal(plain.game.animals.counts.wolf, 4);
});

// A deer `metres` from the player at `angle` off their facing, alone.
function deerAt(game, metres, angle = 0) {
  const [dx, dy] = toCells(Math.sin(angle) * metres, Math.cos(angle) * metres);
  const deer = game.animals.spawn('deer', { x: game.player.x + dx, y: game.player.y + dy, count: 1 }).members[0];
  game.animals.calm();
  return deer;
}

test('a sword cut brings down a deer whose drops lie beside it, picked up with a notice', async () => {
  const { game, frame } = await loadGame();
  // Every chunk counts as loaded, so the drops have dry ground to lie on.
  game.world.loaded = () => ({ props: [] });
  const notes = [];
  const damage = [];
  game.hud.notify = (text, kind) => notes.push([text, kind]);
  game.hud.damage = (amount) => damage.push(amount);
  const deer = deerAt(game, 1);
  deer.health = 15;
  game.animals.random = () => 0;
  game.player.events.push({ type: 'strike', swing: 'cut', x: game.player.x, y: game.player.y, strength: 1 });
  frame();
  assert.equal(deer.alive, false);
  assert.equal(damage.length, 1, 'its damage number shows');
  assert.equal(game.animals.drops.length, 0, 'spent by the frame');
  const stacks = game.huntDrops.all();
  assert.deepEqual(stacks.map((s) => s.id).sort(), ['bone', 'deerHide', 'rawVenison']);
  for (const s of stacks) assert.ok(Math.hypot(...toMetres(s.x - deer.x, s.y - deer.y)) < 1.7);
  assert.equal(game.collection.items, game.huntDrops.items, 'the TAKE button reaches them');
  for (let i = 0; i < 40; i++) frame();
  for (const s of [...stacks]) {
    game.player.x = s.x;
    game.player.y = s.y;
    for (let i = 0; i < 3; i++) frame();
  }
  assert.ok(game.inventory.slots.some((s) => s?.id === 'deerHide'));
  assert.ok(game.inventory.slots.some((s) => s?.id === 'rawVenison'));
  assert.ok(notes.some(([text, kind]) => /^Picked up Deer Hide/.test(text) && kind === 'pickup'));
  assert.equal(game.huntDrops.all().length, 0);
  // A corpse and its drops on screen for a while raise nothing.
  for (let i = 0; i < 120; i++) frame();
});

test('touch TAKE on hunted drops tells each pickup once', async () => {
  const { game, frame, tap } = await loadGame(undefined, { coarse: true });
  game.world.loaded = () => ({ props: [] });
  const notes = [];
  game.hud.notify = (text, kind) => notes.push([text, kind]);
  const deer = deerAt(game, 1);
  deer.health = 15;
  game.animals.random = () => 0;
  game.player.events.push({ type: 'strike', swing: 'cut', x: game.player.x, y: game.player.y, strength: 1 });
  frame();
  const stacks = game.huntDrops.all();
  assert.equal(stacks.length, 3);
  for (const s of stacks) s.pickupAfter = 0;
  // Beside the first stack, TAKE picks it up; the rest are walked over.
  const [first, ...rest] = stacks;
  game.player.x = first.x + 3;
  game.player.y = first.y;
  tap('TouchInteract');
  frame();
  assert.equal(first.count, 0, 'taken by the tap');
  for (const s of rest) {
    game.player.x = s.x;
    game.player.y = s.y;
    for (let i = 0; i < 3; i++) frame();
  }
  assert.equal(game.huntDrops.all().length, 0, 'all taken');
  const picked = notes.filter(([text]) => /^Picked up/.test(text)).map(([text]) => text).sort();
  assert.deepEqual(picked, ['Picked up Bone.', 'Picked up Deer Hide.', 'Picked up Raw Venison.']);
});

test('two full-draw arrows bring down a deer and are spent; a miss startles it', async () => {
  const { game, frame } = await loadGame();
  const deer = deerAt(game, 6);
  const loose = () => game.projectiles.launch({ x: game.player.x, y: game.player.y, h: 13 * 1.1,
    aimTarget: { x: deer.x, y: deer.y }, projectile: { kind: 'arrow' }, strength: 1, damage: 22 });
  loose();
  for (let i = 0; i < 40; i++) frame();
  assert.equal(deer.health, 18);
  loose();
  for (let i = 0; i < 40; i++) frame();
  assert.equal(deer.alive, false);
  assert.equal(game.projectiles.landed.length, 0, 'no arrow left in the ground');
  const other = deerAt(game, 12, 0.6);
  const [mx, my] = toCells(2, 0);
  game.projectiles.launch({ x: game.player.x, y: game.player.y, h: 13 * 1.1,
    aimTarget: { x: other.x + mx, y: other.y + my }, projectile: { kind: 'arrow' }, strength: 1, damage: 22 });
  for (let i = 0; i < 60; i++) frame();
  assert.equal(other.health, 40);
  assert.equal(game.projectiles.landed.length, 1);
  assert.equal(other.state, 'flee', 'the arrow landing beside it sent it off');
});

test('touch STRIKE turns to an animal ahead, with a sword or a bow', async () => {
  const { game, frame, tap } = await loadGame(undefined, { coarse: true });
  deerAt(game, 1.2, 20 * Math.PI / 180);
  tap('TouchStrike');
  frame();
  assert.ok(Math.abs(game.player.facing - 20 * Math.PI / 180) < 1e-6);
  const bow = await loadGame(undefined, { coarse: true });
  bow.game.inventory.add('longbow');
  bow.game.inventory.add('arrow', 4);
  bow.game.inventory.equip(bow.game.inventory.slots.findIndex((s) => s?.id === 'longbow'));
  bow.frame();
  const deer = deerAt(bow.game, 6, 25 * Math.PI / 180);
  bow.hold('TouchStrike');
  for (let i = 0; i < 15; i++) bow.frame(0.05);
  assert.ok(Math.hypot(bow.game.player.aimTarget.x - deer.x, bow.game.player.aimTarget.y - deer.y) < 1e-6);
  bow.release('TouchStrike');
  for (let i = 0; i < 40; i++) bow.frame();
  assert.ok(deer.health < 40, 'the assisted arrow struck it');
});

const quiet = 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0';

// A pack of `count` wolves `metres` in front of the player.
function packAt(game, metres, count) {
  game.world.loaded = () => ({ props: [] });
  const [dx, dy] = toCells(0, metres);
  return game.animals.spawn('wolf', { x: game.player.x + dx, y: game.player.y + dy, count });
}

test('a wolf pack beside the player bites them, shaking the screen, through hundreds of frames', async () => {
  const { game, frame } = await loadGame(undefined, { href: quiet });
  const sounds = [];
  const play = game.sound.play.bind(game.sound);
  game.sound.play = (e) => {
    sounds.push(e.type);
    return play(e);
  };
  packAt(game, 3, 3);
  const before = game.player.vitals.health;
  for (let i = 0; i < 300; i++) frame();
  assert.ok(game.player.vitals.health < before, `${game.player.vitals.health}`);
  assert.ok(sounds.includes('swing'), 'a lunge is heard');
  // A bite on prey thuds softly.
  game.animals.events.push({ type: 'bite', x: game.player.x, y: game.player.y, animal: game.animals.list[0] });
  frame();
  assert.ok(sounds.filter((t) => t === 'slam').length > 0);
});

test('two sword cuts bring down a wolf, with its notice and its pelt', async () => {
  const { game, frame } = await loadGame(undefined, { href: quiet });
  const notes = [];
  game.hud.notify = (text, kind) => notes.push([text, kind]);
  const herd = packAt(game, 1, 1);
  const wolf = herd.members[0];
  // It stands still, its hurt window passing as usual.
  wolf.update = function (dt) {
    this.hurtFor = Math.max(0, this.hurtFor - dt);
  };
  game.animals.random = () => 0;
  game.player.heading = 0;
  game.player.events.push({ type: 'strike', swing: 'cut', x: game.player.x, y: game.player.y, strength: 1 });
  frame();
  for (let i = 0; i < 40; i++) frame();
  game.player.events.push({ type: 'strike', swing: 'cut', x: game.player.x, y: game.player.y, strength: 1 });
  frame();
  assert.equal(wolf.alive, false);
  assert.ok(notes.some(([text, kind]) => text === 'Wolf slain' && kind === 'pickup'));
  assert.deepEqual(game.huntDrops.all().map((s) => s.id).sort(), ['bone', 'wolfPelt']);
});

test('struck down by wolves, the player wakes at the start and the pack goes home', async () => {
  const { game, frame } = await loadGame(undefined, { href: quiet });
  const herd = packAt(game, 3, 3);
  herd.key = 'pack:0,0';
  game.player.vitals.health = 8;
  for (let i = 0; i < 600 && game.animals.count('wolf'); i++) frame();
  assert.equal(game.animals.count('wolf'), 0);
  assert.equal(game.player.vitals.health, game.player.vitals.maxHealth);
});
