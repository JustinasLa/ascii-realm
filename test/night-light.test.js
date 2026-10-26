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
  BAKE_WORK, FADE_FRAMES, MAX_BAKES_PER_FRAME, MAX_BEAM_BAKES, NightLight, PAD_BOTTOM, PAD_TOP, PAD_X, SKY_SHARE, beamFactor,
  moonlightOf, skyFactor,
} from '../src/world/night-light.js';
import { SHAFT_TIERS, patchStamp, shaftAt } from '../src/world/moon-shafts.js';
import { PEAK_LIFT, TINT, moonTint } from '../src/world/moon-tint.js';
import { DEW_CAP, FLOWER_CAP } from '../src/world/grass.js';
import { benchmark, createScene, scenarios } from '../bench/scene.js';
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
  assert.deepEqual(draw({ rowShaded: () => true, gainAt: () => 1, tintAt: () => 0 }), plain, 'a map that lets all the light through');
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
  const shaded = draw({ rowShaded: () => true, gainAt: () => 0.6, tintAt: () => 0 });
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

// Moonbeams. A world of meadow, and one where a single slot's beam is all
// there is: everywhere else is water.
const meadow = () => ({ typeAt: () => GRASS });
function oneBeam(seed, i = 0, j = 0) {
  const probe = meadow();
  let shaft = null;
  for (; !shaft; i++) shaft = shaftAt(i, j, seed, probe);
  const x = Math.floor(shaft.cx), y = Math.floor(shaft.cy);
  return { world: { typeAt: (wx, wy) => (wx === x && wy === y ? GRASS : WATER) }, shaft };
}
const around = (shaft, cols = 120, rows = 60, dx = 0, dy = 0) =>
  ({ x0: Math.floor(shaft.cx) - (cols >> 1) + dx, y0: Math.floor(shaft.cy) - (rows >> 1) + dy, cols, rows });

function screenRenderer(view) {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(view.cols, view.rows);
  for (let o = 0; o < r.fg.length; o++) {
    if (o % 4 === 3) continue;
    r.fg[o] = 60;
    r.bg[o] = 30;
    r.ov[o] = 40;
  }
  r.mask.fill(GRASS);
  return r;
}

test('moonbeams are fixed to the world: walking, zooming and the sub-cell offset never move them', () => {
  const { world, shaft } = oneBeam(5);
  const views = [around(shaft, 160, 70), { ...around(shaft, 90, 40, 7, 3), offX: 3.4, offY: 1.7 },
    { ...around(shaft, 300, 140, -20, -10), offX: -2, offY: 0.5 }];
  const shared = views.map(window).reduce((a, b) => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) }));
  const props = [plainTree(shaft.cx + 30, shaft.cy + 2)];
  const night = new NightLight();
  let first = null;
  for (const view of views) {
    settle(night, view, props, { seed: 5, world });
    const cells = [];
    for (let y = shared.y0; y < shared.y1; y++) for (let x = shared.x0; x < shared.x1; x++) cells.push(night.gainAt(x, y), night.tintAt(x, y));
    if (!first) first = cells;
    else assert.deepEqual(cells, first);
  }
  assert.ok(first.some((g) => g > 1.1), 'some ground is lit');
  assert.ok(first.some((g) => g > 0 && g < 0.8), 'and some shaded');
  assert.equal(night.tintAt(shared.x0 - 1000, shared.y0), 0);
  assert.equal(night.debugShaftAt(shaft.i, shaft.j).key, shaft.key);
  assert.equal(new NightLight().debugShaftAt(0, 0), null);
});

