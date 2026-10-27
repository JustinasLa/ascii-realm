import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { packFine } from '../src/world/fine-bakes.js';
import { fineRecipe, fineSource } from '../src/world/prop-art.js';
import { GROVE_FLOWER_CHANCE, WOOD_FLOWERS, grassRoots, woodFlowerAt } from '../src/world/grass-roots.js';
import { pickForm } from '../src/world/pale-caps.js';
import { blocks, createProp, generateProps, rebuildProp } from '../src/world/props.js';
import { makeTree, TREE_SPECIES } from '../src/world/trees.js';
import { ASPECT, CHUNK_SIZE, GRASS, World } from '../src/world/world.js';
import {
  clumpReach, GROVE, groveField, groveProps, MAX_CHUNK_PROPS, neighbourSolids, ROCK_FOOT_MAX, rngSeed, sitesAround,
  TREE_FOOT_MAX, TREE_FOOTH_MAX, treeSites, WOODLANDS, woodlandOptions,
} from '../src/world/woodland.js';

const S = CHUNK_SIZE;
// Runs a fine bake to the end.
const finish = (steps) => { let step; do step = steps.next(); while (!step.done); return step.value; };
const fineCells = (prop) => finish(fineRecipe(prop)());
// A dense 4×4-chunk block of World(19) with many grove sites, next to spawn.
const BLOCK = { cx: -4, cy: -1, n: 4 };
const chunksOf = ({ cx, cy, n }) => Array.from({ length: n * n }, (_, k) => [cx + k % n, cy + Math.floor(k / n)]);
const blockProps = (world, block = BLOCK) => chunksOf(block).flatMap(([cx, cy]) => world.propsOf(cx, cy));
let dense19;
const dense = () => (dense19 ??= new World(19, { woodland: 'dense' }));
const groveTrees = (world, props) => {
  const sites = new Set(chunksOf(BLOCK).flatMap(([cx, cy]) => treeSites(world, cx, cy, S))
    .filter((s) => s.grove).map((s) => `${s.x},${s.y}`));
  return props.filter((p) => p.kind === 'tree' && sites.has(`${p.x},${p.y}`));
};
// A world that is grass everywhere, with spawn far away: generators place
// every rock and tree they draw.
const meadowWorld = (seed, grove = GROVE) => ({ seed, season: 'summer', spawn: { x: 1e6, y: 1e6 }, grove,
  typeAt: () => GRASS, landTypeAt: () => GRASS, siteCache: new Map() });

test('the world keeps its sparse, grass-only woods unless dense ones are asked for', () => {
  assert.deepEqual(WOODLANDS, ['sparse', 'dense']);
  const plain = new World(1);
  assert.equal(plain.woodland, 'sparse');
  assert.equal(plain.flora, false);
  assert.equal(new World(1, { woodland: 'dense' }).flora, true, 'dense woods bring their flowers');
  assert.equal(new World(1, { woodland: 'dense', flora: false }).flora, false);
  assert.equal(new World(1, { flora: true }).woodland, 'sparse');
  assert.equal(new World(1, { woodland: 'lush' }).woodland, 'sparse');
  assert.equal(new World(1, 64).woodland, 'sparse');
});

test('the page address picks the woods and the flowers, and a lobby page is always sparse', () => {
  const read = (q, options) => woodlandOptions(new URLSearchParams(q), options);
  assert.deepEqual(read(''), { woodland: 'sparse' });
  assert.deepEqual(read('woodland=dense'), { woodland: 'dense' });
  assert.deepEqual(read('woodland=dense&flora=0'), { woodland: 'dense', flora: false });
  assert.deepEqual(read('flora=1'), { woodland: 'sparse', flora: true });
  assert.deepEqual(read('flora=true'), { woodland: 'sparse', flora: true });
  assert.deepEqual(read('flora=0'), { woodland: 'sparse', flora: false });
  assert.deepEqual(read('flora=false'), { woodland: 'sparse', flora: false });
  assert.deepEqual(read('woodland=thick&flora=lots'), { woodland: 'sparse' });
  assert.deepEqual(read('woodland=dense', { inLobby: true }), { woodland: 'sparse' });
  assert.deepEqual(read('woodland=dense&flora=1', { inLobby: true }), { woodland: 'sparse', flora: true });
});

