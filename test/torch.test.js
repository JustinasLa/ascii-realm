import assert from 'node:assert/strict';
import test from 'node:test';
import { Player } from '../src/entities/player.js';
import { Fires, MAX_FIRES } from '../src/world/fire.js';
import { reflector } from '../src/world/reflection.js';
import { Torches, MAX_THROWN_TORCHES, torchGrip } from '../src/world/torch.js';
import { GRASS, WATER } from '../src/world/world.js';

const dryWorld = (overrides = {}) => ({ seed: 1, typeAt: () => GRASS,
  isWalkable: () => true, waterDepthAt: () => 0, burnGrass() {}, ...overrides });
const view = { x0: 0, y0: 0, cols: 100, rows: 80 };

function buffer(type = GRASS) {
  const r = { cols: view.cols, rows: view.rows,
    fg: new Uint8ClampedArray(view.cols * view.rows * 4),
    bg: new Uint8ClampedArray(view.cols * view.rows * 4),
    mask: new Uint8Array(view.cols * view.rows).fill(type) };
  r.put = (x, y, g, red, green, blue) => {
    assert.ok([x, y, g, red, green, blue].every(Number.isFinite));
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return;
    r.fg.set([red, green, blue, g], (y * r.cols + x) * 4);
  };
  r.putBg = (x, y, red, green, blue) => {
    assert.ok([red, green, blue].every(Number.isFinite));
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return;
    r.bg.set([red, green, blue, 0], (y * r.cols + x) * 4);
  };
  return r;
}

test('the player carries a torch, can stow and redraw it, and stays standing while it burns', () => {
  const player = new Player(40, 40);
  const torches = new Torches();
  assert.equal(player.torch, true);
  assert.equal(torches.prepare(view, 1, player).length, 1);
  for (let i = 0; i < 150; i++) player.update(0.1, dryWorld(), { x: 0, y: 0 }, false, false);
  assert.equal(player.kneel, 0);
  assert.equal(torches.toggle(player), 'stowed');
  assert.deepEqual(torches.prepare(view, 2, player), []);
  assert.equal(torches.throw(player), 'empty');
  assert.equal(torches.toggle(player), 'drawn');
  assert.equal(player.idle, 0);
});

test('the held torch follows the free hand across movement, turns, jumping and wading', () => {
  const player = new Player(40, 40);
  const torches = new Torches();
  const first = { ...torches.hold(player) };
  player.x += 10;
  player.y -= 5;
  const moved = torches.hold(player);
  assert.ok(Math.abs(moved.x - first.x - 10) < 1e-8);
  assert.ok(Math.abs(moved.y - first.y + 5) < 1e-8);
  player.heading = Math.PI;
  const turned = torchGrip(player);
  assert.ok(Math.abs(turned.x + first.x - 40) < 1e-8);
  const standing = turned.h;
  player.air = 0.7;
  assert.ok(torchGrip(player).h > standing + 8);
  player.air = 0;
  player.waterDepth = 0.42;
  assert.ok(torchGrip(player).h > 0);
  assert.ok(torchGrip(player).h < standing);
  const modelPose = { x: 8, y: 2, h: 12 };
  assert.deepEqual([torches.hold(player, modelPose).x, torches.carried.y, torches.carried.h], [58, 37, 12]);
});

test('throwing leaves the hand immediately, flies forward, and ignites exactly once on landing', () => {
  const world = dryWorld();
  const fires = new Fires({ windAt: () => 0.3 });
  const torches = new Torches();
  const player = new Player(0, 0);
  player.heading = Math.PI / 2;
  assert.equal(torches.throw(player, { x: 0, y: 0, h: 12 }), 'thrown');
  assert.equal(player.torch, false);
  assert.equal(torches.throw(player), 'empty');
  assert.equal(torches.list.length, 1);
  assert.deepEqual(torches.update(0.1, world, fires), []);
  assert.equal(fires.list.length, 0, 'no fire in midair');
  assert.ok(torches.list[0].x > 6 && torches.list[0].h > 12);
  const impacts = torches.update(2, world, fires);
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].type, 'lit');
  assert.ok(impacts[0].x > 60);
  assert.ok(Math.abs(impacts[0].y) < 1e-8);
  assert.equal(fires.list.length, 1);
  assert.equal(fires.list[0].kind, 'ground');
  assert.equal(torches.list.length, 0);
  assert.deepEqual(torches.update(2, world, fires), []);
  assert.equal(fires.list.length, 1);
});

test('a second torch landing on the same fire reports feeding it, not a new fire', () => {
  const world = dryWorld();
  const fires = new Fires({ windAt: () => 0 });
  const torches = new Torches();
  const player = new Player(0, 0);
  player.heading = Math.PI / 2;
  torches.throw(player, { x: 0, y: 0, h: 12 });
  assert.equal(torches.update(2, world, fires)[0].type, 'lit');
  torches.toggle(player);
  torches.throw(player, { x: 0, y: 0, h: 12 });
  const [impact] = torches.update(2, world, fires);
  assert.equal(impact.type, 'fed');
  assert.equal(impact.fire, fires.list[0]);
  assert.equal(fires.list.length, 1);
});

