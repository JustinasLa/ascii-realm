import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// The browser import map, in Node: `three` is the vendored build. The
// player model's outline picker is stood in for (an edge glyph from the
// cover), so the model's loaders stay out of this test.
const threeURL = new URL('../vendor/three/three.module.min.js', import.meta.url).href;
const outlineURL = `data:text/javascript,${encodeURIComponent("export const outline = (mx, my, cover) => ({ g: my > 0 ? 63 : 92, rim: cover });")}`;
registerHooks({ resolve: (specifier, context, next) => {
  if (specifier === 'three') return { url: threeURL, shortCircuit: true };
  if (specifier === '../entities/model.js' && context.parentURL?.endsWith('/src/ui/item-studio.js')) return { url: outlineURL, shortCircuit: true };
  return next(specifier, context);
} });
const THREE = await import('three');
const { outline } = await import(outlineURL);
const { WEAPONS, WEAPON_MATERIALS } = await import('../src/entities/weapons.js');
const { ITEMS } = await import('../src/inventory/items.js');
const { BARK_RAMP } = await import('../src/world/tree-chars.js');
const { GLYPHS } = await import('../src/render/glyphs.js');
const { ITEM_MODELS, PAINTS, WEAPON_PAINTS } = await import('../src/ui/item-models.js');
const { GRIDS, SX, SY, poseAngle } = await import('../src/ui/item-shading.js');
const { ItemStudio, buildModel, fit, glyphChars, itemStudio, paintFor, posed } = await import('../src/ui/item-studio.js');

const meshesOf = (group) => {
  const meshes = [];
  group.traverse((node) => node.isMesh && meshes.push(node));
  return meshes;
};

test('the trees\' bark ramp comes out as the letters the trees draw', () => {
  const chars = glyphChars(BARK_RAMP);
  assert.deepEqual(chars.map((level) => level.join('')), ['.:', ':-', 'rcz', 'vuxs', 'aeno', 'hdbpqk', 'QD0%8', '$&#H', '@MWB']);
  assert.equal(GLYPHS[BARK_RAMP[0][0]], '.');
});

test('every weapon item but the javelin has a model, and every material its parts name has a paint', () => {
  for (const [id, recipe] of Object.entries(ITEM_MODELS)) {
    assert.ok(ITEMS[id], id);
    assert.equal(recipe.from, 'weapon');
    assert.ok(WEAPONS[ITEMS[id].weapon].spriteParts.length, id);
  }
  // The javelin's picture comes with the next items.
  for (const item of Object.values(ITEMS)) if (item.weapon) assert.equal(!!ITEM_MODELS[item.id], item.id !== 'javelin', item.id);
  for (const weapon of Object.values(WEAPONS)) {
    for (const part of weapon.spriteParts) assert.ok(PAINTS[WEAPON_PAINTS[part.material]], `${weapon.id} ${part.material}`);
  }
  for (const [name, paint] of Object.entries(PAINTS)) {
    const ramp = typeof paint.ramp === 'string' ? glyphChars(BARK_RAMP) : paint.ramp;
    if (!paint.edge) assert.ok(ramp.length >= 4 && ramp.length <= 9, `${name} has 4-9 levels`);
    assert.ok(ramp.flat().every((ch) => /^[\x21-\x7e]$/.test(ch)), `${name} is printable ASCII`);
    assert.equal(paint.colour.length, 3);
  }
  assert.ok(Object.keys(PAINTS).length <= 31, 'paint ids fit the red channel');
});

test('every weapon builds into a small, finite model', () => {
  for (const id of Object.keys(ITEM_MODELS)) {
    const model = buildModel(THREE, { item: ITEMS[id], tint: null });
    const meshes = meshesOf(model);
    assert.ok(meshes.length > 0 && meshes.length <= 40, id);
    const triangles = meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
    assert.ok(triangles <= 20000, id);
    for (const m of meshes) assert.ok(m.geometry.attributes.position.array.every(Number.isFinite), id);
    const box = new THREE.Box3().setFromObject(model);
    assert.ok(!box.isEmpty() && Number.isFinite(box.max.y - box.min.y), id);
  }
});

