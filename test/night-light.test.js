import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAKESIDE_QUERY, PLAYER, SEED, TREE, placeAtLakeside } from '../bench/lakeside.js';
import { mulberry32 } from '../src/core/rng.js';
import { drawShadow } from '../src/entities/figure.js';
import { LAYER } from '../src/render/glyphs.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { GAIN, GAIN_FLOOR, LAYER_UNIT, hasStamp } from '../src/world/canopy.js';
import { bakeFine, fineOf } from '../src/world/fine-bakes.js';
import { drawFireLight } from '../src/world/fire.js';
import { Grass } from '../src/world/grass.js';
import { DEW, FERN } from '../src/world/grass-roots.js';
import {
  BAKE_WORK, FADE_FRAMES, MAX_BAKES_PER_FRAME, NightLight, PAD_BOTTOM, PAD_TOP, PAD_X, SKY_SHARE, skyFactor,
} from '../src/world/night-light.js';
import { withCanopy } from '../src/world/prop-art.js';
import { drawProp } from '../src/world/props.js';
import { makeTree } from '../src/world/trees.js';
import { CHUNK_SIZE, GRASS, WATER, World } from '../src/world/world.js';

// A broad tree of three leaf masses at (x, y): about 27 cells either side
// of its trunk and 9 rows deep.
const MASSES = [0, 30, 10, 8, -7, 26, 7, 6, 7, 27, 7, 6];
const plainTree = (x, y, masses = MASSES) => withCanopy({ kind: 'tree', x, y }, Float32Array.from(masses));

function screen(view, Buffer = Uint8ClampedArray) {
  const n = view.cols * view.rows;
  return { cols: view.cols, rows: view.rows,
    fg: new Buffer(n * 4).fill(200), bg: new Buffer(n * 4).fill(100), ov: new Buffer(n * 4).fill(150),
    mask: new Uint8Array(n).fill(GRASS), cellLit: new Uint8Array(n * 4).fill(7) };
}

// Prepares the same frame until every footprint has faded in.
function settle(night, view, props, env) {
  for (let i = 0; i < FADE_FRAMES; i++) night.prepare(view, props, env);
}

const window = (view) => ({ x0: view.x0 - PAD_X, y0: view.y0 - PAD_TOP,
  x1: view.x0 + view.cols + PAD_X, y1: view.y0 + view.rows + PAD_BOTTOM });

test('shadows are fixed to the world: walking, zooming and the camera\'s sub-cell offset never move them', () => {
  const props = [plainTree(180.5, 80.5), plainTree(150.5, 95.5)];
  const views = [
    { x0: 100, y0: 50, cols: 160, rows: 70, offX: 0, offY: 0 },
    { x0: 107, y0: 53, cols: 90, rows: 40, offX: 3.4, offY: 1.7 },
    { x0: 40, y0: 20, cols: 300, rows: 140, offX: -2, offY: 0.5 },
  ];
  const shared = views.map(window).reduce((a, b) => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) }));
  const night = new NightLight();
  let first = null;
  for (const view of views) {
    settle(night, view, props, { seed: 5 });
    const gains = [];
    for (let y = shared.y0; y < shared.y1; y++) for (let x = shared.x0; x < shared.x1; x++) gains.push(night.gainAt(x, y));
    if (!first) first = gains;
    else assert.deepEqual(gains, first);
  }
  assert.ok(first.some((g) => g < 0.8), 'the shared cells are shaded');
});

test('with no tree near, nothing changes', () => {
  const view = { x0: 0, y0: 0, cols: 30, rows: 20 };
  const night = new NightLight();
  night.prepare(view, [{ kind: 'rock', x: 5, y: 5 }, makeTree(5.5, 5.5, mulberry32(2), { growth: 'bush' }),
    plainTree(400.5, 400.5)], { seed: 1 });
  assert.equal(night.active, false);
  assert.equal(night.rowShaded(5), false);
  const r = screen(view);
  const before = [r.fg.slice(), r.bg.slice(), r.ov.slice()];
  night.shadeGround(r, view);
  assert.deepEqual([r.fg, r.bg, r.ov], before);
  assert.equal(night.gainAt(5, 5), 1);
});

