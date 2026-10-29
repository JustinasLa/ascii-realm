import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HuntDrops } from '../src/entities/hunt-drops.js';
import { Camera, liftView } from '../src/world/camera.js';
import { raisedRows } from '../src/world/ground.js';
import { MAX_LIFT } from '../src/world/relief.js';
import { PENDING_LOBBY } from '../src/world/woodland.js';
import { World } from '../src/world/world.js';
import { loadGame } from './helpers/main-game.js';

// The real camera on a fixed 80 × 60 grid, without a canvas to measure.
const noop = () => {};

class GridCamera extends Camera {
  view() { return { x0: Math.floor(this.x) - 40, y0: Math.floor(this.y) - 30, offX: 0, offY: 0, cols: 80, rows: 60 }; }
}

// A stand-in for the grass that draws the painter's list in order, as the
// real layered pass does between its root rows.
class Grass {
  constructor() {
    return new Proxy(this, { get: (target, key) => (key in target ? target[key] : () => []) });
  }
  drawLayered(_r, _w, _v, _t, drawables) { for (const d of drawables) d.draw(); }
}

// A stand-in system: the given methods, and an empty list from any other.
const stub = (methods = {}) => class {
  constructor() {
    Object.assign(this, { list: [], events: [], spores: [], ambient: [], time: 0 }, methods);
    return new Proxy(this, { get: (target, key) => (key in target ? target[key] : () => []) });
  }
};

// The game on the real world and camera, recording what the frame draws.
// `shape` keeps the 3D character from loading, so the shape-built figure shows.
async function hillGame(query = 'scene=hill', { shape = false, real = {} } = {}) {
  const order = [];
  // The views each glow and light pass draws a source through.
  const glows = [];
  const glow = (kind) => (_r, view) => glows.push([kind, view.y0]);
  const figures = [];
  const shadows = [];
  let pointerCell = null;
  // A torch stuck in the ground, a bush and a glowcap where the player stands.
  const at = () => [{ x: loaded.game.player.x, y: loaded.game.player.y }];
  const sprites = [];
  const sprite = (kind) => (_r, view) => sprites.push([kind, view.y0]);
  const loaded = await loadGame(undefined, { href: `http://localhost/?debug&${query}`, real: {
    World, Camera: GridCamera, liftView, Grass, propDepthSlices: () => null,
    raisedRows: (r, world, view) => raisedRows(r, world, view).map((row) => ({ y: row.y, draw: () => order.push(['ground', row.y]) })),
    drawFigure: (_r, view) => { figures.push(view); order.push(['player']); },
    drawShadow: (_r, view, x, y) => shadows.push({ view, x, y }),
    screenToWorld: () => pointerCell,
    Torches: stub({ prepare: at, draw: sprite('torch'), light: glow('torch') }),
    Fires: stub({ prepare: at, light: glow('fire'), nearest: () => null }),
    Harvesting: stub({ resourcesIn: at }),
    drawResource: sprite('plant'),
    Mushrooms: stub({ prepare: at, draw: sprite('mushroom'), drawGlow: glow('glowcap'), nearby: () => null }),
    ...(shape ? { ModelFigure: { load: () => new Promise(noop), library: () => new Promise(noop) }, dressFigure: () => [] } : {}),
    ...real,
  } });
  Object.assign(loaded.model, { top: 10, cells: [{ sx: 40, sy: 25 }], rasterise: (view) => figures.push(view),
    draw: () => order.push(['player']) });
  return { ...loaded, order, figures, shadows, sprites, glows, aimAt: (cell) => { pointerCell = cell; } };
}

test('?scene=hill raises the hill on quiet land without rivers or ruins', async () => {
  const { game } = await hillGame();
  assert.ok(game.world.relief);
  assert.equal(game.world.rivers.enabled, false);
  assert.equal(game.world.spawnRuins, undefined);
  assert.equal(game.world.meadow, true);
  assert.deepEqual(game.animals.counts, { deer: 0, rabbit: 0, wolf: 0 });
});

test('the hill scene keeps a wildlife count the address asks for', async () => {
  const { game } = await hillGame('scene=hill&deer=3');
  assert.deepEqual(game.animals.counts, { deer: 3, rabbit: 0, wolf: 0 });
});

test('a lobby page and the plain world have no relief', async () => {
  for (const query of ['scene=hill&room=ABC234', 'seed=1']) {
    const { game } = await hillGame(query);
    assert.equal(game.world.relief ?? null, null, query);
  }
});

