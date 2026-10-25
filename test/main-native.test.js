import assert from 'node:assert/strict';
import test from 'node:test';
import { CELL_CEILING, PHONE_PACING } from '../src/render/budget.js';
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

test('behind the card every system steps by zero and the sound is paused', async () => {
  const harness = await loadGame(walk, phone);
  const { game, frame, audio, tapGate } = harness;
  const steps = {};
  const spy = (name, object, method = 'update') => {
    const original = object[method];
    object[method] = (dt, ...rest) => {
      (steps[name] ??= []).push(dt);
      return typeof original === 'function' ? original.call(object, dt, ...rest) : [];
    };
  };
  for (const name of ['weather', 'fog', 'fires', 'dust', 'splashes', 'fireflies', 'ambience', 'torches', 'projectiles']) {
    spy(name, game[name]);
  }
  let remote = 0;
  game.remotePlayers.update = () => { remote++; };
  const pausedBefore = audio.paused ?? 0;
  for (let i = 0; i < 300; i++) frame();
  for (const [name, list] of Object.entries(steps)) {
    assert.ok(list.every(dt => dt === 0), `${name} steps by zero`);
  }
  assert.ok(steps.weather.length >= 300 && steps.fires.length >= 300, 'the scene is still drawn');
  assert.equal(steps.projectiles, undefined, 'paused systems are not stepped at all');
  assert.equal(remote, 0, 'friends hold still too');
  assert.ok(audio.paused - pausedBefore >= 300);
  assert.equal(audio.suspends, 1, 'the card suspends the sound when shown');
  tapGate();
  for (const list of Object.values(steps)) list.length = 0;
  frame();
  assert.ok(steps.weather[0] > 0 && steps.fires[0] > 0);
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
