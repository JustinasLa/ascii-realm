import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { GRASS } from '../src/world/world.js';
import { SCALE, TILT } from '../src/entities/rig.js';
import { ASPECT } from '../src/world/world.js';
import { pitchLook } from '../src/world/camera.js';
import { Vector3 } from '../vendor/three/three.module.min.js';
import { runeScene } from '../test-support/spells.js';
import fireRain from '../src/spells/definitions/fire-rain.js';

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
moduleURL('../vendor/three/utils/SkeletonUtils.js');
const { GLTFLoader } = await import(moduleURL('../vendor/three/loaders/GLTFLoader.js'));
moduleURL('../src/entities/retarget.js');
moduleURL('../src/entities/gear.js');
moduleURL('../src/entities/armory.js');
const { ModelFigure } = await import(moduleURL('../src/entities/model.js'));

async function library() {
  const bytes = readFileSync(new URL('../assets/ual1.glb', import.meta.url));
  return new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
  );
}

async function figure(gltf) {
  gltf ??= await library();
  const document = globalThis.document;
  globalThis.document = { createElement: () => ({}) };
  try {
    return new ModelFigure(gltf);
  } finally {
    if (document === undefined) delete globalThis.document;
    else globalThis.document = document;
  }
}

test('figures sharing a library keep their skeletons, clothes and animation tracks independent', async () => {
  const gltf = await library();
  const source = gltf.animations.find((clip) => clip.name === 'Jog_Fwd_Loop');
  const tracks = source.tracks.map((track) => Array.from(track.values));
  const sourceMesh = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
  const sourceColors = sourceMesh.geometry.getAttribute('color');
  const first = await figure(gltf);
  const firstJog = first.actions.jog.getClip();
  const shortened = firstJog.tracks.map((track) => Array.from(track.values));
  const second = await figure(gltf);

  assert.equal(first.model.parent, first.scene, 'a second figure does not steal the first model');
  assert.equal(second.model.parent, second.scene);
  assert.notEqual(first.model, gltf.scene);
  assert.notEqual(first.feet[0], second.feet[0]);
  assert.notEqual(firstJog, second.actions.jog.getClip());
  assert.deepEqual(source.tracks.map((track) => Array.from(track.values)), tracks,
    'monster clips retain the unmodified library gait');
  assert.deepEqual(firstJog.tracks.map((track) => Array.from(track.values)), shortened,
    'creating another figure does not shorten the first stride again');
  assert.deepEqual(second.actions.jog.getClip().tracks.map((track) => Array.from(track.values)), shortened);
  assert.equal(sourceMesh.geometry.getAttribute('color'), sourceColors, 'gear does not repaint source geometry');
  const firstMesh = first.model.getObjectByProperty('isSkinnedMesh', true);
  const secondMesh = second.model.getObjectByProperty('isSkinnedMesh', true);
  assert.notEqual(firstMesh.geometry, sourceMesh.geometry);
  assert.notEqual(firstMesh.geometry, secondMesh.geometry);
  const before = second.feet[0].quaternion.clone();
  first.update(1 / 60, new Player(0, 0));
  assert.ok(second.feet[0].quaternion.equals(before), 'animating one figure leaves the other untouched');
});

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
  // In the air the swing is laid over the jump from the waist up.
  assert.ok(model.layer.attack > 0);

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
  assert.deepEqual(model.layer, { attack: 0, attackB: 0 });
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
  // The stone pickaxe has its own arched head, not the short sword's blade.
  player.equipment = { mainHand: { id: 'stonePickaxe', count: 1 } };
  model.update(1 / 60, player);
  assert.equal(model.armory.held, model.armory.active);
  assert.equal(model.armory.active.children.length, 4, 'haft, pick, peen and collar');
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

test('Fire Rain keeps the whole jumping skeleton inside the render window through landing', async () => {
  const model = await figure();
  model.renderer = fixture().model.renderer;
  const { player, cast } = runeScene(fireRain);
  assert.equal(cast().ok, true);
  let peak = 0;
  for (let frame = 0; frame < 150; frame++) {
    player.updateJump(1 / 60);
    model.update(1 / 60, player);
    model.renderPose(100.25, 100.75);
    model.camera.updateMatrixWorld(true);
    peak = Math.max(peak, player.air);
    for (const joint of Object.values(model.bones)) {
      const point = joint.getWorldPosition(new Vector3()).project(model.camera);
      assert.ok(point.y > -1 && point.y < 1, `${joint.name} clipped at height ${player.air}`);
    }
    const cells = model.rasterise({ x0: 10, y0: 20 }, 100.25, 100.75);
    // The synthetic source cell is at the top of the image: map it back
    // through the camera to check raster placement and fractional alignment.
    const top = 100.75 - model.camera.top * SCALE;
    assert.ok(Math.abs(cells[0].sy - (top - 20)) < 1e-9);
    assert.equal(model.base, 80, 'depth sorting stays anchored to the ground');
  }
  assert.ok(peak > 5, 'exercise the full Fire Rain launch');
  assert.equal(player.air, 0);
});

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

