import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HORSE, Horse, Horses } from '../src/entities/horses.js';
import { toCells } from '../src/entities/monsters.js';
import { GRASS, WATER } from '../src/world/world.js';

// Open grass everywhere, or water wherever `wet` says.
const land = (wet = () => false) => ({ typeAt: (x, y) => (wet(x, y) ? WATER : GRASS), isWalkable: () => true });
const params = (query) => new URLSearchParams(query);
const spawn = { x: 100, y: 50 };

test('?horse=N stands 0 to 4 horses by the spawn, each a quarter turn from the last', () => {
  const world = land();
  for (const [query, n] of [['', 0], ['horse=0', 0], ['horse=2', 2], ['horse=4', 4], ['horse=9', 4], ['horse=-3', 0],
    ['horse=2.7', 2], ['horse=lots', 0]]) {
    assert.equal(Horses.fromParams(params(query), { world, seed: 1, spawn }).list.length, n, query);
  }
  const { list } = Horses.fromParams(params('horse=4'), { world, seed: 1, spawn });
  list.forEach((h, i) => {
    assert.ok(Math.abs(h.heading - (-0.7 + (i * Math.PI) / 2)) < 1e-9);
    const along = (i * 3.5) / Math.SQRT2;
    const [dx, dy] = toCells(4 + along, along);
    assert.ok(Math.abs(h.x - (spawn.x + dx)) <= 1 && Math.abs(h.y - (spawn.y + dy)) <= 1, `horse ${i}`);
    assert.deepEqual(h.rider, { look: 'outlaw' });
    assert.equal(h.kind, HORSE);
  });
  assert.equal(new Set(list.map((h) => h.id)).size, 4);
});

test('a horse stands on the nearest dry land within 6 m, or nowhere out on a lake', () => {
  const horses = new Horses({ seed: 3 });
  // Water left of x = 120.
  const shore = land((x) => x < 120);
  const h = horses.spawn({ world: shore, x: 100, y: 40 });
  assert.ok(h.x >= 120 && h.x < 124, `${h.x}`);
  assert.ok(Math.abs(h.y - 40.5) <= 1);
  assert.equal(h.heading, -0.7);
  assert.equal(horses.spawn({ world: land(() => true), x: 0, y: 0 }), null);
  assert.equal(horses.list.length, 1);
  const bare = horses.spawn({ world: land(), x: 10, y: 10, heading: 1, rider: false });
  assert.equal(bare.rider, null);
  assert.equal(bare.heading, 1);
  horses.remove(h);
  assert.deepEqual(horses.list, [bare]);
});

test('a ridden horse shifts its weight every 8 to 20 s and never grazes', () => {
  const h = new Horse(0, 0, { seed: 7 });
  const dt = 1 / 20;
  let last = 0;
  let shifts = 0;
  const gaps = [];
  let played = h.plays;
  for (let t = 0; t < 600; t += dt) {
    h.update(dt);
    assert.notEqual(h.clip, 'graze');
    assert.equal(h.state, 'idle');
    if (h.plays !== played && h.clip === 'shift') {
      gaps.push(t - last);
      shifts++;
    }
    if (h.plays !== played && h.clip === 'idle') last = t;
    played = h.plays;
  }
  assert.ok(shifts >= 600 / (20 + HORSE.lengths.shift) - 1 && shifts <= 600 / 8, `${shifts} shifts`);
  for (const gap of gaps.slice(1)) assert.ok(gap >= 8 - 0.1 && gap <= 20 + 0.1, `gap ${gap}`);
});

test('a riderless horse grazes now and then, at about its stated rate', () => {
  const h = new Horse(0, 0, { seed: 11, rider: false });
  const dt = 1 / 20;
  let grazes = 0;
  let idleTime = 0;
  let played = h.plays;
  for (let t = 0; t < 1800; t += dt) {
    if (h.clip === 'idle') idleTime += dt;
    h.update(dt);
    if (h.plays !== played && h.clip === 'graze') {
      grazes++;
      assert.equal(h.state, 'graze');
    }
    played = h.plays;
  }
  const expected = idleTime * HORSE.graze.chance;
  assert.ok(Math.abs(grazes - expected) < expected * 0.4, `${grazes} grazes, expected ${expected}`);
  // A graze plays out and the horse stands idle again.
  assert.ok(['idle', 'graze'].includes(h.state));
});

test('the manager poses every horse it holds', () => {
  const horses = Horses.fromParams(params('horse=2'), { world: land(), seed: 5, spawn });
  const before = horses.list.map((h) => h.clipTime);
  horses.update(0.5);
  horses.list.forEach((h, i) => assert.ok(h.clipTime > before[i]));
});
