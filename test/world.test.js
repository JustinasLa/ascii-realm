import assert from 'node:assert/strict';
import { test } from 'node:test';
import { World } from '../src/world/world.js';

test('distant chunks retain distinct terrain and coordinates', () => {
  const coordinates = [[200, 65536], [201, 0]];
  for (const order of [coordinates, [...coordinates].reverse()]) {
    const world = new World(1);
    const chunks = order.map(([cx, cy]) => world.chunk(cx, cy));
    assert.ok(chunks[0] !== chunks[1], 'distinct coordinates must not share a chunk');
    chunks.forEach((chunk, i) => {
      assert.deepEqual([chunk.cx, chunk.cy], order[i]);
      assert.equal(world.chunk(...order[i]), chunk);
    });
  }
});

test('trimming keeps the most recently used chunks within the cache size', () => {
  const world = new World(3, { maxChunks: 64 });
  for (let i = 0; i < 40; i++) world.chunk(i, 0);
  const recent = world.chunk(0, 0);
  world.maxChunks = 16;
  world.trim();
  assert.equal(world.chunks.size, 16);
  assert.equal(world.chunk(0, 0), recent, 'the chunk just used survives');
});