test('the grass is drawn exactly as before where no shadow falls', () => {
  const world = new World(19, { flora: true });
  // One chunk of meadow, with flowers, ferns and dew to draw.
  const view = { x0: 3 * CHUNK_SIZE, y0: CHUNK_SIZE, cols: CHUNK_SIZE, rows: CHUNK_SIZE };
  const kinds = new Set();
  const { blades } = world.chunk(3, 1);
  for (let k = 0; k < blades.indices.length; k++) {
    if (blades.flowers[k]) kinds.add('flower');
    if (blades.extras[k] === FERN) kinds.add('fern');
    if (blades.extras[k] === DEW) kinds.add('dew');
  }
  assert.deepEqual([...kinds].sort(), ['dew', 'fern', 'flower']);
  const draw = (night) => {
    const r = { cols: view.cols, rows: view.rows, night };
    const cells = [];
    const grass = new Grass();
    for (let y = view.y0; y < view.y0 + view.rows; y++) {
      grass.drawRow(r, world, view, 3.7, y, (_r, ...cell) => cells.push(cell));
    }
    return cells;
  };
  const plain = draw(null);
  assert.ok(plain.length > 1000);
  assert.deepEqual(draw(new NightLight()), plain, 'an empty map');
  assert.deepEqual(draw({ rowShaded: () => true, gainAt: () => 1 }), plain, 'a map that lets all the light through');
});

test('the ground under a crown is darkened, the water and stone lighting are not', () => {
  const view = { x0: 0, y0: 0, cols: 80, rows: 40 };
  const props = [plainTree(40.5, 20.5)];
  const night = new NightLight();
  settle(night, view, props, { seed: 2 });
  assert.equal(night.active, true);
  const r = screen(view);
  r.mask[20 * view.cols + 41] = WATER;
  night.shadeGround(r, view);
  const k = night.gainAt(40, 20);
  assert.ok(k < 0.8);
  const o = (20 * view.cols + 40) * 4;
  assert.ok(Math.abs(r.fg[o] - 200 * k) <= 0.5 && Math.abs(r.bg[o + 1] - 100 * k) <= 0.5 &&
    Math.abs(r.ov[o + 2] - 150 * k) <= 0.5);
  assert.equal(r.fg[o + 3], 200, 'the glyph is kept');
  const w = (20 * view.cols + 41) * 4;
  assert.deepEqual([r.fg[w], r.bg[w], r.ov[w]], [200, 100, 150], 'water shows the sky');
  assert.ok(r.cellLit.every((v) => v === 7));
  // Far from the tree the ground is as it was.
  assert.equal(r.fg[(2 * view.cols + 2) * 4], 200);
});

test('overlapping crowns never darken a cell below the floor', () => {
  const view = { x0: 0, y0: 0, cols: 80, rows: 40 };
  const props = [plainTree(40.5, 20.5), plainTree(40.5, 20.5), plainTree(40.5, 20.5)];
  const night = new NightLight();
  settle(night, view, props, { seed: 2 });
  let darkest = 1;
  for (let y = -PAD_TOP; y < view.rows + PAD_BOTTOM; y++) for (let x = -PAD_X; x < view.cols + PAD_X; x++) darkest = Math.min(darkest, night.gainAt(x, y));
  assert.equal(darkest, Math.fround(GAIN_FLOOR));
  assert.equal(night.gainAt(40, 20), Math.fround(GAIN_FLOOR));
});

test('grass rooted in shade is darker, keeps its strokes and loses its pale moonlit tips', () => {
  const world = new World(19, { flora: true });
  const view = { x0: 3 * CHUNK_SIZE, y0: CHUNK_SIZE, cols: CHUNK_SIZE, rows: CHUNK_SIZE };
  const draw = (night) => {
    const r = { cols: view.cols, rows: view.rows, night };
    const cells = [];
    const grass = new Grass();
    for (let y = view.y0; y < view.y0 + view.rows; y++) grass.drawRow(r, world, view, 3.7, y, (_r, ...cell) => cells.push(cell));
    return cells;
  };
  const lit = draw(null);
  const shaded = draw({ rowShaded: () => true, gainAt: () => 0.6 });
  assert.equal(shaded.length, lit.length);
  let exact = 0, tips = 0, heads = 0;
  for (let i = 0; i < lit.length; i++) {
    const [x, y, g, ...a] = lit[i];
    const [sx, sy, sg, ...b] = shaded[i];
    assert.deepEqual([sx, sy, sg], [x, y, g], 'the same strokes in the same cells');
    const ratio = (j) => (a[j] ? b[j] / a[j] : 0.6);
    if ([0, 1, 2].every((j) => Math.abs(ratio(j) - 0.6) < 1e-9)) {
      exact++;
      if (g & LAYER) heads++;
    } else if ([0, 1, 2].every((j) => Math.abs(ratio(j) - 0.36) < 1e-9)) continue; // a dew glint
    else {
      // A tip that paled toward the moon keeps nearly its own green.
      tips++;
      for (let j = 0; j < 3; j++) assert.ok(Math.abs(b[j] / 0.6 - a[j]) < 40, `tip colour ${a[j]} -> ${b[j]}`);
    }
  }
  assert.ok(exact > lit.length / 2, 'most of a blade is just darker');
  assert.ok(tips > 0, 'tips lose their paling');
  assert.ok(heads > 0, 'flower heads darken with their stalks');
});

