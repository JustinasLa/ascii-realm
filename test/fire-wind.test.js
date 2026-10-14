import assert from 'node:assert/strict';
import test from 'node:test';
import { fireWeatherWind } from '../src/world/fire-wind.js';
import { Fires } from '../src/world/fire.js';
import { GRASS } from '../src/world/world.js';

test('weather wind follows preset, intensity and clock independently of audio unlock', () => {
  for (const preset of ['clear', 'fog', 'unknown']) assert.equal(fireWeatherWind({preset, intensity: 1}, 5), 0);
  const full = fireWeatherWind({preset: 'gale', intensity: 1}, 5);
  const half = fireWeatherWind({preset: 'gale', intensity: 0.5}, 5);
  assert.equal(half, full / 2);
  assert.equal(fireWeatherWind({preset: 'gale', intensity: 0}, 5), 0);
  assert.ok(full > 0.4 && full <= 1);
});

test('a saved full-intensity gale can extinguish a campfire through the normal update loop', () => {
  const world = {seed: 1, typeAt: () => GRASS, isWalkable: () => true, burnGrass() {}};
  const fires = new Fires({windAt: () => 0.3});
  fires.add(world, 0.5, 0.5);
  for (let time = 0.1; time <= 30 && fires.list.length; time += 0.1) {
    fires.update(0.1, time, world, fireWeatherWind({preset: 'gale', intensity: 1}, time));
  }
  assert.equal(fires.list.length, 0);
});
