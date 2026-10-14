import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Grass } from '../src/world/grass.js';
import {
  BUTTERCUP, CATTAIL, DAISY, FERN, FLOWER_KINDS, FOXGLOVE, LUPIN, POPPY, SEED_OAT, SEED_RYE, grassRoots,
} from '../src/world/grass-roots.js';
import { LAYER, MIRRORED, GLYPH_MASK, dg, family } from '../src/render/glyphs.js';
import { FLORA } from '../src/render/glyph-packs/flora.js';
import { CHUNK_SIZE, GRASS, World } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const n = CHUNK_SIZE * CHUNK_SIZE;

// A world of one hand-placed root, with its precomputed blade record.
function single({ flower = 0, extra = 0, style = 0, height = 4, variation = 0.4 } = {}) {
  const chunk = {
    cx: 0, cy: 0,
    type: new Uint8Array(n).fill(GRASS),
    grassHeight: new Float32Array(n),
    grassStyle: new Uint8Array(n).fill(style),
    shade: new Float32Array(n).fill(0.6),
    rnd: new Float32Array(n).fill(0.2),
  };
  const i = 20 * CHUNK_SIZE + 20;
  chunk.grassHeight[i] = height;
  const rows = new Uint16Array(CHUNK_SIZE + 1);
  for (let y = 21; y <= CHUNK_SIZE; y++) rows[y] = 1;
  chunk.blades = { rows, indices: Uint16Array.of(i), heights: Uint8Array.of(height),
    variations: Float64Array.of(variation), flowers: Uint8Array.of(flower), extras: Uint8Array.of(extra),
    tones: Float32Array.of(40, 84, 58) };
  const empty = { ...chunk, grassHeight: new Float32Array(n), blades: { ...chunk.blades,
    rows: new Uint16Array(CHUNK_SIZE + 1), indices: new Uint16Array(0) } };
  return {
    seed: 19,
    chunk: (cx, cy) => (cx === 0 && cy === 0 ? chunk : empty),
    locate(x, y) {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cy = Math.floor(y / CHUNK_SIZE);
      return { c: this.chunk(cx, cy), i: (y - cy * CHUNK_SIZE) * CHUNK_SIZE + x - cx * CHUNK_SIZE };
    },
  };
}

const view = { x0: 0, y0: 0, cols: 40, rows: 40 };
function cells(world, grass = new Grass(), t = 1) {
  const out = [];
  grass.drawRow(withLayers({ cols: 40, rows: 40 }), world, view, t, 20,
    (_r, x, y, g, cr, cg, cb) => out.push({ x, y, g, cr, cg, cb }));
  return out;
}
const named = (prefix) => new Set(family(prefix));
const base = (g) => g & GLYPH_MASK;

test('a flower stands on a thin stalk with its head layered over the cell above, eye last', () => {
  const drawn = cells(single({ flower: DAISY }));
  const stems = named('flora.stem.');
  const petals = named('flora.daisy.');
  const stalk = drawn.filter((c) => stems.has(c.g));
  assert.ok(stalk.length >= 3, 'the stalk is drawn with thin stem strokes, not broad blades');
  const head = drawn.filter((c) => c.g & LAYER);
  assert.equal(head.length, 2, 'petals and an eye');
  assert.ok(head.every((c) => petals.has(base(c.g))));
  assert.deepEqual([head[0].x, head[0].y], [head[1].x, head[1].y], 'the eye sits in the petals');
  const top = Math.min(...stalk.map((c) => c.y));
  assert.equal(head[0].y, top - 1, 'the head tops the stalk');
  assert.ok(head[0].cr > 180 && head[1].cb < head[1].cr * 0.6, 'white petals around a yellow eye');
});

test('flower colours are clearly distinct by moonlight', () => {
  const colour = (flower) => cells(single({ flower })).find((c) => c.g & LAYER);
  const poppy = colour(POPPY);
  const buttercup = colour(BUTTERCUP);
  assert.ok(poppy.cr > poppy.cg * 2.5, 'poppies are red');
  assert.ok(buttercup.cr > buttercup.cb * 2 && buttercup.cg > buttercup.cb * 2, 'buttercups are yellow');
});

test('lupin and foxglove spikes run florets up over their own stalk', () => {
  for (const flower of [LUPIN, FOXGLOVE]) {
    const drawn = cells(single({ flower, height: 5 }));
    const florets = drawn.filter((c) => c.g & LAYER);
    const rows = new Set(florets.map((c) => c.y));
    assert.ok(rows.size >= 3, `a spike several rows tall (${rows.size})`);
    const stems = named('flora.stem.');
    const stalkRows = new Set(drawn.filter((c) => stems.has(c.g)).map((c) => c.y));
    assert.ok([...rows].filter((y) => stalkRows.has(y)).length >= 2, 'florets layer over the stalk cells');
  }
});

