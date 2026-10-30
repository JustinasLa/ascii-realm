import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import {
  EDGE_STAND, gridOf, MAX_COORD, PROVINCE_METRES, provinceId, Provinces, SPAWN_CLEAR, toCellPoint, toMetres,
} from '../src/world/provinces.js';
import { landType, SHORE, seededLand, WATER, World } from '../src/world/world.js';

const S = PROVINCE_METRES;
const ids = (p, i0, j0, n) => {
  const out = [];
  for (let j = j0; j < j0 + n; j++) for (let i = i0; i < i0 + n; i++) out.push(provinceId(i, j));
  return out;
};
// Every province a cell of the window touches, by brute force: id -> the ids
// of cells 4-adjacent to its cells.
function bruteBorders(p, x0, y0, x1, y1) {
  const out = new Map();
  const add = (a, b) => {
    if (a === b) return;
    if (!out.has(a)) out.set(a, new Set());
    if (!out.has(b)) out.set(b, new Set());
    out.get(a).add(b);
    out.get(b).add(a);
  };
  let prev = null;
  for (let y = y0; y <= y1; y++) {
    const row = new Float64Array(x1 - x0 + 1);
    for (let x = x0; x <= x1; x++) {
      row[x - x0] = p.idAt(x, y);
      if (x > x0) add(row[x - x0 - 1], row[x - x0]);
      if (prev) add(prev[x - x0], row[x - x0]);
    }
    prev = row;
  }
  return out;
}
const spawnOf = (seed) => new World(seed, { rivers: false }).spawn;

test('ids are positive, distinct, safe integers that map back to their grid cell', () => {
  const seen = new Set();
  for (let j = -300; j <= 300; j++) {
    for (let i = -300; i <= 300; i++) {
      const id = provinceId(i, j);
      assert.ok(Number.isSafeInteger(id) && id > 0);
      seen.add(id);
      if ((i + j) % 37 === 0) assert.deepEqual(gridOf(id), { i, j });
    }
  }
  assert.equal(seen.size, 601 * 601);
  const p = new Provinces(1);
  for (const [x, y] of [[MAX_COORD, MAX_COORD], [-MAX_COORD, MAX_COORD], [-MAX_COORD, -MAX_COORD]]) {
    const id = p.idAt(x, y);
    assert.ok(Number.isSafeInteger(id) && id > 0);
  }
  assert.ok(Number.isSafeInteger(provinceId(2 ** 25, -(2 ** 25))));
});

test('beyond the bounds there is province 0: land with no heart or neighbours', () => {
  const p = new Provinces(1);
  assert.equal(p.idAt(MAX_COORD + 1, 0), 0);
  assert.equal(p.idAt(0, -MAX_COORD - 1), 0);
  assert.equal(p.terrain(0), 'land');
  assert.equal(p.heart(0), null);
  assert.deepEqual(p.neighbours(0), []);
});

test('ids and terrains are the same for a seed and differ between seeds', () => {
  const a = new Provinces(1);
  const b = new Provinces(1);
  const c = new Provinces(2);
  const window = ids(a, -15, -15, 30);
  assert.deepEqual(window.map(id => a.terrain(id)), window.map(id => b.terrain(id)));
  assert.notDeepEqual(window.map(id => a.terrain(id)), window.map(id => c.terrain(id)));
  const rand = mulberry32(7);
  let differ = 0;
  for (let k = 0; k < 2000; k++) {
    const x = (rand() - 0.5) * 1e5;
    const y = (rand() - 0.5) * 3e4;
    assert.equal(a.idAt(x, y), b.idAt(x, y));
    assert.equal(a.idAt(x, y), a.idAt(Math.floor(x), Math.floor(y)));
    if (a.idAt(x, y) !== c.idAt(x, y)) differ++;
  }
  assert.ok(differ > 200);
});

