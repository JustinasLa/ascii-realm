import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PITCH, pitchLook } from '../src/world/camera.js';
import { LIFT_PER_METRE, MAX_LIFT } from '../src/world/relief.js';
import { CHUNK_SIZE, World } from '../src/world/world.js';

const hillWorld = () => new World(1, { relief: 'hill', rivers: false });

// The hill's chunks round spawn, generated.
function loadHill(world) {
  const { relief } = world;
  for (let cy = Math.floor(relief.y0 / CHUNK_SIZE); cy <= Math.floor(relief.y1 / CHUNK_SIZE); cy++) {
    for (let cx = Math.floor(relief.x0 / CHUNK_SIZE); cx <= Math.floor(relief.x1 / CHUNK_SIZE); cx++) world.chunk(cx, cy);
  }
  return [...world.chunks.values()];
}

const column = (world, dx, dy0, n) => Array.from({ length: n }, (_, k) => world.liftAt(world.spawn.x + dx, world.spawn.y + dy0 + k));

test('a higher camera flattens the hill and a lower one towers it', () => {
  const world = hillWorld();
  const heights = (deg) => {
    world.setRise(pitchLook(deg).rise);
    return [Math.max(...column(world, 0, -50, 60)), world.liftAt(world.spawn.x + 75, world.spawn.y - 6)];
  };
  assert.deepEqual(heights(45), [10, 7]);
  assert.deepEqual(heights(25), [22, 14]);
  assert.deepEqual(heights(30), [18, 11]);
});

test('re-lifting keeps every chunk in step with liftAt, in range, and back to a fresh world', () => {
  const world = hillWorld();
  const chunks = loadHill(world);
  const fresh = new Map(chunks.map((c) => [c, [c.lift?.slice(), c.liftRows?.slice()]]));
  for (const deg of [PITCH.min, 37, PITCH.max]) {
    world.setRise(pitchLook(deg).rise);
    for (const c of chunks) {
      if (!c.lift) continue;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        let most = 0;
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const x = c.cx * CHUNK_SIZE + lx;
          const y = c.cy * CHUNK_SIZE + ly;
          const lift = c.lift[ly * CHUNK_SIZE + lx];
          assert.ok(lift <= MAX_LIFT, `${deg}° ${x},${y}`);
          if (c.baseType[ly * CHUNK_SIZE + lx] > 1) assert.equal(lift, world.liftAt(x, y), `${deg}° ${x},${y}`);
          most = Math.max(most, lift);
        }
        assert.equal(c.liftRows[ly], most);
      }
    }
  }
  world.setRise(LIFT_PER_METRE);
  for (const c of chunks) assert.deepEqual([c.lift?.slice(), c.liftRows?.slice()], fresh.get(c));
  // A chunk generated later is lifted at the pitch of the time.
  world.setRise(pitchLook(45).rise);
  world.chunks.clear();
  assert.equal(Math.max(...column(world, 0, -50, 60)), 10);
  const crest = world.chunk(Math.floor(world.spawn.x / CHUNK_SIZE), Math.floor((world.spawn.y - 24) / CHUNK_SIZE));
  assert.equal(Math.max(...crest.liftRows), 10);
});

test('the flat world has nothing to re-lift', () => {
  const world = new World(1);
  world.chunk(0, 0);
  world.setRise(pitchLook(45).rise);
  assert.equal(world.relief, null);
  assert.equal(world.liftAt(0, 0), 0);
});

// How many rows of the feet of someone standing at (x, y) the ground in
// front of them hides: how far above the feet's drawn row the nearest raised
// top in front reaches.
function hiddenFeet(world, x, y) {
  let top = y - world.liftAt(x, y);
  for (let k = 1; k <= MAX_LIFT + 1; k++) top = Math.min(top, y + k - world.liftAt(x, y + k));
  return y - world.liftAt(x, y) - top;
}

test('the higher the camera, the more of someone behind the crest shows', () => {
  const world = hillWorld();
  const x = Math.floor(world.spawn.x) + 20;
  const y = Math.floor(world.spawn.y) - 39;
  const hidden = [25, 30, 45].map((deg) => {
    world.setRise(pitchLook(deg).rise);
    return hiddenFeet(world, x, y);
  });
  assert.deepEqual(hidden, [11, 6, 0], 'seen over the ridge from 45°');
});
