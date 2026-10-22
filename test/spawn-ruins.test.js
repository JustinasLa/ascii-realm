import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scenery } from '../src/editor/scenery.js';
import { CHUNK_SIZE, WATER, World } from '../src/world/world.js';

const seeds = [1, 42, 221];
const ids = Array.from({ length: 8 }, (_, i) => `r:spawn:${i}`);
const isRuin = prop => prop.id?.startsWith('r:spawn:');
const sorted = props => [...props].sort((a, b) => a.id.localeCompare(b.id));

function ruins(world) {
  assert.ok(world.spawnRuins, 'World(seed, { spawnRuins: true }) must create the starting landmark');
  const { bounds } = world.spawnRuins;
  return sorted(world.propsIn(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY).filter(isRuin));
}

function route(world, visit) {
  const gate = ruins(world).find(prop => prop.kind === 'stone-gate');
  assert.ok(gate, 'the starting landmark includes a gate');
  // Sample the player width all the way from spawn, through both faces of
  // the gate, and several rows into the ground beyond the north wall.
  for (let y = world.spawn.y + 1.2; y >= gate.y - gate.footH - 5; y -= 0.25) {
    for (const dx of [-1.2, 0, 1.2]) visit(world.spawn.x + dx, y);
  }
}

function dryAndWalkable(world) {
  route(world, (x, y) => {
    const at = `${x},${y}, seed ${world.seed}`;
    assert.notEqual(world.typeAt(x, y), WATER, `dry approach at ${at}`);
    assert.equal(world.waterDepthAt(x, y), 0, `no wading at ${at}`);
    assert.equal(world.isWalkable(x, y), true, `player-width approach at ${at}`);
  });
}

function worldRect(prop, rect) {
  return { minX: prop.x + rect.minX, maxX: prop.x + rect.maxX,
    minY: prop.y + rect.minY, maxY: prop.y + rect.maxY };
}

