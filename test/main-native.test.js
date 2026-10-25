import assert from 'node:assert/strict';
import test from 'node:test';
import { CELL_CEILING, PHONE_PACING } from '../src/render/budget.js';
import { GameAudio } from '../src/audio/audio.js';
import { AudioEngine } from '../src/audio/engine.js';
import { Debris } from '../src/world/debris.js';
import { Fires } from '../src/world/fire.js';
import { WeatherEffects } from '../src/world/weather.js';
import { GRASS, WATER } from '../src/world/world.js';
import { loadGame } from './helpers/main-game.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const phone = { phone: true, width: 393, height: 852, dpr: 3 };
const walk = { x: 1, y: 0 };

test('a phone starts paused behind the card; the tap unlocks sound, goes full screen and keeps the screen awake', async () => {
  const harness = await loadGame(walk, phone);
  const { game, frame, gateButton, gateAction, tapGate, fullscreenRequests, locks, audio, document } = harness;
  assert.equal(game.native.gate.waiting, true);
  assert.equal(gateButton.hidden, false);
  assert.equal(gateAction.textContent, 'TAP TO PLAY');
  assert.ok(document.body.classList.contains('play-gated'));
  for (let i = 0; i < 30; i++) frame();
  assert.equal(game.player.x, 0, 'the stick does nothing behind the card');
  await settle();
  assert.equal(locks.requests, 0);
  assert.equal(game.native.wakeLock.held, false);
  tapGate();
  assert.equal(audio.unlocks, 1);
  assert.deepEqual(fullscreenRequests, [{ navigationUI: 'hide' }]);
  await settle();
  assert.equal(game.native.wakeLock.held, true);
  assert.equal(game.native.fullscreen, true);
  for (let i = 0; i < 30; i++) frame();
  assert.ok(game.player.x > 0, 'the player walks after the tap');
});

// A fake Web Audio context: enough for the engine's buses, counting every
// node made so a sound started behind the card would show.
class FakeAudioContext {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.nodes = 0; this.destination = this.node(); }
  node() {
    this.nodes++;
    const param = () => ({ value: 1, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {},
      cancelScheduledValues() {}, exponentialRampToValueAtTime() {} });
    return { gain: param(), pan: param(), connect() {}, disconnect() {} };
  }
  createGain() { return this.node(); }
  createStereoPanner() { return this.node(); }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
}

// A meadow with a river running east a little south of the player, so the
// real debris has water to drift on. Grass everywhere else.
const RIVER_ROWS = [18, 26];
class RiverWorld {
  constructor() { this.spawn = { x: 0, y: 0 }; }
  inRiver(y) { return y >= RIVER_ROWS[0] && y <= RIVER_ROWS[1]; }
  isWalkable(x, y) { return !this.inRiver(y); }
  typeAt(x, y) { return this.inRiver(y) ? WATER : GRASS; }
  // Every chunk is generated, with no props on it.
  loaded() { return { props: [] }; }
  propsIn() { return []; }
  propsInView() { return []; }
  waterDepthAt(x, y) { return this.inRiver(y) ? 0.5 : 0; }
  flowAt(x, y, out = {}) {
    Object.assign(out, { x: 0, y: 0, speed: 0, river: 0, across: 0, secondary: 0, halfWidth: 0, bend: 0, depth: 0 });
    if (!this.inRiver(y)) return out;
    const mid = (RIVER_ROWS[0] + RIVER_ROWS[1]) / 2, half = (RIVER_ROWS[1] - RIVER_ROWS[0]) / 2;
    return Object.assign(out, { x: 1, speed: 0.8, river: 1, across: (y - mid) / half, halfWidth: 3, depth: 0.5 });
  }
  get rivers() { return { near: () => [], stonesNear: () => [] }; }
  trim() {}
}

// The plain numbers, strings and flags of an object, for comparing state.
const plain = object => Object.fromEntries(Object.entries(object)
  .filter(([, value]) => ['number', 'string', 'boolean'].includes(typeof value)));

