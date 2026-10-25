import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';
import { Animal, KINDS } from '../src/entities/animals.js';
import { WATER } from '../src/world/world.js';

const dataURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const threeURL = new URL('../vendor/three/three.module.min.js', import.meta.url).href;
// Resolve the browser import map in Node, replacing only the GPU renderer
// (see model-animation.test.js). The vendored loaders and the player's model
// load from data URLs as in the monster tests; a resolve hook sends the
// animal modules' imports of them there, so the animal modules themselves
// load as files and count toward coverage.
const modules = new Map([['three', dataURL(`
  export * from ${JSON.stringify(threeURL)};
  export class WebGLRenderer {
    constructor() { throw new Error('no WebGL in Node'); }
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
register(dataURL(`
  const redirect = new Map(${JSON.stringify([...modules])});
  export async function resolve(specifier, context, next) {
    if (specifier === 'three') return { url: redirect.get('three'), shortCircuit: true };
    const resolved = await next(specifier, context);
    return redirect.has(resolved.url) ? { url: redirect.get(resolved.url), shortCircuit: true } : resolved;
  }
`));
const { AnimalFigures, LOOKS } = await import('../src/entities/animal-figures.js');
const THREE = await import(threeURL);

// Node has no image decoder, so the rabbit's fur texture is dropped from
// the file's JSON before parsing; the geometry, skin and clips are as shipped.
function untextured(bytes) {
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) delete m.pbrMetallicRoughness?.baseColorTexture;
  let text = JSON.stringify(json);
  text += ' '.repeat((4 - (text.length % 4)) % 4);
  const head = Buffer.alloc(20);
  const rest = bytes.subarray(20 + length);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, Buffer.from(text), rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
const parse = (name) => new GLTFLoader().parseAsync(untextured(readFileSync(new URL(`../assets/animals/${name}.glb`, import.meta.url))), '');
const gltfs = Object.fromEntries(await Promise.all(Object.keys(LOOKS).map(async (n) => [n, await parse(n)])));
const stub = { setPixelRatio() {}, setSize() {}, setClearColor() {} };
const figures = () => new AnimalFigures(gltfs, { renderer: stub });
const dt = 1 / 60;


// A stand-in GPU: renders nothing, and reads back a solid body filling the
// middle of every slot drawn.
function fakeGPU() {
  const slots = [];
  return {
    slots,
    setPixelRatio() {}, setSize() {}, setClearColor() {}, setScissorTest() {}, clear() {},
    setViewport(x, y, w, h) { this.last = { x, y, w, h }; },
    setScissor() {},
    render() { slots.push(this.last); },
    getContext() {
      return {
        readPixels(x, y, w, h, format, type, out) {
          // `w` is the width read back, the sum of the slots' widths.
          out.fill(0);
          for (const s of slots) {
            for (let j = 0; j < s.h; j++) {
              for (let i = 0; i < s.w; i++) {
                if (((i / s.w - 0.5) / 0.3) ** 2 + ((j / s.h - 0.5) / 0.3) ** 2 > 1) continue;
                out.set([200, 150, 90, 255], (j * w + s.x + i) * 4);
              }
            }
          }
          slots.length = 0;
        },
      };
    },
  };
}

const hind = () => new Animal(KINDS.deer, 0, 0, { variant: 'hind' });
const stag = () => new Animal(KINDS.deer, 0, 0, { variant: 'stag' });
const rabbit = () => new Animal(KINDS.rabbit, 0, 0);
const looks = [['deer', hind], ['stag', stag], ['rabbit', rabbit]];

test('every clip each kind plays is in its model', () => {
  for (const [name] of looks) {
    const kind = KINDS[LOOKS[name].kind];
    for (const clip of Object.values(kind.clips)) {
      assert.ok(gltfs[name].animations.some((c) => c.name === clip), `${name} ${clip}`);
    }
  }
  const broken = { ...gltfs, rabbit: { ...gltfs.rabbit, animations: [] } };
  assert.throws(() => new AnimalFigures(broken, { renderer: stub }), /Missing clip/);
});

test('models stand at their withers height, facing their heading', () => {
  const f = figures();
  for (const [name, make] of looks) {
    const a = make();
    f.update(dt, [a]);
    const rig = f.rigs.get(a);
    const kind = KINDS[LOOKS[name].kind];
    const want = name === 'stag' ? kind.stagHeight : kind.height;
    rig.model.rotation.y = 0;
    rig.mixer.stopAllAction();
    rig.inner.traverse((o) => o.isBone && o.position && o.updateMatrixWorld());
    const { scale } = f.fits[name];
    assert.ok(scale > 0);
    for (const heading of [0, Math.PI / 2]) {
      a.heading = heading;
      f.update(dt, [a]);
      const head = rig.bones[LOOKS[name].head.replace('.', '')].getWorldPosition(new THREE.Vector3());
      const hips = rig.bones[LOOKS[name].hips].getWorldPosition(new THREE.Vector3());
      const bearing = Math.atan2(head.x - hips.x, head.z - hips.z);
      assert.ok(Math.abs(Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading))) < 0.35, `${name} ${bearing}`);
    }
    // The withers stand at the kind's height above the hooves.
    const fresh = new AnimalFigures(gltfs, { renderer: stub });
    const scene = fresh.sources[name];
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene, true);
    const withers = scene.getObjectByName(LOOKS[name].withers).getWorldPosition(new THREE.Vector3()).y;
    const height = (withers - box.min.y) * fresh.fits[name].scale;
    assert.ok(Math.abs(height - want) < want * 0.05, `${name} ${height}`);
    assert.ok(Number.isFinite(want));
  }
});

test('gaits play at rates that keep the feet planted', () => {
  const f = figures();
  for (const [name, make] of looks) {
    const a = make();
    f.update(dt, [a]);
    const rig = f.rigs.get(a);
    const kind = KINDS[LOOKS[name].kind];
    const [lo, hi] = kind.rates;
    assert.ok(rig.runSpeed > 0);
    const flee = kind.fleeSpeed / rig.runSpeed;
    assert.ok(flee >= lo && flee <= hi, `${name} gallops at ${flee}`);
    if (rig.actions.walk) {
      assert.ok(rig.walkSpeed > 0);
      for (const speed of [kind.walkSpeed, kind.trotSpeed]) {
        const rate = speed / rig.walkSpeed;
        assert.ok(rate >= lo && rate <= hi, `${name} walks at ${rate}`);
      }
    } else {
      const rate = kind.walkSpeed / rig.runSpeed;
      assert.ok(rate >= lo && rate <= hi, `${name} lopes at ${rate}`);
    }
    // Moving, the gait's clip rate is the speed over the clip's own pace.
    a.speed = kind.fleeSpeed;
    a.groundSpeed = kind.fleeSpeed;
    a.state = 'flee';
    for (let i = 0; i < 30; i++) f.update(dt, [a]);
    assert.ok(rig.weights.run > 0.9);
    assert.ok(Math.abs(rig.actions.run.timeScale - flee) < 1e-9);
  }
});

test('each state plays its own clip', () => {
  const f = figures();
  const weightOf = (make, set) => {
    const a = make();
    Object.assign(a, set);
    for (let i = 0; i < 40; i++) f.update(dt, [a]);
    const rig = f.rigs.get(a);
    return Object.entries(rig.weights).sort((x, y) => y[1] - x[1])[0][0];
  };
  assert.equal(weightOf(hind, { state: 'idle' }), 'idle');
  assert.equal(weightOf(hind, { state: 'idle', looking: true }), 'look');
  assert.equal(weightOf(hind, { state: 'graze' }), 'graze');
  assert.equal(weightOf(hind, { state: 'graze', headUp: true }), 'look');
  assert.equal(weightOf(hind, { state: 'alert' }), 'look');
  assert.equal(weightOf(hind, { state: 'wander', speed: 1.1, groundSpeed: 1.1 }), 'walk');
  assert.equal(weightOf(hind, { state: 'wander', speed: 1.1, groundSpeed: 0.5, speedScale: 0 }), 'walk');
  assert.equal(weightOf(rabbit, { state: 'idle' }), 'groom');
  assert.equal(weightOf(rabbit, { state: 'graze' }), 'graze');
  assert.equal(weightOf(rabbit, { state: 'graze', headUp: true }), 'alertLoop');
  assert.equal(weightOf(rabbit, { state: 'freeze' }), 'alertLoop');
  assert.equal(weightOf(rabbit, { state: 'wander', speed: 1.2, groundSpeed: 1.2 }), 'run');
});

test('slots fit the body: a sitting rabbit small, a galloping deer whole', () => {
  const f = new AnimalFigures(gltfs, { renderer: fakeGPU() });
  const view = { x0: -200, y0: -100, cols: 400, rows: 200 };
  const r = rabbit();
  f.update(dt, [r]);
  const small = f.slotOf(r, view);
  assert.ok(small.cols <= 24 && small.rows <= 14, `${small.cols}x${small.rows}`);
  const d = stag();
  Object.assign(d, { state: 'flee', speed: 5.8, groundSpeed: 5.8 });
  for (let i = 0; i < 20; i++) f.update(dt, [d]);
  const big = f.slotOf(d, view);
  const reach = f.rigs.get(d).reach();
  assert.ok(big.cols >= (reach.right - reach.left) * 13 / 0.6 && big.rows >= (reach.up - reach.down) * 13);
  assert.equal(f.slotOf({ ...d, x: 5000 }, view), null, 'off screen it is not drawn');
  assert.equal(f.slotOf(d, { x0: 50, y0: 0, cols: 0, rows: 0 }), null);
});

test('rigs of animals let go are kept for the next', () => {
  const f = figures();
  const a = hind();
  f.update(dt, [a]);
  const rig = f.rigs.get(a);
  f.update(dt, []);
  assert.equal(f.rigs.size, 0);
  const b = hind();
  f.update(dt, [b]);
  assert.equal(f.rigs.get(b), rig);
});

test('the figures are drawn as outlined cells with a shaded body, nearest first, fewer on phones', () => {
  let phone = false;
  const gpu = fakeGPU();
  const f = new AnimalFigures(gltfs, { renderer: gpu, phone: () => phone });
  const herd = Array.from({ length: 8 }, (_, i) => new Animal(KINDS.deer, i * 10, 0, { variant: 'hind' }));
  f.update(dt, herd);
  const view = { x0: -200, y0: -100, cols: 400, rows: 200 };
  const drawn = f.rasterise(view, herd, { x: 0, y: 0 });
  assert.equal(drawn.length, 6);
  assert.deepEqual(drawn.map((d) => d.animal), herd.slice(0, 6));
  const glyphs = new Set(drawn[0].cells.map((c) => c.g));
  assert.ok(glyphs.size >= 3, 'outline edges and a ramp inside');
  assert.ok(drawn[0].cells.every((c) => c.r <= 255 && c.gg <= 255));
  phone = true;
  assert.equal(f.rasterise(view, herd, { x: 0, y: 0 }).length, 4);
  assert.deepEqual(f.rasterise({ x0: 9000, y0: 0, cols: 10, rows: 10 }, herd, { x: 0, y: 0 }), []);
  const written = [];
  AnimalFigures.draw(null, drawn[0], (...args) => written.push(args));
  assert.equal(written.length, drawn[0].cells.length);
  // A wider body than the image grows it.
  f.fit(f.width + 10, f.height + 10);
  assert.equal(f.pixels.length, f.width * f.height * 4);
});

test('a wading deer is clipped at the surface and splashes where its legs meet it', () => {
  const f = new AnimalFigures(gltfs, { renderer: fakeGPU() });
  const a = hind();
  Object.assign(a, { state: 'flee', speed: 5.8, groundSpeed: 5.8, waterDepth: 0.3 });
  for (let i = 0; i < 10; i++) f.update(dt, [a]);
  const rig = f.rigs.get(a);
  assert.ok(rig.waterContacts().length >= 2);
  const [figure] = f.rasterise({ x0: -200, y0: -100, cols: 400, rows: 200 }, [a], a);
  assert.ok(figure.contacts.length >= 2);
  a.waterDepth = 0;
  f.update(dt, [a]);
  assert.deepEqual(rig.waterContacts(), []);
});

test('the shadow darkens the ground under the body, longest along it, never on water', () => {
  const cols = 60;
  const rows = 30;
  const r = { cols, fg: new Float32Array(cols * rows * 4).fill(100), bg: new Float32Array(cols * rows * 4).fill(100),
    mask: new Uint8Array(cols * rows).fill(2) };
  const view = { x0: 0, y0: 0, cols, rows };
  r.mask[15 * cols + 31] = WATER;
  AnimalFigures.drawShadow(r, view, { animal: { x: 30, y: 15, heading: Math.PI / 2 }, shadow: LOOKS.deer.shadow });
  const dark = (x, y) => r.fg[(y * cols + x) * 4] < 100;
  assert.ok(dark(30, 15) && dark(40, 15), 'long across the screen for a deer side-on');
  assert.ok(!dark(30, 19));
  assert.ok(!dark(31, 15), 'water is left alone');
  AnimalFigures.drawShadow(r, view, { animal: { x: 1, y: 1, heading: 0 }, shadow: LOOKS.rabbit.shadow });
});

test('the models load once each, and without WebGL the animals go undrawn', async (t) => {
  const urls = [];
  t.mock.method(ModelFigure, 'library', async (url) => {
    urls.push(url);
    return gltfs[Object.keys(LOOKS).find((n) => LOOKS[n].url === url)];
  });
  const f = await AnimalFigures.load({ renderer: stub });
  assert.ok(f instanceof AnimalFigures);
  assert.deepEqual(urls.sort(), Object.values(LOOKS).map((l) => l.url).sort());
  const warn = t.mock.method(console, 'warn', () => {});
  assert.equal(await AnimalFigures.load(), null);
  assert.equal(warn.mock.callCount(), 1);
});

test('the animal models are credited, CC0, and light enough', () => {
  const licence = new URL('../assets/animals/LICENSE.txt', import.meta.url);
  assert.ok(existsSync(licence));
  const text = readFileSync(licence, 'utf8');
  assert.match(text, /CC0/);
  assert.match(text, /Quaternius/);
  assert.match(text, /Dammer/);
  const total = Object.values(LOOKS).reduce((sum, l) => sum + statSync(new URL(`../${l.url}`, import.meta.url)).size, 0);
  assert.ok(total < 4 * 1024 * 1024, `${total} bytes`);
});
