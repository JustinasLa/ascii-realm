import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCALE } from '../src/entities/rig.js';
import { BASE_LOOK, Camera, liftView, PITCH, pitchLook } from '../src/world/camera.js';
import { raisedRows } from '../src/world/ground.js';
import { World } from '../src/world/world.js';
import { loadGame } from './helpers/main-game.js';

const noop = () => {};

// The real camera on a fixed 80 × 60 grid; the page's own is kept.
let cameras = [];
class GridCamera extends Camera {
  constructor(...args) { super(...args); cameras.push(this); }
  view() { return { x0: Math.floor(this.x) - 40, y0: Math.floor(this.y) - 30, offX: 0, offY: 0, cols: 80, rows: 60 }; }
}

// A stand-in system: the given methods, and an empty list from any other.
const stub = (methods = {}) => class {
  constructor() {
    Object.assign(this, { list: [], events: [], spores: [], ambient: [], time: 0 }, methods);
    return new Proxy(this, { get: (target, key) => (key in target ? target[key] : () => []) });
  }
};

// The hill scene at the address `query`, with the 3D character loading only
// once `loadModel()` is called; records the pitch toasts, the model's looks
// and the torch throws.
async function pitchGame(query, move) {
  cameras = [];
  const toasts = [];
  const looks = [];
  const throws = [];
  let pointerCell = null;
  let ready;
  const modelReady = new Promise((resolve) => { ready = resolve; });
  const loaded = await loadGame(move, { href: `http://localhost/?${query}`, real: {
    World, Camera: GridCamera, liftView, PITCH, pitchLook, propDepthSlices: () => null, dressFigure: () => [],
    Grass: stub({ drawLayered: (_r, _w, _v, _t, drawables) => { for (const d of drawables) d.draw(); } }),
    raisedRows: (r, world, view) => raisedRows(r, world, view).map((row) => ({ y: row.y, draw: noop })),
    screenToWorld: () => pointerCell,
    Hud: stub({ notify: (message) => toasts.push(message) }),
    Torches: stub({ throw: (player, pose) => { throws.push(pose); } }), Footprints: stub(),
    ModelFigure: { load: () => modelReady, library: () => new Promise(noop) },
  } });
  Object.assign(loaded.model, { top: 10, cells: [], setLook: (look) => looks.push(look),
    torchPose: () => ({ x: 1, y: 2, h: 20 }) });
  const loadModel = async () => {
    ready(loaded.model);
    await modelReady;
    await Promise.resolve();
  };
  return { ...loaded, camera: cameras[0], toasts, looks, throws, loadModel, aimAt: (cell) => { pointerCell = cell; } };
}

const code = (c, modifiers = {}) => [c === 'Backslash' ? '\\' : c === 'BracketLeft' ? '[' : ']', { code: c, ...modifiers }];

test('?debug&pitch= tilts the camera, re-lifts the hill and views the model from there', async () => {
  const { game, camera, toasts, looks, loadModel } = await pitchGame('debug&scene=hill&pitch=45');
  assert.equal(camera.look, pitchLook(45));
  assert.equal(game.world.relief.rise, pitchLook(45).rise);
  game.world.typeAt(game.world.spawn.x + 75, game.world.spawn.y - 6);
  assert.equal(game.world.liftAt(game.world.spawn.x + 75, game.world.spawn.y - 6), 7);
  assert.deepEqual(toasts, ['Camera pitch 45°']);
  await loadModel();
  assert.deepEqual(looks, [camera.look], 'the model loaded later is viewed from the pitch');
});

test('the usual pitch leaves the camera, the hill and the model as they are', async () => {
  for (const query of ['debug&scene=hill', 'debug&scene=hill&pitch=30']) {
    const { game, camera, toasts, looks, loadModel } = await pitchGame(query);
    await loadModel();
    assert.equal(camera.look, BASE_LOOK, query);
    assert.equal(game.world.relief.rise, BASE_LOOK.rise, query);
    assert.deepEqual([toasts, looks], [[], []], query);
  }
});

test('without ?debug, or in a lobby, the pitch and its keys are ignored', async () => {
  for (const query of ['scene=hill&pitch=45', 'debug&scene=hill&pitch=45&room=ABC234']) {
    const { game, camera, keydown, toasts } = await pitchGame(query);
    keydown(...code('BracketRight'));
    assert.equal(camera.look, BASE_LOOK, query);
    assert.deepEqual(toasts, [], query);
    assert.equal(game?.setPitch, undefined, query);
  }
});