test('behind the card the real fire, weather, world clock, sound, debris and animals hold still', async () => {
  const contexts = [];
  // No herds of the land's own: only the two animals placed below.
  const harness = await loadGame(walk, { ...phone, href: 'http://localhost/?debug&deer=0&rabbits=0', real: {
    // The real systems; only their drawing is left out, as the renderer is a
    // stand-in.
    World: RiverWorld,
    Fires: class extends Fires { draw() {} drawParticles() {} },
    WeatherEffects: class extends WeatherEffects { drawSurface() {} drawAtmosphere() {} draw() {} },
    Debris: class extends Debris { drawSurface() {} draw() {} reflect() {} },
    GameAudio: class extends GameAudio {
      constructor(world) {
        super(world, new AudioEngine({ storage: null, contextFactory: () => {
          const context = new FakeAudioContext();
          contexts.push(context);
          return context;
        } }));
      }
    },
  } });
  const { game, frame, tapGate, setHidden } = harness;
  const { world, player } = game;
  // Start playing for the sound, then come back to the resume card.
  tapGate();
  await settle();
  assert.equal(game.audio.context.state, 'running');
  setHidden(true);
  setHidden(false);
  await settle();
  assert.equal(game.native.gate.waiting, true);
  assert.equal(game.audio.context.state, 'suspended', 'the card suspends the real engine');
  // Something alive in every system: a burning fire, rain, a drifting log
  // and a deer and a rabbit nearby.
  game.sound.weather.preset = 'rain';
  game.sound.weather.intensity = 1;
  assert.ok(game.fires.add(world, player.x + 30, player.y - 6));
  assert.ok(game.debris.spawn('log', { x: 40, y: 22, angle: 0 }));
  game.animals.spawn('deer', { x: player.x + 20, y: player.y - 8, count: 1 });
  game.animals.spawn('rabbit', { x: player.x - 20, y: player.y - 8, count: 1 });
  for (let i = 0; i < 3; i++) frame();
  const snapshot = () => ({
    time: game.time,
    player: [player.x, player.y],
    fires: game.fires.list.map(plain),
    sparks: game.fires.particles.map(plain),
    weather: [game.weather.particles.map(plain), game.weather.crowns.map(plain), game.weather.settled.map(plain),
      plain(game.weather)],
    debris: game.debris.list.map(plain),
    animals: game.animals.list.map(plain),
    sound: { state: game.audio.context.state, nodes: contexts.map(c => c.nodes), music: plain(game.sound.music) },
  });
  const before = snapshot();
  assert.equal(before.fires.length, 1);
  assert.ok(before.weather[0].length > 0, 'rain is falling');
  assert.equal(before.debris.length, 1);
  assert.equal(before.animals.length, 2);
  for (let i = 0; i < 300; i++) frame();
  assert.deepEqual(snapshot(), before, 'five seconds behind the card change nothing');
  // After the tap the same systems move on, so the check above can fail.
  tapGate();
  await settle();
  for (let i = 0; i < 60; i++) frame();
  const after = snapshot();
  assert.ok(after.time > before.time, 'the world clock runs');
  assert.equal(after.sound.state, 'running');
  for (const name of ['fires', 'weather', 'debris', 'animals']) {
    assert.notDeepEqual(after[name], before[name], `${name} move on after the tap`);
  }
});

test('behind the card the sound is paused every frame and friends hold still', async () => {
  const harness = await loadGame(walk, phone);
  const { game, frame, audio, tapGate } = harness;
  let remote = 0;
  game.remotePlayers.update = () => { remote++; };
  const pausedBefore = audio.paused ?? 0;
  for (let i = 0; i < 300; i++) frame();
  assert.equal(remote, 0, 'friends hold still too');
  assert.ok(audio.paused - pausedBefore >= 300);
  assert.equal(audio.suspends, 1, 'the card suspends the sound when shown');
  tapGate();
  frame();
  assert.equal(remote, 1);
});

