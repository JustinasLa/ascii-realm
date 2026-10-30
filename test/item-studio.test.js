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
const { INSTRUMENT_SHAPES } = await import('../src/entities/instrument-shapes.js');
const { INSTRUMENT_PAINTS, ITEM_MODELS, PAINTS, WEAPON_PAINTS } = await import('../src/ui/item-models.js');
const { GRIDS, SX, SY, poseAngle } = await import('../src/ui/item-shading.js');
const { ItemStudio, buildModel, fit, glyphChars, itemStudio, paintFor, posed, recipeOf } = await import('../src/ui/item-studio.js');

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

// Every part a recipe lists, inside groups too.
const partsOf = (parts) => parts.flatMap((part) => (part[0] === 'group' ? partsOf(part[1]) : [part]));
const VARIANTS = ['', 'card', 'compact', 'two'];

test('every weapon, the arrow, the instruments and the metals have a model, and every paint they name exists', () => {
  for (const item of Object.values(ITEMS)) {
    if (item.weapon || INSTRUMENT_SHAPES.includes(item.id) || /Ingot$|^(raw(Iron|Copper|Tin)|arrow|coal|lapisLazuli|unusableScrap)$/.test(item.id)) {
      assert.ok(ITEM_MODELS[item.id], item.id);
    }
  }
  for (const [id, recipe] of Object.entries(ITEM_MODELS)) {
    assert.ok(ITEMS[id], id);
    if (recipe.from === 'weapon') assert.ok(WEAPONS[ITEMS[id].weapon].spriteParts.length, id);
    else if (recipe.from === 'instrument') assert.ok(INSTRUMENT_SHAPES.includes(id) && recipe.up, id);
    for (const variant of VARIANTS) {
      for (const part of partsOf(recipeOf(ITEMS[id], variant).parts ?? [])) assert.ok(PAINTS[part[4]], `${id} ${variant} ${part[4]}`);
    }
  }
  for (const weapon of Object.values(WEAPONS)) {
    for (const part of weapon.spriteParts) assert.ok(PAINTS[WEAPON_PAINTS[part.material]], `${weapon.id} ${part.material}`);
  }
  for (const paint of [...Object.values(INSTRUMENT_PAINTS), 'leather', 'bone', 'metal']) assert.ok(PAINTS[paint], paint);
  for (const [name, paint] of Object.entries(PAINTS)) {
    const ramp = typeof paint.ramp === 'string' ? glyphChars(BARK_RAMP) : paint.ramp;
    if (!paint.edge) assert.ok(ramp.length >= 4 && ramp.length <= 9, `${name} has 4-9 levels`);
    assert.ok(ramp.flat().every((ch) => /^[\x21-\x7e]$/.test(ch)), `${name} is printable ASCII`);
    assert.equal(paint.colour.length, 3);
  }
  assert.ok(Object.keys(PAINTS).length <= 31, 'paint ids fit the red channel');
});

test('every model and every version of it builds small and finite', () => {
  for (const [id, recipe] of Object.entries(ITEM_MODELS)) {
    for (const variant of VARIANTS.filter((v) => !v || recipe[v])) {
      const model = buildModel(THREE, { item: ITEMS[id], tint: null, variant });
      const meshes = meshesOf(model);
      assert.ok(meshes.length > 0 && meshes.length <= 40, `${id} ${variant}`);
      const triangles = meshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
      assert.ok(triangles <= 20000, id);
      for (const m of meshes) {
        assert.ok(m.geometry.attributes.position.array.every(Number.isFinite), id);
        assert.ok(PAINTS[m.userData.paint], `${id} ${m.userData.paint}`);
      }
      const box = new THREE.Box3().setFromObject(model);
      assert.ok(!box.isEmpty() && Number.isFinite(box.max.y - box.min.y), id);
    }
  }
});

