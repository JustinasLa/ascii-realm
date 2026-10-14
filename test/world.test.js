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