// Steps the player and the 3D character together, `move` being the keys held.
function stepper(model, player, move = { x: 0, y: 0 }) {
  const world = { isWalkable: () => true, typeAt: () => GRASS };
  return (frames = 1, dt = 1 / 60) => {
    for (let i = 0; i < frames; i++) {
      player.update(dt, world, move, false);
      model.update(dt, player);
      player.events.length = 0;
    }
  };
}

test('a swing on the move is laid over the stride, so the legs keep walking', async () => {
  const model = await figure();
  const player = new Player(0, 0);
  player.combat.inHand = true;
  const step = stepper(model, player, { x: 1, y: 0 });
  step(60);
  const phase = model.phase;
  player.attack();
  step(12);
  assert.ok(model.weights.walk > 0.9, 'the walk still drives the legs');
  assert.ok(model.weights.attack < 0.05, 'the swing does not take the whole body');
  assert.ok(model.layer.attack > 0.8, 'the swing takes the body from the waist up');
  assert.notEqual(model.phase, phase, 'the stride carries on');

  // Standing still, the same swing takes the whole body.
  const still = await figure();
  const idle = new Player(0, 0);
  idle.combat.inHand = true;
  const wait = stepper(still, idle);
  wait(30);
  idle.attack();
  wait(12);
  assert.ok(still.weights.attack > 0.8);
  assert.ok(still.layer.attack < 0.05);
});

test('spam-clicked swings each show their cut and fade into one another', async () => {
  const model = await figure();
  const player = new Player(0, 0);
  player.combat.inHand = true;
  const step = stepper(model, player);
  step(30);
  const cuts = [];
  for (let frame = 0; frame < 150; frame++) {
    if (frame % 3 === 0) player.attack();
    const cb = player.combat;
    const slot = model.oneShot?.key;
    step();
    // Whenever the blade is cutting, the clip shows the cut, and gets
    // through it before the next swing takes over.
    if (cb.trailing && model.oneShot?.swing === cb.move) {
      const at = model.actions[model.oneShot.key].time;
      assert.ok(at <= 0.53, `cut shown at ${at.toFixed(2)}s into the clip`);
      if (cuts.at(-1)?.key !== model.oneShot.key) cuts.push({ key: model.oneShot.key, move: cb.move, at });
      cuts.at(-1).at = at;
    }
    // A new swing starts in the other slot, leaving the last one to fade.
    if (model.oneShot?.key && slot && model.oneShot.key !== slot) {
      assert.ok(model.weights[slot] + model.layer[slot] > 0.3, 'the last swing is still fading out');
      assert.ok(model.actions[slot].time > 0.3, 'the last swing is not snapped back to its start');
    }
  }
  const shown = cuts.map((c) => c.move);
  for (const c of cuts.slice(0, -1)) assert.ok(c.at > 0.45, `${c.move} cut through to ${c.at.toFixed(2)}s`);
  assert.ok(shown.length >= 4, `every swing shows a cut (${shown.join(' ')})`);
});

test('walking away from where the swing is aimed steps backwards, and sideways strafes', async () => {
  const model = await figure();
  const player = new Player(0, 0);
  player.combat.inHand = true;
  const step = stepper(model, player, { x: 1, y: 0 });
  step(60);
  // Aim behind: the chest turns round, the legs step backwards.
  player.attack(-Math.PI / 2);
  step(4);
  assert.ok(model.backpedal);
  const before = model.phase;
  step(2);
  const back = ((before - model.phase) % 1 + 1) % 1;
  assert.ok(back > 0 && back < 0.5, 'the stride runs backwards');
  const legs = player.heading + model.legYaw;
  assert.ok(Math.abs(Math.atan2(Math.sin(legs + Math.PI / 2), Math.cos(legs + Math.PI / 2))) < 0.2,
    'the legs face the way the chest does');

  // Aim across the way of travel: the legs face the way they walk.
  const side = await figure();
  const strafer = new Player(0, 0);
  strafer.combat.inHand = true;
  const strafe = stepper(side, strafer, { x: 0, y: 1 });
  strafe(60);
  strafer.attack(Math.PI / 2);
  strafe(12);
  assert.equal(side.backpedal, false);
  const going = strafer.heading + side.legYaw;
  assert.ok(Math.abs(Math.atan2(Math.sin(going), Math.cos(going))) < 0.2, 'the legs face down the screen');
  assert.ok(Math.abs(strafer.heading - Math.PI / 2) < 0.05, 'the chest still faces the aim');

  // Once the swing is over the legs come round under the body again.
  strafe(240);
  assert.ok(Math.abs(side.legYaw) < 0.05);
});