test('hiding the page releases the wake lock and comes back paused behind the resume card', async () => {
  const harness = await loadGame(walk, phone);
  const { game, frame, setHidden, tapGate, gateAction, locks, audio } = harness;
  tapGate();
  await settle();
  frame();
  setHidden(true);
  assert.equal(game.native.wakeLock.held, false);
  assert.equal(locks.released, 1);
  assert.equal(game.native.gate.waiting, true);
  assert.equal(gateAction.textContent, 'TAP TO RESUME');
  const suspends = audio.suspends;
  setHidden(false);
  assert.equal(audio.suspends, suspends + 1, 'a resumed page keeps the sound waiting for the tap');
  await settle();
  assert.equal(game.native.wakeLock.held, false, 'no wake lock behind the card');
  const x = game.player.x;
  for (let i = 0; i < 10; i++) frame();
  assert.equal(game.player.x, x, 'still paused');
  tapGate();
  frame(5);
  assert.ok(game.metrics.intervalMs <= 1000 / 60 + 1e-9, 'a fresh clock step after the tap');
  await settle();
  assert.equal(game.native.wakeLock.held, true);
  assert.ok(game.player.x > x);
});

test('a page kept in the back-forward cache comes back behind the resume card, with the sound waiting', async () => {
  const harness = await loadGame(walk, phone);
  const { game, tapGate, audio } = harness;
  tapGate();
  const unlocks = audio.unlocks;
  const hide = Object.assign(new Event('pagehide'), { persisted: true });
  harness.window.dispatchEvent(hide);
  assert.equal(game.native.gate.waiting, true);
  game.audio.context = {};
  harness.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  assert.equal(audio.unlocks, unlocks, 'no sound until the tap');
});

test('?nogate skips the card; installed to the home screen the tap does not ask for full screen', async () => {
  const tools = await loadGame(walk, { ...phone, href: 'http://localhost/?debug&nogate' });
  assert.equal(tools.game.native.gate.waiting, false);
  tools.setHidden(true);
  tools.setHidden(false);
  tools.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  assert.equal(tools.game.native.gate.waiting, false, 'nor the resume card');
  tools.frame();
  await settle();
  assert.equal(tools.game.native.wakeLock.held, true);
  const installed = await loadGame(walk, { ...phone, standalone: true });
  installed.tapGate();
  assert.deepEqual(installed.fullscreenRequests, []);
  assert.equal(installed.fullscreenRow.hidden, true, 'no Full screen row when already standalone');
});

test('desktops get no card, no wake lock and no pacing', async () => {
  const { game, frame, locks } = await loadGame(walk);
  assert.equal(game.native.gate.waiting, false);
  game.native.pacer.fitMs = -1;
  for (let i = 0; i < 300; i++) frame();
  await settle();
  assert.equal(locks.requests, 0);
  assert.equal(game.metrics.rate, 60);
});

test('freezing or leaving phone mode releases the wake lock and resets the pacing', async () => {
  const harness = await loadGame(walk, { ...phone, href: 'http://localhost/?debug&nogate' });
  const { game, frame, setPhone } = harness;
  frame();
  await settle();
  assert.equal(game.native.wakeLock.held, true);
  game.freeze = true;
  frame();
  assert.equal(game.native.wakeLock.held, false);
  game.freeze = false;
  frame();
  await settle();
  assert.equal(game.native.wakeLock.held, true);
  game.native.pacer.rate = 30;
  setPhone(false);
  assert.equal(game.native.wakeLock.held, false);
  assert.equal(game.native.pacer.rate, 60);
});

test('leaving phone mode after the pacing dropped to 30 renders at 60 again, with the full cell ceiling', async () => {
  const harness = await loadGame(walk, { ...phone, href: 'http://localhost/?debug&nogate' });
  const { game, frame, setPhone } = harness;
  const pacer = game.native.pacer;
  pacer.fitMs = -1;
  pacer.overMs = -1;
  pacer.refitMs = -2;
  for (let i = 0; i < 60 * (PHONE_PACING.settleAfter + PHONE_PACING.downAfter + PHONE_PACING.cellsAfter) + 120; i++) frame();
  assert.equal(game.native.clock.period, 1000 / 30);
  assert.equal(pacer.cellCeiling, PHONE_PACING.reducedCells);
  setPhone(false);
  assert.equal(game.native.clock.period, 1000 / 60);
  assert.equal(pacer.cellCeiling, CELL_CEILING.mobile);
  frame();
  const before = game.metrics.frames;
  for (let i = 0; i < 60; i++) frame();
  assert.equal(game.metrics.frames - before, 60, 'every display frame is drawn');
  assert.equal(game.metrics.rate, 60);
});

