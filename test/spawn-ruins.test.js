import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scenery } from '../src/editor/scenery.js';
import { ASPECT, CHUNK_SIZE, WATER, World } from '../src/world/world.js';
import { blocks, createProp } from '../src/world/props.js';
import * as architecture from '../src/world/architecture-props.js';

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
  const points = world.spawnRuins.route;
  assert.ok(Array.isArray(points) && points.length >= 3, 'the site publishes the bent approach through its tunnel');
  assert.deepEqual(points[0], world.spawn, 'the approach starts at the player spawn');
  for (const point of points) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), 'route points use finite world coordinates');
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25);
    assert.ok(steps > 0, 'route segments have positive length');
    for (let step = 0; step <= steps; step++) {
      const x = a.x + (b.x - a.x) * step / steps;
      const y = a.y + (b.y - a.y) * step / steps;
      // Match the three collision probes used by player movement, including
      // both ends and the corners where the approach changes direction.
      for (const dx of [-1.2, 0, 1.2]) visit(x + dx, y);
    }
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

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: expected ${expected}, got ${actual}`);
}

function unrotated(prop) {
  return createProp(prop.kind, 0, 0, { seed: prop.seed, scale: prop.scale, variant: 0 });
}

function rotate(x, y, degrees = 45) {
  const point = architecture.rotateArchitectureGround(x, y, degrees);
  return [point.x, point.y];
}

function at(prop, x, y) {
  const [dx, dy] = rotate(x, y);
  return [prop.x + dx, prop.y + dy];
}

function corners(rect) {
  return [[rect.minX, rect.minY], [rect.maxX, rect.minY],
    [rect.maxX, rect.maxY], [rect.minX, rect.maxY]];
}

function polygonCenter(polygon) {
  return [0, 1].map(axis => polygon.reduce((sum, point) => sum + point[axis], 0) / polygon.length);
}

function boundsOf(prop) {
  const points = prop.collisionPolygons?.flat()
    ?? prop.collisionRects?.flatMap(corners)
    ?? [[-prop.footW, -prop.footH], [prop.footW, prop.footH]];
  return { minX: prop.x + Math.min(...points.map(p => p[0])), maxX: prop.x + Math.max(...points.map(p => p[0])),
    minY: prop.y + Math.min(...points.map(p => p[1])), maxY: prop.y + Math.max(...points.map(p => p[1])) };
}

test('architecture ground yaw is a physical 45-degree rotation, with a visually diagonal wall tangent', () => {
  assert.equal(typeof architecture.rotateArchitectureGround, 'function');
  // Invert the mesh ground projection [X + .55 Z, -.45 Z], yaw in
  // physical X/Z, then project again. A screen-space rotation is different.
  for (const [dx, dy] of [[10, 0], [0, -12], [-7, 4]]) {
    const z = -dy / 0.45, x = dx * ASPECT - 0.55 * z;
    const xx = (x + z) / Math.sqrt(2), zz = (-x + z) / Math.sqrt(2);
    const actual = rotate(dx, dy);
    near(actual[0], (xx + 0.55 * zz) / ASPECT, 'projected ground X');
    near(actual[1], -0.45 * zz, 'projected ground Y');
    const restored = rotate(...actual, -45);
    near(restored[0], dx, 'inverse yaw X');
    near(restored[1], dy, 'inverse yaw Y');
  }
  const [dx, dy] = rotate(10, 0);
  near(dy / (dx * ASPECT), 1, 'wall tangent has a 45-degree screen slope');
});

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
    assert.deepEqual([gate.x, gate.y], [world.spawn.x, world.spawn.y - 30]);
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

  test(`bent spawn route crosses the actual tunnel and stays dry and player-width walkable (seed ${seed})`, () => {
    const world = new World(seed, { spawnRuins: true });
    dryAndWalkable(world);
    const gate = ruins(world).find(prop => prop.kind === 'stone-gate');
    const piers = unrotated(gate).collisionRects;
    const points = world.spawnRuins.route.map(p => rotate(p.x - gate.x, p.y - gate.y, -45));
    const front = Math.max(...piers.map(p => p.maxY));
    const back = Math.min(...piers.map(p => p.minY));
    let crossed = false;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (a[1] <= front || b[1] >= back) continue;
      for (const y of [front, back]) {
        const f = (y - a[1]) / (b[1] - a[1]);
        const x = a[0] + (b[0] - a[0]) * f;
        assert.ok(x > piers[0].maxX && x < piers[1].minX, 'route enters and exits between the solid piers');
      }
      crossed = true;
    }
    assert.ok(crossed, 'a route segment passes completely through the rotated tunnel');
  });

  test(`gate piers block and both wall joins have continuous collision (seed ${seed})`, () => {
    const world = new World(seed, { spawnRuins: true });
    const props = ruins(world);
    const gate = props.find(prop => prop.kind === 'stone-gate');
    assert.equal(gate.collisionPolygons?.length, 2);
    const piers = unrotated(gate).collisionRects;
    const walls = props.filter(prop => prop.kind.startsWith('wall-')).sort((a, b) =>
      rotate(a.x - gate.x, a.y - gate.y, -45)[0] - rotate(b.x - gate.x, b.y - gate.y, -45)[0]);
    for (const prop of [gate, ...walls]) {
      assert.equal(prop.variant, 0, 'gate and adjoining walls share coherent, unvaried yaw');
      const original = unrotated(prop);
      assert.equal(prop.collisionPolygons?.length, original.collisionRects.length);
      for (const [i, rect] of original.collisionRects.entries()) {
        const expected = corners(rect).map(([x, y]) => rotate(x, y));
        const polygon = prop.collisionPolygons[i];
        assert.equal(polygon.length, 4);
        for (const [x, y] of expected) {
          assert.ok(polygon.some(p => Math.hypot(p[0] - x, p[1] - y) < 1e-7), 'collision follows physical mesh yaw');
          assert.ok(Math.abs(x) <= prop.footW + 1e-7 && Math.abs(y) <= prop.footH + 1e-7, 'broad phase encloses every rotated corner');
        }
        const [x, y] = polygonCenter(polygon);
        assert.equal(blocks(prop, prop.x + x, prop.y + y), true, 'actual polygon centre blocks movement');
      }
      assert.notDeepEqual(prop.cells, original.cells, 'rotation changes the rendered architecture');
    }
    for (const [i, pier] of piers.entries()) {
      for (const fx of [0.01, 0.5, 0.99]) for (const fy of [0.01, 0.5, 0.99]) {
        const point = at(gate, pier.minX + (pier.maxX - pier.minX) * fx,
          pier.minY + (pier.maxY - pier.minY) * fy);
        assert.equal(blocks(gate, ...point), true, 'rotated pier corners and centre remain solid');
        assert.equal(world.isWalkable(...point), false, 'world collision finds rotated piers');
      }
      const wall = walls[i];
      const [wx, wy] = rotate(wall.x - gate.x, wall.y - gate.y, -45);
      near(wy, 0, 'wall stays on the gate masonry axis');
      const faces = unrotated(wall).collisionRects.map(r => ({ minX: wx + r.minX, maxX: wx + r.maxX,
        minY: wy + r.minY, maxY: wy + r.maxY }));
      const wallMinX = Math.min(...faces.map(rect => rect.minX));
      const wallMaxX = Math.max(...faces.map(rect => rect.maxX));
      assert.ok(i === 0 ? wx < 0 : wx > 0, 'walls flank opposite piers');
      assert.ok(Math.min(pier.maxX, wallMaxX) > Math.max(pier.minX, wallMinX), 'wall and pier physically overlap');
      // Use several rows inside the shared wall/pier depth. Testing the
      // continuous span catches a walkable crack at either outer pier edge.
      const minY = Math.max(pier.minY, Math.min(...faces.map(rect => rect.minY)));
      const maxY = Math.min(pier.maxY, Math.max(...faces.map(rect => rect.maxY)));
      assert.ok(maxY > minY, 'wall and pier share collision depth');
      const x0 = i === 0 ? wx : (pier.minX + pier.maxX) / 2;
      const x1 = i === 0 ? (pier.minX + pier.maxX) / 2 : wx;
      for (const f of [0.2, 0.5, 0.8]) {
        const y = minY + (maxY - minY) * f;
        for (let x = x0; x <= x1; x += 0.1) {
          const point = at(gate, x, y);
          assert.ok(blocks(gate, ...point) || blocks(wall, ...point), `masonry gap at ${point}`);
          assert.equal(world.isWalkable(...point), false, `wall/pier gap at ${point}`);
        }
      }
    }
  });

  test(`pillars and rubble occupy a spacious forecourt without crowding the gate (seed ${seed})`, () => {
    const world = new World(seed, { spawnRuins: true });
    const props = ruins(world);
    const pillars = props.filter(p => p.kind.startsWith('column-'));
    const masonry = props.filter(p => p.kind === 'stone-gate' || p.kind.startsWith('wall-'));
    assert.equal(pillars.length, 3);
    for (const [i, pillar] of pillars.entries()) {
      for (const other of pillars.slice(i + 1)) {
        const dx = Math.abs(pillar.x - other.x), dy = pillar.y - other.y;
        assert.ok(Math.hypot(dx * ASPECT, dy) >= 60 || dx >= 80, 'pillars have at least 60 physical row units or 80 columns between them');
      }
      const p = boundsOf(pillar);
      for (const wall of masonry) {
        const w = boundsOf(wall);
        assert.ok(p.maxX < w.minX || p.minX > w.maxX || p.maxY < w.minY || p.minY > w.maxY,
          'pillar footprints stay separate from gate and wall masonry');
      }
    }
    const rubble = props.filter(p => p.kind.startsWith('rubble-'));
    assert.ok(rubble.some(p => p.x <= world.spawn.x - 120), 'fallen masonry extends to the left flank');
    assert.ok(rubble.some(p => p.x >= world.spawn.x + 120), 'fallen masonry extends to the right flank');
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
