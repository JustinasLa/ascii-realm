import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fbm } from '../src/core/noise.js';
import { createSpawnRuins } from '../src/world/spawn-ruins.js';
import {
  BASE_SPEED, carryTarget, cellElevation, crossSpeed, CURRENT_CARRY, currentAt, easeCarry, groundHalfWidth, immersion,
  KEEP_OUT, MIN_CARRY, readFlow, REGION, RiverNetwork, screenOrientation, toCells, toGround, UPHILL_TOL, walk, WIDTH,
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
// The cell `q` half-widths out to the left bank (+) beside a river's point.
const besideOf = (river, i, q) => ({
  x: (river.points[2 * i] + river.dir[2 * i + 1] * q * river.half[i]) / ASPECT,
  y: river.points[2 * i + 1] - river.dir[2 * i] * q * river.half[i],
});
const bendOf = (river, i) => Math.abs(river.curve[i]) * river.half[i] * 2;

// Follows the current from a cell for `seconds`, as anything it carries
// would, and returns where it ends up.
function follow(world, start, seconds) {
  const flow = {};
  let { x, y } = start;
  const dt = 0.02;
  for (let k = 0; k < Math.round(seconds / dt); k++) {
    world.flowAt(x, y, flow);
    assert.ok(flow.speed > 0.04, 'still in the current');
    const half = toCells(flow.x * flow.speed * dt / 2, flow.y * flow.speed * dt / 2);
    world.flowAt(x + half.cols, y + half.rows, flow);
    const step = toCells(flow.x * flow.speed * dt, flow.y * flow.speed * dt);
    x += step.cols;
    y += step.rows;
  }
  return { x, y };
}

// Whether a cell lies in the pond at the end of any river.
function inPond(world, x, y) {
  const px = (x + 0.5) * ASPECT;
  const py = y + 0.5;
  for (const { river: { pond } } of world.rivers.segmentsFor(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE))) {
    if (!pond) continue;
    const u = ((px - pond.x) * pond.dx + (py - pond.y) * pond.dy) / pond.along;
    const v = ((py - pond.y) * pond.dx - (px - pond.x) * pond.dy) / pond.across;
    if (u * u + v * v < 1) return true;
  }
  return false;
}

// A network holding one river laid out by hand on made-up land, `elev`
// being that land as `RiverNetwork.trace` reads it, and nothing else.
function handMade(raw, end, elev) {
  const network = new RiverNetwork(1, { x: 1e6, y: 1e6 });
  const heights = [];
  for (let i = 0; i < raw.length; i += 2) heights.push(elev(raw[i], raw[i + 1], 5));
  const river = network.build(0, 0, raw, heights, end, 7, elev);
  for (let ry = -4; ry <= 4; ry++) for (let rx = -4; rx <= 4; rx++) network.regions.set(`${rx},${ry}`, null);
  network.regions.set('0,0', river);
  return { network, river };
}

// One chunk of made-up land, carved by a network.
function carveLand(network, cx, cy, elev) {
  const type = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const height = new Float64Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let k = 0; k < type.length; k++) {
    height[k] = elev((cx * CHUNK_SIZE + (k & 63)) * ASPECT, cy * CHUNK_SIZE + (k >> 6), 5);
    type[k] = height[k] < WATER_LEVEL ? WATER : GRASS;
  }
  const before = type.slice();
  const flow = network.carve(cx, cy, type, height);
  return { type, height, before, flow };
}

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
  // Judged by the cells it crosses: a metre east and a metre south crosses
  // over three columns for every row, so it runs along the rows.
  assert.equal(screenOrientation(1, 1), 0);
  const cellDiagonal = toGround(ASPECT, 1);
  assert.equal(screenOrientation(cellDiagonal.x, cellDiagonal.y), 3);
  assert.equal(screenOrientation(-cellDiagonal.x, cellDiagonal.y), 1);
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

