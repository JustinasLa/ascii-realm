import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GroundItems } from '../src/world/items.js';
import { CHUNK_SIZE, World } from '../src/world/world.js';

// Empty cached arrays let storage tests isolate ownership from terrain choices.
function emptyWorld() {
  const chunks = new Map();
  return {
    chunks,
    chunk(cx, cy) {
      const key = `${cx},${cy}`;
      if (!chunks.has(key)) chunks.set(key, { cx, cy, items: [] });
      return chunks.get(key);
    },
  };
}

test('ground arrays retain partial counts and depletion after exploration and another store', () => {
  const world = emptyWorld();
  const ground = new GroundItems(world);
  assert.equal(world.chunks.size, 0);
  const item = ground.add('ironIngot', 8, 4.5, 6.5);
  const original = ground.of(0, 0);
  assert.strictEqual(original, world.chunk(0, 0).items);
  item.count -= 3;
  ground.in(CHUNK_SIZE * 10, CHUNK_SIZE * 10, CHUNK_SIZE * 11, CHUNK_SIZE * 11);
  assert.strictEqual(ground.of(0, 0), original);
  assert.equal(ground.in(4, 6, 5, 7)[0].count, 5);

  const resumed = new GroundItems(world);
  assert.strictEqual(resumed.of(0, 0), original);
  assert.equal(resumed.remove(item), true);
  assert.equal(ground.remove(item), false);
  assert.deepEqual(ground.in(0, 0, CHUNK_SIZE - 1, CHUNK_SIZE - 1), []);
  assert.strictEqual(ground.of(0, 0), original);
  assert.equal(original.length, 0);
});

test('procedurally generated arrays persist every removal on chunk revisit', () => {
  const world = new World(1);
  const ground = new GroundItems(world);
  const list = ground.of(0, 0);
  const generated = [...list];
  assert.ok(generated.length > 0, 'exercise removal of actual generated finds');
  for (const item of generated) assert.equal(ground.remove(item), true);
  ground.of(3, -2);
  assert.strictEqual(ground.of(0, 0), list);
  assert.deepEqual(ground.in(0, 0, CHUNK_SIZE - 1, CHUNK_SIZE - 1), []);
  assert.equal(world.chunk(0, 0).items.length, 0);
});

test('range queries filter exact inclusive coordinates across negative chunk boundaries', () => {
  const ground = new GroundItems(emptyWorld());
  const low = ground.add('ironIngot', 1, -CHUNK_SIZE, -CHUNK_SIZE);
  const inside = ground.add('oakLog', 1, -0.25, -0.25);
  const high = ground.add('ironIngot', 1, 0, 0);
  ground.add('ironIngot', 1, 0.01, 0);
  ground.add('ironIngot', 1, -CHUNK_SIZE - 0.01, -CHUNK_SIZE);
  ground.add('ironIngot', 1, -4, 5);
  assert.deepEqual(ground.in(-CHUNK_SIZE, -CHUNK_SIZE, 0, 0), [low, inside, high]);
  assert.deepEqual(ground.in(-0.25, -0.25, -0.25, -0.25), [inside]);
  assert.deepEqual(ground.in(1, 0, -1, 0), []);
  assert.deepEqual(ground.in(0, 1, 0, -1), []);
  assert.deepEqual(ground.in(NaN, 0, 1, 1), []);
  assert.deepEqual(ground.in(0, 0, Infinity, 1), []);
});

test('drops have independent identities and preserve their pickup metadata', () => {
  const world = emptyWorld();
  const ground = new GroundItems(world);
  const origin = { x: 4.5, y: 6.5 };
  const first = ground.add('ironIngot', 25, 4.5, 6.5, { pickupAfter: 2, dropOrigin: origin });
  const second = ground.add('ironIngot', 2, 4.5, 6.5);
  const otherStore = new GroundItems(world);
  const third = otherStore.add('ironIngot', 1, 4.5, 6.5);
  assert.equal(new Set([first.uid, second.uid, third.uid]).size, 3);
  assert.notStrictEqual(first, second);
  assert.deepEqual(ground.in(4, 6, 5, 7), [first, second, third]);
  assert.equal(first.count, 25);
  assert.equal(first.pickupAfter, 2);
  assert.deepEqual(first.dropOrigin, origin);
  origin.x = 99;
  assert.equal(first.dropOrigin.x, 4.5);
  assert.equal(second.pickupAfter, 0);
  assert.equal(second.dropOrigin, null);
  assert.ok(Number.isFinite(first.phase));
  first.dropOrigin = null;
  assert.equal(ground.remove({ ...first }), false);
  assert.equal(ground.remove(first), true);
  assert.deepEqual(ground.in(4, 6, 5, 7), [second, third]);
});