test('the metal tint colours only the blade and head, and stone tools are stone', () => {
  const colours = (id, tint) => meshesOf(buildModel(THREE, { item: ITEMS[id], tint })).map((m) => m.userData);
  const steel = colours('shortSword', WEAPON_MATERIALS.steel.color);
  const plain = colours('shortSword', null);
  steel.forEach((part, i) => {
    if (PAINTS[part.paint].tinted) assert.deepEqual(part.colour, WEAPON_MATERIALS.steel.color.map((c) => c * PAINTS[part.paint].tinted));
    else assert.deepEqual(part.colour, plain[i].colour, `${part.paint} keeps its colour`);
  });
  assert.ok(steel.some((p) => p.paint === 'metal') && steel.some((p) => p.paint === 'leather') && steel.some((p) => p.paint === 'trim'));
  const red = colours('shortSword', [170, 51, 34]);
  assert.deepEqual(red.find((p) => p.paint === 'metal').colour, [170, 51, 34]);
  const pick = colours('stonePickaxe', WEAPON_MATERIALS.stone.color);
  assert.ok(pick.some((p) => p.paint === 'stone'), 'the pick head is stone');
  assert.ok(!pick.some((p) => p.paint === 'metal'));
  assert.deepEqual(paintFor('darkMetal', [100, 100, 100]).colour, [40, 40, 40]);
  assert.deepEqual(paintFor('wood', [100, 100, 100]), { name: 'wood', colour: PAINTS.wood.colour });
  const material = meshesOf(buildModel(THREE, { item: ITEMS.shortSword, tint: [255, 0, 0] }))[0].material;
  const { r, g } = material.color.getRGB(new THREE.Color(), THREE.SRGBColorSpace);
  assert.ok(r > 0.999 && g === 0, 'colours are sRGB');
});

test('long weapons lie on the box diagonal and fill it', () => {
  for (const id of ['shortSword', 'spear', 'quarterstaff']) {
    for (const shape of ['card', '2x4']) {
      const grid = GRIDS[shape];
      const model = buildModel(THREE, { item: ITEMS[id], tint: null });
      const outer = posed(THREE, model, grid);
      const axis = new THREE.Vector3(0, 1, 0).transformDirection(model.matrixWorld);
      assert.ok(Math.abs(Math.atan2(axis.y, axis.x) - poseAngle(grid)) < (5 * Math.PI) / 180, `${id} ${shape}`);
      const camera = new THREE.OrthographicCamera();
      fit(THREE, camera, outer, grid);
      const box = new THREE.Box3().setFromObject(outer);
      const width = camera.right - camera.left;
      const height = camera.top - camera.bottom;
      assert.ok(Math.abs(width / height - (grid.cols * 0.6) / grid.rows) < 1e-9, 'cells are undistorted');
      assert.ok(box.min.x >= camera.left && box.max.x <= camera.right && box.min.y >= camera.bottom && box.max.y <= camera.top);
      const fill = Math.max((box.max.x - box.min.x) / width, (box.max.y - box.min.y) / height);
      assert.ok(Math.abs(fill - 0.9) < 1e-6, `${id} fills 90%`);
      assert.ok(camera.position.z > box.max.z && camera.position.z - camera.far < box.min.z);
    }
  }
});

// A stand-in for the WebGL renderer: what it read back is a lit picture
// (the whole frame covered in grey) and then the paint ids (all metal).
function fakeRenderer() {
  const made = [];
  const factory = () => {
    const canvas = new EventTarget();
    let pass = 0;
    const renderer = {
      domElement: canvas, sizes: [], lost: 0, disposed: 0,
      setClearColor() {},
      setSize(w, h) { this.sizes.push([w, h]); },
      render(scene, camera) { this.scene = scene; this.camera = camera; },
      getContext: () => ({
        RGBA: 1, UNSIGNED_BYTE: 2,
        readPixels(x, y, w, h, format, type, pixels) {
          // The left half and one sample column more is covered.
          for (let o = 0; o < pixels.length; o += 4) {
            const covered = (o / 4) % w <= w / 2 ? 255 : 0;
            pixels.set(pass % 2 ? [12, 0, 0, covered] : [240, 240, 240, covered], o);
          }
          pass++;
        },
      }),
      forceContextLoss() { this.lost++; },
      dispose() { this.disposed++; },
    };
    made.push(renderer);
    return renderer;
  };
  return { made, factory };
}

function fakeCanvas(t) {
  const canvases = [];
  const previous = globalThis.document;
  globalThis.document = {
    createElement: () => {
      const texts = [];
      const canvas = {
        width: 0, height: 0, texts,
        getContext: () => ({ fillRect() {}, fillText: (ch) => texts.push(ch) }),
        toDataURL: () => `data:image/png;base64,${canvases.indexOf(canvas)}:${canvas.width}x${canvas.height}:${texts.length}`,
      };
      canvases.push(canvas);
      return canvas;
    },
  };
  t.after(() => { globalThis.document = previous; });
  return canvases;
}

// A stand-in for the browser's animation frames: `paint()` runs the
// callbacks asked for since the last one.
function fakeFrames(t) {
  let waiting = [];
  globalThis.requestAnimationFrame = (callback) => waiting.push(callback);
  t.after(() => { delete globalThis.requestAnimationFrame; });
  return () => {
    const due = waiting;
    waiting = [];
    for (const callback of due) callback();
  };
}