test('a river carved into the land never raises its bed downstream', () => {
  const shelve = (e) => e < WATER_LEVEL ? WATER_LEVEL - (WATER_LEVEL - e) * 1.6 : e;
  const at = {};
  let checked = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const world = new World(seed, { maxChunks: 64 });
    for (const river of riversOf(world, 2)) {
      // The depth of the middle of the channel, as each carved cell near it
      // shows it: a cell's bed is that depth shallowed by how far across the
      // channel it lies.
      const profile = [];
      const seen = new Set();
      const all = [...river.half.keys()].slice(0, -1);
      for (let i = 0; i < river.mouthFrom - 6; i++) {
        const cx = Math.floor(river.points[2 * i] / ASPECT);
        const cy = Math.floor(river.points[2 * i + 1]);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (seen.has(`${x},${y}`)) continue;
            seen.add(`${x},${y}`);
            const { c, i: k } = world.locate(x, y);
            if (c.flow?.river[k] !== river.id) continue;
            // Only cells the river cut, not lake beds or ponds it passes.
            if (!(c.elev[k] < shelve(cellElevation(x * ASPECT, y, seed)) - 1e-6)) continue;
            if (inPond(world, x, y)) continue;
            world.rivers.locate(river, all, (x + 0.5) * ASPECT, y + 0.5, at);
            if (Math.abs(at.q) > 0.3) continue;
            profile.push([at.i + at.t, (WATER_LEVEL - c.elev[k]) / Math.max(0.08, 1 - at.q * at.q) ** 0.9]);
          }
        }
      }
      profile.sort((a, b) => a[0] - b[0]);
      let deepest = 0;
      for (const [s, depth] of profile) {
        assert.ok(depth >= deepest - 1e-5, `seed ${seed}, river ${river.id}: the bed rises at ${s}`);
        deepest = Math.max(deepest, depth);
        checked++;
      }
      for (let i = 1; i < river.depth.length; i++) assert.ok(river.depth[i] >= river.depth[i - 1]);
    }
  }
  assert.ok(checked > 500, `${checked} cells`);
});