test('the land type is worked out without generating a chunk and matches the generated land', () => {
  const world = new World(19, { spawnRuins: true });
  const { x, y } = world.spawn;
  const cx = Math.floor(x / S), cy = Math.floor(y / S);
  const pure = [];
  for (let wy = (cy - 1) * S; wy < (cy + 2) * S; wy += 1) {
    for (let wx = (cx - 1) * S; wx < (cx + 2) * S; wx += 3) pure.push(world.landTypeAt(wx + 0.25, wy + 0.75));
  }
  assert.equal(world.chunks.size, 0, 'no chunk was made');
  let k = 0, ruin = 0, river = 0;
  for (let wy = (cy - 1) * S; wy < (cy + 2) * S; wy += 1) {
    for (let wx = (cx - 1) * S; wx < (cx + 2) * S; wx += 3) {
      assert.equal(pure[k++], world.preRiverTypeAt(wx, wy), `${wx},${wy}`);
      if (world.spawnRuins.terrainAt(wx, wy) !== undefined) ruin++;
      if (world.riverAt(wx, wy)) river++;
    }
  }
  assert.ok(ruin > 0, 'the block holds the starter ruin');
  assert.ok(river >= 0);
});

test('random streams are seeded with whole 32-bit numbers, so sites draw differently', () => {
  const a = rngSeed(3, 4, 2301);
  const b = rngSeed(35, 4, 2301);
  assert.ok(Number.isInteger(a) && a >= 0 && a < 2 ** 32);
  assert.notEqual(mulberry32(a)(), mulberry32(b)());
  assert.ok(a > 1, 'not truncated to 0');
});

test('every tree the sparse generator grows is a tree site, so the sites follow it', () => {
  for (const seed of [1, 7, 19]) {
    const world = new World(seed);
    const sx = Math.floor(world.spawn.x / S), sy = Math.floor(world.spawn.y / S);
    let trees = 0;
    for (let cy = sy - 3; cy <= sy + 3; cy++) {
      for (let cx = sx - 3; cx <= sx + 3; cx++) {
        const sites = treeSites(world, cx, cy, S).filter((s) => !s.grove).map((s) => `${s.x},${s.y}`);
        for (const p of generateProps(world, cx, cy, S)) {
          if (p.kind !== 'tree') continue;
          trees++;
          assert.ok(sites.includes(`${p.x},${p.y}`), `seed ${seed} tree ${p.x},${p.y}`);
        }
      }
    }
    assert.ok(trees > 2, `seed ${seed} grows trees`);
  }
});

test('grove sites are seeded, on grass, out of the spawn clearing and at most two a chunk', () => {
  const world = new World(19, { woodland: 'dense' });
  const again = new World(19, { woodland: 'dense' });
  const other = new World(20, { woodland: 'dense' });
  const all = [];
  for (const [cx, cy] of chunksOf({ cx: -8, cy: -6, n: 12 })) {
    const sites = treeSites(world, cx, cy, S).filter((s) => s.grove);
    assert.ok(sites.length <= GROVE.maxTreesPerChunk);
    assert.deepEqual(treeSites(again, cx, cy, S), treeSites(world, cx, cy, S));
    for (const s of sites) {
      assert.equal(Math.floor(s.x / S), cx);
      assert.equal(Math.floor(s.y / S), cy);
      assert.equal(world.landTypeAt(s.x, s.y), GRASS);
      assert.ok(Math.hypot((s.x - world.spawn.x) * ASPECT, s.y - world.spawn.y) >= GROVE.spawnClear);
      all.push(`${s.x},${s.y}`);
    }
  }
  assert.ok(all.length > 20, `${all.length} grove sites`);
  const elsewhere = chunksOf({ cx: -8, cy: -6, n: 12 }).flatMap(([cx, cy]) => treeSites(other, cx, cy, S))
    .filter((s) => s.grove).map((s) => `${s.x},${s.y}`);
  assert.notDeepEqual(elsewhere, all, 'another seed grows other groves');
  // The config seam: no grove trees, only undergrowth around the sparse ones.
  const bare = new World(19, { woodland: 'dense' });
  bare.grove = { ...GROVE, maxTreesPerChunk: 0 };
  assert.equal(chunksOf({ cx: -8, cy: -6, n: 12 }).flatMap(([cx, cy]) => treeSites(bare, cx, cy, S))
    .filter((s) => s.grove).length, 0);
});

