import assert from 'node:assert/strict';
import test from 'node:test';
import { Mushrooms, makeGlowcap } from '../src/world/mushrooms.js';
import { dg } from '../src/render/glyphs.js';
import { ASPECT, CHUNK_SIZE, GRASS, WATER, World } from '../src/world/world.js';

class Meadow {
  constructor(seed = 1) { this.seed = seed; this.spawn = { x: 0.5, y: 0.5 }; this.chunks = new Map(); }
  typeAt() { return GRASS; }
  isWalkable() { return true; }
  chunk(cx, cy) {
    const key = `${cx},${cy}`;
    if (!this.chunks.has(key)) this.chunks.set(key, { props: [] });
    return this.chunks.get(key);
  }
  loaded(cx, cy) { return this.chunks.get(`${cx},${cy}`); }
}

function setup() {
  const world = new Meadow();
  const mushrooms = new Mushrooms(world);
  const node = mushrooms.starters[0];
  const player = { x: node.x - 3, y: node.y, air: 0 };
  return { world, mushrooms, node, player };
}

test('reference models preserve the crown lettering and broad, illuminated stem', () => {
  const dome = makeGlowcap(0, 0, 1);
  const crown = dome.cells.filter(c => c.dy === -dome.height && c.g !== 0);
  assert.deepEqual(crown.map(c => c.g), [...'Q@##BNQ'].map(ch => dg(`mushrooms.ascii.${ch.charCodeAt(0)}`)));
  assert.notDeepEqual(dome.cells.filter(c => c.dy === -dome.height + 1 && c.g !== 0).map(c => c.g), crown.map(c => c.g),
    'the next row is its own traced band, not a stretched copy of the crown');
  const stem = dome.cells.filter(c => c.dy === -dome.height + 6 && c.g !== 0);
  assert.ok(stem.length >= 9, 'the stalk has a broad textured surface');
  assert.ok(dome.cells.some(c => c.back[1] > 50 && c.color[1] > 160), 'the teal core lights the stem and the space between its letters');
  assert.deepEqual([dome, makeGlowcap(0, 0, 1, 0.85), makeGlowcap(0, 0, 1, 0.64)].map(p => p.shape),
    ['dome', 'crooked', 'button']);
});

test('seeded clusters stay inside their owning chunks and regenerate identically', () => {
  const world = new Meadow();
  const mushrooms = new Mushrooms(world);
  const samples = [];
  for (const [cx, cy] of [[0, 0], [-1, -1], [3, 2]]) {
    const nodes = mushrooms.nodesOf(cx, cy);
    for (const p of nodes) {
      assert.equal(Math.floor(p.x / CHUNK_SIZE), cx);
      assert.equal(Math.floor(p.y / CHUNK_SIZE), cy);
    }
    samples.push(nodes.map(p => ({ x: p.x, y: p.y, cells: p.cells })));
    world.chunks.delete(`${cx},${cy}`);
    assert.deepEqual(mushrooms.nodesOf(cx, cy).map(p => ({ x: p.x, y: p.y, cells: p.cells })), samples.at(-1));
  }
  assert.notDeepEqual(makeGlowcap(10, 20, 1).cells, makeGlowcap(10, 20, 2).cells);
});

test('starter mushrooms grow on reachable grass in real seeded ruin worlds', () => {
  for (const seed of [1, 42, 123]) {
    const world = new World(seed, { spawnRuins: true });
    const mushrooms = new Mushrooms(world);
    assert.equal(mushrooms.starters.length, 1, 'one starter remains at the reduced density');
    for (const node of mushrooms.starters) {
      assert.equal(world.typeAt(node.x, node.y), GRASS);
      assert.ok(world.isWalkable(node.x, node.y));
      assert.ok(Math.hypot((node.x - world.spawn.x) * ASPECT, node.y - world.spawn.y) < 24);
    }
  }
});

test('the reduced spawn rate retains about 15% of the same seeded wild positions', () => {
  const dense = new Mushrooms(new Meadow(42), { spawnRate: 1 });
  const sparse = new Mushrooms(new Meadow(42));
  let original = 0, retained = 0;
  for (let cy = 2; cy < 10; cy++) {
    for (let cx = 2; cx < 10; cx++) {
      const before = new Set(dense.nodesOf(cx, cy).map(p => `${p.x},${p.y}`));
      const after = sparse.nodesOf(cx, cy);
      original += before.size;
      retained += after.length;
      for (const p of after) assert.ok(before.has(`${p.x},${p.y}`), 'thinning preserves the original seeded positions');
    }
  }
  assert.ok(original > 200);
  assert.ok(retained / original > 0.11 && retained / original < 0.19, `${retained} / ${original} mushrooms retained`);
  assert.equal(dense.starters.length, 7);
  assert.equal(sparse.starters.length, 1);
});