const lib = async () => ({ THREE, outline });
const sword = { id: 'shortSword', count: 1, material: 'steel' };

test('pictures are made a couple a frame once three.js loads, kept, and the renderer let go when idle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const canvases = fakeCanvas(t);
  const paint = fakeFrames(t);
  const { made, factory } = fakeRenderer();
  const studio = new ItemStudio({ webgl: true, load: lib, renderer: factory, ratio: () => 3, now: () => 0 });
  assert.equal(studio.art({ id: 'oakLog', count: 1 }, ITEMS.oakLog, null, 'card'), null, 'no model yet: the outline');
  assert.equal(studio.pump(), false, 'nothing to make');
  for (const id of ['shortSword', 'spear', 'longbow']) assert.equal(studio.art({ ...sword, id }, ITEMS[id], null, 'card'), null);
  assert.equal(studio.art(sword, ITEMS.shortSword, null, '2x4'), null);
  assert.equal(studio.art(sword, ITEMS.shortSword, null, '2x4'), null, 'asked twice, queued once');
  assert.equal(studio.jobs.size, 4);
  assert.equal(studio.pump(), false, 'three.js is loading');
  await studio.loading;
  assert.equal(studio.pump(), true);
  assert.equal(studio.jobs.size, 2, 'two a frame');
  assert.equal(studio.pump(), false, 'every update in a frame shares the one batch');
  assert.equal(studio.jobs.size, 2);
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].sizes, [[GRIDS.card.cols * SX, GRIDS.card.rows * SY], [GRIDS.card.cols * SX, GRIDS.card.rows * SY]]);
  const card = studio.art({ ...sword }, ITEMS.shortSword, null, 'card');
  assert.match(card.src, /^data:image\/png;base64,0:120x240:\d+$/, 'letters 5 px tall at twice the size');
  assert.ok(canvases[0].texts.length > 100 && canvases[0].texts.every((ch) => /^[\x21-\x7e]$/.test(ch)));
  assert.ok(new Set(canvases[0].texts).has('@'), 'brightly lit metal draws heavy letters');
  assert.ok(new Set(canvases[0].texts).has('|'), 'and the silhouette edge its outline glyph');
  assert.equal(card.bytes, 120 * 240 * 4);
  assert.equal(made[0].scene.children.filter((node) => node.isLight).length, 3, 'the drawn models are taken away again');
  assert.equal(made[0].scene.children.length, 3);
  paint();
  studio.pump();
  assert.equal(studio.jobs.size, 0);
  assert.match(studio.art(sword, ITEMS.shortSword, null, '2x4').src, /:238x409:/);
  assert.equal(studio.bytes, 3 * 120 * 240 * 4 + 238 * 409 * 4);
  assert.equal(studio.peak, studio.bytes);

  t.mock.timers.tick(10000);
  assert.equal(studio.renderer, null, 'idle: the renderer goes');
  assert.equal(made[0].lost, 1);
  assert.equal(made[0].disposed, 1);
  made[0].domElement.dispatchEvent(new Event('webglcontextlost'));
  assert.equal(studio.off, false, 'a loss it caused is no failure');
  assert.equal(studio.disposing, false);
  studio.release();
  assert.ok(studio.art(sword, ITEMS.shortSword, null, 'card'), 'the pictures stay');
  studio.art({ ...sword, id: 'dagger' }, ITEMS.dagger, null, 'card');
  paint();
  assert.equal(studio.pump(), true);
  assert.equal(made.length, 2, 'the next picture makes a new renderer');
  assert.ok(studio.art({ ...sword, id: 'dagger' }, ITEMS.dagger, null, 'card'));
});

test('a frame stops making pictures after 8 ms, and the next batch waits for the frame to be painted', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fakeCanvas(t);
  const paint = fakeFrames(t);
  const { made, factory } = fakeRenderer();
  let clock = 0;
  // Drawing a picture takes 20 ms, longer than a frame.
  const slow = () => {
    const renderer = factory();
    const render = renderer.render;
    renderer.render = (...args) => { clock += 10; render.apply(renderer, args); };
    return renderer;
  };
  const studio = new ItemStudio({ webgl: true, load: lib, renderer: slow, now: () => clock });
  for (const id of ['shortSword', 'spear', 'dagger']) studio.art({ ...sword, id }, ITEMS[id], null, 'card');
  studio.pump();
  await studio.loading;
  assert.equal(studio.pump(), true);
  assert.equal(clock, 20);
  assert.equal(studio.jobs.size, 2, 'one picture, then over 8 ms');
  // A drop's two updates in one pointer-up: the second waits however long
  // the first took.
  assert.equal(studio.pump(), false);
  clock += 1000;
  assert.equal(studio.pump(), false);
  assert.equal(studio.jobs.size, 2);
  paint();
  assert.equal(studio.pump(), true);
  assert.equal(studio.jobs.size, 1);
  assert.equal(made[0].sizes.length, 2);
});

