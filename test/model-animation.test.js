import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { GRASS } from '../src/world/world.js';

const dataURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const threeURL = new URL('../vendor/three/three.module.min.js', import.meta.url).href;
// Resolve the browser import map in Node, replacing only the GPU renderer.
// The shipped skeleton, clips, retargeting and animation mixer run unchanged.
const modules = new Map([['three', dataURL(`
  export * from ${JSON.stringify(threeURL)};
  export class WebGLRenderer {
    setPixelRatio() {}
    setSize() {}
    setClearColor() {}
  }
`)]]);
function moduleURL(path) {
  const file = new URL(path, import.meta.url);
  const source = readFileSync(file, 'utf8').replace(/from '([^']+)'/g, (_, specifier) => {
    const target = specifier === 'three' ? specifier : new URL(specifier, file).href;
    return `from ${JSON.stringify(modules.get(target) ?? target)}`;
  });
  const url = dataURL(source);
  modules.set(file.href, url);
  return url;
}
moduleURL('../vendor/three/utils/BufferGeometryUtils.js');
const { GLTFLoader } = await import(moduleURL('../vendor/three/loaders/GLTFLoader.js'));
moduleURL('../src/entities/retarget.js');
moduleURL('../src/entities/gear.js');
moduleURL('../src/entities/armory.js');
const { ModelFigure } = await import(moduleURL('../src/entities/model.js'));

async function figure() {
  const bytes = readFileSync(new URL('../assets/ual1.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
  );
  const document = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    return new ModelFigure(gltf);
  } finally {
    if (document === undefined) delete globalThis.document;
    else globalThis.document = document;
  }
}

test('standing jump anticipation restarts after idle and on a later jump', async () => {
  const model = await figure();
  const player = new Player(0, 0);
  const dt = 1 / 60;
  const tick = () => {
    player.update(dt, { isWalkable: () => true, typeAt: () => GRASS }, { x: 0, y: 0 }, false);
    model.update(dt, player);
    player.events.length = 0;
  };
  const action = model.actions.jumpStart;
  for (let jump = 0; jump < 2; jump++) {
    // Long enough to finish the previous jump and exhaust unused one-shot clips.
    for (let frame = 0; frame < 180; frame++) tick();
    assert.equal(player.air, 0);
    player.jump();
    tick();
    assert.equal(action.paused, false, `jump ${jump + 1} must resume anticipation`);
    assert.ok(Math.abs(action.time - dt) < 1e-6, 'anticipation starts at the beginning');
    assert.ok(action.getEffectiveWeight() > 0, 'anticipation contributes to the pose');
    const before = action.time;
    tick();
    assert.ok(Math.abs(action.time - before - dt) < 1e-6, 'anticipation advances without resetting every frame');
  }
});

test('respawning clears the fatal jump and sword animation before the next draw', async () => {
  const model = await figure();
  const player = new Player(240, 160);
  player.jumpKind = 'leap';
  player.air = 0.4;
  player.flight = 0.5;
  player.jumpT = 0.2;
  player.attack();
  model.update(0.2, player);
  assert.ok(model.jump);
  assert.ok(model.oneShot);
  assert.ok(model.weights.attack > 0);

  const respawned = new Player(0, 0);
  model.resetPose(respawned);
  assert.equal(model.jump, null);
  assert.equal(model.oneShot, null);
  assert.equal(model.lastMove, null);
  assert.equal(model.armory.held, null);
  assert.equal(model.model.position.y, 0);
  assert.equal(model.model.rotation.y, 0);
  assert.deepEqual(respawned.events, [], 'a teleport must not emit a landing or footfall');
  for (const [key, action] of Object.entries(model.actions)) {
    assert.equal(action.getEffectiveWeight(), key === 'idle' ? 1 : 0, key);
  }
  model.update(1 / 60, respawned);
  assert.equal(model.jump, null);
  assert.equal(model.oneShot, null, 'no deferred landing is played at spawn');
});

test('the 3D character keeps its clothes on and shows an equipped buckler', async () => {
  const model = await figure();
  const player = new Player(0, 0);
  const equipment = { helm: { id: 'outlawHood', count: 1 }, chest: { id: 'leatherJerkin', count: 1 },
    legs: { id: 'ridingBoots', count: 1 }, hands: { id: 'leatherBracers', count: 1 },
    cape: { id: 'travelCloak', count: 1 }, mainHand: { id: 'shortSword', count: 1 }, offHand: null };
  player.equipment = equipment;
  const step = () => model.update(1 / 60, player);
  const colors = () => model.gear.painted.map(({ mesh }) => [...mesh.geometry.attributes.color.array]);
  step();
  assert.equal(model.gear.hood.visible, true);
  assert.equal(model.gear.hair.visible, false);
  assert.equal(model.gear.cloak.visible, true);
  assert.equal(model.gear.buckler.visible, false);
  const dressed = colors();
  assert.ok(dressed.length > 0 && dressed.every((c) => c.some((v) => v > 0)), 'the body is painted');

  player.equipment = { ...equipment, helm: null, cape: null, chest: null, offHand: { id: 'woodenBuckler', count: 1 } };
  step();
  assert.equal(model.gear.hood.visible, true);
  assert.equal(model.gear.hair.visible, false);
  assert.equal(model.gear.cloak.visible, true);
  assert.equal(model.gear.buckler.visible, true);
  assert.deepEqual(colors(), dressed, 'the clothes are part of the character for now');

  player.equipment = equipment;
  step();
  assert.deepEqual(colors(), dressed, 'putting everything back restores the same look');
});

