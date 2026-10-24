import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fbm } from '../src/core/noise.js';
import { createSpawnRuins } from '../src/world/spawn-ruins.js';
import {
  BASE_SPEED, cellElevation, crossSpeed, groundHalfWidth, KEEP_OUT, readFlow, REGION, RiverNetwork,
  screenOrientation, toCells, toGround, UPHILL_TOL, walk,
} from '../src/world/rivers.js';
import { ASPECT, CHUNK_SIZE, GRASS, LAND_LIFT, MAX_WATER_DEPTH, SHORE, WATER, WATER_LEVEL, World } from '../src/world/world.js';

// Every river rising within `k` regions of the origin.
function riversOf(world, k = 4) {
  const out = [];
  for (let ry = -k; ry <= k; ry++) {
    for (let rx = -k; rx <= k; rx++) {
      const river = world.rivers.region(rx, ry);
      if (river) out.push(river);
    }
  }
  return out;
}

const cellOf = (river, i) => ({ x: river.points[2 * i] / ASPECT, y: river.points[2 * i + 1] });

// The widest straight reach of any river near the origin, away from its
// ends.
function widest(world) {
  let best = null;
  for (const river of riversOf(world)) {
    for (let i = 6; i < river.mouthFrom - 6; i++) {
      let bend = 0;
      for (let k = i - 5; k <= i + 5; k++) bend = Math.max(bend, Math.abs(river.curve[k]) * river.half[k] * 2);
      if (bend > 0.12) continue;
      if (!best || river.half[i] > best.river.half[best.i]) best = { river, i };
    }
  }
  return best;
}

test('a ground step and its cells convert back and forth, and a metre spans more columns than rows', () => {
  const g = toGround(6.5, 13);
  const c = toCells(g.x, g.y);
  assert.ok(Math.abs(c.cols * ASPECT - 6.5) < 1e-9 && Math.abs(c.rows - 13) < 1e-9);
  const metre = toCells(1, 1);
  assert.ok(metre.cols > 20 && metre.cols < 23, 'a metre east is about 22 columns');
  assert.ok(Math.abs(metre.rows - 6.5) < 1e-9, 'a metre south is 6.5 rows');
  assert.equal(screenOrientation(1, 0), 0);
  assert.equal(screenOrientation(0, 1), 2);
  assert.equal(screenOrientation(0, -1), 2);
  // Diagonal on the ground is steeper toward the rows on screen.
  assert.equal(screenOrientation(0.45, 0.9), 3);
  assert.equal(screenOrientation(-0.45, 0.9), 1);
  assert.ok(groundHalfWidth(1, 0, 2) > groundHalfWidth(0, 1, 2), 'across an eastward river runs down the screen');
  assert.equal(groundHalfWidth(0, 0, 2), 0);
});

test('rivers are traced the same whatever order chunks load in, and differ between seeds', () => {
  const a = new World(1);
  const b = new World(1, { maxChunks: 16 });
  const { river, i } = widest(a);
  const { x, y } = cellOf(river, i);
  const keys = [[Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)],
    [Math.floor(x / CHUNK_SIZE) + 1, Math.floor(y / CHUNK_SIZE)]];
  const first = keys.map(([cx, cy]) => a.chunk(cx, cy));
  // The other world loads them the other way round, after filling and
  // emptying its cache elsewhere.
  for (let k = 0; k < 20; k++) b.chunk(40 + k, -40);
  const second = keys.slice().reverse().map(([cx, cy]) => b.chunk(cx, cy)).reverse();
  for (let k = 0; k < keys.length; k++) {
    assert.deepEqual(first[k].type, second[k].type);
    assert.deepEqual(first[k].elev, second[k].elev);
    assert.deepEqual(first[k].flow?.tau, second[k].flow?.tau);
    assert.deepEqual(first[k].flow?.heading, second[k].flow?.heading);
  }
  assert.ok(first[0].flow, 'the widest reach is river water');
  assert.deepEqual(a.flowAt(x, y), b.flowAt(x, y));
  const other = riversOf(new World(2)).map(r => r.id).join();
  assert.notEqual(other, riversOf(a).map(r => r.id).join());
  assert.equal(new World(1, { rivers: false }).rivers.region(0, 0), null);
});