test('[ lowers the camera, ] raises it and \\ puts it back, within range', async () => {
  const { game, camera, keydown, toasts, looks, loadModel } = await pitchGame('debug&scene=hill');
  await loadModel();
  keydown(...code('BracketRight'));
  assert.equal(camera.look.deg, 35);
  assert.equal(game.world.relief.rise, pitchLook(35).rise);
  keydown(...code('Backslash'));
  assert.equal(camera.look, BASE_LOOK);
  for (let i = 0; i < 4; i++) keydown(...code('BracketLeft'));
  assert.equal(camera.look.deg, PITCH.min);
  keydown(...code('BracketRight', { ctrlKey: true }));
  assert.equal(camera.look.deg, PITCH.min, 'a modifier chord is left alone');
  game.setPitch(90);
  assert.equal(camera.look.deg, PITCH.max);
  assert.deepEqual(toasts, ['Camera pitch 35°', 'Camera pitch 30°', 'Camera pitch 25°', 'Camera pitch 45°']);
  assert.deepEqual(looks.map((l) => l.deg), [35, 30, 25, 45]);
});

test('the camera aims at the figure\'s middle at the pitch\'s own height', async () => {
  for (const deg of [25, 45]) {
    const { game, camera, frame } = await pitchGame(`debug&scene=hill&pitch=${deg}`);
    const { player, world } = game;
    player.x = world.spawn.x + 75;
    player.y = world.spawn.y - 4;
    for (let i = 0; i < 120; i++) frame();
    const want = player.y - 11 * pitchLook(deg).scale - world.liftAt(player.x, player.y);
    assert.ok(Math.abs(camera.y - want) < 0.5, `${deg}° camera ${camera.y} vs ${want}`);
    // Falling in battle snaps it there over spawn.
    player.vitals.health = 0;
    frame();
    assert.ok(Math.abs(camera.y - (world.spawn.y - 11 * pitchLook(deg).scale)) < 0.5, `${deg}° respawn ${camera.y}`);
  }
});

test('the pitch never changes where the player walks', async () => {
  const at = [];
  for (const query of ['debug&scene=hill&pitch=25', 'debug&scene=hill', 'debug&scene=hill&pitch=45']) {
    const { game, frame } = await pitchGame(query, { x: 0.6, y: -0.8 });
    for (let i = 0; i < 120; i++) frame();
    at.push([game.player.x - game.world.spawn.x, game.player.y - game.world.spawn.y]);
  }
  assert.ok(at[0][0] > 3 && at[0][1] < -1, `it walked ${at[0]}`);
  assert.deepEqual(at[0], at[1]);
  assert.deepEqual(at[2], at[1]);
});

test('a click is read against the hips drawn at the pitch\'s height', async () => {
  const south = {};
  for (const deg of [25, 30, 45]) {
    const { game, frame, aimAt, tap } = await pitchGame(`debug&scene=hill&pitch=${deg}`);
    const { player, world } = game;
    player.x = world.spawn.x + 75;
    player.y = world.spawn.y - 4;
    for (let i = 0; i < 30; i++) frame();
    // Nine rows above the drawn feet: below the hips at 25° and 30°, above
    // them at 45°, where height is drawn shorter.
    player.heading = Math.PI / 2;
    aimAt({ x: player.x, y: player.y - world.liftAt(player.x, player.y) - 9 });
    tap('mouse');
    for (let i = 0; i < 20; i++) frame();
    south[deg] = Math.abs(Math.atan2(Math.sin(player.heading), Math.cos(player.heading))) < Math.PI / 2;
  }
  assert.deepEqual(south, { 25: true, 30: true, 45: false });
  assert.ok(0.9 * SCALE * pitchLook(45).scale < 9 && 0.9 * SCALE > 9);
});

test('a torch thrown at any pitch leaves the hand at the usual height', async () => {
  const heights = [];
  for (const query of ['debug&scene=hill&pitch=45', 'debug&scene=hill']) {
    const { frame, tap, throws, loadModel } = await pitchGame(query);
    await loadModel();
    tap('KeyG');
    frame();
    assert.equal(throws.length, 1, query);
    heights.push(throws[0]);
  }
  assert.deepEqual({ ...heights[0] }, { x: 1, y: 2, h: 20 / pitchLook(45).scale });
  assert.deepEqual({ ...heights[1] }, { x: 1, y: 2, h: 20 });
});

test('meeting friends in a lobby puts the camera over the player from the usual angle', async () => {
  const { game, camera } = await pitchGame('debug&room=ABC234');
  game.multiplayer.players = [{ id: 'me' }, { id: 'friend' }];
  game.multiplayer.onJoin({ seed: 1, code: 'ABC234', id: 'me', self: { x: 40, y: 70 } });
  assert.deepEqual([game.player.x, game.player.y], [40, 70]);
  assert.deepEqual([camera.x, camera.y], [40, 59]);
});