for (const seed of seeds) {
  test(`spawn ruins are deterministic generated defaults, not editor additions (seed ${seed})`, () => {
    const world = new World(seed, { spawnRuins: true });
    const props = ruins(world);
    assert.deepEqual(props.map(prop => prop.id), ids);
    assert.deepEqual(props, ruins(new World(seed, { spawnRuins: true })));
    assert.equal(world.addedProps.size, 0);
    assert.equal(world.terrainEdits.size, 0);
    assert.equal(world.removedProps.size, 0);
    const gate = props.find(prop => prop.kind === 'stone-gate');
    assert.deepEqual([gate.x, gate.y], [world.spawn.x, world.spawn.y - 12]);
    assert.equal(props.filter(prop => prop.kind.startsWith('wall-')).length, 2);
    assert.ok(props.some(prop => prop.kind.startsWith('column-') && prop.y > gate.y), 'forecourt pillar');
    assert.ok(props.some(prop => prop.kind.startsWith('column-') && prop.y < gate.y), 'pillar behind wall');
    assert.ok(props.some(prop => prop.kind.startsWith('rubble-')), 'fallen masonry');
    for (const prop of props) {
      const cx = Math.floor(prop.x / CHUNK_SIZE), cy = Math.floor(prop.y / CHUNK_SIZE);
      const cached = world.propsOf(cx, cy);
      assert.equal(cached, world.propsOf(cx, cy), 'repeated queries reuse the generated prop cache');
      assert.equal(cached.filter(other => other.id === prop.id).length, 1);
      assert.ok(world.chunk(cx, cy).props.includes(prop), 'default belongs to the generated chunk baseline');
    }
    assert.deepEqual(new Scenery(world).serialize(), { version: 1, seed, terrain: [], props: [], removed: [] });
  });

  test(`spawn-to-north route stays dry and player-width walkable (seed ${seed})`, () => {
    dryAndWalkable(new World(seed, { spawnRuins: true }));
  });

  test(`gate piers block and both wall joins have continuous collision (seed ${seed})`, () => {
    const world = new World(seed, { spawnRuins: true });
    const props = ruins(world);
    const gate = props.find(prop => prop.kind === 'stone-gate');
    assert.equal(gate.collisionRects.length, 2);
    const piers = gate.collisionRects.map(rect => worldRect(gate, rect)).sort((a, b) => a.minX - b.minX);
    const walls = props.filter(prop => prop.kind.startsWith('wall-')).sort((a, b) => a.x - b.x);
    for (const [i, pier] of piers.entries()) {
      for (const fx of [0.01, 0.5, 0.99]) for (const fy of [0.01, 0.5, 0.99]) {
        assert.equal(world.isWalkable(pier.minX + (pier.maxX - pier.minX) * fx,
          pier.minY + (pier.maxY - pier.minY) * fy), false, 'pier corners and centre remain solid');
      }
      const wall = walls[i];
      assert.ok(wall.collisionRects?.length, 'wall provides its actual masonry collision');
      const faces = wall.collisionRects.map(rect => worldRect(wall, rect));
      const wallMinX = Math.min(...faces.map(rect => rect.minX));
      const wallMaxX = Math.max(...faces.map(rect => rect.maxX));
      assert.ok(i === 0 ? wall.x < gate.x : wall.x > gate.x, 'walls flank opposite piers');
      assert.ok(Math.min(pier.maxX, wallMaxX) > Math.max(pier.minX, wallMinX), 'wall and pier physically overlap');
      // Use several rows inside the shared wall/pier depth. Testing the
      // continuous span catches a walkable crack at either outer pier edge.
      const minY = Math.max(pier.minY, Math.min(...faces.map(rect => rect.minY)));
      const maxY = Math.min(pier.maxY, Math.max(...faces.map(rect => rect.maxY)));
      assert.ok(maxY > minY, 'wall and pier share collision depth');
      const x0 = i === 0 ? wall.x : (pier.minX + pier.maxX) / 2;
      const x1 = i === 0 ? (pier.minX + pier.maxX) / 2 : wall.x;
      for (const f of [0.2, 0.5, 0.8]) {
        const y = minY + (maxY - minY) * f;
        for (let x = x0; x <= x1; x += 0.1) {
          assert.equal(world.isWalkable(x, y), false, `wall/pier gap at ${x},${y}`);
        }
      }
    }
  });

  test(`erased default IDs survive JSON load; reset restores ruins and dry terrain (seed ${seed})`, () => {
    const world = new World(seed, { spawnRuins: true });
    const scene = new Scenery(world);
    const baseline = structuredClone(ruins(world));
    const gate = baseline.find(prop => prop.kind === 'stone-gate');
    assert.equal(scene.erase(gate.x, gate.y, 0), 1);
    assert.ok(world.removedProps.has(gate.id));
    assert.ok(!ruins(world).some(prop => prop.id === gate.id));
    const x = Math.floor(world.spawn.x), y = Math.floor(world.spawn.y);
    const ground = world.originalTypeAt(x, y);
    scene.paint(x, y, 0, WATER);
    const saved = JSON.parse(JSON.stringify(scene.serialize()));
    assert.deepEqual(saved.removed, [gate.id]);
    assert.equal(saved.props.length, 0, 'generated defaults are not copied into scene additions');
    const restoredWorld = new World(seed, { spawnRuins: true });
    const restored = new Scenery(restoredWorld);
    restored.load(saved);
    assert.deepEqual(restored.serialize(), saved);
    assert.deepEqual(ruins(restoredWorld), baseline.filter(prop => prop.id !== gate.id));
    assert.equal(restoredWorld.typeAt(x, y), WATER);
    assert.equal(restored.undo(), true);
    assert.deepEqual(ruins(restoredWorld), baseline);
    assert.equal(restored.redo(), true);
    assert.ok(!ruins(restoredWorld).some(prop => prop.id === gate.id));
    assert.equal(restored.reset(), true);
    assert.deepEqual(ruins(restoredWorld), baseline);
    assert.equal(restoredWorld.typeAt(x, y), ground);
    assert.equal(restoredWorld.originalTypeAt(x, y), ground);
    assert.deepEqual(restored.serialize(), { version: 1, seed, terrain: [], props: [], removed: [] });
    dryAndWalkable(restoredWorld);
  });

  test(`chunk eviction regenerates identical ruins and the dry baseline (seed ${seed})`, () => {
    const world = new World(seed, { spawnRuins: true });
    const baseline = structuredClone(ruins(world));
    const { bounds } = world.spawnRuins;
    const cells = [];
    // Check the whole reclaimed ground, including terrain that was wet in
    // the original seeded landscape, rather than only checking its metadata.
    for (let y = bounds.minY; y <= bounds.maxY; y++) for (let x = bounds.minX; x <= bounds.maxX; x++) {
      const { c, i } = world.locate(x, y);
      assert.notEqual(c.type[i], WATER, `dry baseline at ${x},${y}`);
      cells.push([x, y, c.type[i], c.baseType[i], c.elev[i], c.baseElev[i]]);
    }
    const localChunks = [...world.chunks.keys()];
    world.maxChunks = 16;
    world.trim();
    for (let i = 0; i < 20; i++) world.chunk(1000 + i, 1000);
    assert.ok(localChunks.every(key => !world.chunks.has(key)), 'the original site really leaves the cache');
    assert.deepEqual(ruins(world), baseline);
    for (const [x, y, type, baseType, elev, baseElev] of cells) {
      const { c, i } = world.locate(x, y);
      assert.deepEqual([c.type[i], c.baseType[i], c.elev[i], c.baseElev[i]], [type, baseType, elev, baseElev]);
    }
    dryAndWalkable(world);
  });
}

test('ordinary World fixtures stay opt-in and keep the same spawn and distant terrain', () => {
  for (const seed of seeds) {
    const ordinary = new World(seed);
    const disabled = new World(seed, { spawnRuins: false });
    const enabled = new World(seed, { spawnRuins: true });
    assert.equal(ordinary.spawnRuins, undefined);
    assert.equal(disabled.spawnRuins, undefined);
    assert.deepEqual(enabled.spawn, ordinary.spawn);
    const { bounds } = enabled.spawnRuins;
    assert.ok(!ordinary.propsIn(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY).some(isRuin));
    for (const [cx, cy] of [[100, -100], [-2, 1]]) {
      for (const field of ['type', 'elev', 'baseType', 'baseElev']) {
        assert.deepEqual(ordinary.chunk(cx, cy)[field], disabled.chunk(cx, cy)[field]);
      }
    }
    for (const field of ['type', 'elev', 'baseType', 'baseElev']) {
      assert.deepEqual(enabled.chunk(100, -100)[field], ordinary.chunk(100, -100)[field], 'distant terrain is untouched');
    }
  }
});