test('rivers run downhill on the real terrain into a lake or a pond, a few cells to a dozen wide', () => {
  let rivers = 0;
  let lakes = 0;
  let ponds = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const world = new World(seed);
    for (const river of riversOf(world, 3)) {
      rivers++;
      const n = river.mouthFrom;
      let low = river.heights[0];
      for (let i = 1; i < n; i++) {
        const h = cellElevation(river.points[2 * i], river.points[2 * i + 1], seed);
        assert.ok(Math.abs(h - river.heights[i]) < 1e-6, 'heights are read from the chunks\' own terrain');
        assert.ok(h <= low + UPHILL_TOL + 1e-9, `step ${i} of river ${river.id} climbs`);
        low = Math.min(low, h);
      }
      assert.ok(river.heights[n - 1] < river.heights[0], 'the end lies below the spring');
      for (let i = 0; i < river.half.length; i++) {
        assert.ok(river.half[i] * 2 >= 2.2 && river.half[i] * 2 <= 12, 'from a couple of rows to a dozen wide');
      }
      if (river.end === 'lake') {
        lakes++;
        assert.ok(river.heights[river.heights.length - 1] < WATER_LEVEL, 'it reaches a lake');
        assert.equal(river.speed[river.speed.length - 1], 0, 'and slows to a stop in it');
      } else {
        ponds++;
        assert.ok(river.pond.across > 0 && river.pond.along > river.pond.across);
      }
      // Every river lies within reach of its own source region.
      assert.ok(river.bbox.x0 > (river.rx - 2) * REGION && river.bbox.x1 < (river.rx + 3) * REGION);
      assert.ok(river.bbox.y0 > (river.ry - 2) * REGION && river.bbox.y1 < (river.ry + 3) * REGION);
    }
  }
  assert.ok(rivers > 20, `rivers are common enough to find (${rivers})`);
  assert.ok(lakes > 3 && ponds > 3, `both endings occur (${lakes} lakes, ${ponds} ponds)`);
});

test('a ridge across the way makes a river pool rather than climb', () => {
  // Land falling to the east, with a ridge across it at x = 60.
  const elev = (x, y, octaves) => 0.8 - x * 0.002 + (octaves === 5 ? 0.0005 * Math.sin(y) : 0)
    + 0.2 * Math.exp(-(((x - 60) / 6) ** 2));
  const path = walk(0, 0, 7, elev);
  assert.equal(path.end, 'pond');
  for (let i = 0; i < path.points.length; i += 2) assert.ok(path.points[i] < 60, 'never over the ridge');
  // Flat land gives no lead at all: the trace stops where it starts.
  const flat = walk(0, 0, 7, () => 0.7);
  assert.equal(flat.end, 'pond');
  assert.ok(flat.length <= 60);
});

test('the channel is deep in the middle, shallow by the banks and edged with sand', () => {
  const world = new World(1);
  const { river, i } = widest(world);
  assert.ok(river.half[i] >= 2, 'a broad reach');
  const mid = cellOf(river, i);
  const nx = -river.dir[2 * i + 1];
  const ny = river.dir[2 * i];
  const at = (q) => ({ x: mid.x + nx * q * river.half[i] / ASPECT, y: mid.y + ny * q * river.half[i] });
  const depth = (q) => { const p = at(q); return world.waterDepthAt(p.x, p.y); };
  assert.ok(depth(0) / MAX_WATER_DEPTH >= 0.6, 'deep in the middle');
  assert.ok(depth(0.8) < depth(0) * 0.6 && depth(0.8) > 0, 'shallows near the banks');
  const bank = at(1 + 0.6 / river.half[i]);
  assert.equal(world.typeAt(bank.x, bank.y), SHORE);
  // Beyond the bank the valley floor is eased down, damp and green.
  const valley = at(1 + 4 / river.half[i]);
  const { c, i: k } = world.locate(Math.floor(valley.x), Math.floor(valley.y));
  const plain = new World(1, { rivers: false }).locate(Math.floor(valley.x), Math.floor(valley.y));
  assert.equal(c.type[k], GRASS);
  assert.ok(c.elev[k] < plain.c.elev[plain.i]);
});