for (const shape of [false, true]) test(`on the knoll the camera, ${shape ? 'shape-built' : '3D'} figure and shadow rise with the ground`, async () => {
  const { game, frame, figures, shadows, order, sprites, glows } = await hillGame('scene=hill', { shape });
  const { player, world, camera } = game;
  player.x = world.spawn.x + 75;
  player.y = world.spawn.y - 4;
  for (let i = 0; i < 120; i++) frame();
  const lift = world.liftAt(player.x, player.y);
  assert.equal(lift, 11);
  assert.ok(Math.abs(camera.y - (player.y - 11 - lift)) < 0.5, `camera ${camera.y}`);
  figures.length = 0;
  shadows.length = 0;
  order.length = 0;
  sprites.length = 0;
  glows.length = 0;
  frame();
  const view = camera.view(game.renderer);
  // Whatever stands on the ground there rises with it; reflections do not.
  for (const kind of ['torch', 'plant', 'mushroom']) {
    assert.ok(sprites.some(([k, y0]) => k === kind && y0 === view.y0 + lift), kind);
  }
  // So does the light or glow it gives.
  assert.deepEqual(glows.sort(), [['fire', view.y0 + lift], ['glowcap', view.y0 + lift], ['torch', view.y0 + lift]]);
  assert.equal(figures.at(-1).y0, view.y0 + lift, 'the figure is drawn its lift higher');
  assert.equal(shadows.length, 1, 'one shadow, cast on the raised ground');
  assert.equal(shadows[0].view.y0, view.y0 + lift);
  // The ground row the player stands on is drawn before them.
  const own = order.findIndex(([kind, y]) => kind === 'ground' && y === Math.floor(player.y));
  assert.ok(own >= 0 && own < order.findIndex(([kind]) => kind === 'player'));
});

test('falling in battle puts the camera back over the raised spawn', async () => {
  const { game, frame } = await hillGame();
  const { player, world, camera } = game;
  world.spawn.x += 75;
  world.spawn.y -= 4;
  frame();
  player.vitals.health = 0;
  frame();
  assert.equal(player.y, world.spawn.y);
  assert.ok(Math.abs(camera.y - (world.spawn.y - 11 - 11)) < 0.5, `camera ${camera.y}`);
});

test('the cursor is read on the raised player\'s own height', async () => {
  const { game, frame, aimAt, tap } = await hillGame();
  const { player, world } = game;
  player.x = world.spawn.x + 75;
  player.y = world.spawn.y - 4;
  for (let i = 0; i < 30; i++) frame();
  player.heading = Math.PI;
  // A click below the lifted figure's hips on screen (above its unlifted
  // ones) cuts south.
  aimAt({ x: player.x, y: player.y - 11 - 5 });
  tap('mouse');
  for (let i = 0; i < 20; i++) frame();
  assert.ok(Math.abs(Math.atan2(Math.sin(player.heading), Math.cos(player.heading))) < 0.5, `heading ${player.heading}`);
});

test('on flat land every light and glow is drawn in one pass through the view', async () => {
  const { game, frame, glows } = await hillGame('seed=1');
  frame();
  const view = game.camera.view(game.renderer);
  assert.deepEqual(glows.sort(), [['fire', view.y0], ['glowcap', view.y0], ['torch', view.y0]]);
});

test('a carried torch shines from the raised player\'s hand', async () => {
  const { game, frame, glows } = await hillGame('scene=hill', { real: {
    Torches: stub({ prepare: () => [{ x: game.player.x, y: game.player.y + 30, carried: true }],
      light: (_r, view) => glows.push(['torch', view.y0]) }),
  } });
  const { player, world, camera } = game;
  player.x = world.spawn.x + 75;
  player.y = world.spawn.y - 4;
  for (let i = 0; i < 3; i++) frame();
  glows.length = 0;
  frame();
  assert.ok(glows.some(([kind, y0]) => kind === 'torch' && y0 === camera.view(game.renderer).y0 + 11));
});

