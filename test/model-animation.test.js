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