test('spawn and its ruins stay dry, and spawn is where it was without rivers', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const world = new World(seed, { spawnRuins: true });
    const plain = new World(seed, { rivers: false });
    assert.deepEqual(world.spawn, plain.spawn);
    const { x, y } = world.spawn;
    const ruins = createSpawnRuins(seed, world.spawn).bounds;
    assert.ok(ruins.minX >= x - KEEP_OUT.left && ruins.maxX <= x + KEEP_OUT.right, `seed ${seed} ruins fit across`);
    assert.ok(ruins.minY >= y - KEEP_OUT.up && ruins.maxY <= y + KEEP_OUT.down, `seed ${seed} ruins fit down`);
    for (const river of riversOf(world, 2)) assert.equal(world.rivers.touchesKeepOut(river), false);
    for (let cy = Math.floor((y - KEEP_OUT.up) / CHUNK_SIZE); cy <= Math.floor((y + KEEP_OUT.down) / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor((x - KEEP_OUT.left) / CHUNK_SIZE); cx <= Math.floor((x + KEEP_OUT.right) / CHUNK_SIZE); cx++) {
        const c = world.chunk(cx, cy);
        for (let k = 0; k < c.type.length; k++) {
          const wx = cx * CHUNK_SIZE + (k & 63);
          const wy = cy * CHUNK_SIZE + (k >> 6);
          if (Math.abs(wx - x) > KEEP_OUT.left || wy < y - KEEP_OUT.up || wy > y + KEEP_OUT.down) continue;
          assert.ok(!c.flow?.river[k], `seed ${seed}: river water at ${wx},${wy}`);
          if (c.preRiverType) assert.equal(c.type[k], c.preRiverType[k], `seed ${seed}: river bank at ${wx},${wy}`);
        }
      }
    }
    // The route from spawn to the gate stays paved and dry.
    for (const p of world.spawnRuins.route) assert.notEqual(world.typeAt(p.x, p.y), WATER);
  }
  // A river reaching toward spawn is left out of the world entirely.
  const world = new World(1);
  const near = new RiverNetwork(1, { x: 0, y: 0 });
  const river = riversOf(world)[0];
  const at = cellOf(river, Math.floor(river.mouthFrom / 2));
  assert.equal(new RiverNetwork(1, at).touchesKeepOut(river), true);
  assert.equal(near.touchesKeepOut({ ...river, bbox: { x0: 1e6, x1: 1e6 + 1, y0: 0, y1: 1 } }), false);
  // A box overlapping a river's reach but none of it, with or without a pond.
  const everywhere = { x0: -1e9, x1: 1e9, y0: -1e9, y1: 1e9 };
  assert.equal(near.touchesKeepOut({ bbox: everywhere, half: [], points: [], pond: null }), false);
  assert.equal(near.touchesKeepOut({ bbox: everywhere, half: [], points: [],
    pond: { x: 1e5, y: 1e5, along: 3 } }), false);
  const pond = riversOf(world).find(r => r.pond);
  assert.equal(new RiverNetwork(1, { x: pond.pond.x / ASPECT, y: pond.pond.y }).touchesKeepOut(pond), true);
});

test('the current runs downstream, fastest mid-channel, in the narrows and on straight reaches', () => {
  const world = new World(1);
  const flow = {};
  let checked = 0;
  for (const river of riversOf(world, 3)) {
    for (let i = 2; i < river.mouthFrom - 2; i += 5) {
      const { x, y } = cellOf(river, i);
      world.flowAt(x, y, flow);
      if (!flow.speed) continue;
      const g = toGround(river.dir[2 * i], river.dir[2 * i + 1]);
      assert.ok(flow.x * g.x + flow.y * g.y > 0, 'the water flows from source to mouth');
      assert.ok(flow.depth > 0 && flow.river === river.id && flow.halfWidth > 0);
      checked++;
    }
    // Within a river, narrower and straighter reaches run faster.
    let narrow = null;
    let wide = null;
    let straight = null;
    let bent = null;
    for (let i = 0; i < river.mouthFrom; i++) {
      const bend = Math.abs(river.curve[i]) * river.half[i] * 2;
      if (bend < 0.05) {
        if (!narrow || river.half[i] < river.half[narrow]) narrow = i;
        if (!wide || river.half[i] > river.half[wide]) wide = i;
      }
      if (Math.abs(river.half[i] - river.meanHalf) < 0.3) {
        if (bend < 0.05 && straight === null) straight = i;
        if (bend > 0.6 && bent === null) bent = i;
      }
    }
    if (narrow !== null && river.half[wide] - river.half[narrow] > 0.5) assert.ok(river.speed[narrow] > river.speed[wide]);
    if (straight !== null && bent !== null) assert.ok(river.speed[straight] > river.speed[bent]);
  }
  assert.ok(checked > 20);
  assert.ok(crossSpeed(0) > crossSpeed(0.8) && crossSpeed(0.8) > crossSpeed(1));
  assert.equal(crossSpeed(1), 0.15);
  // Still water: lakes, banks and dry land.
  const lake = new World(1);
  assert.equal(lake.flowAt(0.5, 70.5).speed, 0);
  assert.equal(lake.flowAt(lake.spawn.x, lake.spawn.y).speed, 0);
  assert.ok(BASE_SPEED > 0.4 && BASE_SPEED < 0.8);
});

