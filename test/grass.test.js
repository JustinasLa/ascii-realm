import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Grass, MAX_GRASS_HEIGHT } from '../src/world/grass.js';
import { Player } from '../src/entities/player.js';
import { glyph } from '../src/render/glyphs.js';
import { reflector } from '../src/world/reflection.js';
import { CHUNK_SIZE, DIRT, GRASS, SHORE, STONE, WATER, World } from '../src/world/world.js';

// Terrain-only fixtures keep blade geometry and interaction tests independent
// of the procedural biome layout.
function meadow(roots = null) {
  const chunks = new Map();
  const world = {
    seed: 19,
    chunk(cx, cy) {
      const key = `${cx},${cy}`;
      if (!chunks.has(key)) {
        const n = CHUNK_SIZE * CHUNK_SIZE;
        const c = {
          cx, cy,
          type: new Uint8Array(n).fill(GRASS),
          grassHeight: new Float32Array(n),
          reeds: new Uint8Array(n),
          shade: new Float32Array(n).fill(0.6),
          rnd: new Float32Array(n).fill(0.91),
        };
        for (let y = 0; y < CHUNK_SIZE; y++) {
          for (let x = 0; x < CHUNK_SIZE; x++) {
            const wx = cx * CHUNK_SIZE + x;
            const wy = cy * CHUNK_SIZE + y;
            c.grassHeight[y * CHUNK_SIZE + x] = roots ? (roots.get(`${wx},${wy}`) || 0) : 3.5;
          }
        }
        chunks.set(key, c);
      }
      return chunks.get(key);
    },
    locate(x, y) {
      x = Math.floor(x);
      y = Math.floor(y);
      const cx = Math.floor(x / CHUNK_SIZE);
      const cy = Math.floor(y / CHUNK_SIZE);
      return { c: this.chunk(cx, cy), i: (y - cy * CHUNK_SIZE) * CHUNK_SIZE + x - cx * CHUNK_SIZE };
    },
    typeAt() { return GRASS; },
    isWalkable() { return true; },
  };
  return world;
}

function renderer(view, onPut = () => {}) {
  return {
    cols: view.cols,
    rows: view.rows,
    fg: new Float32Array(view.cols * view.rows * 4),
    mask: new Uint8Array(view.cols * view.rows),
    put(x, y, g, cr, cg, cb) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
      const i = (y * this.cols + x) * 4;
      this.fg.set([cr, cg, cb, g], i);
      onPut(x, y, g);
    },
    putBg() {},
  };
}

function rowCells(grass, world, view, t, y) {
  const cells = [];
  grass.drawRow(renderer(view), world, view, t, y, (_r, x, row, g, cr, cg, cb, base) => {
    cells.push({ x, y: row, g, cr, cg, cb, base });
  });
  return cells;
}

const player = (x, y, air = 0) => ({ x, y, air });

test('grass biome heights are cached and deterministic, with reeds on shoreline terrain', () => {
  const a = new World(19);
  const b = new World(19);
  const heights = new Set();
  let reeds = 0;
  const chunks = [[0, 0], [-1, 0], [0, -1], [1, 1], [-2, 2], [3, -2]];
  for (const [cx, cy] of [...chunks].reverse()) b.chunk(cx, cy);
  for (const [cx, cy] of chunks) {
    const ca = a.chunk(cx, cy);
    const cb = b.chunk(cx, cy);
    assert.strictEqual(a.chunk(cx, cy).grassHeight, ca.grassHeight);
    assert.ok(ca.grassHeight instanceof Float32Array);
    assert.ok(ca.grassDensity instanceof Float32Array);
    assert.ok(ca.reeds instanceof Uint8Array);
    assert.deepEqual(ca.grassHeight, cb.grassHeight);
    assert.deepEqual(ca.reeds, cb.reeds);
    assert.deepEqual(ca.grassDensity, cb.grassDensity);
    for (let i = 0; i < ca.type.length; i++) {
      const h = ca.grassHeight[i];
      assert.ok(h <= 5, 'even shoreline grass stays within five cells');
      if ([WATER, DIRT, STONE].includes(ca.type[i])) {
        assert.equal(h, 0);
        assert.equal(ca.reeds[i], 0);
      } else if (ca.type[i] === SHORE) {
        if (h) {
          assert.ok(ca.reeds[i]);
          assert.ok(h >= 3 && h <= 5);
          reeds++;
        }
      } else {
        assert.ok(h >= 2);
        heights.add(h);
        if (ca.reeds[i]) {
          reeds++;
          assert.ok(h >= 2 && h <= 5);
        }
      }
    }
  }
  assert.equal(MAX_GRASS_HEIGHT, 5);
  assert.ok([...heights].some((h) => h >= 2 && h < 2.4), 'verges retain multi-cell grass');
  assert.ok([...heights].some((h) => h > 2.6 && h < 3.6), 'the field includes ordinary grass');
  assert.ok([...heights].some((h) => h > 3.7), 'the meadow includes fuller patches');
  assert.ok(reeds > 0, 'the sampled shore includes reeds');
});