test('torchlight under a tree is as bright as in the open', () => {
  const view = { x0: 0, y0: 0, cols: 80, rows: 40 };
  const night = new NightLight();
  settle(night, view, [plainTree(40.5, 20.5)], { seed: 2 });
  const make = () => {
    const r = Object.create(AsciiRenderer.prototype);
    r.allocate(view.cols, view.rows);
    r.fg.fill(60);
    r.bg.fill(30);
    r.ov.fill(40);
    r.mask.fill(GRASS);
    return r;
  };
  const open = make(), shaded = make();
  night.shadeGround(shaded, view);
  const before = shaded.fg.slice();
  const source = { x: 40.5, y: 22.5, intensity: 1, seed: 3 };
  drawFireLight(open, view, 1, source, 14, 4);
  drawFireLight(shaded, view, 1, source, 14, 4);
  let checked = 0;
  for (let o = 0; o < open.fg.length; o += 4) {
    if (open.fg[o] >= 255 || before[o] === 60) continue;
    assert.equal(shaded.fg[o] - before[o], open.fg[o] - 60, `cell ${o / 4}`);
    checked++;
  }
  assert.ok(checked > 50);
});

test('a contact shadow still darkens the canopy\'s shade further', () => {
  const view = { x0: 0, y0: 0, cols: 80, rows: 40 };
  const night = new NightLight();
  settle(night, view, [plainTree(40.5, 20.5)], { seed: 2 });
  const make = () => {
    const r = Object.create(AsciiRenderer.prototype);
    r.allocate(view.cols, view.rows);
    r.fg.fill(200);
    r.bg.fill(120);
    r.mask.fill(GRASS);
    return r;
  };
  const canopy = make(), contact = make(), both = make();
  night.shadeGround(canopy, view);
  night.shadeGround(both, view);
  drawShadow(contact, view, 42.5, 21.5);
  drawShadow(both, view, 42.5, 21.5);
  const o = (21 * view.cols + 42) * 4;
  assert.ok(both.bg[o] < canopy.bg[o] && both.bg[o] < contact.bg[o]);
});

test('cloud thins the shadows, lightning lifts them, clear weather leaves them whole', () => {
  assert.equal(skyFactor(undefined), 1);
  assert.equal(skyFactor({ preset: 'clear', intensity: 0, flash: 0 }), 1);
  assert.equal(skyFactor({ preset: 'clear' }), 1);
  assert.equal(skyFactor({ preset: 'no such weather', intensity: 1 }), 1);
  assert.equal(skyFactor({ preset: 'thunderstorm', intensity: 1, flash: 0 }), SKY_SHARE);
  const view = { x0: 0, y0: 0, cols: 80, rows: 40 };
  const props = [plainTree(40.5, 20.5)];
  const core = (weather) => {
    const night = new NightLight();
    settle(night, view, props, { seed: 2, weather });
    assert.ok(night.layers.every(Number.isFinite), 'no NaN');
    return { layers: night.layers[(20 + PAD_TOP) * night.w + 40 + PAD_X], gain: night.gainAt(40, 20), active: night.active };
  };
  const clear = core({ preset: 'clear', intensity: 0, flash: 0 });
  const storm = core({ preset: 'thunderstorm', intensity: 1, flash: 0 });
  const flash = core({ preset: 'thunderstorm', intensity: 1, flash: 1 });
  assert.ok(Math.abs(storm.layers - clear.layers * SKY_SHARE) < 1e-5);
  assert.ok(storm.gain > clear.gain && storm.gain < 1 && storm.gain > GAIN_FLOOR);
  assert.equal(flash.active, false);
  assert.equal(flash.gain, 1);
});