test('a plunge plays its cut through the landing', async () => {
  const model = await figure();
  const player = new Player(0, 0);
  player.combat.inHand = true;
  const step = stepper(model, player);
  step(30);
  player.jump();
  step(10);
  assert.ok(player.air > 0);
  player.attack();
  for (let i = 0; i < 120 && player.air > 0; i++) step();
  step(6);
  assert.ok(model.oneShot?.swing === 'plunge', 'the landing does not replace the plunge');
  assert.ok(model.actions[model.oneShot.key].time > 0.4);
});

test('at the usual pitch the model draws height and depth as it always has', async () => {
  const model = await figure();
  model.renderer = fixture().model.renderer;
  const cos = Math.sqrt(1 - TILT * TILT);
  const v = new Vector3(0.3, 1.1, -0.4);
  assert.deepEqual(model.toScreen(v), [(v.x * SCALE) / ASPECT, (-v.y * cos + v.z * TILT) * SCALE]);
  model.update(0, { ...new Player(0, 0), air: 0.5 });
  assert.equal(model.renderLift, 0.5 * cos * SCALE);
  const pose = model.torchPose();
  const hand = model.torchArm.hand.getWorldPosition(new Vector3());
  assert.equal(pose.h, hand.y * SCALE * cos);
  model.renderPose(10.5, 20.5);
  assert.ok(Math.abs((model.camera.top - model.camera.bottom) * SCALE - 52) < 1e-9);
});

test('a pitched camera views the model from that angle, with ground depth unchanged', async () => {
  const model = await figure();
  model.renderer = fixture().model.renderer;
  const look = pitchLook(45);
  model.posePending = true;
  model.setLook(look);
  assert.equal(model.posePending, false, 'a pose from the old angle is not read back');
  const dir = model.camera.position.clone().normalize();
  assert.ok(Math.abs(dir.y - look.sin) < 1e-9 && Math.abs(dir.z - look.cos) < 1e-9);
  assert.ok(Math.abs(model.toScreen(new Vector3(0, 1, 0))[1] + SCALE * TILT) < 1e-9, 'a metre up rises 6.5 rows');
  assert.ok(Math.abs(model.toScreen(new Vector3(0, 0, 1))[1] - SCALE * TILT) < 1e-9, 'a metre nearer drops 6.5 rows');
  model.update(0, { ...new Player(0, 0), air: 0.5 });
  assert.ok(Math.abs(model.renderLift - 0.5 * look.rise) < 1e-9);
  assert.ok(Math.abs(model.torchPose().h - model.torchArm.hand.getWorldPosition(new Vector3()).y * look.rise) < 1e-9);
  // The real camera's image lands where toScreen says, row for row.
  model.renderPose(10.5, 20.5);
  model.camera.updateMatrixWorld(true);
  for (const p of [new Vector3(0, 1.2, 0), new Vector3(0.2, 0.4, 0.7), new Vector3(0, 0, -0.5)]) {
    const ndc = p.clone().project(model.camera);
    const row = -(model.camera.bottom + (ndc.y + 1) / 2 * (model.camera.top - model.camera.bottom)) * look.rowsPerUnit;
    assert.ok(Math.abs(row - model.toScreen(p)[1]) < 1e-6, `${p.toArray()} row ${row}`);
  }
});

for (const deg of [25, 45]) test(`at ${deg}° Fire Rain's raised arms stay inside the render window`, async () => {
  const model = await figure();
  model.renderer = fixture().model.renderer;
  model.setLook(pitchLook(deg));
  const { player, cast } = runeScene(fireRain);
  assert.equal(cast().ok, true);
  for (let frame = 0; frame < 150; frame++) {
    player.updateJump(1 / 60);
    model.update(1 / 60, player);
    model.renderPose(100.25, 100.75);
    model.camera.updateMatrixWorld(true);
    for (const joint of Object.values(model.bones)) {
      const point = joint.getWorldPosition(new Vector3()).project(model.camera);
      assert.ok(point.y > -1 && point.y < 0.98, `${joint.name} at ${point.y}, height ${player.air}`);
    }
  }
});