test('a beam\'s column of air is fixed to the world too', () => {
  const { world, shaft } = oneBeam(5);
  const draw = (view) => {
    const night = new NightLight();
    settle(night, view, [], { seed: 5, world });
    const r = screenRenderer(view);
    night.drawShafts(r, view, 4.2);
    return r;
  };
  const a = around(shaft, 120, 70, -20, -20), b = { ...a, x0: a.x0 + 7, y0: a.y0 + 3 };
  const ra = draw(a), rb = draw(b);
  let changed = 0;
  for (let wy = b.y0; wy < a.y0 + a.rows; wy++) {
    for (let wx = b.x0; wx < a.x0 + a.cols; wx++) {
      const oa = ((wy - a.y0) * a.cols + wx - a.x0) * 4, ob = ((wy - b.y0) * b.cols + wx - b.x0) * 4;
      assert.deepEqual([...ra.fg.slice(oa, oa + 4), ...ra.ov.slice(oa, oa + 4)], [...rb.fg.slice(ob, ob + 4), ...rb.ov.slice(ob, ob + 4)], `${wx},${wy}`);
      if (ra.fg[oa] !== 60) changed++;
    }
  }
  assert.ok(changed > 100, `${changed} cells lit`);
});

test('with beams switched off, or none in the world, nothing changes', () => {
  const view = { x0: 0, y0: 0, cols: 80, rows: 40 };
  const props = [plainTree(40.5, 20.5)];
  const run = (env, shafts = true) => {
    const night = new NightLight();
    night.shafts = shafts;
    settle(night, view, props, env);
    const r = screen(view);
    night.shadeGround(r, view);
    const s = screenRenderer(view);
    const before = s.fg.slice();
    night.drawShafts(s, view, 3);
    const gains = [];
    for (let y = -10; y < 50; y++) for (let x = -10; x < 90; x++) gains.push(night.gainAt(x, y), night.tintAt(x, y));
    return [r.fg, r.bg, r.ov, gains, night.visible.length, s.fg.some((v, i) => v !== before[i])];
  };
  const plain = run({ seed: 2 });
  assert.equal(plain[5], false, 'no column drawn');
  assert.deepEqual(run({ seed: 2, world: { typeAt: () => WATER } }), plain, 'a world with no beam');
  assert.deepEqual(run({ seed: 2, world: meadow() }, false), plain, 'beams off');
  // With beams on in a meadow the same frame is lit somewhere.
  assert.notDeepEqual(run({ seed: 2, world: meadow() }), plain);
});

test('the ground in a beam is brighter and paler, each cell once; the water and stone lighting are not', () => {
  const { world, shaft } = oneBeam(3);
  const view = around(shaft);
  const night = new NightLight();
  settle(night, view, [], { seed: 3, world });
  assert.equal(night.active, true);
  const x = Math.floor(shaft.cx), y = Math.floor(shaft.cy);
  const lift = night.gainAt(x, y) - 1;
  assert.ok(lift > PEAK_LIFT * 0.8 && lift <= PEAK_LIFT * (1 + 1e-6), `lift ${lift}`);
  assert.ok(Math.abs(night.tintAt(x, y) - TINT * lift / PEAK_LIFT) < 1e-6);
  const r = screen(view);
  const cell = (y - view.y0) * view.cols + x - view.x0;
  r.mask[cell + 1] = WATER;
  night.shadeGround(r, view);
  const expect = (base) => {
    const c = new Uint8ClampedArray([base, base, base]).map((v) => v * (1 + lift));
    moonTint(c, 0, night.tintAt(x, y));
    return [...c];
  };
  const o = cell * 4;
  for (const [arr, base] of [[r.fg, 200], [r.bg, 100], [r.ov, 150]]) {
    const want = expect(base);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(arr[o + k] - want[k]) <= 1, `${base}: ${arr[o + k]} vs ${want[k]}`);
    assert.ok(arr[o + 2] > arr[o], 'paler blue');
  }
  assert.deepEqual([r.fg[o + 4], r.bg[o + 4], r.ov[o + 4]], [200, 100, 150], 'water shows the sky');
  assert.ok(r.cellLit.every((v) => v === 7));
});

