import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Fireflies } from '../src/world/fireflies.js';
import { GRASS, STONE } from '../src/world/world.js';

function terrain(type = STONE) {
  return {
    type,
    queries: 0,
    typeAt() {
      this.queries++;
      return this.type;
    },
  };
}

test('failed spawns wait before retrying and never draw invisible placeholders', () => {
  const world = terrain();
  const fireflies = new Fireflies();
  fireflies.update(1 / 60, 0, world, 0, 0, 20, 13);
  const firstQueries = world.queries;
  assert.equal(firstQueries, 4 * 8, 'try each of the four slots only once initially');
  for (let i = 1; i < 60; i++) fireflies.update(1 / 60, i / 60, world, 0, 0, 20, 13);
  assert.equal(world.queries, firstQueries, 'stationary frames do not keep querying barren terrain');

  const r = {
    cols: 40,
    fg: new Uint8ClampedArray(40 * 26 * 4),
    bg: new Uint8ClampedArray(40 * 26 * 4),
    put() { assert.fail('failed spawns must not be drawn'); },
  };
  fireflies.draw(r, { x0: -20, y0: -13, cols: 40, rows: 26 }, 1);
  assert.ok(r.fg.every((v) => v === 0));
  assert.ok(r.bg.every((v) => v === 0));

  fireflies.update(1 / 60, 1, world, 0, 0, 20, 13);
  assert.equal(world.queries, firstQueries * 2, 'retry after the delay');
});

test('failed spawns recover when grass becomes available after the retry delay', () => {
  const world = terrain();
  const fireflies = new Fireflies();
  fireflies.update(0, 0, world, 0, 0, 20, 13);
  world.type = GRASS;
  fireflies.update(0, 1, world, 0, 0, 20, 13);
  assert.equal(world.queries, 4 * 8 + 4);
  assert.equal(fireflies.list.length, 4);
  assert.ok(fireflies.list.every((f) => Number.isFinite(f.phase)));
});

test('camera movement can retry earlier without retrying for tiny camera drift', () => {
  const world = terrain();
  const fireflies = new Fireflies();
  fireflies.update(0, 0, world, 0, 0, 20, 13);
  const firstQueries = world.queries;
  world.type = GRASS;
  fireflies.update(0, 0.1, world, 0.1, 0.1, 20, 13);
  assert.equal(world.queries, firstQueries);
  fireflies.update(0, 0.2, world, 100, 100, 20, 13);
  assert.equal(world.queries, firstQueries + 4);
  assert.ok(fireflies.list.every((f) => Math.abs(f.x - 100) <= 20 && Math.abs(f.y - 100) <= 13));
  assert.ok(fireflies.list.every((f) => Number.isFinite(f.phase)));
});

test('successful spawns retain the same density as the viewport changes', () => {
  const world = terrain(GRASS);
  const fireflies = new Fireflies();
  for (const [halfW, halfH, count] of [[20, 13, 4], [40, 26, 16], [10, 13, 2]]) {
    fireflies.update(0, 0, world, 0, 0, halfW, halfH);
    assert.equal(fireflies.list.length, count);
    assert.ok(fireflies.list.every((f) => Number.isFinite(f.phase)));
  }
});