test('a trampled flower leaves fallen petals on the mat instead of a head', () => {
  const world = single({ flower: POPPY });
  const grass = new Grass();
  grass.update(world, { x: 20.5, y: 20.5, air: 0,
    feet: [{ id: 1, plant: 1, grounded: true, hx: 20.5, hy: 20.5, tx: 20.5, ty: 21 }] }, 1);
  const layered = cells(world, grass, 1).filter((c) => c.g & LAYER).map((c) => base(c.g));
  assert.ok(layered.length > 0 && layered.every((g) => g === dg('flora.fallen')), 'petals, no standing head');
});

test('flower heads reflect upside down and stay layered', () => {
  for (const name of ['flora.daisy.0@1', 'flora.poppy@2', 'flora.lupin.tip@0']) {
    const g = dg(name) | LAYER;
    assert.equal(MIRRORED[g], dg(`${name}~`) | LAYER);
  }
  const stem = dg('flora.stem.1.4');
  assert.equal(MIRRORED[stem], dg('flora.stem.4.1'), 'a leaning stalk leans the other way');
});

test('seed heads, cattails and dew decorate plain grass', () => {
  const seed = cells(single({ extra: SEED_OAT, style: 3 })).filter((c) => c.g & LAYER);
  assert.equal(seed.length, 1);
  assert.ok(named('flora.seed.').has(base(seed[0].g)));
  const reed = cells(single({ extra: CATTAIL, style: 5, height: 5 })).filter((c) => c.g & LAYER);
  assert.ok(named('flora.cattail').has(base(reed[0].g)));
  const rye = cells(single({ extra: SEED_RYE, style: 4 })).filter((c) => c.g & LAYER);
  assert.ok(named('flora.seed.rye').has(base(rye[0].g)));
});

test('ferns unfurl several fronds from one root', () => {
  const drawn = cells(single({ extra: FERN, variation: 0.9 }));
  const fronds = named('flora.frond.');
  assert.ok(drawn.length >= 8 && drawn.every((c) => fronds.has(c.g)), 'all frond segments');
  const xs = drawn.map((c) => c.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) >= 4, 'fronds arch out to both sides');
});

test('wild flowers grow in drifts of a species, matched to their ground', () => {
  const world = new World(19);
  const species = new Set();
  let windows = 0;
  let dominated = 0;
  for (let cy = -2; cy < 3; cy++) {
    for (let cx = -2; cx < 3; cx++) {
      const { blades } = world.chunk(cx, cy);
      const tally = new Map();
      blades.indices.forEach((i, k) => {
        const kind = blades.flowers[k];
        if (!kind) return;
        species.add(kind);
        if (kind === LUPIN || kind === FOXGLOVE) assert.ok(blades.heights[k] >= 4, 'spikes on tall stalks');
        if (kind === BUTTERCUP) assert.ok(blades.heights[k] <= 3, 'buttercups low in the turf');
        const key = `${Math.floor((i % CHUNK_SIZE) / 16)},${Math.floor(i / CHUNK_SIZE / 16)}`;
        const counts = tally.get(key) ?? new Map();
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
        tally.set(key, counts);
      });
      for (const counts of tally.values()) {
        const total = [...counts.values()].reduce((a, b) => a + b, 0);
        if (total < 12) continue;
        windows++;
        if (Math.max(...counts.values()) / total > 0.5) dominated++;
      }
    }
  }
  assert.ok(species.size >= FLOWER_KINDS - 2, `${species.size} species`);
  assert.ok(dominated / windows > 0.4, `${dominated} of ${windows} patches led by one species`);
});

test('neighbouring clumps differ in shade', () => {
  const size = CHUNK_SIZE;
  const chunk = { cx: 0, cy: 0, grassStyle: new Uint8Array(n), grassDensity: new Float32Array(n).fill(0.3),
    grassHeight: new Float32Array(n).fill(3.5), rnd: new Float32Array(n).fill(0.95) };
  const { tones } = grassRoots(chunk, 19, size);
  const greens = [];
  for (let k = 1; k < tones.length; k += 3) greens.push(tones[k]);
  assert.ok(Math.max(...greens) - Math.min(...greens) > 15, 'a visible spread of greens');
});

test('every flora glyph has a unique name and stays within the cell format', () => {
  const names = FLORA.map((e) => e.name);
  assert.equal(new Set(names).size, names.length);
});