test('wind moves upper blade geometry while the root and reflection base stay fixed', () => {
  const world = meadow(new Map([['0,0', 5]]));
  const grass = new Grass();
  const view = { x0: -12, y0: -20, cols: 32, rows: 40 };
  const shapes = new Set();
  for (const t of [0, 0.7, 1.8, 3.2, 5.5, 8.1]) {
    const cells = rowCells(grass, world, view, t, 0);
    assert.ok(cells.length >= 2);
    assert.ok(cells.every((c) => c.base === 20));
    assert.ok(cells.some((c) => c.x === 12 && c.y === 20), `root at t=${t}`);
    shapes.add(JSON.stringify(cells.filter((c) => c.y < 20).map((c) => [c.x, c.y, c.g])));
  }
  assert.ok(shapes.size > 1, 'wind changes blade geometry, beyond colour shimmer');
});

test('path verges blend in height and density without one-cell lawn or height cliffs', () => {
  const world = new World(19);
  const sample = (x, y) => {
    const { c, i } = world.locate(x, y);
    return { type: c.type[i], h: c.grassHeight[i], density: c.grassDensity[i] };
  };
  const heights = [];
  for (let x = -70; x <= -46; x++) {
    const a = sample(x, -92);
    const b = sample(x + 1, -92);
    if (a.type !== GRASS) continue;
    assert.ok(a.h >= 2 && a.h <= 5);
    heights.push(a.h);
    if (b.type !== GRASS) continue;
    assert.ok(Math.abs(a.h - b.h) < 0.4, `height cliff at ${x}`);
    assert.ok(Math.abs(a.density - b.density) < 0.025, `density cliff at ${x}`);
  }
  assert.ok(Math.max(...heights) - Math.min(...heights) > 0.5, 'the verge transitions into the field');
  assert.ok(heights.some((h) => h > 2.2 && h < 2.6), 'intermediate-height grass fills the transition');
});

test('player contact visibly flattens a short blade, then restores its wind-driven pose', () => {
  const world = meadow(new Map([['2,0', 3]]));
  const grass = new Grass();
  const view = { x0: -10, y0: -10, cols: 30, rows: 30 };
  const before = rowCells(grass, world, view, 0, 0);
  grass.update(world, player(0.5, 0.5), 0);
  const after = rowCells(grass, world, view, 0, 0);
  assert.ok(Math.min(...after.map((c) => c.y)) > Math.min(...before.map((c) => c.y)),
    'the visible stalk lies lower, rather than just changing a stored bend');
  assert.ok(after.some((c) => c.g === glyph('-')), 'pressed grass has a horizontal stalk');
  assert.ok(after.some((c) => c.x === 12 && c.y === 10), 'the root stays anchored');
  grass.update(world, player(30.5, 0.5), 0.1);
  assert.ok(grass.pressAt(2, 0, 0.2) > 0.6, 'the flattened trail remains briefly');
  assert.deepEqual(rowCells(grass, world, view, 2.2, 0), rowCells(new Grass(), world, view, 2.2, 0));
});

test('real sword animations disturb grass beyond the footsteps, including every combo swing', () => {
  const world = meadow();
  const warrior = new Player(0.5, 0.5);
  const grass = new Grass();
  const feetOnly = new Grass();
  warrior.combat.inHand = true;
  let activeFrames = 0;
  let outerContacts = 0;
  for (let swing = 0; swing < 3; swing++) {
    warrior.attack();
    let reacted = false;
    for (let frame = 0; frame < 32; frame++) {
      warrior.update(1 / 60, world, { x: 0, y: 0 }, false);
      grass.update(world, warrior, warrior.time);
      feetOnly.update(world, player(warrior.x, warrior.y), warrior.time);
      if (warrior.swordSweep) {
        activeFrames++;
        for (const [key, bend] of grass.bends) {
          if (bend.t === warrior.time && !feetOnly.bends.has(key)) {
            reacted = true;
            outerContacts++;
          }
        }
      }
      warrior.events.length = 0;
    }
    assert.ok(reacted, `combo swing ${swing + 1} pushes grass outside the foot radius`);
  }
  assert.ok(activeFrames > 3 && outerContacts > 10);
  assert.equal(warrior.swordSweep, null, 'a resting sword does not keep flattening the grass');
});

