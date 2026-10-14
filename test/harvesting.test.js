import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { Collection } from '../src/inventory/collection.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ITEMS } from '../src/inventory/items.js';
import { Harvesting } from '../src/world/harvesting.js';
import { GroundItems } from '../src/world/items.js';
import { blocks, drawProp, generateProps } from '../src/world/props.js';
import { ASPECT, CHUNK_SIZE, GRASS, WATER, World } from '../src/world/world.js';

const node = (kind, x, y) => ({ uid: `${kind}:${x}:${y}`, kind, x, y, harvested: false, phase: 0 });
const tree = (x, y) => ({ kind: 'tree', x, y, footW: 2.4, footH: 1.2, hits: 0,
  chopped: false, cells: [{ dx: 0, dy: -25, g: 5, r: 1, gg: 2, b: 3 }] });

function fixture(resources = [], props = []) {
  const chunks = new Map();
  const key = (cx, cy) => `${cx},${cy}`;
  const world = {
    seed: 9,
    spawn: { x: 10000, y: 10000 },
    chunk(cx, cy) {
      if (!chunks.has(key(cx, cy))) chunks.set(key(cx, cy), { cx, cy, resources: [], items: [] });
      return chunks.get(key(cx, cy));
    },
    typeAt() { return GRASS; },
    isWalkable() { return true; },
    propsIn() { return props; },
  };
  for (const resource of resources) {
    world.chunk(Math.floor(resource.x / CHUNK_SIZE), Math.floor(resource.y / CHUNK_SIZE)).resources.push(resource);
  }
  const groundItems = {
    time: 4,
    drops: [],
    add(id, count, x, y, options) {
      const entry = { id, count, x, y, ...options };
      this.drops.push(entry);
      return entry;
    },
  };
  return { world, groundItems, harvesting: new Harvesting(world, groundItems) };
}

function firstStrike(player, world) {
  player.attack();
  for (let frame = 0; frame < 100; frame++) {
    player.events.length = 0;
    player.update(0.02, world, { x: 0, y: 0 }, false);
    const strike = player.events.find((event) => event.type === 'strike');
    if (strike) return strike;
  }
  assert.fail('Player attack did not emit a strike');
}

test('resources are generated lazily once and retain harvested state on chunk revisit', () => {
  const { world, harvesting } = fixture();
  const chunk = world.chunk(-1, 1);
  delete chunk.resources;
  const resources = harvesting.resourcesOf(-1, 1);
  assert.ok(resources.length > 0);
  assert.equal(chunk.resources, resources);
  resources[0].harvested = true;
  harvesting.resourcesOf(50, -50);
  assert.equal(harvesting.resourcesOf(-1, 1), resources);
  assert.equal(harvesting.resourcesOf(-1, 1)[0].harvested, true);
});

test('resource queries return the exact range across positive and negative chunk borders', () => {
  const wanted = [node('grass', -0.5, -0.5), node('bush', 0.5, 0.5), node('grass', 64.5, 64.5)];
  const outside = [node('bush', -20.5, -0.5), node('grass', 63.5, 80.5), node('grass', 70.5, 70.5)];
  const { harvesting } = fixture([...wanted, ...outside]);
  assert.deepEqual(new Set(harvesting.resourcesIn(-0.5, -0.5, 64.5, 64.5)), new Set(wanted));
  assert.deepEqual(harvesting.resourcesIn(2, 2, 1, 1), []);
});

test('interaction chooses the nearest undepleted target using cell aspect', () => {
  const horizontal = node('bush', 6, 0);
  const vertical = node('grass', 0, 4);
  const depleted = node('bush', 1, 0);
  depleted.harvested = true;
  const { harvesting } = fixture([horizontal, vertical, depleted]);
  assert.ok(6 * ASPECT < 4);
  assert.equal(harvesting.nearby({ x: 0, y: 0 }).node, horizontal);
  assert.equal(harvesting.nearby({ x: 100, y: 100 }), null);
});

