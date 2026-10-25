import assert from 'node:assert/strict';
import test from 'node:test';
import { blockPageGestures, enterFullscreen, fullscreenApi, isStandalone, toggleFullscreen, WakeLock } from '../src/core/native.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

function event(type, target = null) {
  const e = new Event(type, { cancelable: true });
  Object.defineProperty(e, 'target', { value: target });
  return e;
}

test('page pinch gestures and double taps outside text fields are cancelled until disposed', () => {
  const doc = new EventTarget();
  const dispose = blockPageGestures(doc);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    const e = new Event(type, { cancelable: true });
    doc.dispatchEvent(e);
    assert.ok(e.defaultPrevented, type);
  }
  const canvas = { closest: () => null };
  const input = { closest: selector => selector.includes('input') ? input : null };
  const onCanvas = event('dblclick', canvas);
  doc.dispatchEvent(onCanvas);
  assert.ok(onCanvas.defaultPrevented);
  const onInput = event('dblclick', input);
  doc.dispatchEvent(onInput);
  assert.ok(!onInput.defaultPrevented, 'a text field keeps its double tap');
  const bare = new Event('dblclick', { cancelable: true });
  doc.dispatchEvent(bare);
  assert.ok(bare.defaultPrevented, 'a target without closest() is not a text field');
  dispose();
  const after = new Event('gesturestart', { cancelable: true });
  doc.dispatchEvent(after);
  assert.ok(!after.defaultPrevented);
});

test('standalone is the installed display mode or the iOS flag, never mere full screen', () => {
  const win = (modes = [], standalone) => ({ matchMedia: q => ({ matches: modes.includes(q) }), navigator: { standalone } });
  assert.equal(isStandalone(win(['(display-mode: standalone)'])), true);
  assert.equal(isStandalone(win(['(display-mode: fullscreen)'])), false);
  assert.equal(isStandalone(win([], true)), true);
  assert.equal(isStandalone(win()), false);
  assert.equal(isStandalone({}), false);
});

function fullscreenDoc({ prefixed = false, refuse = false } = {}) {
  const doc = { calls: 0, documentElement: {} };
  const key = prefixed ? 'webkitFullscreenElement' : 'fullscreenElement';
  doc[key] = null;
  doc.documentElement[prefixed ? 'webkitRequestFullscreen' : 'requestFullscreen'] = function request(options) {
    doc.calls++;
    doc.options = options;
    if (refuse) return Promise.reject(new Error('denied'));
    doc[key] = this;
    return prefixed ? undefined : Promise.resolve();
  };
  doc[prefixed ? 'webkitExitFullscreen' : 'exitFullscreen'] = () => { doc[key] = null; };
  return doc;
}

test('the Fullscreen API is found plain or prefixed, and absent on iPhone Safari', async () => {
  assert.equal(fullscreenApi({ documentElement: {} }), null);
  assert.equal(fullscreenApi({}), null);
  for (const prefixed of [false, true]) {
    const doc = fullscreenDoc({ prefixed });
    const api = fullscreenApi(doc);
    assert.equal(api.active, false);
    await api.request();
    assert.equal(api.active, true, prefixed ? 'webkit' : 'standard');
    await api.exit();
    assert.equal(api.active, false);
  }
});

test('entering full screen asks once, hides the browser UI and never throws', async () => {
  assert.equal(await enterFullscreen({ documentElement: {} }), false, 'no API');
  const doc = fullscreenDoc();
  assert.equal(await enterFullscreen(doc, doc.documentElement), true);
  assert.deepEqual(doc.options, { navigationUI: 'hide' });
  assert.equal(await enterFullscreen(doc, doc.documentElement), true);
  assert.equal(doc.calls, 1, 'already full screen: no second request');
  const refused = fullscreenDoc({ refuse: true });
  assert.equal(await enterFullscreen(refused, refused.documentElement), false);
});

test('the menu toggle leaves and enters full screen and swallows refusals', async () => {
  assert.equal(await toggleFullscreen({ documentElement: {} }), false);
  const doc = fullscreenDoc();
  assert.equal(await toggleFullscreen(doc), true);
  assert.equal(await toggleFullscreen(doc), false);
  const refused = fullscreenDoc({ refuse: true });
  assert.equal(await toggleFullscreen(refused), false);
});