test('overlapping beams light a cell with the brighter one, never both', () => {
  const { world, shaft } = oneBeam(3);
  const view = around(shaft);
  const night = new NightLight();
  settle(night, view, [], { seed: 3, world });
  // A second beam, the same patch moved a little east, fading out.
  const twin = { ...night.visible[0].shaft, key: 'twin', cx: shaft.cx + 6 };
  night.beams.set('twin', { shaft: twin, frames: FADE_FRAMES, out: true, mix: 1, motes: 0, s: 0 });
  night.prepare(view, [], { seed: 3, world });
  const stamp = patchStamp(shaft, 3);
  const at = (cx, x, y, s) => {
    const sx = x - Math.floor(cx) - stamp.x0, sy = y - Math.floor(shaft.cy) - stamp.y0;
    return sx < 0 || sy < 0 || sx >= stamp.w || sy >= stamp.h ? 0 : Math.fround(stamp.lift[sy * stamp.w + sx] * s * PEAK_LIFT / 255);
  };
  let both = 0;
  for (let y = shaft.box.y0; y < shaft.box.y1; y++) {
    for (let x = shaft.box.x0; x < shaft.box.x1 + 6; x++) {
      const a = at(shaft.cx, x, y, 1), b = at(twin.cx, x, y, (FADE_FRAMES - 1) / FADE_FRAMES);
      if (a && b) both++;
      assert.ok(Math.abs(night.gainAt(x, y) - (1 + Math.max(a, b))) < 1e-6, `${x},${y}`);
    }
  }
  assert.ok(both > 50);
});

test('a beam under a crown is dimmed by its leaves, the ground lit once by both', () => {
  const { world, shaft } = oneBeam(3);
  const view = around(shaft);
  const x = Math.floor(shaft.cx), y = Math.floor(shaft.cy);
  const props = [plainTree(x + 0.5, y + 0.5), plainTree(x + 0.5, y + 0.5), plainTree(x + 0.5, y + 0.5)];
  const night = new NightLight();
  settle(night, view, props, { seed: 3, world });
  const i = (y - night.y0) * night.w + x - night.x0;
  assert.equal(night.gainAt(x, y), Math.fround(GAIN_FLOOR) * (1 + night.lift[i]));
  assert.ok(night.lift[i] > PEAK_LIFT * 0.8);
  const r = screen(view);
  night.shadeGround(r, view);
  const o = ((y - view.y0) * view.cols + x - view.x0) * 4;
  const c = [200, 200, 200].map((v) => Math.round(v * night.gainAt(x, y)));
  moonTint(c, 0, night.tintAt(x, y));
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(r.fg[o + k] - c[k]) <= 1);
  assert.equal(night.rowShaded(y), true);
  assert.equal(night.rowShaded(shaft.box.y1 + 200), false);
});