test('gathering berries depletes its bush once and creates delayed loose rewards', () => {
  const bush = node('bush', 3, 0);
  const { harvesting, groundItems } = fixture([bush]);
  const player = { x: 0, y: 0 };
  const result = harvesting.interact(player);
  assert.equal(result.status, 'harvested');
  assert.equal(result.id, 'berries');
  assert.equal(result.count, 2);
  assert.equal(bush.harvested, true);
  assert.equal(groundItems.drops.length, 1);
  assert.equal(groundItems.drops[0].pickupAfter, 4.25);
  assert.equal(harvesting.interact(player).status, 'empty');
  assert.equal(groundItems.drops.length, 1);
});

test('seeded berry yields appear in prompts and harvest exactly once without removing the plant', () => {
  for (const berryCount of [4, 5, 6, 7]) {
    const bush = { ...node('bush', 3, 0), berryCount };
    const { world, harvesting, groundItems } = fixture([bush]);
    const player = { x: 0, y: 0 };
    assert.equal(harvesting.nearby(player).action, `Gather ${berryCount} berries`);
    const result = harvesting.interact(player);
    assert.equal(result.id, 'berries');
    assert.equal(result.count, berryCount);
    assert.equal(result.message, `Gathered ${berryCount} berries.`);
    assert.deepEqual(result.rewards, [{ id: 'berries', count: berryCount }]);
    assert.equal(groundItems.drops[0].count, berryCount);
    assert.equal(groundItems.drops[0].pickupAfter, 4.25);
    assert.equal(world.chunk(0, 0).resources[0], bush, 'the harvested bush remains available to render');
    assert.equal(bush.berryCount, berryCount, 'depletion preserves the seeded plant data');
    harvesting.resourcesOf(20, -20);
    assert.equal(harvesting.interact(player).status, 'empty');
    assert.equal(groundItems.drops.length, 1);
    assert.equal(groundItems.drops[0].count, berryCount);
  }
});

test('legacy and invalid berry yields retain the bounded original reward and prompt', () => {
  for (const berryCount of [undefined, null, NaN, Infinity, -1, 0, 1, 2, 3, 4.5, 8, 1000, '5', true]) {
    const bush = { ...node('bush', 3, 0), berryCount };
    const { harvesting, groundItems } = fixture([bush]);
    const player = { x: 0, y: 0 };
    assert.equal(harvesting.nearby(player).action, 'Gather berries');
    assert.equal(harvesting.interact(player).count, 2);
    assert.equal(groundItems.drops[0].count, 2);
  }
});

test('full and partial bag capacity conserve every seeded berry in real loose stacks', () => {
  for (const initialSpace of [0, 3]) {
    const bush = { ...node('bush', 3, 0), berryCount: 7 };
    const { world } = fixture([bush]);
    const items = new GroundItems(world);
    const inventory = new Inventory({ starter: false, capacity: ITEMS.berries.weight * initialSpace });
    const harvesting = new Harvesting(world, items);
    const collection = new Collection(world, inventory, items, harvesting);
    const player = { x: bush.x, y: bush.y };
    const carried = () => inventory.slots.reduce((sum, stack) => sum + (stack?.id === 'berries' ? stack.count : 0), 0);
    const loose = () => items.in(-10, -10, 10, 10).reduce((sum, item) => sum + (item.id === 'berries' ? item.count : 0), 0);

    assert.ok(ITEMS.berries.tags.includes('food'));
    assert.equal(collection.prompt(player), 'E Gather 7 berries');
    assert.equal(collection.interact(player).count, 7);
    assert.equal(carried(), 0);
    assert.equal(loose(), 7, 'a full bag must not prevent the food reward from dropping');
    assert.equal(collection.interact(player).status, 'empty', 'the settling drop cannot cause a repeated harvest');
    collection.update(0.1, player);
    assert.equal(carried(), 0, 'berries retain their short settling delay');
    collection.update(0.2, player);
    assert.equal(carried(), initialSpace);
    assert.equal(loose(), 7 - initialSpace);
    assert.equal(carried() + loose(), 7);
    assert.equal(harvesting.interact(player).status, 'empty');
    assert.equal(world.chunk(0, 0).resources[0], bush);
    assert.equal(bush.harvested, true);

    items.of(30, -30);
    harvesting.resourcesOf(30, -30);
    assert.equal(loose(), 7 - initialSpace, 'leaving the chunk preserves uncollected berries');
    inventory.capacity = ITEMS.berries.weight * 7;
    collection.update(0, player);
    assert.equal(carried(), 7);
    assert.equal(loose(), 0);
    assert.equal(collection.interact(player).status, 'empty');
    assert.equal(carried() + loose(), 7);
  }
});