test('sword contact covers the space swept between blade frames and produces a flattened blade', () => {
  const world = meadow();
  const grass = new Grass();
  const first = { ...player(0.5, 0.5), swordSweep: { hx: 8, hy: -1, tx: 8, ty: 2, t: 0 } };
  grass.update(world, first, 0);
  assert.equal(grass.pressAt(13, 0, 0), 0, 'the middle root is outside the first blade footprint');
  const next = { ...first, swordSweep: { hx: 18, hy: -1, tx: 18, ty: 2, t: 0.05 } };
  grass.update(world, next, 0.05);
  assert.ok(grass.pressAt(13, 0, 0.05) > 0.8, 'the swept strip affects grass between footprints');
  const cells = rowCells(grass, meadow(new Map([['13,0', 3]])),
    { x0: 0, y0: -10, cols: 30, rows: 20 }, 0.05, 0);
  assert.ok(cells.some((c) => c.g === glyph('-')), 'the sword wake is visible in the rendered blade');
  grass.update(world, { ...next, swordSweep: null, air: 1 }, 2.1);
  assert.equal(grass.pressAt(13, 0, 2.1), 0, 'the sword wake recovers');
});

test('panning across negative chunk boundaries preserves the cropped grass image', () => {
  const roots = new Map([['-65,-65', 5], ['-64,-60', 4], ['-57,-53', 3], ['-43,-41', 5]]);
  const world = meadow(roots);
  const grass = new Grass();
  const broad = { x0: -80, y0: -85, cols: 70, rows: 75 };
  const crop = { x0: -69, y0: -72, cols: 35, rows: 40 };
  const render = (view) => {
    const r = renderer(view);
    grass.drawLayered(r, world, view, 2.3, []);
    return r;
  };
  const a = render(broad);
  const b = render(crop);
  assert.ok(b.fg.some((v) => v !== 0), 'the crop contains blades');
  for (let y = 0; y < crop.rows; y++) {
    for (let x = 0; x < crop.cols; x++) {
      const ai = ((crop.y0 + y - broad.y0) * broad.cols + crop.x0 + x - broad.x0) * 4;
      const bi = (y * crop.cols + x) * 4;
      assert.deepEqual(b.fg.slice(bi, bi + 4), a.fg.slice(ai, ai + 4), `world ${crop.x0 + x},${crop.y0 + y}`);
    }
  }
});

test('player contact bends blades aside and leaves a recovering trail', () => {
  const world = meadow();
  const grass = new Grass();
  grass.update(world, player(0.5, 0.5), 0);
  const left = grass.bendAt(-2, 0, 0);
  const right = grass.bendAt(2, 0, 0);
  assert.ok(left * right < 0, 'blades bend away from the player on either side');
  assert.ok(Math.abs(right) > 0);
  assert.equal(grass.bendAt(20, 0, 0), 0);
  grass.update(world, player(30.5, 0.5), 0.1);
  assert.ok(Math.abs(grass.bendAt(2, 0, 0.2)) > 0, 'bend persists after the player leaves');
  assert.ok(Math.abs(grass.bendAt(2, 0, 0.8)) < Math.abs(right), 'the blade recovers over time');
  assert.equal(grass.bendAt(2, 0, 2.2), 0);
});

test('airborne players do not bend grass and teleports do not flatten the intervening field', () => {
  const world = meadow();
  const airborne = new Grass();
  airborne.update(world, player(0.5, 0.5, 1), 0);
  assert.equal(airborne.bendAt(2, 0, 0), 0);
  const grass = new Grass();
  grass.update(world, player(0.5, 0.5), 0);
  grass.update(world, player(100.5, 0.5), 0.1);
  assert.equal(grass.bendAt(50, 0, 0.1), 0);
  assert.ok(Math.abs(grass.bendAt(102, 0, 0.1)) > 0, 'landing at the destination still makes contact');
});

