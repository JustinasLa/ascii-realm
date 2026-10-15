import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SKELETON, Skeleton, Skeletons, toCells } from '../src/entities/skeleton.js';
import { GRASS } from '../src/world/world.js';

const dataURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const threeURL = new URL('../vendor/three/three.module.min.js', import.meta.url).href;
// Resolve the browser import map in Node, replacing only the GPU renderer
// (see model-animation.test.js).
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
moduleURL('../src/entities/model.js');
const { SkeletonFigures } = await import(moduleURL('../src/entities/skeleton-figure.js'));

const bytes = readFileSync(new URL('../assets/ual1.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const figures = () => new SkeletonFigures(gltf, { renderer: {
  setPixelRatio() {}, setSize() {}, setClearColor() {},
} });
const open = { isWalkable: () => true, typeAt: () => GRASS };
const dt = 1 / 60;

test('the skeleton is bones on the armature, not the mannequin skin', () => {
  const f = figures();
  const s = new Skeleton(0, 0, { risen: true });
  f.update(dt, [s]);
  const rig = f.rigs.get(s);
  let skinned = 0;
  let bones = 0;
  rig.model.traverse((o) => {
    if (o.isSkinnedMesh) skinned++;
    if (o.isMesh) bones++;
  });
  assert.equal(skinned, 0);
  assert.ok(bones > 30, `${bones} bone meshes`);
  // The player's model still has its own skin.
  let skin = 0;
  gltf.scene.traverse((o) => { if (o.isSkinnedMesh) skin++; });
  assert.ok(skin > 0);
});

test('a skeleton stands upright, runs on its feet, and falls over when killed', () => {
  const f = figures();
  const skeletons = new Skeletons({ firstAfter: Infinity });
  const s = new Skeleton(0, 0, { risen: true });
  skeletons.list.push(s);
  const player = { x: toCells(12, 0)[0], y: 0, air: 0, heading: -Math.PI / 2, runSpeed: 5, feel: { reach: 0.95 } };
  for (let t = 0; t < 0.5; t += dt) f.update(dt, skeletons.list);
  const rig = f.rigs.get(s);
  const standing = rig.headHeight();
  assert.ok(standing > 1.3, `head at ${standing} m`);
  // Running at the player, it stays on its feet.
  for (let t = 0; t < 1.5; t += dt) {
    skeletons.update(dt, open, player);
    f.update(dt, skeletons.list);
  }
  assert.equal(s.state, 'chase');
  assert.ok(rig.weights.run > 0.5, 'running');
  assert.ok(rig.headHeight() > 1.1);
  // Cut down, it collapses to the ground.
  [player.x, player.y] = [s.x + toCells(1, 0)[0], s.y];
  skeletons.strike({ type: 'strike', swing: 'spin' }, player, 1000);
  assert.equal(s.state, 'dead');
  for (let t = 0; t < 3; t += dt) {
    skeletons.update(dt, open, player);
    f.update(dt, skeletons.list);
  }
  assert.ok(rig.headHeight() < 0.5, `head at ${rig.headHeight()} m after falling`);
});

test('a skeleton climbs up from the ground as it rises', () => {
  const f = figures();
  const s = new Skeleton(0, 0);
  f.update(dt, [s]);
  const rig = f.rigs.get(s);
  assert.ok(rig.headHeight() < 0.5, `starts at ${rig.headHeight()} m`);
  for (let t = 0; t < SKELETON.rise + 0.5; t += dt) {
    s.update(dt, open, null);
    f.update(dt, [s]);
  }
  assert.ok(rig.headHeight() > 1.3, `ends at ${rig.headHeight()} m`);
});

test('rigs of removed skeletons are reused', () => {
  const f = figures();
  const a = new Skeleton(0, 0, { risen: true });
  f.update(dt, [a]);
  const rig = f.rigs.get(a);
  f.update(dt, []);
  assert.equal(f.rigs.size, 0);
  const b = new Skeleton(5, 5, { risen: true });
  f.update(dt, [b]);
  assert.equal(f.rigs.get(b), rig);
  assert.equal(f.scene.children.filter((c) => c === rig.model).length, 1);
});

test('read-back pixels become cells: outline at the edges, glyphs inside, glowing eyes', () => {
  const f = figures();
  const s = new Skeleton(10.5, 20.5, { risen: true });
  // Paint slot 0: a solid bone-white block and a lone ember-red cell.
  const fill = (cx, cy, rgb, cover = 1) => {
    for (let j = 0; j < 6; j++) {
      const row = f.height - 1 - (cy * 6 + j);
      for (let i = 0; i < 4; i++) {
        if ((j * 4 + i) / 24 >= cover) continue;
        f.pixels.set([...rgb, 255], (row * f.width + cx * 4 + i) * 4);
      }
    }
  };
  for (let cy = 10; cy < 14; cy++) for (let cx = 30; cx < 33; cx++) fill(cx, cy, [210, 205, 180]);
  fill(31, 8, [255, 90, 30]);
  fill(29, 10, [210, 205, 180], 0.5);
  const view = { x0: 0, y0: 0 };
  const { cells, top } = f.cellsOf(0, s, view, 0);
  assert.equal(cells.length, 3 * 4 + 2);
  const at = (cx, cy) => cells.find((c) => c.sx === Math.floor(s.x) - 32 + cx && c.sy === Math.floor(s.y) - 30 + cy);
  assert.ok(at(31, 11).g !== at(29, 10).g, 'an edge is drawn differently from the solid bone');
  const eye = at(31, 8);
  assert.ok(eye.r > 200 && eye.gg < 140, 'the eye keeps its ember colour');
  assert.equal(top, Math.floor(s.y) - 30 + 8);
  // A fresh cut flashes the bones.
  const flashed = f.cellsOf(0, s, view, 1);
  assert.ok(flashed.cells[0].gg >= cells[0].gg);
});