test('the 3×3 seed search finds the nearest seed a 7×7 search does', () => {
  for (const seed of [1, 2, 3]) {
    const p = new Provinces(seed);
    const rand = mulberry32(seed);
    for (let k = 0; k < 1e5; k++) {
      const x = Math.floor((rand() - 0.5) * 2e5);
      const y = Math.floor((rand() - 0.5) * 6e4);
      const id = p.idAt(x, y);
      const { wx, wy } = p.found;
      const gi = Math.floor(wx / S), gj = Math.floor(wy / S);
      let best = Infinity, bestId = 0;
      for (let j = gj - 3; j <= gj + 3; j++) {
        for (let i = gi - 3; i <= gi + 3; i++) {
          const s = p.seedOf(i, j);
          const d = Math.hypot(wx - s.x, wy - s.y);
          if (d < best) {
            best = d;
            bestId = provinceId(i, j);
          }
        }
      }
      assert.equal(id, bestId);
    }
  }
});

test('neighbours are exactly the provinces 4-adjacent on the cell grid', () => {
  for (const seed of [1, 2, 3]) {
    const p = new Provinces(seed);
    const s = p.seedOf(1, -1);
    const id = provinceId(1, -1);
    const lo = toCellPoint(s.x - 140, s.y - 140), hi = toCellPoint(s.x + 140, s.y + 140);
    const x0 = Math.floor(lo.x), y0 = Math.floor(lo.y), x1 = Math.ceil(hi.x), y1 = Math.ceil(hi.y);
    // The province lies wholly inside the window.
    for (let x = x0; x <= x1; x += 7) {
      assert.notEqual(p.idAt(x, y0), id);
      assert.notEqual(p.idAt(x, y1), id);
    }
    const brute = bruteBorders(new Provinces(seed), x0, y0, x1, y1);
    assert.deepEqual(p.neighbours(id), [...brute.get(id)].sort((a, b) => a - b));
    assert.equal(p.neighbours(id), p.neighbours(id));
  }
});

test('neighbours are symmetric', () => {
  for (const seed of [1, 2, 3]) {
    const p = new Provinces(seed);
    for (const id of ids(p, -2, -2, 4)) {
      const list = p.neighbours(id);
      assert.ok(list.length >= 3 && !list.includes(id));
      for (const other of list) assert.ok(p.neighbours(other).includes(id), `${seed}: ${id} and ${other}`);
    }
  }
});

test('about a tenth of the land is bog, leaning towards lakes', () => {
  let bogLake = 0, bogs = 0, landLake = 0, lands = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const p = new Provinces(seed, { spawn: spawnOf(seed) });
    let land = 0, bog = 0;
    for (const id of ids(p, -15, -15, 30)) {
      const t = p.terrain(id);
      if (t === 'water') continue;
      land++;
      const samples = p.details(id).samples;
      const lake = samples.filter(s => landType(seededLand(s.x, s.y, seed)) !== 2).length / samples.length;
      landLake += lake;
      lands++;
      if (t === 'bog') {
        bog++;
        bogLake += lake;
        bogs++;
      }
    }
    assert.ok(bog / land >= 0.07 && bog / land <= 0.13, `seed ${seed}: ${bog} of ${land}`);
  }
  assert.ok(bogLake / bogs > landLake / lands);
});

test('no province holding spawn or reaching within 64 m of it is bog', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const spawn = spawnOf(seed);
    const p = new Provinces(seed, { spawn });
    assert.notEqual(p.terrain(p.idAt(spawn.x, spawn.y)), 'bog');
    for (let k = 0; k < 8; k++) assert.notEqual(p.terrain(p.probe(spawn.x, spawn.y, SPAWN_CLEAR, k)), 'bog');
  }
  // A bog stays a bog until spawn sits in it, or just across its border.
  const free = new Provinces(1);
  const bog = free.nearest('bog', 0, 0);
  const heart = free.heart(bog);
  assert.equal(new Provinces(1, { spawn: heart }).terrain(bog), 'land');
  // Spawn just outside it, with one probe 64 m away landing inside.
  let across = null;
  for (let t = 0; !across; t += 2) {
    const c = toCellPoint(toMetres(heart.x, heart.y).x - t, toMetres(heart.x, heart.y).y);
    const spawn = { x: Math.floor(c.x), y: heart.y };
    if (free.idAt(spawn.x, spawn.y) !== bog && free.probe(spawn.x, spawn.y, SPAWN_CLEAR, 0) === bog) across = spawn;
  }
  assert.equal(new Provinces(1, { spawn: across }).terrain(bog), 'land');
  const far = toCellPoint(toMetres(heart.x, heart.y).x - 3 * S, 0);
  assert.equal(new Provinces(1, { spawn: { x: far.x, y: heart.y } }).terrain(bog), 'bog');
});

