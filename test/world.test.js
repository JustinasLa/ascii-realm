import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

// Digests taken on the code before dense woods existed: the sparse world's
// land, grass fields and props must not move by a byte.
test('the sparse world is the same land, grass and props as before dense woods', () => {
  const terrain = (world) => {
    const h = createHash('sha256');
    for (let cy = -1; cy <= 2; cy++) {
      for (let cx = -1; cx <= 2; cx++) {
        const c = world.chunk(cx, cy);
        for (const a of [c.type, c.elev, c.grassHeight, c.grassDensity]) h.update(Buffer.from(a.buffer));
      }
    }
    return h.digest('hex').slice(0, 16);
  };
  const props = (world) => {
    const h = createHash('sha256');
    for (let cy = -1; cy <= 2; cy++) {
      for (let cx = -1; cx <= 2; cx++) {
        for (const p of world.propsOf(cx, cy)) h.update(JSON.stringify([p.id, p.kind, p.x, p.y, p.footW, p.footH]));
      }
    }
    return h.digest('hex').slice(0, 16);
  };
  assert.equal(terrain(new World(7)), '4478fb69718fe77e');
  assert.equal(terrain(new World(19, { spawnRuins: true })), 'b7c04a641f77c6cb');
  assert.equal(props(new World(19, { spawnRuins: true })), '55f6a4c5c6960360');
});