test('moving an item rehomes its original identity without duplication or loss', () => {
  const world = emptyWorld();
  const ground = new GroundItems(world);
  const item = ground.add('oakLog', 3, CHUNK_SIZE - 0.01, 0.5, {
    pickupAfter: 1,
    dropOrigin: { x: CHUNK_SIZE - 0.01, y: 0.5 },
  });
  const uid = item.uid;
  const source = ground.of(0, 0);
  assert.equal(ground.move(item, CHUNK_SIZE, 0.5), true);
  assert.equal(source.length, 0);
  assert.strictEqual(ground.of(1, 0)[0], item);
  assert.deepEqual(ground.in(CHUNK_SIZE, 0, CHUNK_SIZE + 1, 1), [item]);
  assert.equal(ground.move(item, -0.01, -CHUNK_SIZE - 0.01), true);
  assert.equal(ground.of(1, 0).length, 0);
  assert.strictEqual(ground.of(-1, -2)[0], item);
  assert.equal(item.uid, uid);
  assert.equal(item.count, 3);
  assert.equal(item.pickupAfter, 1);
  assert.deepEqual(item.dropOrigin, { x: CHUNK_SIZE - 0.01, y: 0.5 });
  assert.equal(ground.move(item, -0.2, -CHUNK_SIZE - 0.2), true);
  assert.equal(ground.of(-1, -2).length, 1);
  assert.equal([...world.chunks.values()].flatMap((chunk) => chunk.items).filter((entry) => entry === item).length, 1);
  assert.equal(ground.remove(item), true);
  assert.equal(ground.move(item, 0, 0), false);
  assert.deepEqual(ground.of(-1, -2), []);
  assert.strictEqual(ground.of(0, 0), source);
});

test('invalid additions and moves leave the world and valid items untouched', () => {
  const world = emptyWorld();
  const ground = new GroundItems(world);
  for (const [id, count, x, y, options] of [
    ['unknown', 1, 0, 0],
    ['toString', 1, 0, 0],
    [{ toString: () => 'ironIngot' }, 1, 0, 0],
    ['ironIngot', 0, 0, 0],
    ['ironIngot', -1, 0, 0],
    ['ironIngot', 1.5, 0, 0],
    ['ironIngot', Number.MAX_SAFE_INTEGER + 1, 0, 0],
    ['ironIngot', 1, NaN, 0],
    ['ironIngot', 1, 0, Infinity],
    ['ironIngot', 1, Number.MAX_VALUE, 0],
    ['ironIngot', 1, 0, 0, null],
    ['ironIngot', 1, 0, 0, { pickupAfter: NaN }],
    ['ironIngot', 1, 0, 0, { pickupAfter: -1 }],
    ['ironIngot', 1, 0, 0, { dropOrigin: { x: Infinity, y: 0 } }],
  ]) assert.equal(ground.add(id, count, x, y, options), null);
  assert.equal(world.chunks.size, 0);

  const item = ground.add('ironIngot', 1, 1.5, 2.5);
  for (const [x, y] of [[NaN, 0], [0, Infinity], [Number.MAX_VALUE, 0]]) {
    assert.equal(ground.move(item, x, y), false);
  }
  assert.equal(ground.move({ ...item }, CHUNK_SIZE, 0), false);
  assert.equal(ground.remove(null), false);
  assert.equal(ground.remove(undefined), false);
  assert.equal(ground.remove('ironIngot'), false);
  assert.equal(world.chunks.size, 1);
  assert.deepEqual(ground.in(1, 2, 2, 3), [item]);
  assert.equal(item.x, 1.5);
  assert.equal(item.y, 2.5);
  assert.throws(() => ground.of(0.5, 0), RangeError);
  assert.throws(() => ground.of(0, Infinity), RangeError);
});
