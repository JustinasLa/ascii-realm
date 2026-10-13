import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueNoise } from '../src/core/noise.js';
import { EnvironmentSampler, grassGust, nightAmount, surfaceAt } from '../src/audio/environment.js';
import { ASPECT, WATER, SHORE, GRASS, DIRT, STONE } from '../src/world/world.js';

function terrain(cells = [], fallback = GRASS) {
  const tiles = new Map(cells.map(([x, y, type]) => [`${x},${y}`, type]));
  return {
    seed: 123,
    calls: 0,
    typeAt(x, y) {
      this.calls++;
      assert.equal(x, Math.floor(x), 'terrain receives integer coordinates');
      assert.equal(y, Math.floor(y), 'terrain receives integer coordinates');
      return tiles.get(`${x},${y}`) ?? fallback;
    },
  };
}

function lake(x0, x1, y0, y1) {
  const cells = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) cells.push([x, y, WATER]);
  }
  return cells;
}

test('footstep surfaces classify every terrain, with fractional and negative positions', () => {
  const world = terrain([
    [-2, -3, WATER], [4, 3, SHORE], [7, 3, DIRT], [10, 3, STONE],
  ]);
  assert.equal(surfaceAt(world, -1.2, -2.1), 'water');
  assert.equal(surfaceAt(world, 4.9, 3.8), 'sand');
  assert.equal(surfaceAt(world, 7.1, 3.9), 'dirt');
  assert.equal(surfaceAt(world, 10.2, 3.3), 'rock');
  assert.equal(surfaceAt(world, 20.2, 3.3), 'grass');
});

test('all four water-adjacent shore edges sound wet; a diagonal lake stays dry', () => {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    assert.equal(surfaceAt(terrain([[0, 0, SHORE], [dx, dy, WATER]]), 0.5, 0.5), 'water');
  }
  assert.equal(surfaceAt(terrain([[0, 0, SHORE], [1, 1, WATER]]), 0.5, 0.5), 'sand');
});

test('wind matches the rendered grass noise field at multiple positions and times', () => {
  const world = terrain();
  for (const [x, y, time] of [[0, 0, 0], [-31.4, 8.2, 15], [80.1, -49.7, 120]]) {
    const renderedGust = valueNoise(x * ASPECT * 0.035 - time * 0.55,
      y * 0.035 + time * 0.12, world.seed + 900);
    assert.equal(grassGust(world, x, y, time), renderedGust);
    assert.ok(renderedGust >= 0 && renderedGust <= 1);
  }
  assert.equal(world.calls, 0, 'wind does not query terrain');
});

test('the 240-second environmental cycle starts at night and stays bounded', () => {
  assert.equal(nightAmount(0), 1);
  assert.equal(nightAmount(120), 0);
  assert.equal(nightAmount(240), 1);
  assert.ok(Math.abs(nightAmount(60) - 0.5) < 1e-12);
  for (let time = -480; time <= 960; time += 7) {
    const level = nightAmount(time);
    assert.ok(Number.isFinite(level) && level >= 0 && level <= 1);
    assert.ok(Math.abs(level - nightAmount(time + 240)) < 1e-12);
  }
});

test('malformed day/night times fall back to the initial night setting', () => {
  for (const time of [NaN, Infinity, -Infinity, undefined]) {
    assert.equal(nightAmount(time), 1);
  }
});

test('constructing an environmental sampler does not probe the world', () => {
  const world = terrain();
  const sampler = new EnvironmentSampler(world);
  assert.equal(world.calls, 0);
  const signals = sampler.update(0, 0.5, 0.5, 0);
  assert.equal(signals.water, null);
  assert.equal(signals.night, 1);
  assert.ok(world.calls > 0, 'first active update samples nearby water');
  assert.ok(world.calls < 1000, 'dry terrain search has a bounded sparse probe budget');
});

test('water source uses aspect-correct distance and selects the nearest lake', () => {
  const sampler = new EnvironmentSampler(terrain([
    ...lake(20, 40, -8, 8), ...lake(-8, 8, 15, 25), ...lake(-40, -30, -8, 8),
  ]));
  const water = sampler.update(0, 0.5, 0.5, 0).water;
  assert.deepEqual(water, { x: 20.5, y: 0.5, strength: 1 - 20 * ASPECT / 40 });
});

test('water sampling is cached, refreshes on elapsed time, and ignores negative dt', () => {
  const world = terrain(lake(10, 20, -8, 8));
  const sampler = new EnvironmentSampler(world);
  sampler.update(0, 0.5, 0.5, 0);
  const firstCalls = world.calls;
  sampler.update(0.1, 0.5, 0.5, 0.1);
  sampler.update(-20, 0.5, 0.5, 0.2);
  sampler.update(NaN, 0.5, 0.5, 0.2);
  sampler.update(Infinity, 0.5, 0.5, 0.2);
  sampler.update(0.2, 0.5, 0.5, 0.3);
  assert.equal(world.calls, firstCalls);
  sampler.update(0.11, 0.5, 0.5, 0.41);
  assert.ok(world.calls > firstCalls, 'elapsed time refreshes cached lake lookup');
});

test('movement triggers refresh at four aspect-correct world units', () => {
  const world = terrain(lake(10, 20, -8, 8));
  const sampler = new EnvironmentSampler(world);
  sampler.update(0, 0.5, 0.5, 0);
  const firstCalls = world.calls;
  sampler.update(0, 0.5 + 3.9 / ASPECT, 0.5, 0);
  assert.equal(world.calls, firstCalls);
  sampler.update(0, 0.5 + 4.1 / ASPECT, 0.5, 0);
  assert.ok(world.calls > firstCalls);
});

test('cached water attenuation changes smoothly between terrain refreshes', () => {
  const world = terrain(lake(10, 20, -8, 8));
  const sampler = new EnvironmentSampler(world);
  const start = sampler.update(0, 0.5, 0.5, 0).water;
  const firstCalls = world.calls;
  const closer = sampler.update(0, 1.5, 0.5, 0).water;
  const farther = sampler.update(0, -0.5, 0.5, 0).water;
  assert.equal(world.calls, firstCalls);
  assert.equal(closer.x, start.x);
  assert.equal(farther.y, start.y);
  assert.ok(Math.abs((closer.strength - start.strength) - ASPECT / 40) < 1e-12);
  assert.ok(Math.abs((start.strength - farther.strength) - ASPECT / 40) < 1e-12);
  for (const water of [start, closer, farther]) {
    assert.ok(Number.isFinite(water.strength) && water.strength >= 0 && water.strength <= 1);
  }
});

test('water is full strength at its source and inaudible at the radius boundary', () => {
  const near = new EnvironmentSampler(terrain([[0, 0, WATER]]));
  assert.equal(near.update(0, 0.5, 0.5, 0).water.strength, 1);
  const edge = new EnvironmentSampler(terrain([[0, 40, WATER]]));
  assert.equal(edge.update(0, 0.5, 0.5, 0).water, null);
  const outside = new EnvironmentSampler(terrain([[0, 41, WATER]]));
  assert.equal(outside.update(0, 0.5, 0.5, 0).water, null);
});