test('grass in a beam is brighter and paler, flowers brighter but their own colour', () => {
  const world = new World(19, { flora: true });
  const view = { x0: 3 * CHUNK_SIZE, y0: CHUNK_SIZE, cols: CHUNK_SIZE, rows: CHUNK_SIZE };
  const draw = (night) => {
    const r = { cols: view.cols, rows: view.rows, night };
    const cells = [];
    const grass = new Grass();
    for (let y = view.y0; y < view.y0 + view.rows; y++) grass.drawRow(r, world, view, 3.7, y, (_r, ...cell) => cells.push(cell));
    return cells;
  };
  const gain = 1 + PEAK_LIFT;
  const open = draw(null);
  const bright = draw({ rowShaded: () => true, gainAt: () => gain, tintAt: () => 0 });
  const tinted = draw({ rowShaded: () => true, gainAt: () => gain, tintAt: () => TINT });
  assert.equal(bright.length, open.length);
  assert.equal(tinted.length, open.length);
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let blades = 0, paler = 0, flowers = 0;
  for (let i = 0; i < open.length; i++) {
    const [x, y, g, ...a] = open[i];
    const [bx, by, bg, ...b] = bright[i];
    const [tx, ty, tg, ...t] = tinted[i];
    assert.deepEqual([bx, by, bg, tx, ty, tg], [x, y, g, x, y, g], 'the same strokes in the same cells');
    if (g & LAYER) {
      // Flowers, seed heads and dew: brighter, never tinted, never white.
      assert.deepEqual(t, b);
      const k = a[1] ? b[1] / a[1] : 1;
      assert.ok(k >= 1 - 1e-9 && k <= gain + 1e-9, `ratio ${k}`);
      for (let j = 0; j < 3; j++) if (a[j] > 1) assert.ok(Math.abs(b[j] / a[j] - k) < 0.01 * k, 'its own hue');
      if (Math.abs(k - FLOWER_CAP) < 1e-9) flowers++;
      assert.ok(k <= Math.max(FLOWER_CAP, DEW_CAP, gain) + 1e-9);
      continue;
    }
    blades++;
    assert.ok(luma(b) > luma(a), 'brighter');
    if (Math.abs(b[0] / a[0] - gain) > 1e-6 || Math.abs(b[2] / a[2] - gain) > 1e-6) paler++;
    // The tint keeps the brightness and turns the stroke toward the moonlight.
    assert.ok(Math.abs(luma(t) - luma(b)) < 1e-6);
    assert.ok(t[2] / (t[1] || 1) >= b[2] / (b[1] || 1) - 1e-9, 'bluer');
  }
  assert.ok(blades > 1000);
  assert.ok(paler > 0, 'tips pale further toward the moon');
  assert.ok(flowers > 0, 'flowers brighten up to their cap');
});

test('torchlight in a beam is as bright as in the open', () => {
  const { world, shaft } = oneBeam(3);
  const view = around(shaft, 80, 40);
  const night = new NightLight();
  settle(night, view, [], { seed: 3, world });
  const make = () => {
    const r = Object.create(AsciiRenderer.prototype);
    r.allocate(view.cols, view.rows);
    r.fg.fill(40);
    r.bg.fill(20);
    r.ov.fill(30);
    r.mask.fill(GRASS);
    return r;
  };
  const open = make(), lit = make();
  night.shadeGround(lit, view);
  night.drawShafts(lit, view, 1);
  const before = lit.fg.slice();
  const source = { x: shaft.cx, y: shaft.cy + 1, intensity: 1, seed: 3 };
  drawFireLight(open, view, 1, source, 14, 4);
  drawFireLight(lit, view, 1, source, 14, 4);
  let checked = 0;
  for (let o = 0; o < open.fg.length; o += 4) {
    if (open.fg[o] >= 255 || lit.fg[o] >= 255 || before[o] === 40) continue;
    assert.equal(lit.fg[o] - before[o], open.fg[o] - 40, `cell ${o / 4}`);
    checked++;
  }
  assert.ok(checked > 50);
});

test('cloud hides the beams, lightning washes them out, clear weather leaves them whole', () => {
  assert.equal(moonlightOf(undefined), 1);
  assert.equal(moonlightOf({ preset: 'clear' }), 1);
  assert.equal(moonlightOf({ preset: 'thunderstorm', intensity: 1 }), 0);
  assert.equal(beamFactor(undefined), 1);
  assert.equal(beamFactor({ preset: 'clear', intensity: 0, flash: 1 }), 0);
  const { world, shaft } = oneBeam(3);
  const view = around(shaft);
  const x = Math.floor(shaft.cx), y = Math.floor(shaft.cy);
  const lit = (weather) => {
    const night = new NightLight();
    settle(night, view, [], { seed: 3, world, weather });
    assert.ok(night.lift.every(Number.isFinite), 'no NaN');
    const r = screenRenderer(view);
    const before = r.fg.slice();
    night.drawShafts(r, view, 2);
    return { lift: night.gainAt(x, y) - 1, drawn: r.fg.some((v, i) => v !== before[i]) };
  };
  const clear = lit({ preset: 'clear', intensity: 0, flash: 0 });
  const drizzle = lit({ preset: 'drizzle', intensity: 1, flash: 0 });
  const storm = lit({ preset: 'thunderstorm', intensity: 1, flash: 0 });
  const flash = lit({ preset: 'clear', intensity: 0, flash: 1 });
  assert.ok(clear.lift > 0.8 * PEAK_LIFT && clear.drawn);
  assert.ok(drizzle.lift > 0 && drizzle.lift < clear.lift && drizzle.drawn);
  assert.deepEqual(storm, { lift: 0, drawn: false });
  assert.deepEqual(flash, { lift: 0, drawn: false });
});