test('a province that is mostly lake is water, and bogs: false makes no bog', () => {
  const wet = new Provinces(3, { landTypeAt: () => WATER });
  assert.ok(ids(wet, 0, 0, 5).every(id => wet.terrain(id) === 'water'));
  const shore = new Provinces(3, { landTypeAt: () => SHORE });
  assert.ok(ids(shore, 0, 0, 5).every(id => shore.terrain(id) !== 'water'));
  const dry = new Provinces(1, { bogs: false });
  assert.ok(ids(dry, -15, -15, 30).every(id => dry.terrain(id) === 'land'));
});

test('hearts lie well inside their provinces', () => {
  const p = new Provinces(2);
  for (const id of ids(p, -3, -3, 6)) {
    const h = p.heart(id);
    assert.equal(p.idAt(h.x, h.y), id);
    assert.ok(p.ringInside(id, h.x, h.y, 16));
    assert.deepEqual(p.heart(id), h);
  }
});

test('nearest finds the closest bog, or null when none is in reach', () => {
  const spawn = spawnOf(1);
  const p = new Provinces(1, { spawn });
  const bog = p.nearest('bog', spawn.x, spawn.y);
  assert.equal(p.terrain(bog), 'bog');
  assert.equal(p.nearest('bog', spawn.x, spawn.y, 0), null);
  assert.equal(p.nearest('water', spawn.x, spawn.y, 2), null);
  // No other bog's heart in the searched rings is nearer.
  const m = toMetres(spawn.x, spawn.y);
  const dist = (id) => {
    const h = toMetres(p.heart(id).x, p.heart(id).y);
    return Math.hypot(h.x - m.x, h.y - m.y);
  };
  for (const id of ids(p, -10, -10, 20)) if (p.terrain(id) === 'bog') assert.ok(dist(id) >= dist(bog));
});

test('edgePoint stands just inside a province, facing a point', () => {
  for (let seed = 1; seed <= 3; seed++) {
    const spawn = spawnOf(seed);
    const p = new Provinces(seed, { spawn });
    const bog = p.nearest('bog', spawn.x, spawn.y);
    for (const from of [spawn, p.heart(bog)]) {
      const e = p.edgePoint(bog, from);
      assert.equal(p.idAt(e.x, e.y), bog);
      assert.equal(p.ringInside(bog, e.x, e.y, EDGE_STAND), false);
    }
    // Facing spawn, it is the bog's nearer side.
    const near = toMetres(p.edgePoint(bog, spawn).x, p.edgePoint(bog, spawn).y);
    const heart = toMetres(p.heart(bog).x, p.heart(bog).y);
    const s = toMetres(spawn.x, spawn.y);
    assert.ok(Math.hypot(near.x - s.x, near.y - s.y) < Math.hypot(heart.x - s.x, heart.y - s.y));
  }
});

test('the world builds its provinces once spawn is known', () => {
  const world = new World(1, { rivers: false });
  const { provinces, spawn } = world;
  assert.equal(provinces.seed, 1);
  assert.equal(provinces.bogs, true);
  assert.deepEqual(provinces.spawn, { x: Math.floor(spawn.x), y: Math.floor(spawn.y) });
  assert.equal(provinces.terrain(provinces.idAt(spawn.x, spawn.y)), 'land');
  assert.equal(new World(1, { rivers: false, bogs: false }).provinces.bogs, false);
});