test('without animation frames, the next batch waits 16 ms after one ends', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fakeCanvas(t);
  const studio = new ItemStudio({ webgl: true, load: lib, renderer: fakeRenderer().factory, now: () => 0 });
  for (const id of ['shortSword', 'spear', 'dagger']) studio.art({ ...sword, id }, ITEMS[id], null, 'card');
  studio.pump();
  await studio.loading;
  assert.equal(studio.pump(), true);
  t.mock.timers.tick(15);
  assert.equal(studio.pump(), false);
  t.mock.timers.tick(1);
  assert.equal(studio.pump(), true);
  assert.equal(studio.jobs.size, 0);
});

test('an unexpected context loss falls back to outlines, retried once on the next opening', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  fakeCanvas(t);
  const paint = fakeFrames(t);
  const { made, factory } = fakeRenderer();
  const frame = () => { paint(); return studio.pump(); };
  const studio = new ItemStudio({ webgl: true, load: lib, renderer: factory, now: () => 0 });
  studio.reopen();
  assert.equal(studio.off, false);
  studio.art(sword, ITEMS.shortSword, null, 'card');
  frame();
  await studio.loading;
  frame();
  studio.art(sword, ITEMS.spear, null, 'card');
  made[0].domElement.dispatchEvent(new Event('webglcontextlost'));
  assert.equal(studio.off, true);
  assert.equal(studio.renderer, null);
  assert.ok(studio.art(sword, ITEMS.shortSword, null, 'card'), 'made pictures still show');
  assert.equal(studio.art(sword, ITEMS.dagger, null, 'card'), null, 'one asked for while off waits');
  assert.equal(frame(), false);
  assert.equal(studio.jobs.size, 2, 'the waiting pictures stay queued');
  // Reopened with nothing changed, the waiting pictures are made on a new
  // renderer, and the screen redraws them.
  studio.reopen();
  assert.equal(studio.off, false, 'one more try');
  assert.equal(frame(), true);
  assert.equal(made.length, 2, 'a new renderer');
  assert.equal(studio.jobs.size, 0);
  assert.ok(studio.art(sword, ITEMS.spear, null, 'card'));
  assert.ok(studio.art(sword, ITEMS.dagger, null, 'card'));
  made[1].domElement.dispatchEvent(new Event('webglcontextlost'));
  studio.reopen();
  assert.equal(studio.off, true, 'twice lost: outlines for the session');
  assert.equal(studio.losses, 2);
});

test('no WebGL, or no three.js, means outlines', async (t) => {
  assert.equal(itemStudio.off, true, 'Node has no WebGL');
  assert.equal(itemStudio.art(sword, ITEMS.shortSword, null, 'card'), null);
  // A browser whose canvas gives no WebGL context.
  const previous = globalThis.document;
  globalThis.document = { createElement: () => Object.assign(new EventTarget(), { getContext: () => null, style: {} }) };
  t.after(() => { globalThis.document = previous; });
  const studio = new ItemStudio({ webgl: true });
  studio.art(sword, ITEMS.shortSword, null, 'card');
  studio.pump();
  await studio.loading;
  assert.equal(studio.lib.THREE.REVISION, THREE.REVISION, 'three.js and the outline glyphs load on demand');
  assert.equal(studio.pump(), false);
  assert.equal(studio.off, true);
  assert.equal(studio.jobs.size, 0);
  const broken = new ItemStudio({ webgl: true, load: async () => { throw new Error('offline'); } });
  broken.art(sword, ITEMS.shortSword, null, 'card');
  broken.pump();
  await broken.loading;
  assert.equal(broken.off, true);
});

test('past the byte budget the least recently used pictures go', () => {
  const studio = new ItemStudio({ webgl: true, budget: 250 });
  studio._store('a', { src: 'a', bytes: 100 });
  studio._store('b', { src: 'b', bytes: 100 });
  // Seen again, `a` moves to the back of the queue.
  const seen = studio.cache.get('a');
  studio.cache.delete('a');
  studio.cache.set('a', seen);
  studio._store('c', { src: 'c', bytes: 100 });
  assert.deepEqual([...studio.cache.keys()], ['a', 'c']);
  assert.equal(studio.bytes, 200);
  assert.equal(studio.peak, 300);
  studio._store('d', { src: 'd', bytes: 400 });
  assert.deepEqual([...studio.cache.keys()], ['d'], 'a picture bigger than the budget still shows');
});