test('walking past excites a damped spring; standing still lets it settle', () => {
  const { mushrooms, node, player } = setup();
  mushrooms.update(1 / 60, player);
  assert.equal(node.bend, 0);
  mushrooms.update(1 / 60, player, player.x - 0.3, player.y);
  assert.ok(node.bend > 0);
  let reversed = false;
  for (let i = 0; i < 240; i++) {
    mushrooms.update(1 / 60, player);
    if (node.bend < 0) reversed = true;
  }
  assert.ok(reversed, 'the cap springs back past its resting position');
  assert.ok(Math.abs(node.bend) < 0.001);
  // Walk away and back: the next approach must trigger another wobble.
  const far = { x: node.x + 70, y: node.y, air: 0 };
  mushrooms.update(0.1, far);
  mushrooms.update(1 / 60, player, player.x - 0.3, player.y);
  assert.ok(node.bend > 0.01);
});

test('interacting releases a bounded cloud that rises, drifts, fades and can be repeated', () => {
  const { mushrooms, node, player } = setup();
  assert.equal(mushrooms.interact(player), true);
  assert.ok(mushrooms.spores.length >= 18 && mushrooms.spores.length <= 28, 'a sparse ring-shaped puff');
  assert.equal(mushrooms.interact(player), false, 'cooldown rejects rapid repeats');
  const first = { ...mushrooms.spores[0] };
  mushrooms.update(0.1, player);
  assert.ok(mushrooms.spores[0].h > first.h);
  assert.notEqual(mushrooms.spores[0].x, first.x);
  assert.ok(node.squash < 0, 'interacting compresses the cap');
  assert.ok(mushrooms.spores.every(s => s.rise > Math.abs(s.vy)), 'every interaction spore travels upward on screen');
  for (let i = 0; i < 99; i++) mushrooms.update(0.1, player);
  assert.equal(mushrooms.spores.length, 0);
  assert.equal(mushrooms.interact(player), true);
  for (let i = 0; i < 10; i++) { node.cooldown = 0; mushrooms.interact(player); }
  assert.ok(mushrooms.spores.length <= 280);
});

test('walking continuously excites a fluid response and releases upward-floating spores', () => {
  const { mushrooms, node, player } = setup();
  for (let i = 0; i < 60; i++) mushrooms.update(1 / 60, player);
  assert.equal(mushrooms.spores.length, 0, 'standing still does not shake spores out');
  for (let i = 0; i < 50; i++) mushrooms.update(1 / 60, player, player.x - 0.2, player.y);
  assert.ok(node.bend > 0.2);
  assert.notEqual(node.capBend, node.bend, 'the crown follows the stalk with a soft lag');
  assert.ok(mushrooms.spores.length > 0, 'jiggling alone releases spores without pressing E');
  assert.ok(mushrooms.spores.every(s => s.rise > Math.abs(s.vy)), 'every shaken spore travels upward on screen');
  const tracked = mushrooms.spores.map(spore => ({ spore, screenY: spore.y - spore.h }));
  for (let i = 0; i < 12; i++) mushrooms.update(1 / 60, player);
  assert.ok(tracked.every(({ spore, screenY }) => spore.y - spore.h < screenY), 'all released spores rise instead of falling');
  for (let i = 0; i < 600; i++) mushrooms.update(1 / 60, player);
  assert.equal(mushrooms.spores.length, 0);
  assert.ok(Math.abs(node.bend) + Math.abs(node.capBend) < 0.002);
});

test('the spring response stays consistent at 30, 60 and 120 frames per second', () => {
  const samples = [];
  for (const fps of [30, 60, 120]) {
    const { mushrooms, player, node } = setup();
    for (let i = 0; i < fps; i++) mushrooms.update(1 / fps, player, player.x - 6 / ASPECT / fps, player.y);
    samples.push({ bend: node.bend, squash: node.squash, cap: node.capBend });
  }
  for (const sample of samples.slice(1)) {
    assert.ok(Math.abs(sample.bend - samples[0].bend) < 1e-9);
    assert.ok(Math.abs(sample.squash - samples[0].squash) < 1e-9);
    assert.ok(Math.abs(sample.cap - samples[0].cap) < 0.025);
  }
});