test('at most a tier\'s count of beams, nearest first, fading in; the dropped fade out', () => {
  const world = meadow();
  const view = { x0: 0, y0: 0, cols: 600, rows: 200 };
  const mid = { x: 300, y: 100 };
  for (const [name, tier] of Object.entries(SHAFT_TIERS)) {
    const night = new NightLight();
    night.tier = name;
    night.prepare(view, [], { seed: 4, world });
    assert.equal(night.tierName, name);
    // Patches bake within the frame's budget; give them the frames they need.
    for (let k = 0; k < 20 && night.beams.size < tier.max; k++) night.prepare(view, [], { seed: 4, world });
    assert.equal(night.beams.size, tier.max);
    const kept = [...night.beams.values()].map((b) => b.shaft);
    const d = (s) => ((s.cx - mid.x) * 0.6) ** 2 + (s.cy - mid.y) ** 2;
    const far = Math.max(...kept.map(d));
    // No beam left out is nearer than one kept.
    const all = [];
    for (let j = -3; j < 8; j++) for (let i = -2; i < 12; i++) { const s = shaftAt(i, j, 4, world); if (s) all.push(s); }
    const left = all.filter((s) => !kept.includes(s) && s.reach.x0 < 660 && s.reach.x1 > -60 && s.reach.y0 < 240 && s.reach.y1 > -40);
    assert.ok(left.length > 0);
    assert.ok(left.every((s) => d(s) >= far - 1e-9 || !(tier.column ? s.reach : s.box)), name);
    for (const beam of night.beams.values()) assert.equal(beam.motes, Math.min(4, tier.motes));
  }
  // One beam, alone: full strength after exactly FADE_FRAMES frames.
  const { world: lone, shaft } = oneBeam(4);
  const night = new NightLight();
  const at = around(shaft);
  const seen = [];
  for (let i = 0; i < FADE_FRAMES + 2; i++) {
    night.prepare(at, [], { seed: 4, world: lone });
    seen.push(night.visible[0].s);
  }
  assert.ok(Math.abs(seen[0] - 1 / FADE_FRAMES) < 1e-9);
  assert.deepEqual(seen.slice(FADE_FRAMES - 1), [1, 1, 1]);
  // Walk away: it fades out over FADE_FRAMES, then is gone.
  const away = { ...at, x0: at.x0 + 5000 };
  const out = [];
  for (let i = 0; i < FADE_FRAMES; i++) {
    night.prepare(away, [], { seed: 4, world: lone });
    out.push(night.beams.size ? night.beams.get(shaft.key).frames : 0);
  }
  assert.deepEqual(out, Array.from({ length: FADE_FRAMES }, (_, i) => Math.max(0, FADE_FRAMES - 1 - i)));
  assert.equal(night.beams.size, 0);
  assert.equal(night.active, false);
  // A new world starts afresh.
  night.prepare(at, [], { seed: 4, world: lone });
  night.prepare(at, [], { seed: 4, world: meadow() });
  assert.ok([...night.beams.values()].every((b) => b.frames === 1));
  // An unknown tier is a desktop's.
  night.tier = 'no such tier';
  night.prepare(at, [], { seed: 4, world: lone });
  assert.equal(night.tierName, 'desktop');
});