test('every kind of part builds where it is put, and stones are knobbly', (t) => {
  ITEM_MODELS.sampler = { pose: 'upright', parts: [
    ['box', [0.1, 0.2, 0.05], [0, 0, 0], 0, 'wood'],
    ['cyl', [0.02, 0.03, 0.1, 4, 0.5], [0.2, 0, 0], [0, 1, 0], 'metal', 'item', [2, 1, 1]],
    ['cone', [0.02, 0.05], [0, 0.2, 0], 0, 'metal'],
    ['ball', [0.03, 0.02, 0.03], [0, -0.2, 0], 0, 'bone', [10, 20, 30]],
    ['torus', [0.05, 0.01], [0, 0, 0.1], 0, 'trim'],
    ['lathe', [[0, 0], [0.04, 0.02], [0.02, 0.08]], [0, 0, -0.1], 0, 'stone'],
    ['slab', [[[0, 0], [0.05, 0], [0, 0.05]], 0.01], [-0.2, 0, 0], 0, 'leather'],
    ['lump', [0.05, 0.4, 1], [0, 0, 0.3], 0, 'stone'],
    ['tube', [[[0, 0, 0], [0.05, 0.05, 0], [0.1, 0, 0]], 0.005], [0, 0.3, 0], 0, 'leather'],
    ['group', [['box', [0.01, 0.01, 0.01], [0.01, 0, 0], 0, 'wood']], [0, 0, -0.3], [0, 0, 1]],
  ] };
  t.after(() => { delete ITEM_MODELS.sampler; });
  const model = buildModel(THREE, { item: { id: 'sampler', colour: [1, 2, 3] } });
  const kinds = model.children.map((node) => node.geometry?.type ?? 'Group');
  assert.deepEqual(kinds, ['BoxGeometry', 'CylinderGeometry', 'ConeGeometry', 'SphereGeometry', 'TorusGeometry', 'LatheGeometry',
    'ExtrudeGeometry', 'IcosahedronGeometry', 'TubeGeometry', 'Group']);
  const [, bar, , ball, , , slab, lump] = model.children;
  assert.deepEqual(bar.userData.colour, [1, 2, 3], "'item' is the item's colour");
  assert.deepEqual(bar.position.toArray(), [0.2, 0, 0]);
  assert.deepEqual(bar.scale.toArray(), [2, 1, 1]);
  assert.equal(bar.rotation.y, 1);
  assert.ok(bar.material.flatShading && lump.material.flatShading && !ball.material.flatShading, 'facets on stones and bars');
  assert.deepEqual(ball.userData, { paint: 'bone', colour: [10, 20, 30] });
  slab.geometry.computeBoundingBox();
  assert.ok(Math.abs(slab.geometry.boundingBox.max.z + slab.geometry.boundingBox.min.z) < 1e-9, 'slabs are centred on their depth');
  const radii = [];
  const at = lump.geometry.attributes.position;
  for (let i = 0; i < at.count; i++) radii.push(Math.hypot(at.getX(i), at.getY(i), at.getZ(i)));
  assert.ok(Math.max(...radii) - Math.min(...radii) > 0.01, 'a lump is not a ball');
  assert.ok(radii.every((r) => r > 0.05 * 0.79 && r < 0.05 * 1.21));
  assert.deepEqual(model.children[9].rotation.z, 1);
  const again = buildModel(THREE, { item: { id: 'sampler', colour: [1, 2, 3] } }).children[7].geometry.attributes.position.array;
  assert.deepEqual([...again], [...at.array], 'the same stone every time');
});

test('instruments stand neck up, body down, painted by the colour of each piece', () => {
  for (const id of INSTRUMENT_SHAPES) {
    const recipe = ITEM_MODELS[id];
    const model = buildModel(THREE, { item: ITEMS[id] });
    const outer = posed(THREE, model, GRIDS['2x4'], recipe.pose);
    const box = new THREE.Box3().setFromObject(outer);
    const middle = (box.min.y + box.max.y) / 2;
    // The widest of ten bands across the height is in the lower half.
    const bands = Array.from({ length: 10 }, () => [Infinity, -Infinity]);
    const point = new THREE.Vector3();
    for (const mesh of meshesOf(model)) {
      const at = mesh.geometry.attributes.position;
      for (let i = 0; i < at.count; i++) {
        point.fromBufferAttribute(at, i).applyMatrix4(mesh.matrixWorld);
        const band = bands[Math.min(9, Math.floor(((point.y - box.min.y) / (box.max.y - box.min.y)) * 10))];
        band[0] = Math.min(band[0], point.x);
        band[1] = Math.max(band[1], point.x);
      }
    }
    const widths = bands.map(([a, b]) => b - a);
    const widest = widths.indexOf(Math.max(...widths));
    // A harp is the other way up: its neck crowns the triangle.
    if (id === 'celticHarp') assert.ok(widest >= 5, 'the harp\'s neck is at the top');
    else if (recipe.pose === 'upright' && id !== 'bagpipe') assert.ok(widest < 5, `${id} is body down`);
    for (const mesh of meshesOf(model)) {
      const hex = mesh.material.color.getHex();
      assert.deepEqual(mesh.userData.colour, [hex >> 16, (hex >> 8) & 255, hex & 255], id);
    }
    // The bagpipe's three drones stand above its bag, the chanter below.
    if (id === 'bagpipe') {
      const [bag, ...pipes] = meshesOf(model).map((mesh) => mesh.getWorldPosition(new THREE.Vector3()).y);
      assert.deepEqual(pipes.map((y) => y > bag), [true, true, true, false]);
      assert.ok(bag < middle + 0.05);
    }
  }
  // The trumpet's bell is at the bottom of its diagonal.
  const trumpet = buildModel(THREE, { item: ITEMS.trumpet });
  posed(THREE, trumpet, GRIDS['2x4']);
  const bell = meshesOf(trumpet).find((mesh) => mesh.geometry.type === 'ConeGeometry');
  const centre = new THREE.Box3().setFromObject(trumpet).getCenter(new THREE.Vector3());
  assert.ok(bell.getWorldPosition(new THREE.Vector3()).y < centre.y);
  const paints = (id) => new Set(meshesOf(buildModel(THREE, { item: ITEMS[id] })).map((mesh) => mesh.userData.paint));
  assert.deepEqual(paints('celticHarp'), new Set(['wood', 'string']));
  assert.deepEqual(paints('kalimba'), new Set(['wood', 'darkWood', 'trim']));
  assert.deepEqual(paints('bagpipe'), new Set(['leather', 'darkWood']));
  assert.deepEqual(paints('trumpet'), new Set(['metal']));
});