test('grounded movement sweeps grass contact while jumps leave the crossed grass untouched', () => {
  const world = meadow();
  const walking = new Grass();
  walking.update(world, player(0.5, 0.5), 0);
  // Six columns in 0.1 seconds is within running speed. This lateral blade
  // lies outside both endpoint footprints, but within the swept footprint.
  assert.equal(walking.bendAt(3, 4, 0), 0);
  walking.update(world, player(6.5, 0.5), 0.1);
  assert.ok(Math.abs(walking.bendAt(3, 4, 0.1)) > 0, 'grounded movement contacts grass between snapshots');
  const jumping = new Grass();
  jumping.update(world, player(0.5, 0.5), 0);
  jumping.update(world, player(3.5, 0.5, 1), 0.05);
  jumping.update(world, player(6.5, 0.5), 0.1);
  assert.equal(jumping.bendAt(3, 4, 0.1), 0);
});

test('a short teleport faster than running does not sweep the intervening grass', () => {
  const world = meadow();
  const grass = new Grass();
  grass.update(world, player(0.5, 0.5), 0);
  grass.update(world, player(13.5, 0.5), 0.1);
  assert.equal(grass.bendAt(6, 3, 0.1), 0);
  assert.ok(Math.abs(grass.bendAt(15, 0, 0.1)) > 0, 'destination contact still bends nearby grass');
});

test('grass interaction memory stays bounded during long travel', () => {
  const world = meadow();
  const grass = new Grass();
  for (let i = 0; i < 180; i++) grass.update(world, player(i * 20 + 0.5, 0.5), i * 0.0001);
  assert.ok(grass.bends.size > 0);
  assert.ok(grass.bends.size <= 1024, `stored bends: ${grass.bends.size}`);
  grass.update(world, player(3600.5, 0.5, 1), 2.2);
  assert.equal(grass.bends.size, 0, 'expired contact is removed from memory');
});

test('offscreen grass roots reflect into visible water without writing on dry terrain', () => {
  const roots = new Map([['3,-2', 5], ['8,-2', 5], ['13,-2', 5], ['18,-2', 5]]);
  const world = meadow(roots);
  const grass = new Grass();
  const view = { x0: 0, y0: 0, cols: 24, rows: 16 };
  const r = renderer(view);
  for (let i = 0; i < r.mask.length; i++) r.mask[i] = i % 3 === 0 ? GRASS : WATER;
  const mirror = reflector(0.4, view);
  const bases = [];
  grass.drawReflections(r, world, view, 0.4, (...args) => {
    bases.push(args[7]);
    mirror(...args);
  });
  assert.ok(bases.some((base) => base < 0), 'roots above the viewport contribute reflections');
  let reflected = 0;
  for (let i = 0; i < r.mask.length; i++) {
    const g = r.fg[i * 4 + 3];
    if (r.mask[i] !== WATER) assert.equal(g, 0, `dry cell ${i}`);
    else if (g !== 0) reflected++;
  }
  assert.ok(reflected > 0, 'the real reflection writer draws visible water cells');
});

test('rooted grass rows interleave with entities in painter order', () => {
  const world = meadow(new Map([['0,3', 4], ['0,7', 4]]));
  const grass = new Grass();
  const view = { x0: -10, y0: -10, cols: 24, rows: 30 };
  const events = [];
  const r = renderer(view, (_x, y) => events.push(`cell:${y}`));
  grass.drawLayered(r, world, view, 0, [
    { y: 2, draw: () => events.push('back entity') },
    { y: 6, draw: () => events.push('front entity') },
  ]);
  const back = events.indexOf('back entity');
  const backRoot = events.indexOf('cell:13');
  const front = events.indexOf('front entity');
  const frontRoot = events.indexOf('cell:17');
  assert.ok(back >= 0 && backRoot >= 0 && front >= 0 && frontRoot >= 0);
  assert.ok(back < backRoot && backRoot < front && front < frontRoot, events.join(', '));
});

test('reflected grass rows interleave with reflected entities in the same rooted order', () => {
  const world = meadow(new Map([['0,3', 4], ['0,7', 4]]));
  const grass = new Grass();
  const view = { x0: -10, y0: -10, cols: 24, rows: 30 };
  const events = [];
  const r = renderer(view);
  r.mask.fill(WATER);
  grass.drawReflections(r, world, view, 0, (_r, _x, _y, _g, _cr, _cg, _cb, base) => {
    events.push(`root:${base}`);
  }, [
    { y: 2, draw: () => events.push('back reflection') },
    { y: 6, draw: () => events.push('front reflection') },
  ]);
  const back = events.indexOf('back reflection');
  const backRoot = events.indexOf('root:13');
  const front = events.indexOf('front reflection');
  const frontRoot = events.indexOf('root:17');
  assert.ok(back >= 0 && backRoot >= 0 && front >= 0 && frontRoot >= 0);
  assert.ok(back < backRoot && backRoot < front && front < frontRoot, events.join(', '));
});