test('beams fading out are bounded: at most a tier\'s count more, the faintest dropped at once', () => {
  const world = meadow();
  const night = new NightLight();
  night.tier = 'desktop';
  const view = { x0: 0, y0: 0, cols: 600, rows: 200 };
  for (let k = 0; k < 40; k++) night.prepare(view, [], { seed: 4, world });
  const max = SHAFT_TIERS.desktop.max;
  // Jump a little way, then further: what was kept now leaves, twice over.
  let most = 0;
  for (const dx of [300, 600, 900, 1200]) {
    for (let k = 0; k < 6; k++) {
      night.prepare({ ...view, x0: dx + k * 40 }, [], { seed: 4, world });
      const leaving = [...night.beams.values()].filter((b) => b.out).length;
      assert.ok(leaving <= max, `${leaving} leaving`);
      assert.ok(night.beams.size <= 2 * max);
      most = Math.max(most, leaving);
    }
  }
  assert.equal(most, max, 'the bound was reached');
});

test('a tier change fades the columns and their motes out over the fade, never at once', () => {
  const { world, shaft } = oneBeam(4);
  const view = around(shaft, 120, 70, -20, -20);
  const night = new NightLight();
  night.tier = 'phone';
  settle(night, view, [], { seed: 4, world });
  const drawn = () => {
    const r = screenRenderer(view);
    night.drawShafts(r, view, 2);
    let sum = 0, motes = 0;
    for (let o = 0; o < r.fg.length; o += 4) {
      if (r.fg[o + 3]) motes++;
      else sum += r.fg[o + 1] - 60;
    }
    return { sum, motes };
  };
  const full = drawn();
  assert.ok(full.sum > 0);
  assert.ok(full.motes >= 1 && full.motes <= SHAFT_TIERS.phone.motes, `${full.motes} motes`);
  night.tier = 'reduced';
  const sums = [];
  for (let i = 0; i < FADE_FRAMES + 1; i++) {
    night.prepare(view, [], { seed: 4, world });
    const { sum, motes } = drawn();
    sums.push(sum);
    if (i < FADE_FRAMES - 2) assert.ok(motes > 0, `motes still there at ${i}`);
  }
  for (let i = 1; i < FADE_FRAMES; i++) assert.ok(sums[i] <= sums[i - 1], `fading at ${i}`);
  assert.ok(sums[0] > full.sum * 0.9 && sums[0] < full.sum);
  assert.equal(sums[FADE_FRAMES - 1], 0);
  assert.equal(sums[FADE_FRAMES], 0);
  // The patch stays.
  assert.ok(night.gainAt(Math.floor(shaft.cx), Math.floor(shaft.cy)) > 1.5);
  // And back: the column fades in again, its mote count kept.
  night.tier = 'phone';
  night.prepare(view, [], { seed: 4, world });
  assert.ok(drawn().sum > 0);
  assert.equal(night.beams.get(shaft.key).motes, SHAFT_TIERS.phone.motes);
});

test('trees\' footprints and beams\' patches share a frame\'s bake budget', () => {
  const world = meadow();
  const view = { x0: 0, y0: 0, cols: 400, rows: 150 };
  const props = Array.from({ length: 6 }, (_, i) => plainTree(30.5 + i * 60, 60.5));
  const night = new NightLight();
  night.prepare(view, props, { seed: 11, world });
  assert.equal(night.bakes, MAX_BAKES_PER_FRAME);
  assert.equal(props.filter(hasStamp).length, MAX_BAKES_PER_FRAME);
  assert.equal(night.beams.size, 0, 'the patches wait');
  let frames = 1;
  while (night.beams.size < SHAFT_TIERS.desktop.max) {
    const had = night.beams.size;
    night.prepare(view, props, { seed: 11, world });
    assert.ok(night.bakes <= MAX_BAKES_PER_FRAME);
    assert.ok(night.beams.size - had <= MAX_BEAM_BAKES, 'one beam baked a frame');
    frames++;
  }
  assert.ok(frames > 2);
  assert.ok(props.every(hasStamp));
  assert.equal(night.baked, 6 + SHAFT_TIERS.desktop.max);
});

