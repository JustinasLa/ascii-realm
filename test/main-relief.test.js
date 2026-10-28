import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera, liftView } from '../src/world/camera.js';
import { raisedRows } from '../src/world/ground.js';
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
async function hillGame(query = 'scene=hill', { shape = false } = {}) {
  const order = [];
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
    drawShadow: (_r, view, x, y) => { shadows.push({ view, x, y }); order.push('shadow'); },
    screenToWorld: () => pointerCell,
    Torches: stub({ prepare: at, draw: sprite('torch') }),
    Harvesting: stub({ resourcesIn: at }),
    drawResource: sprite('plant'),
    Mushrooms: stub({ prepare: at, draw: sprite('mushroom'), nearby: () => null }),
    ...(shape ? { ModelFigure: { load: () => new Promise(noop), library: () => new Promise(noop) }, dressFigure: () => [] } : {}),
  } });
  Object.assign(loaded.model, { top: 10, cells: [{ sx: 40, sy: 25 }], rasterise: (view) => figures.push(view),
    draw: () => order.push(['player']) });
  return { ...loaded, order, figures, shadows, sprites, aimAt: (cell) => { pointerCell = cell; } };
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
  const { game, frame, figures, shadows, order, sprites } = await hillGame('scene=hill', { shape });
  const { player, world, camera } = game;
  player.x = world.spawn.x + 75;
  player.y = world.spawn.y - 4;
  const lift = world.liftAt(player.x, player.y);
  assert.equal(lift, 11);
  for (let i = 0; i < 120; i++) frame();
  assert.ok(Math.abs(camera.y - (player.y - 11 - lift)) < 0.5, `camera ${camera.y}`);
  figures.length = 0;
  shadows.length = 0;
  order.length = 0;
  sprites.length = 0;
  frame();
  const view = camera.view(game.renderer);
  // Whatever stands on the ground there rises with it; reflections do not.
  for (const kind of ['torch', 'plant', 'mushroom']) {
    assert.ok(sprites.some(([k, y0]) => k === kind && y0 === view.y0 + lift), kind);
  }
  assert.equal(figures.at(-1).y0, view.y0 + lift, 'the figure is drawn its lift higher');
  // The shadow is laid on the flat ground, whose raised tops carry it up.
  assert.equal(shadows.length, 1, 'one shadow');
  assert.equal(shadows[0].view.y0, view.y0);
  const laid = order.indexOf('shadow');
  assert.ok(laid >= 0 && order.findIndex(([kind]) => kind === 'ground') > laid, 'before the raised rows');
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