test('soft glyphs move by fractions of a cell while the roots stay planted', () => {
  const { mushrooms, node } = setup();
  const view = { x0: -30, y0: -30, cols: 100, rows: 100 };
  let points = [];
  const r = { put() {}, putBg() {}, beginFloating() {}, putFloating: (...args) => points.push(args) };
  node.bend = 0.2; node.capBend = 0.15;
  mushrooms.draw(r, view, node);
  const first = points;
  points = [];
  node.bend = 0.23; node.capBend = 0.18;
  mushrooms.draw(r, view, node);
  assert.ok(points.some((point, i) => Math.abs(point[0] - first[i][0]) > 0 && Math.abs(point[0] - first[i][0]) < 0.1));
  const roots = points.filter(p => p[1] === Math.floor(node.y) - view.y0);
  assert.deepEqual(roots, first.filter(p => p[1] === Math.floor(node.y) - view.y0));
});

test('interaction respects distance, water, obstacles, jumping and death', () => {
  const { mushrooms, world, node, player } = setup();
  assert.equal(mushrooms.nearby(player), node);
  assert.equal(mushrooms.interact({ ...player, x: node.x + 100, y: node.y + 100 }), false);
  assert.equal(mushrooms.interact({ ...player, air: 1 }), false);
  assert.equal(mushrooms.interact({ ...player, vitals: { dead: true } }), false);
  world.typeAt = (x, y) => x > player.x && x < node.x - 1 && Math.abs(y - node.y) < 1 ? WATER : GRASS;
  assert.equal(mushrooms.nearby(player), null);
  world.typeAt = () => GRASS;
  world.isWalkable = x => !(x > player.x && x < node.x - 1);
  assert.equal(mushrooms.nearby(player), null);
});

test('zero simulation time preserves wobble, spores and cooldown', () => {
  const { mushrooms, player, node } = setup();
  mushrooms.interact(player);
  const before = JSON.stringify({ node, spores: mushrooms.spores, time: mushrooms.time });
  mushrooms.update(0, player, player.x - 1, player.y);
  assert.equal(JSON.stringify({ node, spores: mushrooms.spores, time: mushrooms.time }), before);
});

test('the strongest teal bloom sits inside the gills, with only a faint spill at the feet', () => {
  const { mushrooms, node } = setup();
  const view = { x0: -30, y0: -30, cols: 100, rows: 100 };
  const r = { cols: 100, rows: 100, fg: new Float32Array(40000), bg: new Float32Array(40000), ov: new Float32Array(40000) };
  mushrooms.drawGlow(r, view, [node]);
  const x = Math.floor(node.x) - view.x0 - 1;
  const base = Math.floor(node.y) - view.y0;
  const gills = Math.round(base - node.height + 6.3);
  assert.ok(r.fg[(gills * r.cols + x) * 4 + 1] > r.fg[(base * r.cols + x) * 4 + 1] * 5);
  assert.ok(r.bg[(gills * r.cols + x) * 4 + 1] > 40);
});

test('wide views skip ungenerated chunks and terrain edits hide mushrooms', () => {
  const world = new Meadow();
  const mushrooms = new Mushrooms(world);
  const view = { x0: -100, y0: -100, cols: 200, rows: 200 };
  assert.deepEqual(mushrooms.prepare(view, true), []);
  assert.equal(world.chunks.size, 0);
  const starter = mushrooms.starters[0];
  world.chunk(Math.floor(starter.x / CHUNK_SIZE), Math.floor(starter.y / CHUNK_SIZE));
  assert.ok(mushrooms.prepare(view, true).length > 0);
  world.typeAt = () => WATER;
  assert.deepEqual(mushrooms.prepare(view, true), []);
});

test('bending keeps roots fixed and the reflection uses the same deformed cells', () => {
  const { mushrooms, node } = setup();
  const view = { x0: -50, y0: -50, cols: 120, rows: 120 };
  const before = [], after = [], reflected = [];
  const collect = out => (...args) => out.push(args.slice(1));
  mushrooms.draw({}, view, node, collect(before));
  node.bend = 3;
  mushrooms.draw({}, view, node, collect(after));
  mushrooms.draw({}, view, node, collect(reflected));
  assert.deepEqual(after, reflected);
  assert.deepEqual(before.filter(c => c[1] === Math.floor(node.y) - view.y0),
    after.filter(c => c[1] === Math.floor(node.y) - view.y0));
  assert.notDeepEqual(before, after);
});