test('landing in water extinguishes the torch, while flying over water can reach dry ground', () => {
  for (const landsInWater of [true, false]) {
    const world = dryWorld({ typeAt: x => landsInWater || (x > 10 && x < 30) ? WATER : GRASS,
      burnGrass() { assert.equal(landsInWater, false); } });
    const torches = new Torches();
    const fires = new Fires();
    const player = new Player(0, 0);
    player.heading = Math.PI / 2;
    torches.throw(player, { x: 0, y: 0, h: 12 });
    const [impact] = torches.update(2, world, fires);
    assert.equal(impact.type, landsInWater ? 'water' : 'lit');
    assert.equal(fires.list.length, landsInWater ? 0 : 1);
    assert.equal(torches.list.length, 0);
  }
});

test('solid obstacles stop a throw on the near side, even in one long frame', () => {
  const world = dryWorld({ isWalkable: x => x < 15 || x >= 16 });
  const torches = new Torches();
  const fires = new Fires();
  const player = new Player(0, 0);
  player.heading = Math.PI / 2;
  torches.throw(player, { x: 0, y: 0, h: 12 });
  const [impact] = torches.update(2, world, fires);
  assert.equal(impact.type, 'lit');
  assert.ok(impact.x < 15 && impact.x > 13);
  assert.ok(fires.list[0].x < 15);
});

test('torch ignition accepts a small dry patch, coalesces nearby fires and obeys the fire cap', () => {
  let burns = 0;
  const fires = new Fires();
  const patch = dryWorld({ typeAt: (x, y) => Math.floor(x) === 0 && Math.floor(y) === 0 ? GRASS : WATER,
    burnGrass() { burns++; } });
  assert.equal(fires.add(patch, 0, 0), null, 'a stone ring cannot fit');
  const fire = fires.ignite(patch, 0.2, 0.1);
  assert.ok(fire);
  assert.equal(fire.kind, 'ground');
  assert.equal(burns, 1);
  assert.equal(fires.ignite(patch, 0.9, 0.9), fire);
  assert.equal(burns, 1);
  assert.equal(fires.ignite(patch, 2, 2), null);
  assert.equal(fires.ignite(patch, NaN, 0), null);
  assert.equal(fires.ignite(dryWorld({ isWalkable: () => false }), 40, 0), null);
  for (let i = 1; i < MAX_FIRES; i++) assert.ok(fires.ignite(dryWorld(), i * 100, 0));
  assert.equal(fires.ignite(dryWorld(), -100, 0), null);
  assert.equal(fires.ignite(patch, 0, 0), fire, 'an existing fire still accepts a torch at the cap');
});

test('torch glow warms nearby cells, follows its source and preserves glyphs and terrain masks', () => {
  const torches = new Torches();
  const player = new Player(40, 40);
  const sources = torches.prepare(view, 1, player, { x: 0, y: 0, h: 7 });
  const r = buffer();
  r.fg.forEach((_, i) => { if (i % 4 === 3) r.fg[i] = 10; });
  const glyphs = r.fg.filter((_, i) => i % 4 === 3);
  const mask = [...r.mask];
  torches.light(r, view, 1, sources);
  const at = (x, y) => (y * r.cols + x) * 4;
  assert.ok(r.fg[at(40, 27)] > 100);
  assert.ok(r.bg[at(40, 40)] > 0, 'light reaches the ground around the player');
  assert.ok(r.fg[at(40, 27)] > r.fg[at(40, 27) + 1]);
  assert.equal(r.fg[at(50, 27)], r.fg[at(40, 33)], 'aspect-correct light is round');
  assert.equal(r.fg[at(0, 0)], 0);
  assert.deepEqual(r.fg.filter((_, i) => i % 4 === 3), glyphs);
  assert.deepEqual([...r.mask], mask);
  torches.toggle(player);
  const stowed = buffer();
  torches.light(stowed, view, 1, torches.prepare(view, 1, player));
  assert.equal(stowed.bg.some(value => value > 0), false);
});

test('torch flames animate, reflect only in water, and clip safely at view edges', () => {
  const torches = new Torches();
  const player = new Player(40, 25);
  const [torch] = torches.prepare(view, 1, player);
  const first = JSON.stringify(torch.cells);
  torches.prepare(view, 1.5, player);
  assert.notEqual(JSON.stringify(torch.cells), first);
  const r = buffer();
  torches.draw(r, view, torch);
  assert.ok(r.fg.some(value => value === 255));
  const dry = buffer();
  const water = buffer(WATER);
  torches.draw(dry, view, torch, reflector(1.5, view));
  torches.draw(water, view, torch, reflector(1.5, view));
  assert.equal(dry.fg.some(value => value > 0), false);
  assert.ok(water.fg.some(value => value > 60));
  torches.draw(buffer(), { ...view, x0: 42, y0: 25 }, torch);
  assert.deepEqual(torches.prepare({ ...view, x0: 1000 }, 1.5, player), []);
});

test('flying torches stay bounded, paused time preserves them and long gaps settle throws', () => {
  const player = new Player(40, 40);
  const torches = new Torches();
  const fires = new Fires();
  for (let i = 0; i < MAX_THROWN_TORCHES; i++) {
    player.torch = true;
    assert.equal(torches.throw(player), 'thrown');
  }
  player.torch = true;
  assert.equal(torches.throw(player), 'busy');
  assert.equal(player.torch, true, 'the held item is kept if the flight cap is reached');
  const before = JSON.stringify(torches.list);
  for (const dt of [0, -1, NaN, Infinity]) assert.deepEqual(torches.update(dt, dryWorld(), fires), []);
  assert.equal(JSON.stringify(torches.list), before);
  assert.equal(torches.update(300, dryWorld(), fires).length, MAX_THROWN_TORCHES);
  assert.equal(torches.list.length, 0);
  assert.equal(fires.list.length, 1, 'overlapping landings share one fire');
});