test('river water painted over with other ground runs still', () => {
  const world = new World(1);
  const { river, i } = widest(world);
  const { x, y } = cellOf(river, i);
  assert.ok(world.flowAt(x + 0.5, y + 0.5).speed > 0);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) world.setTerrain(Math.floor(x) + dx, Math.floor(y) + dy, GRASS);
  const still = world.flowAt(Math.floor(x) + 0.5, Math.floor(y) + 0.5);
  assert.equal(still.speed, 0);
  assert.equal(still.river, 0);
  assert.equal(world.riverAt(Math.floor(x), Math.floor(y)), true, 'it is still river in the seeded land');
  assert.equal(world.preRiverTypeAt(Math.floor(x), Math.floor(y)) === WATER, false);
});

test('foam travel time follows the water: it rises by the time the current takes to cover the distance', () => {
  const world = new World(1);
  const { river, i } = widest(world);
  // Near the bank, but where the cell holding the point is still water.
  for (const q of [0, 0.65]) {
    // Points along one line through the water, a metre long.
    const along = (s) => {
      const p = world.rivers.pointAt(river, s);
      const half = p.halfWidth;
      return { x: p.x - p.dir.y * q * half / ASPECT, y: p.y + p.dir.x * q * half };
    };
    // The time the water takes, step by step at the speed flowAt gives,
    // against the travel time the foam is laid out by.
    let length = 0;
    let time = 0;
    let last = along(river.s[i] - 0.5);
    for (let k = 1; k <= 20; k++) {
      const next = along(river.s[i] - 0.5 + k / 20);
      const g = toGround((next.x - last.x) * ASPECT, next.y - last.y);
      const ds = Math.hypot(g.x, g.y);
      const mid = world.flowAt((next.x + last.x) / 2, (next.y + last.y) / 2);
      length += ds;
      time += ds / mid.speed;
      last = next;
    }
    const a = along(river.s[i] - 0.5);
    const tau = world.flowAt(last.x, last.y).tau - world.flowAt(a.x, a.y).tau;
    assert.ok(Math.abs(tau - time) / time < 0.1, `q=${q}: foam takes ${tau} s, the water ${time} s over ${length} m`);
  }
});

test('stones stand in wide reaches as wet scenery, and no other prop stands in a river', () => {
  const world = new World(1);
  const plain = new World(1, { rivers: false });
  const rivers = riversOf(world, 5);
  const stones = rivers.flatMap(r => r.stones);
  assert.ok(stones.length > 0, 'some stones');
  const stone = stones[0];
  const cx = Math.floor(stone.x / CHUNK_SIZE);
  const cy = Math.floor(stone.y / CHUNK_SIZE);
  const props = world.propsOf(cx, cy);
  const placed = props.filter(p => p.river);
  assert.ok(placed.length > 0 && placed.every(p => p.wet && p.kind === 'rock' && p.id.startsWith(`v:${cx}:${cy}:`)));
  assert.equal(world.typeAt(stone.x, stone.y), WATER);
  assert.equal(world.isWalkable(stone.x, stone.y), false, 'a stone blocks the way');
  const again = new World(1).propsOf(cx, cy).filter(p => p.river);
  assert.deepEqual(again.map(p => [p.id, p.x, p.y, p.footW]), placed.map(p => [p.id, p.x, p.y, p.footW]));
  // Elsewhere props keep their ids, and none stands in the water.
  let kept = 0;
  for (const river of rivers.slice(0, 4)) {
    const { x, y } = cellOf(river, Math.floor(river.mouthFrom / 2));
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0]]) {
      const kx = Math.floor(x / CHUNK_SIZE) + dx;
      const ky = Math.floor(y / CHUNK_SIZE) + dy;
      const ids = new Map(plain.propsOf(kx, ky).map(p => [p.id, p]));
      for (const prop of world.propsOf(kx, ky)) {
        if (prop.river) continue;
        assert.equal(world.inRiver(prop), false);
        assert.ok(ids.has(prop.id), 'the same prop, by the same id');
        assert.equal(ids.get(prop.id).x, prop.x);
        kept++;
      }
    }
  }
  assert.ok(kept > 0);
});