test('new footprints are baked a few a frame and fade in; a felled tree casts none at once', () => {
  const view = { x0: 0, y0: 0, cols: 200, rows: 60 };
  const props = Array.from({ length: 10 }, (_, i) => plainTree(10.5 + i * 18, 30.5));
  const night = new NightLight();
  assert.equal(night.baked, 0);
  night.prepare(view, props, { seed: 9 });
  assert.equal(night.bakes, MAX_BAKES_PER_FRAME);
  assert.equal(props.filter(hasStamp).length, MAX_BAKES_PER_FRAME);
  assert.ok(night.bakeMs > 0);
  let frames = 1;
  while (!props.every(hasStamp)) { night.prepare(view, props, { seed: 9 }); frames++; }
  assert.equal(frames, Math.ceil(10 / MAX_BAKES_PER_FRAME));
  // The running count adds up every frame's bakes; baked stamps aren't counted again.
  assert.equal(night.bakes, 10 - (frames - 1) * MAX_BAKES_PER_FRAME);
  assert.equal(night.baked, 10);
  night.prepare(view, props, { seed: 9 });
  assert.equal(night.bakes, 0);
  assert.equal(night.bakeMs, 0);
  assert.equal(night.baked, 10);
  // One tree, alone: full strength after exactly FADE_FRAMES frames.
  const one = [plainTree(100.5, 30.5)];
  const fresh = new NightLight();
  const core = () => fresh.layers[(30 + PAD_TOP) * fresh.w + 100 + PAD_X];
  const seen = [];
  for (let i = 0; i < FADE_FRAMES + 3; i++) {
    fresh.prepare(view, one, { seed: 9 });
    seen.push(core());
  }
  const full = seen[FADE_FRAMES - 1];
  for (let i = 0; i < FADE_FRAMES - 1; i++) assert.ok(seen[i] < seen[i + 1], `frame ${i} fades in`);
  assert.ok(Math.abs(seen[0] - full / FADE_FRAMES) < 1e-6);
  assert.deepEqual(seen.slice(FADE_FRAMES), [full, full, full]);
  one[0].chopped = true;
  fresh.prepare(view, one, { seed: 9 });
  assert.equal(fresh.active, false);
  assert.equal(fresh.gainAt(100, 30), 1);
});

test('big new footprints are baked within a frame\'s work budget, at least one a frame', () => {
  const view = { x0: 0, y0: 0, cols: 300, rows: 80 };
  // Crowns of eight broad masses: each footprint is far over a fifth of the budget.
  const wide = [];
  for (let i = 0; i < 8; i++) wide.push((i - 3.5) * 6, 40 + i, 22, 10);
  const props = Array.from({ length: 5 }, (_, i) => plainTree(30.5 + i * 60, 40.5, wide));
  const night = new NightLight();
  night.prepare(view, props, { seed: 4 });
  assert.ok(night.bakes >= 1 && night.bakes < props.length, `${night.bakes} baked`);
  assert.ok(night.work >= BAKE_WORK);
  assert.equal(props.filter(hasStamp).length, night.bakes);
  let frames = 1;
  while (!props.every(hasStamp)) { night.prepare(view, props, { seed: 4 }); frames++; }
  assert.ok(frames > 1 && frames <= props.length);
  // A tree with no leaves is settled at no cost.
  const bare = { kind: 'tree', x: 10.5, y: 10.5 };
  night.prepare(view, [bare], { seed: 4 });
  assert.equal(night.bakes, 1);
  assert.equal(night.work, 0);
  assert.equal(hasStamp(bare), true);
});

test('the map is emptied where a tree was once it leaves the view, and can be switched off', () => {
  const view = { x0: 0, y0: 0, cols: 80, rows: 40 };
  const night = new NightLight();
  settle(night, view, [plainTree(40.5, 20.5)], { seed: 2 });
  assert.equal(night.rowShaded(20), true);
  assert.equal(night.rowShaded(-PAD_TOP - 1), false);
  night.prepare(view, [], { seed: 2 });
  assert.equal(night.active, false);
  assert.ok(night.layers.every((v) => v === 0));
  // A view moved far off: a tree's stamp that misses the map adds nothing.
  night.prepare({ x0: 1000, y0: 1000, cols: 80, rows: 40 }, [plainTree(40.5, 20.5)], { seed: 2 });
  assert.equal(night.active, false);
  night.enabled = false;
  night.prepare(view, [plainTree(40.5, 20.5)], { seed: 2 });
  assert.equal(night.active, false);
  assert.equal(night.gainAt(40, 20), 1);
});