test('a refused wake lock is asked for again on the next tap', async () => {
  const harness = await loadGame(walk, { ...phone, href: 'http://localhost/?debug&nogate' });
  const { game, frame, locks, pointer } = harness;
  await settle();
  game.native.wakeLock.want(false);
  locks.refuse = true;
  frame();
  await settle();
  assert.equal(game.native.wakeLock.held, false);
  locks.refuse = false;
  pointer('pointerup', 0, 'touch');
  await settle();
  assert.equal(game.native.wakeLock.held, true);
});

test('slow phone frames drop the cap to 30, then to fewer cells, through the real loop', async () => {
  const harness = await loadGame(walk, { ...phone, href: 'http://localhost/?debug&nogate' });
  const { game, frame, cellHeight } = harness;
  const pacer = game.native.pacer;
  // The stub clock measures no work, so lower the thresholds below it.
  pacer.fitMs = -1;
  pacer.overMs = -1;
  pacer.refitMs = -2;
  for (let i = 0; i < 330; i++) frame();
  assert.equal(game.metrics.rate, 30);
  const before = game.metrics.frames;
  for (let i = 0; i < 60; i++) frame();
  assert.ok(Math.abs(game.metrics.frames - before - 30) <= 1, 'every other display frame is drawn');
  const cell = cellHeight();
  for (let i = 0; i < 60 * PHONE_PACING.cellsAfter + 30; i++) frame();
  assert.equal(pacer.cellCeiling, PHONE_PACING.reducedCells);
  assert.ok(cellHeight() > cell, 'the reduced ceiling enlarges cells');
  pacer.refitMs = 100;
  pacer.overMs = 100;
  for (let i = 0; i < 60 * PHONE_PACING.upAfter + 60; i++) frame();
  assert.equal(pacer.cellCeiling, CELL_CEILING.mobile);
  assert.ok(Math.abs(cellHeight() - cell) < 1e-9, 'cells come back first');
});

test('a phone GPU late even at the lowest resolution gets the steady 30 through the real loop', async () => {
  const { game, frame } = await loadGame(walk, { ...phone, href: 'http://localhost/?debug&nogate' });
  for (let i = 0; i < 400; i++) frame();
  assert.equal(game.metrics.rate, 60, 'quick work, no GPU trouble');
  game.quality.scale = game.quality.minimum;
  game.quality.sample = () => false;
  game.quality.average = 1;
  for (let i = 0; i < 180; i++) frame();
  assert.equal(game.metrics.rate, 30);
  assert.equal(game.native.pacer.held, true);
  assert.equal(game.native.clock.period, 1000 / 30);
});

test('the Full screen row follows the Fullscreen API and toggles it', async () => {
  const harness = await loadGame(walk, phone);
  const { fullscreenRow, document } = harness;
  assert.equal(fullscreenRow.hidden, false);
  assert.equal(fullscreenRow.textContent, 'Full screen');
  fullscreenRow.dispatchEvent(new Event('click'));
  await settle();
  document.dispatchEvent(new Event('fullscreenchange'));
  assert.equal(fullscreenRow.textContent, 'Leave full screen');
  fullscreenRow.dispatchEvent(new Event('click'));
  await settle();
  document.dispatchEvent(new Event('webkitfullscreenchange'));
  assert.equal(fullscreenRow.textContent, 'Full screen');
  const bare = await loadGame(walk, { ...phone, fullscreen: false, wakeLock: false });
  assert.equal(bare.fullscreenRow.hidden, true);
  bare.tapGate();
  await settle();
  assert.equal(bare.game.native.wakeLock.held, false, 'no Wake Lock API: play still starts');
  assert.equal(bare.game.native.gate.waiting, false);
});