test('the river network looks up nearby rivers, points along them and stones for each chunk', () => {
  const world = new World(1);
  const { river, i } = widest(world);
  const { x, y } = cellOf(river, i);
  // Twelve layout units out from the left bank.
  const off = river.half[i] + 12;
  const px = x - river.dir[2 * i + 1] * off / ASPECT;
  const py = y + river.dir[2 * i] * off;
  const near = world.rivers.near(px, py, 40);
  const found = near.find(n => n.river === river);
  assert.ok(found && Math.abs(found.dist - 12) < 1, `${found?.dist}`);
  assert.ok(near.every((n, k) => k === 0 || n.dist >= near[k - 1].dist), 'nearest first');
  assert.equal(world.rivers.near(px, py, 5).some(n => n.river === river), false);
  assert.equal(world.nearestRiver(x, y).river, river);
  assert.equal(new World(1, { rivers: false }).nearestRiver(x, y), null);
  const point = world.rivers.pointAt(river, river.s[i]);
  assert.ok(Math.abs(point.x - x) < 1e-3 && Math.abs(point.y - y) < 1e-3);
  assert.ok(point.halfWidth === river.half[i] && point.speed === river.speed[i]);
  const start = world.rivers.pointAt(river, -5);
  assert.ok(Math.abs(start.x - river.points[0] / ASPECT) < 1e-3);
  const end = world.rivers.pointAt(river, 1e9);
  assert.ok(Math.abs(end.y - river.points[river.points.length - 1]) < 1e-3);
  const stone = riversOf(world, 5).flatMap(r => r.stones)[0];
  const cx = Math.floor(stone.x / CHUNK_SIZE);
  const cy = Math.floor(stone.y / CHUNK_SIZE);
  assert.ok(world.rivers.stonesIn(cx, cy).some(s => s.x === stone.x && s.y === stone.y));
  assert.ok(world.rivers.stonesNear(cx, cy).some(s => s.x === stone.x));
  assert.ok(world.chunk(cx, cy).riverStones.length > 0);
  assert.equal(new RiverNetwork(1, { x: 0, y: 0 }, { enabled: false }).carve(0, 0), null);
  assert.equal(new RiverNetwork(1, { x: 0, y: 0 }, { enabled: false }).reaches(0, 0), false);
  // Decoded flow matches the stored heading.
  const c = world.chunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
  const k = (Math.floor(y) - c.cy * CHUNK_SIZE) * CHUNK_SIZE + Math.floor(x) - c.cx * CHUNK_SIZE;
  const out = readFlow(c.flow, k, {});
  assert.ok(Math.abs(Math.hypot(out.x, out.y) - 1) < 1e-9 && out.speed > 0);
});

test('caches stay bounded and rebuild the same rivers', () => {
  const network = new RiverNetwork(3, { x: 0, y: 0 });
  const first = network.region(0, 0);
  for (let k = 0; k < 300; k++) network.region(100 + k, 50);
  assert.ok(network.regions.size <= 256);
  const again = network.region(0, 0);
  assert.deepEqual(again?.points, first?.points);
  for (let k = 0; k < 1100; k++) network.segmentsFor(k, 9);
  assert.ok(network.chunkSegments.size <= 1024);
});

test('the land the rivers follow is the land the chunks are built from', () => {
  const seed = 5;
  const world = new World(seed, { rivers: false });
  for (const [x, y] of [[3, 4], [-70, 33], [120, -9]]) {
    const { c, i } = world.locate(x, y);
    const raw = fbm(x * ASPECT * 0.011, y * 0.011, seed, 5) + LAND_LIFT;
    assert.equal(cellElevation(x * ASPECT + 0.1, y + 0.2, seed), raw);
    if (raw >= WATER_LEVEL && c.type[i] !== WATER) assert.ok(Math.abs(c.elev[i] - raw) < 1e-6);
  }
});

test('carving a river chunk stays cheap', () => {
  const world = new World(1);
  const { river, i } = widest(world);
  const { x, y } = cellOf(river, i);
  world.chunk(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
  const started = performance.now();
  for (let k = 0; k < 5; k++) world.generate(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
  const river5 = performance.now() - started;
  const lake = performance.now();
  for (let k = 0; k < 5; k++) world.generate(0, 1);
  const lake5 = performance.now() - lake;
  assert.ok(river5 < Math.max(4 * lake5, 60), `river ${river5.toFixed(1)} ms vs lake ${lake5.toFixed(1)} ms`);
});