test('nearby interaction cannot reach across water or another prop', () => {
  const bush = node('bush', 8, 0);
  const waterFixture = fixture([bush]);
  waterFixture.world.typeAt = (x) => x >= 3 && x <= 5 ? WATER : GRASS;
  assert.equal(waterFixture.harvesting.nearby({ x: 0, y: 0 }), null);
  assert.equal(waterFixture.harvesting.interact({ x: 0, y: 0 }).status, 'empty');
  assert.equal(waterFixture.groundItems.drops.length, 0);

  const rock = { kind: 'rock', x: 4, y: 0, footW: 1.5, footH: 1.5 };
  const blocked = fixture([bush], [rock]);
  assert.equal(blocked.harvesting.nearby({ x: 0, y: 0 }), null);
  assert.equal(bush.harvested, false);
});

test('a strike cuts only in-range reachable grass and leaves bushes for gathering', () => {
  const grass = node('grass', 6, 1);
  const farGrass = node('grass', 30, 1);
  const bush = node('bush', 6, 0);
  const { harvesting, groundItems } = fixture([grass, farGrass, bush]);
  const event = { type: 'strike', x: 8, y: 0 };
  const results = harvesting.react(event, { x: 0, y: 0 });
  assert.equal(results.length, 1);
  assert.equal(grass.harvested, true);
  assert.equal(farGrass.harvested, false);
  assert.equal(bush.harvested, false);
  assert.deepEqual(groundItems.drops.map(({ id, count }) => ({ id, count })), [
    { id: 'straw', count: 1 }, { id: 'fibre', count: 1 },
  ]);
  harvesting.react(event, { x: 0, y: 0 });
  harvesting.react({ type: 'strike', x: 8, y: 0 }, { x: 0, y: 0 });
  assert.equal(groundItems.drops.length, 2);
});

test('trees need three separate strikes; slam and duplicate event delivery deal no extra hit', () => {
  const oak = tree(6, 0);
  const { harvesting, groundItems } = fixture([], [oak]);
  const player = { x: 0, y: 0 };
  assert.equal(harvesting.interact(player).status, 'tree');
  assert.equal(oak.hits, 0);
  const first = { type: 'strike', x: oak.x, y: oak.y };
  harvesting.react(first, player);
  harvesting.react(first, player);
  harvesting.react({ type: 'slam', x: oak.x, y: oak.y }, player);
  assert.equal(oak.hits, 1);
  assert.equal(groundItems.drops.length, 0);
  assert.equal(harvesting.react({ type: 'strike', x: -30, y: 0 }, player).length, 0);
  assert.equal(oak.hits, 1);
  harvesting.react({ type: 'strike', x: oak.x, y: oak.y }, player);
  assert.equal(oak.chopped, false);
  const result = harvesting.react({ type: 'strike', x: oak.x, y: oak.y }, player);
  assert.equal(result[0].status, 'harvested');
  assert.equal(oak.hits, 3);
  assert.equal(oak.chopped, true);
  assert.deepEqual(groundItems.drops.map(({ id, count }) => ({ id, count })), [{ id: 'oakLog', count: 3 }]);
  assert.equal(harvesting.nearby(player), null);
  harvesting.resourcesOf(30, -30);
  harvesting.react({ type: 'strike', x: oak.x, y: oak.y }, player);
  assert.equal(oak.hits, 3);
  assert.equal(groundItems.drops.length, 1);
});