test('a hunt drop, bush, glowcap, fire or torch on the crest below the view rises into it', async () => {
  // Standing on the meadow behind the ridge, its crest lies below the view.
  const items = [];
  const plants = [];
  const queried = {};
  const drawn = [];
  const inBox = (list, x0, y0, x1, y1) => list.filter((n) => n.x >= x0 && n.x < x1 && n.y >= y0 && n.y < y1);
  const deep = (kind) => (view) => { queried[kind] = view.y0 + view.rows; return []; };
  const { game, frame } = await hillGame('scene=hill', { real: {
    HuntDrops: class extends HuntDrops { in(...box) { return inBox(items, ...box); } },
    Harvesting: stub({ resourcesIn: (...box) => inBox(plants, ...box) }),
    drawItem: (_r, view, item, _t, mirror) => mirror || drawn.push(['drop', view.y0]),
    drawResource: (_r, view, node, _t, mirror) => mirror || drawn.push(['plant', view.y0]),
    // Glowcaps reach only further south, not as far north again.
    Mushrooms: stub({ prepare: (view, _wide, below) => {
      queried.glowcaps = view.y0 + view.rows + below;
      queried.glowcapRows = view.rows;
      return [];
    }, nearby: () => null }),
    Fires: stub({ prepare: deep('fires'), nearest: () => null }),
    Torches: stub({ prepare: deep('torches') }),
  } });
  const { player, world, camera } = game;
  player.x = world.spawn.x + 20;
  player.y = world.spawn.y - 60;
  for (let i = 0; i < 30; i++) frame();
  const view = camera.view(game.renderer);
  const x = Math.floor(player.x);
  const crest = Array.from({ length: 60 }, (_, k) => world.liftAt(x, view.y0 + view.rows + k));
  const y = view.y0 + view.rows + crest.indexOf(Math.max(...crest));
  const lift = world.liftAt(x, y);
  assert.ok(lift > 12 && y - lift < view.y0 + view.rows, `crest at ${y} lifted ${lift}`);
  items.push({ x: x + 0.5, y: y + 0.5 });
  plants.push({ x: x + 0.5, y: y + 0.5 });
  drawn.length = 0;
  frame();
  assert.deepEqual(drawn.sort(), [['drop', view.y0 + lift], ['plant', view.y0 + lift]]);
  for (const kind of ['glowcaps', 'fires', 'torches']) assert.equal(queried[kind], view.y0 + view.rows + MAX_LIFT, kind);
  assert.equal(queried.glowcapRows, view.rows);
});

test('creating a lobby from the hill scene reloads onto flat land and creates it there', async () => {
  const session = new Map();
  const page = await loadGame(undefined, { href: 'http://localhost/?debug&seed=5&scene=hill', session, real: { World } });
  assert.ok(page.game.world.relief);
  page.game.multiplayer.connect({ mode: 'create', name: 'Kael', seed: 5, code: '', server: '' });
  assert.deepEqual(page.game.multiplayer.connects, [], 'no connection from the hill page');
  const destination = new URL(page.navigatedTo());
  assert.equal(destination.searchParams.has('scene'), false);
  assert.equal(destination.searchParams.get('seed'), '5');
  const flat = await loadGame(undefined, { href: destination.href, session, real: { World } });
  assert.equal(flat.game.world.relief, null);
  assert.deepEqual(flat.game.multiplayer.connects, [{ mode: 'create', name: 'Kael', seed: 5, code: '', server: '' }]);
  assert.equal(session.has(PENDING_LOBBY), false);
});

test('a hill or dense page whose session storage refuses a lobby request stays put and says why', async () => {
  // The browser won't keep the request across a reload (private mode, full
  // storage), so reloading would silently lose it.
  class Refusing extends Map { set(key, value) { if (key === PENDING_LOBBY) throw new Error('QuotaExceededError'); return super.set(key, value); } }
  for (const [query, place] of [['scene=hill', 'the hill scene'], ['woodland=dense', 'the dense woods']]) {
    const session = new Refusing();
    const { game, navigatedTo } = await loadGame(undefined, { href: `http://localhost/?debug&seed=5&${query}`, session });
    const notes = [];
    game.hud.notify = (text, kind) => notes.push([text, kind]);
    for (const mode of ['create', 'join']) game.multiplayer.connect({ mode, name: 'Kael', seed: 5, code: 'ABC234', server: '' });
    assert.equal(navigatedTo(), undefined, 'no reload');
    assert.deepEqual(game.multiplayer.connects, [], 'no connection');
    assert.equal(session.has(PENDING_LOBBY), false);
    assert.equal(game.multiplayer.status, 'error');
    assert.match(game.multiplayer.message, new RegExp(`^Leave ${place} first: lobbies play in the plain world`));
    assert.deepEqual(notes, [[game.multiplayer.message, 'info'], [game.multiplayer.message, 'info']]);
  }
});

test('a hill page that somehow joins a lobby on its own seed keeps its seat and reloads onto flat land', async () => {
  const session = new Map();
  const { game, navigatedTo } = await loadGame(undefined, { href: 'http://localhost/?debug&scene=hill', session });
  game.multiplayer.onJoin({ seed: 1, code: 'ABC234' });
  assert.equal(game.multiplayer.suspends, 1);
  assert.equal(session.get('ascii-realm-rejoin'), 'ABC234');
  const destination = new URL(navigatedTo());
  assert.equal(destination.searchParams.has('scene'), false);
  assert.equal(destination.searchParams.get('room'), 'ABC234');
});