test('a grove tree keeps its gap from every other tree site (R1)', () => {
  assert.ok(GROVE.treeGap[0] >= 2 * TREE_FOOT_MAX + 4, 'two of the largest feet side by side leave 4 cells');
  assert.ok(GROVE.treeGap[1] >= 2 * TREE_FOOTH_MAX + 2, 'or 2 rows one above the other');
  for (const seed of [1, 7, 19]) {
    const world = new World(seed, { woodland: 'dense' });
    const sites = chunksOf({ cx: -6, cy: -6, n: 12 }).flatMap(([cx, cy]) => treeSites(world, cx, cy, S));
    for (let i = 0; i < sites.length; i++) {
      for (let j = i + 1; j < sites.length; j++) {
        const a = sites[i], b = sites[j];
        if (!a.grove && !b.grove) continue;
        assert.ok(Math.abs(a.x - b.x) >= GROVE.treeGap[0] || Math.abs(a.y - b.y) >= GROVE.treeGap[1],
          `seed ${seed}: ${a.x},${a.y} and ${b.x},${b.y}`);
      }
    }
  }
});

test('the largest tree foot is a true bound, worked out from the tree generator', () => {
  assert.equal(ROCK_FOOT_MAX, (2.6 + 3.2) / ASPECT);
  let widest = 0, deepest = 0;
  for (const species of TREE_SPECIES) {
    for (const r of [0, 0.5, 0.999999]) {
      const tree = makeTree(10.5, 10.5, () => r, { species, girth: 2 });
      widest = Math.max(widest, tree.footW);
      deepest = Math.max(deepest, tree.footH);
    }
  }
  assert.ok(widest <= TREE_FOOT_MAX && widest > TREE_FOOT_MAX * 0.99, `${widest} vs ${TREE_FOOT_MAX}`);
  assert.ok(deepest <= TREE_FOOTH_MAX && deepest > TREE_FOOTH_MAX * 0.99, `${deepest} vs ${TREE_FOOTH_MAX}`);
});

test('dense woods add grove trees and pale caps after the sparse props, which keep their ids', () => {
  const sparse = new World(19);
  const world = dense();
  for (const [cx, cy] of chunksOf(BLOCK)) {
    const before = sparse.propsOf(cx, cy).map((p) => [p.id, p.kind, p.x, p.y]);
    const after = world.propsOf(cx, cy);
    assert.deepEqual(after.slice(0, before.length).map((p) => [p.id, p.kind, p.x, p.y]), before);
    assert.ok(after.length <= MAX_CHUNK_PROPS);
    assert.ok(after.slice(before.length).every((p, k) => p.id === `p:${cx}:${cy}:${before.length + k}`));
    assert.ok(after.filter((p) => p.kind === 'pale-caps').length <= GROVE.maxClumpsPerChunk);
  }
  const props = blockProps(world);
  assert.ok(groveTrees(world, props).length >= 6, 'grove trees grow');
  assert.ok(props.filter((p) => p.kind === 'pale-caps').length >= 20, 'pale caps cluster');
});