test('a quiver box shows the quiver, a card fanned arrows, and a stack of ingots two bars', () => {
  const studio = new ItemStudio({ webgl: true });
  const arrows = { id: 'arrow', count: 20, material: 'steel' };
  for (const shape of ['1x1', 'card', '2x2']) studio.art(arrows, ITEMS.arrow, null, shape);
  studio.art({ id: 'ironIngot', count: 3 }, ITEMS.ironIngot, null, 'card');
  studio.art({ id: 'ironIngot', count: 1 }, ITEMS.ironIngot, null, 'card');
  studio.art({ id: 'lute', count: 1 }, ITEMS.lute, null, '1x1');
  const steel = WEAPON_MATERIALS.steel.color.map((c) => c.toString(16).padStart(2, '0')).join('');
  assert.deepEqual([...studio.jobs.values()].map((job) => [job.key, job.variant]), [
    [`arrow|compact|${steel}|1x1|1`, 'compact'], [`arrow|card|${steel}|card|1`, 'card'], [`arrow||${steel}|2x2|1`, ''],
    ['ironIngot|two||card|1', 'two'], ['ironIngot|||card|1', ''], ['lute|||1x1|1', ''],
  ]);
  const heads = meshesOf(buildModel(THREE, { item: ITEMS.arrow, tint: WEAPON_MATERIALS.copper.color, variant: 'card' }))
    .filter((mesh) => mesh.userData.paint === 'metal');
  assert.equal(heads.length, 3, 'three arrows');
  assert.ok(heads.every((mesh) => mesh.userData.colour === WEAPON_MATERIALS.copper.color || mesh.userData.colour.join() === WEAPON_MATERIALS.copper.color.join()));
  const stoneHeads = meshesOf(buildModel(THREE, { item: ITEMS.arrow, tint: WEAPON_MATERIALS.stone.color }));
  assert.ok(stoneHeads.some((mesh) => mesh.userData.paint === 'stone'), 'stone arrowheads are stone');
  const alloy = meshesOf(buildModel(THREE, { item: ITEMS.alloyIngot, tint: [194, 165, 131] }))[0].userData;
  assert.deepEqual(alloy, { paint: 'metal', colour: [194, 165, 131] });
  assert.deepEqual(meshesOf(buildModel(THREE, { item: ITEMS.copperIngot }))[0].userData.colour, ITEMS.copperIngot.colour);
});

test('flat items lie seen from above, upright ones face on', () => {
  const flat = posed(THREE, buildModel(THREE, { item: ITEMS.ironIngot }), GRIDS.card, 'flat');
  const up = new THREE.Vector3(0, 1, 0).transformDirection(flat.children[0].matrixWorld);
  assert.ok(Math.abs(Math.acos(up.z) - (40 * Math.PI) / 180) < 0.02, 'tipped 50° towards the camera');
  const upright = posed(THREE, buildModel(THREE, { item: ITEMS.lute }), GRIDS.card, 'upright');
  assert.ok(new THREE.Vector3(0, 1, 0).transformDirection(upright.children[0].matrixWorld).y > 0.95);
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