test('real player strikes reach close trees while facing either side', () => {
  for (const heading of [Math.PI / 2, -Math.PI / 2]) {
    const side = Math.sign(heading);
    const oak = tree(side * 6, 0);
    const { world, harvesting } = fixture([], [oak]);
    const player = new Player(0, 0);
    player.heading = heading;
    assert.equal(blocks(oak, player.x, player.y), false);
    assert.equal(harvesting.nearby(player).node, oak);
    const strike = firstStrike(player, world);
    assert.ok(Math.abs(strike.x) > Math.abs(oak.x) + 5, 'tree lies before the blade tip');
    harvesting.react(strike, player);
    assert.equal(oak.hits, 1, `close tree was struck at heading ${heading}`);
  }
});

test('real player strike keeps its original circular impact footprint past the centre', () => {
  // The outlaw's cut lands a little over six cells ahead.
  const oak = tree(0, 8);
  const { world, harvesting } = fixture([], [oak]);
  const player = new Player(0, 0);
  const strike = firstStrike(player, world);
  assert.ok(oak.y > strike.y);
  assert.ok(oak.y - strike.y < 3.5);
  harvesting.react(strike, player);
  assert.equal(oak.hits, 1);
});

test('grass is swept in every cardinal direction without reaching behind or past the impact footprint', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const player = new Player(0, 0);
    player.heading = heading;
    const { world, harvesting } = fixture();
    const strike = firstStrike(player, world);
    const length = Math.hypot(strike.x * ASPECT, strike.y);
    const place = (reach) => node('grass', Math.sin(heading) * reach / ASPECT, Math.cos(heading) * reach);
    const front = place(2);
    const behind = place(-2);
    const tooFar = place(length + 3.5 + 1);
    for (const resource of [front, behind, tooFar]) {
      world.chunk(Math.floor(resource.x / CHUNK_SIZE), Math.floor(resource.y / CHUNK_SIZE)).resources.push(resource);
    }
    harvesting.react(strike, player);
    assert.equal(front.harvested, true, `forward grass cut at heading ${heading}`);
    assert.equal(behind.harvested, false, `grass behind remains at heading ${heading}`);
    assert.equal(tooFar.harvested, false, `grass beyond impact footprint remains at heading ${heading}`);
  }
});

test('strikes cannot harvest resources across a water barrier', () => {
  const grass = node('grass', 8, 0);
  const oak = tree(8, 1);
  const { world, harvesting, groundItems } = fixture([grass], [oak]);
  world.typeAt = (x) => x >= 3 && x <= 5 ? WATER : GRASS;
  assert.deepEqual(harvesting.react({ type: 'strike', x: 8, y: 0 }, { x: 0, y: 0 }), []);
  assert.equal(grass.harvested, false);
  assert.equal(oak.hits, 0);
  assert.equal(groundItems.drops.length, 0);
});

test('chopped trees draw a short stump through the writer and stop blocking movement', () => {
  const oak = tree(10, 10);
  const { world } = fixture([], [oak]);
  assert.equal(blocks(oak, oak.x, oak.y), true);
  assert.equal(World.prototype.isWalkable.call(world, oak.x, oak.y), false);
  oak.chopped = true;
  assert.equal(blocks(oak, oak.x, oak.y), false);
  assert.equal(World.prototype.isWalkable.call(world, oak.x, oak.y), true);
  const writes = [];
  drawProp({}, { x0: 2, y0: 3 }, oak, (...args) => writes.push(args));
  assert.ok(writes.length > 1);
  assert.ok(writes.every((args) => args[2] >= 5 && args[2] <= 7));
  assert.ok(writes.every((args) => args[7] === 7));
});

test('procedural prop bases stay in their owning chunks, including negative coordinates', () => {
  const world = { seed: 17, spawn: { x: 10000, y: 10000 }, typeAt: () => GRASS };
  let count = 0;
  for (let cy = -1; cy <= 1; cy++) {
    for (let cx = -1; cx <= 1; cx++) {
      for (const prop of generateProps(world, cx, cy, CHUNK_SIZE)) {
        count++;
        assert.equal(Math.floor(prop.x / CHUNK_SIZE), cx, `prop x ${prop.x} from ${cx}`);
        assert.equal(Math.floor(prop.y / CHUNK_SIZE), cy, `prop y ${prop.y} from ${cy}`);
      }
    }
  }
  assert.ok(count > 0);
});