test('the columns leave the sprites\' small cells alone', () => {
  const { world, shaft } = oneBeam(4);
  const view = around(shaft, 120, 70, -20, -20);
  const night = new NightLight();
  settle(night, view, [], { seed: 4, world });
  const r = screenRenderer(view);
  for (let cell = 0; cell < r.fineMark.length; cell += 3) r.fineMark[cell] = 1;
  r.fine.fill(9);
  r.fineBg.fill(5);
  const before = [r.fine.slice(), r.fineBg.slice(), r.fg.slice()];
  night.drawShafts(r, view, 2);
  assert.deepEqual([r.fine, r.fineBg], before.slice(0, 2));
  let lit = 0;
  for (let cell = 0; cell < r.fineMark.length; cell++) {
    const same = r.fg[cell * 4] === before[2][cell * 4];
    if (cell % 3 === 0) assert.ok(same, `sprite cell ${cell}`);
    else if (!same) lit++;
  }
  assert.ok(lit > 50);
});

test('motes repeat at a fixed time and no more than the tier\'s', () => {
  const { world, shaft } = oneBeam(4);
  const view = around(shaft, 120, 70, -20, -20);
  const night = new NightLight();
  night.tier = 'desktop';
  settle(night, view, [], { seed: 4, world });
  const motes = (time) => {
    const r = screenRenderer(view);
    night.drawShafts(r, view, time);
    const at = [];
    for (let cell = 0; cell < r.mask.length; cell++) if (r.fg[cell * 4 + 3]) at.push(cell);
    return at;
  };
  const a = motes(7);
  assert.ok(a.length > 0 && a.length <= SHAFT_TIERS.desktop.motes);
  assert.deepEqual(motes(7), a);
  assert.notDeepEqual(motes(9), a);
});

test('the scene\'s stages: the beams\' columns are timed apart from the grass and sprites', async () => {
  const scene = await createScene(undefined, { width: 390, height: 844, seed: SEED, x: PLAYER.x, y: PLAYER.y });
  assert.ok(scene.night.visible !== undefined);
  const stages = Object.keys(scene.frame());
  assert.deepEqual(stages.slice(stages.indexOf('night')),
    ['night', 'reflections', 'grassAndSprites', 'shafts', 'fineBakes']);
  for (let k = 0; k < FADE_FRAMES; k++) scene.frame();
  assert.ok(scene.night.visible.length > 0, 'a beam by the lake');
  assert.equal(scene.night.tierName, 'phone');
  const desk = await createScene(undefined, { width: 1280, height: 720, seed: SEED, x: PLAYER.x, y: PLAYER.y, tier: 'reduced' });
  desk.frame();
  assert.equal(desk.night.tierName, 'reduced');
});

test('the CPU scene benchmark runs every scenario and builds the buffers an older checkout reads', async () => {
  const results = await benchmark(undefined, { warmup: 1, frames: 2 });
  assert.deepEqual(results.map((r) => r.name), scenarios.map((s) => s.name));
  for (const r of results) assert.ok(r.medianMs > 0 && r.cells > 0 && 'shafts' in r.stages, r.name);
  const { allocate } = AsciiRenderer.prototype;
  try {
    AsciiRenderer.prototype.allocate = undefined;
    const scene = await createScene(undefined, { width: 100, height: 80 });
    const r = scene.renderer;
    assert.deepEqual([r.fg.length, r.bg.length, r.ov.length, r.mask.length], [r.cols * r.rows * 4,
      r.cols * r.rows * 4, r.cols * r.rows * 4, r.cols * r.rows]);
  } finally {
    AsciiRenderer.prototype.allocate = allocate;
  }
});