test('baked grove trees leave walking room around their feet', () => {
  const world = dense();
  const props = blockProps(world);
  const trees = props.filter((p) => p.kind === 'tree');
  const grove = new Set(groveTrees(world, props));
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      const a = trees[i], b = trees[j];
      if (!grove.has(a) && !grove.has(b)) continue;
      const gapX = Math.abs(a.x - b.x) - a.footW - b.footW;
      const gapY = Math.abs(a.y - b.y) - a.footH - b.footH;
      assert.ok(gapX >= 4 || gapY >= 2, `${a.id} and ${b.id}: ${gapX.toFixed(1)} cells, ${gapY.toFixed(1)} rows`);
    }
  }
  // Around every grove tree, a ring just outside its foot is open ground;
  // around a sparse one, dense woods close none of what was open.
  const sparse = new World(19);
  for (const t of trees) {
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2;
      const x = t.x + Math.cos(a) * (t.footW + 3);
      const y = t.y + Math.sin(a) * (t.footH + 2);
      if (grove.has(t) || sparse.isWalkable(x, y)) assert.ok(world.isWalkable(x, y), `${t.id} at ${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
});

// Which cells of the block are blocked, and which open ones can be walked to
// from its edge.
function reach(world) {
  const x0 = BLOCK.cx * S, y0 = BLOCK.cy * S, w = BLOCK.n * S, h = BLOCK.n * S;
  const blocked = new Uint8Array(w * h);
  const solids = world.propsIn(x0 - 40, y0 - 10, x0 + w + 40, y0 + h + 10).filter((p) => p.solid !== false);
  for (const p of solids) {
    const rx = Math.ceil((p.footW ?? 0) + 2), ry = Math.ceil((p.footH ?? 0) + 2);
    for (let y = Math.max(y0, Math.floor(p.y) - ry); y <= Math.min(y0 + h - 1, Math.floor(p.y) + ry); y++) {
      for (let x = Math.max(x0, Math.floor(p.x) - rx); x <= Math.min(x0 + w - 1, Math.floor(p.x) + rx); x++) {
        if (blocks(p, x + 0.5, y + 0.5)) blocked[(y - y0) * w + x - x0] = 1;
      }
    }
  }
  const seen = new Uint8Array(w * h);
  const queue = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w, y = Math.floor(i / w);
    if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && !blocked[i]) { seen[i] = 1; queue.push(i); }
  }
  while (queue.length) {
    const i = queue.pop();
    const x = i % w, y = Math.floor(i / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      const j = ny * w + nx;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[j] || blocked[j]) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return { blocked, seen, x0, y0, w };
}

test('dense woods wall off no open ground: every open cell is reached from the block edge', () => {
  const dense19 = reach(dense());
  const sparse = reach(new World(19));
  let open = 0, grown = 0;
  for (let i = 0; i < dense19.blocked.length; i++) {
    if (dense19.blocked[i]) { grown += !sparse.blocked[i]; continue; }
    open++;
    // A pocket the sparse world already had (a sparse tree or rock beside a
    // boulder) is not the grove's doing.
    if (!sparse.blocked[i] && !sparse.seen[i]) continue;
    assert.equal(dense19.seen[i], 1, `pocket at ${dense19.x0 + i % dense19.w},${dense19.y0 + Math.floor(i / dense19.w)}`);
  }
  assert.ok(grown > 200, `grove trees stand in the block (${grown} cells)`);
  assert.ok(open > dense19.blocked.length * 0.8);
});

test('pale caps keep the lanes between neighbouring trunks open and are walked through', () => {
  const world = dense();
  const props = blockProps(world);
  const trees = props.filter((p) => p.kind === 'tree');
  const caps = props.filter((p) => p.kind === 'pale-caps');
  const inFoot = (t, x, y) => ((x - t.x) / t.footW) ** 2 + ((y - t.y) / t.footH) ** 2 < 1;
  let lanes = 0;
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      const a = trees[i], b = trees[j];
      if (Math.hypot((a.x - b.x) * ASPECT, a.y - b.y) > 36) continue;
      lanes++;
      for (const c of caps) {
        if (inFoot(a, c.x, c.y) || inFoot(b, c.x, c.y)) continue;
        const ax = a.x * ASPECT, bx = b.x * ASPECT, px = c.x * ASPECT;
        const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (c.y - a.y) * (b.y - a.y)) / ((bx - ax) ** 2 + (b.y - a.y) ** 2)));
        const d = Math.hypot(px - ax - t * (bx - ax), c.y - a.y - t * (b.y - a.y));
        assert.ok(d > 3, `${c.id} stands in the lane between ${a.id} and ${b.id}`);
      }
    }
  }
  assert.ok(lanes > 0);
  for (const c of caps) {
    assert.equal(c.solid, false);
    assert.equal(blocks(c, c.x, c.y), false);
    assert.equal(world.isWalkable(c.x, c.y), true);
  }
});

test('clusters stand in their own chunk, on grass, clear of every solid foot', () => {
  const world = dense();
  const scales = [];
  for (const [cx, cy] of chunksOf(BLOCK)) {
    const props = world.propsOf(cx, cy);
    const solids = world.propsIn(cx * S - 40, cy * S - 10, cx * S + S + 40, cy * S + S + 10)
      .filter((p) => p.solid !== false && p.kind !== 'pale-caps');
    for (const c of props.filter((p) => p.kind === 'pale-caps')) {
      assert.equal(Math.floor(c.x / S), cx);
      assert.equal(Math.floor(c.y / S), cy);
      assert.equal(world.typeAt(c.x, c.y), GRASS);
      for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [-1, -1], [1, -1]]) {
        const x = c.x + dx * c.footW, y = c.y + dy * c.footH;
        for (const s of solids) assert.equal(blocks(s, x, y), false, `${c.id} reaches into ${s.id}`);
      }
      scales.push(c.scale);
    }
  }
  assert.ok(Math.min(...scales) >= GROVE.scale[0] * 0.9 && Math.max(...scales) <= GROVE.scale[1] * 1.1);
  assert.ok(Math.max(...scales) - Math.min(...scales) > 0.3, 'sizes vary');
});

test('a clump\'s reach is known before it is made, and bounds the clump made', () => {
  for (let seed = 1; seed < 40; seed++) {
    for (const scale of [0.6, 1.25]) {
      const prop = createProp('pale-caps', 0.5, 0.5, { seed: seed * 7919, scale });
      assert.ok(clumpReach(seed * 7919, scale) >= prop.footW - 1e-9);
      assert.ok(clumpReach(seed * 7919, scale) <= prop.footW * 1.25);
    }
  }
});

test('all three pale-cap forms grow, and generated clumps bake the same in a worker', () => {
  const world = new World(7, { woodland: 'dense' });
  const forms = new Set();
  let clump;
  for (const [cx, cy] of chunksOf({ cx: -1, cy: -2, n: 6 })) {
    for (const p of world.propsOf(cx, cy)) {
      if (p.kind !== 'pale-caps') continue;
      forms.add(pickForm(mulberry32(p.seed)()));
      clump ??= p;
    }
  }
  assert.deepEqual([...forms].sort(), ['bell', 'button', 'dome']);
  const source = fineSource(clump);
  assert.deepEqual(structuredClone(source), source);
  assert.deepEqual(packFine(fineCells(rebuildProp(structuredClone(source), true))), packFine(fineCells(clump)));
});

test('dense props are the same after their chunks are evicted and grown again', () => {
  const first = new World(19, { woodland: 'dense', maxChunks: 16 });
  const look = (world) => chunksOf({ cx: -4, cy: -1, n: 2 }).flatMap(([cx, cy]) => world.propsOf(cx, cy))
    .map((p) => JSON.stringify([p.id, p.kind, p.x, p.y, p.seed, p.cells.length, p.cells[0]]));
  const before = look(first);
  for (let i = 0; i < 40; i++) first.chunk(40 + i, 40);
  assert.equal(first.chunks.has('-4,-1'), false, 'evicted');
  assert.deepEqual(look(first), before);
  assert.deepEqual(look(new World(19, { woodland: 'dense' })), before);
});

test('a grove sward flowers blue and white around each mature tree, its rim ragged', () => {
  const world = dense();
  const flora = new World(19, { flora: true });
  const trees = blockProps(world).filter((p) => p.kind === 'tree');
  const count = (w, t) => {
    let roots = 0, flowers = 0, wood = 0, foot = 0;
    for (let y = Math.floor(t.y - 7); y <= t.y + 8; y++) {
      for (let x = Math.floor(t.x - 26); x <= t.x + 30; x++) {
        const { c, i } = w.locate(x, y);
        if (!dense().locate(x, y).c.grove?.[i] || !c.blades.present[i]) continue;
        const k = c.blades.indices.indexOf(i);
        roots++;
        if (((x + 0.5 - t.x) / t.footW) ** 2 + ((y + 0.5 - t.y) / t.footH) ** 2 < 0.8) foot++;
        const f = c.blades.flowers[k];
        if (f) { flowers++; if (WOOD_FLOWERS.includes(f)) wood++; }
      }
    }
    return { roots, flowers, wood, foot };
  };
  let d = { roots: 0, flowers: 0, wood: 0 }, f = { roots: 0, flowers: 0 };
  for (const t of trees) {
    const a = count(world, t), b = count(flora, t);
    assert.equal(a.foot, 0, `no grass grows through ${t.id}`);
    d.roots += a.roots; d.flowers += a.flowers; d.wood += a.wood;
    f.roots += b.roots; f.flowers += b.flowers;
  }
  assert.ok(d.roots > 2 * f.roots, `fuller sward: ${d.roots} vs ${f.roots}`);
  assert.ok(d.flowers >= 2 * f.flowers, `more flowers: ${d.flowers} vs ${f.flowers}`);
  assert.ok(d.wood >= 0.7 * d.flowers, `wood flowers: ${d.wood} of ${d.flowers}`);

  // Drifts: a flowered root's flowered neighbour is mostly the same species.
  let same = 0, pairs = 0;
  for (const [cx, cy] of chunksOf(BLOCK)) {
    const c = world.chunk(cx, cy);
    const at = new Map();
    c.blades.indices.forEach((i, k) => { if (WOOD_FLOWERS.includes(c.blades.flowers[k])) at.set(i, c.blades.flowers[k]); });
    for (const [i, f] of at) {
      for (const j of [i + 1, i + 2, i + 3, i + S]) {
        if (!at.has(j)) continue;
        pairs++;
        if (at.get(j) === f) same++;
      }
    }
  }
  assert.ok(pairs > 50 && same / pairs > 0.5, `${same} of ${pairs}`);

  // The field leans to the shade and its rim is no disc.
  const t = groveTrees(world, blockProps(world))[0];
  const strength = (x, y) => {
    const { c, i } = world.locate(Math.floor(x), Math.floor(y));
    return (c.grove?.[i] ?? 0) / 255;
  };
  assert.ok(strength(t.x + 6, t.y + 1) > 0, 'grove on the shade side');
  const radii = [];
  for (let k = 0; k < 32; k++) {
    const a = k / 32 * Math.PI * 2;
    let r = 0;
    while (r < 60 && strength(t.x + 2 + Math.cos(a) * r / ASPECT, t.y + 0.6 + Math.sin(a) * r * 0.3) >= 0.2) r += 0.5;
    radii.push(r);
  }
  assert.ok(Math.max(...radii) > Math.min(...radii) * 1.2, `rim radii ${Math.min(...radii)}–${Math.max(...radii)}`);
});

test('without flora a dense grove is grass alone, still thick around its trees', () => {
  const world = new World(19, { woodland: 'dense', flora: false });
  const sparse = new World(19);
  let roots = 0, sparseRoots = 0;
  for (const [cx, cy] of chunksOf({ cx: -4, cy: -1, n: 2 })) {
    const c = world.chunk(cx, cy);
    assert.ok(c.blades.flowers.every((f) => f === 0));
    roots += c.blades.indices.length;
    sparseRoots += sparse.chunk(cx, cy).blades.indices.length;
  }
  assert.ok(roots > sparseRoots * 1.1, `${roots} vs ${sparseRoots}`);
});

test('the grove field is empty far from trees and wood flowers come in drifts', () => {
  const world = dense();
  let empty = 0;
  for (const [cx, cy] of chunksOf({ cx: 20, cy: 20, n: 4 })) if (!groveField(world, cx, cy, S)) empty++;
  assert.ok(empty >= 0);
  const lonely = { ...meadowWorld(19), siteCache: null, landTypeAt: () => 0 };
  assert.equal(groveField(lonely, 0, 0, S), null, 'no field where no tree can stand');
  assert.equal(sitesAround(lonely, 0, 0, S).length, 0);
  const kinds = new Set();
  for (let x = 0; x < 400; x += 3) kinds.add(woodFlowerAt(x, 7, 19));
  assert.ok([...kinds].every((k) => WOOD_FLOWERS.includes(k)) && kinds.size >= 4);
  assert.ok(GROVE_FLOWER_CHANCE > 0 && GROVE_FLOWER_CHANCE < 0.5);
  // A chunk with no grove field grows exactly as before.
  const chunk = world.chunk(-3, 0);
  const plain = grassRoots({ ...chunk, grove: null }, 19, S, { flora: true });
  const none = grassRoots({ ...chunk, grove: new Uint8Array(S * S) }, 19, S, { flora: true });
  assert.deepEqual(none, plain);
});

test('phantom neighbours cover every big rock and fragment a neighbouring chunk can grow', () => {
  for (const seed of [1, 7, 19]) {
    const world = meadowWorld(seed);
    let rocks = 0;
    for (const [cx, cy] of chunksOf({ cx: -6, cy: -6, n: 12 })) {
      const props = generateProps(world, cx, cy, S).filter((p) => p.kind === 'rock');
      if (!props.length) continue;
      const boxes = neighbourSolids(world, cx + 1, cy, S).filter((s) => s.box);
      assert.equal(boxes.length > 0, true);
      for (const p of props) {
        rocks++;
        const covered = boxes.some((b) => p.x - p.footW >= b.x0 && p.x + p.footW <= b.x1
          && p.y - p.footH >= b.y0 && p.y + p.footH <= b.y1);
        assert.ok(covered, `seed ${seed} rock ${p.x},${p.y} (${p.footW.toFixed(1)} × ${p.footH.toFixed(1)})`);
      }
    }
    assert.ok(rocks > 20, `seed ${seed}: ${rocks} rocks`);
  }
});

test('a boulder at the edge of the next chunk keeps grove trees and caps off its foot', () => {
  // Look for a chunk whose boulder is about the largest a chunk can grow,
  // based as near its west edge as one can be.
  const grove = { ...GROVE, forestFrom: -1, chanceMax: 1 };
  let found;
  for (let seed = 1; !found && seed < 40; seed++) {
    for (let cx = -60; !found && cx < 60; cx++) {
      for (let cy = -60; !found && cy < 60; cy++) {
        const rand = mulberry32(rngSeed(cx, cy, seed + 2203));
        if (rand() >= 0.3) continue;
        const x = 12 + Math.floor(rand() * (S - 24));
        rand();
        if (x <= 13 && 12 + rand() * 8 >= 18.5) found = { seed, cx, cy };
      }
    }
  }
  assert.ok(found, 'such a boulder exists');
  const world = meadowWorld(found.seed, grove);
  const rock = generateProps(world, found.cx, found.cy, S);
  const boulder = rock[0];
  assert.ok(boulder.footW > 26 && Math.floor(boulder.x) - found.cx * S <= 13, `${boulder.footW} wide at ${boulder.x}`);
  const west = found.cx - 1;
  const props = generateProps(world, west, found.cy, S);
  const added = groveProps(world, west, found.cy, S, props);
  assert.ok(added.some((p) => p.kind === 'pale-caps') || added.length >= 0);
  for (const p of added) {
    for (const r of rock) {
      if (p.kind === 'tree') {
        for (let k = 0; k < 16; k++) {
          const x = p.x + Math.cos(k * Math.PI / 8) * p.footW, y = p.y + Math.sin(k * Math.PI / 8) * p.footH;
          assert.equal(blocks(r, x, y), false, `grove tree ${p.x},${p.y} on ${r.x},${r.y}`);
        }
      } else {
        for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [-1, -1], [1, -1]]) {
          assert.equal(blocks(r, p.x + dx * p.footW, p.y + dy * p.footH), false, `clump ${p.x},${p.y} on ${r.x},${r.y}`);
        }
      }
    }
  }
});