test('weapons ride in the hand when drawn and on the back or hip when put away', async () => {
  const model = await figure();
  const player = new Player(0, 0);
  player.equipment = { mainHand: { id: 'spear', count: 1 } };
  model.update(1 / 60, player);
  assert.equal(model.armory.held, null, 'a sheathed spear is not in hand');
  assert.equal(model.armory.active.parent, model.armory.back);
  player.combat.inHand = true;
  model.update(1 / 60, player);
  assert.equal(model.armory.held, model.armory.active);
  assert.ok(model.swordLine(), 'a drawn spear leaves a trail');
  player.equipment = { mainHand: { id: 'dagger', count: 1 } };
  player.combat.inHand = false;
  model.update(1 / 60, player);
  assert.equal(model.armory.active.parent, model.armory.hip);
  player.equipment = { mainHand: null };
  model.update(1 / 60, player);
  assert.equal(model.armory.active, null);
});
function fixture(buffered = false) {
  const calls = [];
  const gl = { RGBA: 1, UNSIGNED_BYTE: 2,
    flush() { calls.push('flush'); },
    readPixels(x, y, width, height, format, type, pixels) {
      calls.push('read');
      // One fully covered source cell, including the bottom-up row order.
      pixels.fill(0);
      for (let y = 0; y < 6; y++) for (let x = 0; x < 4; x++) {
        pixels.set([100, 140, 180, 255], ((height - y - 1) * width + x) * 4);
      }
    } };
  if (buffered) {
    const read = gl.readPixels;
    gl.createBuffer = () => ({});
    gl.isBuffer = value => Boolean(value);
    gl.bindBuffer = () => {};
    gl.bufferData = () => calls.push('allocate');
    gl.readPixels = () => calls.push('queue');
    gl.getBufferSubData = (target, offset, pixels) => read(0, 0, 144, 312, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  }
  const model = Object.assign(Object.create(ModelFigure.prototype), {
    pixels: new Uint8Array(36 * 4 * 52 * 6 * 4), waterDepth: 0,
    waterClipping: [{}], scene: {},
    camera: { updateProjectionMatrix() {} },
    renderer: { render() { calls.push('render'); }, getContext() { return gl; } },
  });
  return { model, calls };
}

test('early GPU submission and immediate rasterisation produce identical cells without a second render', () => {
  const { model, calls } = fixture();
  const view = { x0: -20, y0: -60 };
  const direct = structuredClone(model.rasterise(view, 1.25, -2.75));
  assert.equal(direct.length, 1);
  assert.deepEqual(calls, ['render', 'flush', 'read']);
  calls.length = 0;
  model.renderPose(1.25, -2.75);
  assert.deepEqual(calls, ['render', 'flush']);
  assert.deepEqual(model.rasterise(view, 1.25, -2.75), direct);
  assert.deepEqual(calls, ['render', 'flush', 'read']);
  assert.equal(model.posePending, false);
  model.rasterise(view, 1.25, -2.75);
  assert.deepEqual(calls.slice(3), ['render', 'flush', 'read'], 'a consumed pose cannot become a stale frame');
});

test('moving after early submission renders the current position and preserves water clipping', () => {
  const { model, calls } = fixture();
  model.waterDepth = 0.2;
  model.renderPose(1.2, 3.4);
  assert.equal(model.renderer.clippingPlanes, model.waterClipping);
  const cells = model.rasterise({ x0: -20, y0: -60 }, 2.2, 4.4);
  assert.equal(cells.length, 1);
  assert.deepEqual(calls, ['render', 'flush', 'render', 'flush', 'read']);
  assert.equal(model.renderedX, 2.2);
  assert.equal(model.renderedY, 4.4);
  model.waterDepth = 0;
  model.renderPose(2.2, 4.4);
  assert.deepEqual(model.renderer.clippingPlanes, []);
});

test('pixel-buffer readback queues the copy before CPU work, reuses its storage and preserves all cells', () => {
  const direct = fixture();
  const buffered = fixture(true);
  const view = { x0: -20, y0: -60 };
  const expected = direct.model.rasterise(view, 1.25, -2.75);
  buffered.model.renderPose(1.25, -2.75);
  assert.deepEqual(buffered.calls, ['render', 'allocate', 'queue', 'flush']);
  assert.deepEqual(buffered.model.rasterise(view, 1.25, -2.75), expected);
  buffered.calls.length = 0;
  buffered.model.renderPose(1.25, -2.75);
  buffered.model.rasterise(view, 1.25, -2.75);
  assert.deepEqual(buffered.calls, ['render', 'queue', 'flush', 'read']);
});