test('a river mouth runs on into its lake, never through it into the dry land beyond', () => {
  // Land falling gently east to a narrow lake, then dry land beyond it.
  const narrow = (lx, ly) => {
    const x = Math.floor(lx / ASPECT) * ASPECT;
    return x >= 100 && x < 106 ? 0.38 : 0.6 - 0.001 * x;
  };
  const raw = [];
  for (let x = 0; x <= 102; x += 2) raw.push(x, 30);
  const tight = handMade(raw, 'lake', narrow);
  const end = tight.river.half.length - 1;
  assert.ok(tight.river.points[2 * end] + tight.river.half[end] < 106, 'the channel ends within the lake');
  for (let cx = 1; cx <= 3; cx++) {
    const land = carveLand(tight.network, cx, 0, narrow);
    for (let k = 0; k < land.type.length; k++) {
      if ((cx * CHUNK_SIZE + (k & 63)) * ASPECT >= 106) assert.notEqual(land.type[k], WATER, 'no water cut past the lake');
    }
  }
  // A broad lake takes the whole mouth.
  const broad = (lx) => (Math.floor(lx / ASPECT) * ASPECT >= 100 ? 0.38 : 0.6 - 0.001 * lx);
  const open = handMade(raw, 'lake', broad).river;
  assert.equal(open.half.length - open.mouthFrom - 1, Math.ceil(3 * open.half[open.mouthFrom] / 2));
  // On the real land too, the line of every mouth and the rounded end of
  // its channel lie on the lake's own water.
  let mouths = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const world = new World(seed, { maxChunks: 64 });
    for (const river of riversOf(world, 3)) {
      const n = river.half.length;
      if (river.end !== 'lake' || n - 1 === river.mouthFrom) continue;
      mouths++;
      const from = cellOf(river, river.mouthFrom);
      const dx = river.dir[2 * (n - 1)];
      const dy = river.dir[2 * (n - 1) + 1];
      const length = (n - 1 - river.mouthFrom) * 2 + river.half[n - 1];
      for (let d = 0.25; d <= length; d += 0.25) {
        const x = from.x + dx * d / ASPECT;
        const y = from.y + dy * d;
        assert.equal(world.preRiverTypeAt(x, y), WATER, `seed ${seed}: river ${river.id}'s mouth leaves its lake`);
        assert.equal(world.typeAt(x, y), WATER);
      }
    }
  }
  assert.ok(mouths > 3, `${mouths} mouths`);
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

test('the widest reaches report their full width', () => {
  // A straight river on flat land, broadened to the widest any river grows.
  const flat = () => 0.6;
  const raw = [];
  for (let x = 0; x <= 160; x += 2) raw.push(x, 30);
  const { network, river } = handMade(raw, 'pond', flat);
  river.half.fill(6);
  const { flow } = carveLand(network, 0, 0, flat);
  let checked = 0;
  for (let k = 0; k < flow.width.length; k++) {
    const x = (k & 63) * ASPECT;
    if (!flow.river[k] || x < 20 || x > 120 || Math.abs(flow.across[k]) > 40) continue;
    assert.ok(Math.abs(flow.width[k] / WIDTH - 6) <= 0.5 / WIDTH, `half-width ${flow.width[k] / WIDTH} of 6`);
    checked++;
  }
  assert.ok(checked > 100, `${checked} cells`);
  // And on the real land the reported width follows the river's own.
  checked = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const world = new World(seed);
    for (const r of riversOf(world, 3)) {
      for (let i = 4; i < r.mouthFrom - 2; i++) {
        if (r.half[i] < 3 || bendOf(r, i) > 0.3) continue;
        if (Math.abs(r.half[i - 2] - r.half[i]) > 0.15 || Math.abs(r.half[i + 2] - r.half[i]) > 0.15) continue;
        const { x, y } = cellOf(r, i);
        const f = world.flowAt(x, y);
        const full = groundHalfWidth(f.x, f.y, r.half[i]);
        assert.ok(Math.abs(f.halfWidth - full) / full < 0.05, `${f.halfWidth} m of ${full} m at a half-width of ${r.half[i]}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 3, `wide reaches found (${checked})`);
  assert.ok(255 / WIDTH >= 6, 'the stored width holds the widest river');
});

test('foam keeps time with the current that carries it, down widening and bending reaches too', () => {
  for (let seed = 1; seed <= 3; seed++) {
    const world = new World(seed);
    const rivers = riversOf(world, 3);
    // Whether another stretch of the river comes alongside point i, as on
    // a hairpin, where no one line runs through.
    const alone = (river, i) => {
      for (let k = 0; k < river.half.length; k++) {
        const far = Math.hypot(river.points[2 * k] - river.points[2 * i], river.points[2 * k + 1] - river.points[2 * i + 1]);
        if (Math.abs(k - i) > 8 && far < 3 * (river.half[i] + river.half[k])) return false;
      }
      return true;
    };
    let widening = null;
    let bending = null;
    for (const river of rivers) {
      for (let i = 6; i < river.mouthFrom - 12; i++) {
        let bend = 0;
        for (let k = i; k <= i + 6; k++) bend = Math.max(bend, bendOf(river, k));
        const grows = river.half[i + 6] - river.half[i];
        if (bend < 0.1 && (!widening || grows > widening.grows)) widening = { river, i, grows };
        if (river.half[i] >= 2 && bendOf(river, i) < 0.9 && alone(river, i) && (!bending || bendOf(river, i) > bending.bend)) {
          bending = { river, i: i - 2, bend: bendOf(river, i) };
        }
      }
    }
    assert.ok(widening.grows > 0.3 && bending.bend > 0.3, `seed ${seed}: a widening reach and a bend`);
    for (const { river, i } of [widening, bending]) {
      for (const q of [0, 0.65, -0.65]) {
        // Carried along for three seconds, its clock moves on three seconds.
        const start = besideOf(river, i, q);
        const end = follow(world, start, 3);
        const tau = world.flowAt(end.x, end.y).tau - world.flowAt(start.x, start.y).tau;
        assert.ok(Math.abs(tau - 3) < 0.3, `seed ${seed}, point ${i}, q=${q}: the clock moved ${tau} s in 3 s`);
      }
    }
  }
  // Away from rivers the line is still; so is a network without rivers.
  const world = new World(1);
  assert.deepEqual(world.rivers.lineAt(world.spawn.x, world.spawn.y), { x: 0, y: 0, speed: 0, tau: 0 });
  assert.deepEqual(new RiverNetwork(1, { x: 0, y: 0 }, { enabled: false }).lineAt(0, 0), { x: 0, y: 0, speed: 0, tau: 0 });
});

test('on the inside of a hairpin the current still runs downstream', () => {
  // A river turning right round on itself, tighter than it is wide.
  const raw = [];
  for (let k = 0; k <= 20; k++) raw.push(20 + k * 2, 60);
  for (let k = 1; k < 4; k++) raw.push(60 + 2 * Math.sin(k * Math.PI / 4), 62 - 2 * Math.cos(k * Math.PI / 4));
  for (let k = 0; k <= 20; k++) raw.push(60 - k * 2, 64);
  const { network, river } = handMade(raw, 'pond', () => 0.6);
  assert.ok(Math.max(...river.half) > 2, 'wider than the turn');
  const flow = {};
  const at = {};
  const other = {};
  const all = [...river.half.keys()].slice(0, -1);
  let checked = 0;
  for (let y = 60.5; y <= 64; y += 0.5) {
    for (let x = 52; x <= 64; x += 0.5) {
      network.locate(river, all, x, y, at);
      if (!(Math.abs(at.q) < 1)) continue;
      // Halfway between the two legs either way is downstream.
      network.locate(river, all.filter(k => Math.abs(k - at.i) > 3), x, y, other);
      if (Math.abs(other.q) - Math.abs(at.q) < 0.15) continue;
      network.lineAt(x / ASPECT, y, flow);
      const way = toGround(river.dir[2 * at.i], river.dir[2 * at.i + 1]);
      assert.ok(flow.x * way.x + flow.y * way.y > 0, `downstream at ${x}, ${y}`);
      checked++;
    }
  }
  assert.ok(checked > 20, `${checked} points`);
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

test('rivers stay cheap to trace and to carve', () => {
  // The first look at a stretch of land traces every river that could
  // reach it, from scratch.
  const cold = new RiverNetwork(13, { x: 1e6, y: 1e6 });
  let started = performance.now();
  const found = cold.riversNear(REGION * 0.5, REGION * 0.5);
  const traced = performance.now() - started;
  assert.ok(found.length > 3, `${found.length} rivers`);
  assert.ok(traced < 50, `the first rivers took ${traced.toFixed(1)} ms`);
  // Then each chunk a river crosses costs under twice the same land without
  // it: the quickest of a few tries of each, so other work on the machine
  // does not count.
  const world = new World(1);
  const plain = new World(1, { rivers: false });
  const { river, i } = widest(world);
  const cx = Math.floor(river.points[2 * i] / ASPECT / CHUNK_SIZE);
  const cy = Math.floor(river.points[2 * i + 1] / CHUNK_SIZE);
  const quickest = (w) => {
    let best = Infinity;
    for (let k = 0; k < 7; k++) {
      started = performance.now();
      for (let j = 0; j < 3; j++) w.generate(cx, cy);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  quickest(world);
  quickest(plain);
  const withRiver = quickest(world);
  const without = quickest(plain);
  assert.ok(world.chunk(cx, cy).flow, 'a river chunk');
  assert.ok(withRiver < 2 * without, `with the river ${withRiver.toFixed(2)} ms, without ${without.toFixed(2)} ms`);
});

test('immersion and carry follow the depth of the feet and the pace of the water', () => {
  assert.equal(immersion(MAX_WATER_DEPTH), 1);
  assert.equal(immersion(0.2), 0.5);
  assert.equal(immersion(0.3, 0.5), 0, 'a jump lifts the feet clear');
  assert.ok(Math.abs(immersion(0.3, -1) - 0.75) < 1e-12);
  const flow = { x: 1, y: 0, speed: BASE_SPEED };
  assert.deepEqual(carryTarget(flow, 1), { x: CURRENT_CARRY, y: 0 });
  assert.deepEqual(carryTarget({ x: 0, y: 1, speed: 0.05 }, 1), { x: 0, y: MIN_CARRY }, 'even slow water drifts a body');
  assert.deepEqual(carryTarget({ x: 1, y: 0, speed: 0.01 }, 1), { x: 0, y: 0 });
  assert.deepEqual(carryTarget(flow, 0), { x: 0, y: 0 });
  // About a quarter of a walk, never more than half of one.
  assert.ok(CURRENT_CARRY / 1.35 > 0.2 && CURRENT_CARRY / 1.35 < 0.3);
  assert.ok(carryTarget({ x: 1, y: 0, speed: 1 }, 1).x < 1.35 / 2);
  const carry = { x: 0.2, y: 0 };
  assert.equal(easeCarry(carry, { x: 0, y: 0 }, 1, true).x, 0.2, 'held through a hop');
  easeCarry(carry, { x: 0, y: 0 }, 5);
  assert.deepEqual(carry, { x: 0, y: 0 });
  assert.deepEqual(currentAt({}, 0, 0, 1), { x: 0, y: 0 }, 'a world without rivers carries nothing');
});

test('the current on a body is averaged over the water under its feet and both sides', () => {
  const world = new World(1);
  const { river, i } = widest(world);
  const { x, y } = cellOf(river, i);
  const flow = world.flowAt(x, y);
  const carry = currentAt(world, x, y, 1, 1.2);
  const l = Math.hypot(carry.x, carry.y);
  assert.ok(l > MIN_CARRY && (carry.x * flow.x + carry.y * flow.y) / l > 0.99, 'downstream');
  assert.ok(l <= Math.hypot(carryTarget({ ...flow, speed: 1 }, 1).x, carryTarget({ ...flow, speed: 1 }, 1).y), 'never more than the fastest water gives');
  // Feet out of the water feel nothing; neither does dry land.
  assert.deepEqual(currentAt(world, x, y, 0, 1.2), { x: 0, y: 0 });
  assert.deepEqual(currentAt(world, world.spawn.x, world.spawn.y, 1, 1.2), { x: 0, y: 0 });
});