function lockWorld({ refuse = false, slow = false } = {}) {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const world = { doc, requests: 0, released: 0, sentinels: [], refuse, resolvers: [] };
  world.nav = { wakeLock: { request(type) {
    assert.equal(type, 'screen');
    world.requests++;
    if (world.refuse === 'throw') throw new Error('sync');
    if (world.refuse) return Promise.reject(new Error('NotAllowedError'));
    const sentinel = new EventTarget();
    sentinel.release = () => {
      world.released++;
      sentinel.dispatchEvent(new Event('release'));
      return Promise.resolve();
    };
    world.sentinels.push(sentinel);
    if (slow) return new Promise(resolve => world.resolvers.push(() => resolve(sentinel)));
    return Promise.resolve(sentinel);
  } } };
  world.setHidden = (hidden) => {
    doc.visibilityState = hidden ? 'hidden' : 'visible';
    // The browser releases the lock itself on hide.
    if (hidden) for (const s of world.sentinels) s.dispatchEvent(new Event('release'));
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  return world;
}

test('the wake lock is held while wanted and visible, once, and comes back after a hide', async () => {
  const world = lockWorld();
  const lock = new WakeLock(world);
  assert.equal(lock.supported, true);
  lock.want(true);
  lock.want(true);
  await settle();
  assert.equal(world.requests, 1, 'two wishes make one request');
  assert.equal(lock.held, true);
  world.setHidden(true);
  assert.equal(lock.held, false);
  assert.equal(world.requests, 1, 'never requested while hidden');
  world.setHidden(false);
  await settle();
  assert.equal(world.requests, 2);
  assert.equal(lock.held, true);
  lock.want(false);
  assert.equal(world.released, 1);
  assert.equal(lock.held, false);
  lock.want(false);
  assert.equal(world.released, 1, 'released once');
  lock.dispose();
  world.setHidden(false);
  await settle();
  assert.equal(world.requests, 2, 'disposed: no longer listens');
});

test('a request that resolves after the wish changed is released at once', async () => {
  for (const change of ['hide', 'unwant']) {
    const world = lockWorld({ slow: true });
    const lock = new WakeLock(world);
    lock.want(true);
    if (change === 'hide') world.setHidden(true);
    else lock.want(false);
    world.resolvers.shift()();
    await settle();
    assert.equal(lock.held, false, change);
    assert.equal(world.released, 1, change);
  }
});

test('a sentinel released by the browser is forgotten, but a stale one is ignored', async () => {
  const world = lockWorld();
  const lock = new WakeLock(world);
  lock.want(true);
  await settle();
  const first = world.sentinels[0];
  lock.want(false);
  lock.want(true);
  await settle();
  first.dispatchEvent(new Event('release'));
  assert.equal(lock.held, true, 'an old sentinel does not drop the new one');
  world.sentinels[1].dispatchEvent(new Event('release'));
  assert.equal(lock.held, false);
});

test('a refused request is retried on the next tap, and only once', async () => {
  for (const refuse of [true, 'throw']) {
    const world = lockWorld({ refuse });
    const lock = new WakeLock(world);
    lock.want(true);
    await settle();
    assert.equal(lock.held, false);
    assert.equal(lock.retryOnGesture, true);
    world.refuse = false;
    lock.gesture();
    await settle();
    assert.equal(lock.held, true);
    assert.equal(lock.retryOnGesture, false);
    lock.gesture();
    await settle();
    assert.equal(world.requests, 2, 'no retry needed after success');
  }
});

test('a release that throws or rejects is harmless', async () => {
  const world = lockWorld();
  const lock = new WakeLock(world);
  lock.want(true);
  await settle();
  world.sentinels[0].release = () => { throw new Error('gone'); };
  assert.doesNotThrow(() => lock.want(false));
  lock.want(true);
  await settle();
  world.sentinels[1].release = () => Promise.reject(new Error('gone'));
  assert.doesNotThrow(() => lock.want(false));
  await settle();
});

test('without the Screen Wake Lock API every call is a safe no-op', () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  for (const nav of [{}, undefined]) {
    const lock = new WakeLock({ nav, doc });
    assert.equal(lock.supported, false);
    lock.want(true);
    lock.gesture();
    lock.sync();
    lock.dispose();
    assert.equal(lock.held, false);
  }
});