test('a tree\'s fallen leaves take its shade once as they are laid over the shaded ground', () => {
  const prop = makeTree(20.5, 30.5, mulberry32(4), { species: 'birch', seed: 42 });
  fineOf(prop);
  bakeFine();
  const baked = fineOf(prop);
  assert.ok(baked.ground.length > 0);
  const view = { x0: 0, y0: 0, cols: 60, rows: 40 };
  const night = new NightLight();
  settle(night, view, [prop], { seed: 42 });
  const draw = (shadow) => {
    const r = Object.create(AsciiRenderer.prototype);
    r.allocate(view.cols, view.rows);
    r.fg.fill(90);
    r.bg.fill(40);
    r.mask.fill(GRASS);
    if (shadow) {
      night.shadeGround(r, view);
      r.night = night;
    }
    drawProp(r, view, prop, undefined, 0, null, 42);
    return r;
  };
  const open = draw(false), shaded = draw(true);
  let checked = 0;
  for (const c of baked.ground) {
    const x = 20 + c.dx, y = 30 + c.dy;
    const o = (y * view.cols + x) * 4;
    const k = night.gainAt(x, y);
    if (k === 1) continue;
    assert.ok(Math.abs(shaded.fg[o] - open.fg[o] * k) <= 1, `leaf at ${x},${y}: ${open.fg[o]} * ${k} -> ${shaded.fg[o]}`);
    checked++;
  }
  assert.ok(checked > 0);
});

test('the lakeside scene still has its cherry by the water', () => {
  assert.match(LAKESIDE_QUERY, new RegExp(`seed=${SEED}&`));
  const world = new World(SEED);
  const cherry = world.propsIn(TREE.x - 4, TREE.y - 4, TREE.x + 4, TREE.y + 4)
    .find((p) => p.kind === 'tree' && p.species === 'cherry' && p.growth === 'mature');
  assert.ok(cherry && Math.hypot(cherry.x - TREE.x, cherry.y - TREE.y) <= 2);
  let water = false;
  for (let dy = 1; dy <= 20 && !water; dy++) {
    for (let dx = -12; dx <= 60; dx++) if (world.typeAt(Math.floor(TREE.x) + dx, Math.floor(TREE.y) + dy) === WATER) water = true;
  }
  assert.ok(water, 'a pond just south of it');
  assert.equal(world.typeAt(Math.floor(PLAYER.x), Math.floor(PLAYER.y)), GRASS, 'the wanderer stands on the meadow');
  // Placing the wanderer there holds the grid and clears the way.
  const game = { player: {}, camera: {}, quality: { sample: null }, native: { pacer: {} },
    monsters: { clear() { this.cleared = true; } }, sound: { weather: {} } };
  placeAtLakeside(game, PLAYER, { preset: 'thunderstorm', intensity: 1 });
  assert.deepEqual([game.player.x, game.player.y, game.camera.x, game.camera.y], [PLAYER.x, PLAYER.y, PLAYER.x, PLAYER.y - 11]);
  assert.equal(game.quality.sample(), false);
  assert.deepEqual(game.native.pacer.sample(), {});
  assert.equal(game.monsters.cleared, true);
  assert.deepEqual(game.sound.weather, { preset: 'thunderstorm', intensity: 1 });
  placeAtLakeside({ ...game, native: undefined, monsters: undefined }, PLAYER);
  assert.deepEqual(game.sound.weather, { preset: 'clear', intensity: 0 });
});

test('the gain table is the canopy\'s', () => {
  const night = new NightLight();
  const view = { x0: 0, y0: 0, cols: 10, rows: 10 };
  night.prepare(view, [], {});
  night.layers[(2 + PAD_TOP) * night.w + 2 + PAD_X] = 1;
  night.layers[(3 + PAD_TOP) * night.w + 3 + PAD_X] = 50;
  assert.equal(night.gainAt(2, 2), GAIN[LAYER_UNIT]);
  assert.equal(night.gainAt(3, 3), GAIN[255]);
  assert.equal(night.gainAt(-100, 2), 1);
});
