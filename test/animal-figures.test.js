import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';
import { Animal, Animals, KINDS } from '../src/entities/animals.js';
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
const { AnimalFigures, LOOKS, MAX_DRAWN, MAX_DRAWN_PHONE, MAX_SMALL, MAX_SMALL_PHONE, PLAIN } = await import('../src/entities/animal-figures.js');
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
                out.set([200, 150, 90, 255], ((j + s.y) * w + s.x + i) * 4);
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
  assert.ok(total < 6 * 1024 * 1024, `${total} bytes`);
});

test('a fallen animal plays its fall once and holds it; a rabbit then lies in its dead pose', () => {
  const f = figures();
  const d = hind();
  f.update(dt, [d]);
  const rig = f.rigs.get(d);
  for (const key of ['death', 'hitL', 'hitR']) {
    assert.equal(rig.actions[key].loop, THREE.LoopOnce, key);
    assert.equal(rig.actions[key].clampWhenFinished, true);
  }
  d.takeHit(999, 0, -5);
  f.update(dt, [d]);
  assert.equal(rig.weights.death, 1, 'the fall is sudden');
  assert.equal(rig.actions.death.timeScale, 1.15);
  const duration = rig.actions.death.getClip().duration;
  for (let i = 0; i < (duration / 1.15 + 0.5) / dt; i++) f.update(dt, [d]);
  assert.ok(rig.actions.death.time >= duration - 1e-3, 'held at its last frame');
  assert.ok(rig.weights.death > 0.99);
  assert.deepEqual(rig.waterContacts(), [], 'a body in water makes no splashes');
  const r = rabbit();
  f.update(dt, [r]);
  const bunny = f.rigs.get(r);
  assert.equal(bunny.actions.dead.loop, THREE.LoopOnce);
  r.takeHit(999, 0, -5);
  f.update(dt, [r]);
  assert.equal(bunny.weights.death, 1);
  const fall = bunny.actions.death.getClip().duration;
  for (let i = 0; i < (fall / 1.15 + 1) / dt; i++) f.update(dt, [r]);
  assert.ok(bunny.weights.dead > 0.9, 'then lies in its dead pose');
});

test('a struck deer plays the hit-react on the side of the blow, again for each blow', () => {
  const f = figures();
  const d = hind();
  d.heading = 0;
  f.update(dt, [d]);
  const rig = f.rigs.get(d);
  d.takeHit(5, 3, 0);
  assert.equal(d.flinch.side, 'L');
  for (let i = 0; i < 10; i++) f.update(dt, [d]);
  assert.ok(rig.weights.hitL > 0.8 && rig.weights.hitR < 0.05);
  const first = rig.actions.hitL.time;
  d.flinch = { side: 'L', left: 0.35 };
  f.update(dt, [d]);
  assert.ok(rig.actions.hitL.time < first, 'a new blow starts it over');
  d.flinch = { side: 'R', left: 0.35 };
  for (let i = 0; i < 10; i++) f.update(dt, [d]);
  assert.ok(rig.weights.hitR > 0.8);
  // A rabbit has no hit-react and only flashes.
  const r = rabbit();
  r.flinch = { side: 'L', left: 0.2 };
  f.update(dt, [r]);
  assert.equal(f.rigs.get(r).weights.hitL, undefined);
});

test('a fresh hit flashes the body white, gone by 0.14 s; a sunk body lies lower', () => {
  const f = new AnimalFigures(gltfs, { renderer: fakeGPU() });
  const d = hind();
  const view = { x0: -200, y0: -100, cols: 400, rows: 200 };
  f.update(dt, [d]);
  const plain = f.rasterise(view, [d], d)[0].cells;
  d.hurt = 0;
  f.update(0, [d]);
  assert.equal(f.rigs.get(d).flash, 1);
  const lit = f.rasterise(view, [d], d)[0].cells;
  const mean = (cells) => cells.reduce((n, c) => n + c.r + c.gg + c.b, 0) / cells.length;
  assert.ok(mean(lit) > mean(plain) + 60, 'brighter while it flashes');
  d.hurt = 0.14;
  f.update(0, [d]);
  assert.equal(f.rigs.get(d).flash, 0);
  d.takeHit(999, 0, -5);
  f.update(dt, [d]);
  const rig = f.rigs.get(d);
  const lying = rig.model.position.y;
  d.sunk = 1;
  f.update(dt, [d]);
  assert.ok(Math.abs(rig.model.position.y - (lying - 0.6 * KINDS.deer.height)) < 1e-9);
});

const wolf = () => new Animal(KINDS.wolf, 0, 0);

test('the wolf plays its own clips, stands at its shoulder height and faces its heading', () => {
  for (const clip of Object.values(KINDS.wolf.clips)) assert.ok(gltfs.wolf.animations.some((c) => c.name === clip), clip);
  assert.ok(!gltfs.wolf.animations.some((c) => c.name.includes('|')), 'no duplicate clips');
  const f = figures();
  const scene = f.sources.wolf;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const height = (scene.getObjectByName('Neck1').getWorldPosition(new THREE.Vector3()).y - box.min.y) * f.fits.wolf.scale;
  assert.ok(Math.abs(height - KINDS.wolf.height) < KINDS.wolf.height * 0.05, `${height}`);
  const a = wolf();
  f.update(dt, [a]);
  const rig = f.rigs.get(a);
  for (const heading of [0, Math.PI / 2]) {
    a.heading = heading;
    f.update(dt, [a]);
    const head = rig.bones.Head.getWorldPosition(new THREE.Vector3());
    const hips = rig.bones.Body.getWorldPosition(new THREE.Vector3());
    const bearing = Math.atan2(head.x - hips.x, head.z - hips.z);
    assert.ok(Math.abs(Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading))) < 0.35, `${bearing}`);
  }
});

test('the wolf\'s gaits keep its paws planted, and its run outpaces a deer and the player', () => {
  const f = figures();
  const a = wolf();
  f.update(dt, [a]);
  const rig = f.rigs.get(a);
  const k = KINDS.wolf;
  const [lo, hi] = k.rates;
  for (const speed of [k.stalkSpeed, k.walkSpeed]) {
    const rate = speed / rig.walkSpeed;
    assert.ok(rate >= lo && rate <= hi, `walks ${speed} at ${rate}`);
  }
  for (const speed of [k.trotSpeed, k.runSpeed]) {
    const rate = speed / rig.runSpeed;
    assert.ok(rate >= lo && rate <= hi, `gallops ${speed} at ${rate}`);
  }
  assert.ok(k.runSpeed >= Math.max(KINDS.deer.fleeSpeed, 1.2 * 5.3));
  // A trotting wolf is all gallop, at the clip's rate for its speed.
  Object.assign(a, { state: 'trot', speed: k.trotSpeed, groundSpeed: k.trotSpeed });
  for (let i = 0; i < 40; i++) f.update(dt, [a]);
  assert.ok(rig.weights.run > 0.95);
  assert.ok(Math.abs(rig.actions.run.timeScale - k.trotSpeed / rig.runSpeed) < 1e-9);
});

test('the wolf\'s jaws close at its bite\'s wind-up; the bite plays once from its start for each lunge', () => {
  const f = figures();
  const a = wolf();
  f.update(dt, [a]);
  const rig = f.rigs.get(a);
  const action = rig.actions.attack;
  assert.equal(action.loop, THREE.LoopOnce);
  assert.equal(action.clampWhenFinished, true);
  // The moment the muzzle reaches furthest forward, at the bite's pace.
  const clip = action.getClip();
  for (const other of Object.values(rig.actions)) other.setEffectiveWeight(0);
  action.setEffectiveWeight(1);
  let best = -Infinity;
  let at = 0;
  for (let i = 0; i <= 120; i++) {
    action.time = (i / 120) * clip.duration;
    rig.mixer.update(0);
    rig.inner.rotation.y = -f.fits.wolf.yaw;
    rig.model.rotation.y = 0;
    rig.model.updateMatrixWorld(true);
    const z = rig.bones.Head_end.getWorldPosition(new THREE.Vector3()).z;
    if (z > best) {
      best = z;
      at = action.time;
    }
  }
  const rate = clip.duration / KINDS.wolf.attack.swingTime;
  assert.ok(Math.abs(at / rate - KINDS.wolf.attack.windUp) < 0.06, `jaws at ${at / rate}`);
  // Each lunge starts the clip over.
  a.state = 'attack';
  a.swing = 1;
  for (let i = 0; i < 20; i++) f.update(dt, [a]);
  assert.ok(rig.weights.attack > 0.9);
  assert.ok(Math.abs(action.timeScale - rate) < 1e-9);
  const first = action.time;
  a.swing = 2;
  f.update(dt, [a]);
  assert.ok(action.time < first, 'a new lunge starts it over');
});

test('a stalking wolf walks with its head low, its legs untouched by the head-low clip', () => {
  const f = figures();
  const a = wolf();
  f.update(dt, [a]);
  const rig = f.rigs.get(a);
  const tracks = rig.actions.headLow.getClip().tracks.map((t) => t.name.split('.')[0]);
  assert.ok(tracks.length > 0 && tracks.every((n) => LOOKS.wolf.masks.headLow.includes(n)));
  const legs = () => rig.tips.map((tip) => tip.getWorldPosition(new THREE.Vector3()));
  const head = () => rig.bones.Head.getWorldPosition(new THREE.Vector3());
  const pose = (low) => {
    for (const other of Object.values(rig.actions)) other.setEffectiveWeight(0);
    rig.actions.walk.setEffectiveWeight(1);
    rig.actions.walk.time = 0.3;
    rig.actions.headLow.setEffectiveWeight(low);
    rig.actions.headLow.time = 1;
    rig.mixer.update(0);
    rig.model.updateMatrixWorld(true);
    return { legs: legs(), head: head() };
  };
  const plain = pose(0);
  const low = pose(0.45);
  for (let i = 0; i < 4; i++) assert.ok(plain.legs[i].distanceTo(low.legs[i]) < 1e-6, `leg ${i}`);
  assert.ok(low.head.y < plain.head.y - 0.005, 'the head is lower');
  // Moving at the stalk it walks with the blend; standing, it idles with it.
  Object.assign(a, { state: 'stalk', speed: 0.8, groundSpeed: 0.8 });
  for (let i = 0; i < 40; i++) f.update(dt, [a]);
  assert.ok(rig.weights.walk > 0.95 && Math.abs(rig.weights.headLow - 0.45) < 0.02);
  Object.assign(a, { speed: 0, groundSpeed: 0 });
  for (let i = 0; i < 40; i++) f.update(dt, [a]);
  assert.ok(rig.weights.idle > 0.95 && rig.weights.headLow > 0.4);
});

test('a wolf feeds with the eating clip, snarls on its ring place, and looks about at rest', () => {
  const f = figures();
  const top = (set) => {
    const a = wolf();
    Object.assign(a, set);
    for (let i = 0; i < 40; i++) f.update(dt, [a]);
    return Object.entries(f.rigs.get(a).weights).sort((x, y) => y[1] - x[1])[0][0];
  };
  assert.equal(top({ state: 'feed' }), 'graze');
  assert.equal(top({ state: 'snarl' }), 'look');
  assert.equal(top({ state: 'idle' }), 'idle');
  assert.equal(top({ state: 'idle', looking: true }), 'look');
  assert.equal(top({ state: 'retreat', speed: 6.4, groundSpeed: 6.4 }), 'run');
});

test('a wolf on the hunt is drawn before nearer grazing deer and fleeing ones before calm', () => {
  const gpu = fakeGPU();
  const f = new AnimalFigures(gltfs, { renderer: gpu });
  const herd = Array.from({ length: 6 }, (_, i) => new Animal(KINDS.deer, i * 5, 0, { variant: 'hind' }));
  const animals = new Animals({ counts: { wolf: 4 } });
  const pack = animals.spawn('wolf', { x: 60, y: 0, count: 1 });
  const hunter = pack.members[0];
  pack.pack.phase = 'hunt';
  const all = [...herd, hunter];
  f.update(dt, all);
  const view = { x0: -200, y0: -100, cols: 400, rows: 200 };
  const drawn = f.rasterise(view, all, { x: 0, y: 0 }).map((d) => d.animal);
  assert.equal(drawn[0], hunter);
  assert.equal(drawn.length, 6);
  // Out of the priority range, it is just another animal.
  hunter.x = 1200;
  f.update(dt, all);
  assert.ok(!f.rasterise(view, all, { x: 0, y: 0 }).some((d) => d.animal === hunter));
  hunter.x = 60;
  pack.pack.phase = 'roam';
  herd[5].state = 'flee';
  f.update(dt, all);
  const order = f.rasterise(view, all, { x: 0, y: 0 }).map((d) => d.animal);
  assert.equal(order[0], herd[5]);
});

test('the wolf model is credited and light', () => {
  const text = readFileSync(new URL('../assets/animals/LICENSE.txt', import.meta.url), 'utf8');
  assert.match(text, /wolf\.glb/);
  assert.ok(statSync(new URL('../assets/animals/wolf.glb', import.meta.url)).size < 1.2 * 1024 * 1024);
});

// Birds and fish.
const { BIRD, Bird } = await import('../src/entities/birds.js');
const { FISH, Fish } = await import('../src/entities/fish.js');
const { FLOATING, SHEEN } = await import('../src/world/terrain/water.js');
const { family, glyph } = await import('../src/render/glyphs.js');
const pigeon = (state = 'feed', extra = {}) => Object.assign(new Bird(0, 0), { state }, extra);
const fish = (extra = {}) => Object.assign(new Fish(0, 0), extra);

test('every clip the pigeon and fish play is in their models, at the lengths their kinds expect', () => {
  for (const [name, kind] of [['pigeon', BIRD], ['fish', FISH]]) {
    for (const [key, clipName] of Object.entries(kind.clips)) {
      const clip = gltfs[name].animations.find((c) => c.name === clipName);
      assert.ok(clip, `${name} ${clipName}`);
      assert.ok(Math.abs(clip.duration - kind.lengths[key]) < 0.01, `${clipName} ${clip.duration}`);
    }
  }
  // The fish's measured swim speed: one tail beat a loop.
  const tail = gltfs.fish.scene.getObjectByName('Tail');
  const mixer = new THREE.AnimationMixer(gltfs.fish.scene);
  const clip = gltfs.fish.animations[0];
  const action = mixer.clipAction(clip).play();
  const xs = [];
  for (let i = 0; i < 60; i++) {
    action.time = (clip.duration * i) / 60;
    mixer.update(0);
    gltfs.fish.scene.updateMatrixWorld(true);
    xs.push(tail.getWorldPosition(new THREE.Vector3()).x);
  }
  mixer.stopAllAction();
  const mid = (Math.max(...xs) + Math.min(...xs)) / 2;
  let crossings = 0;
  for (let i = 0; i < 60; i++) if (Math.sign(xs[i] - mid) !== Math.sign(xs[(i + 1) % 60] - mid)) crossings++;
  assert.equal(crossings, 2, 'one sweep each way a loop');
  assert.ok(Math.abs(FISH.swimSpeed - (0.7 * FISH.length) / clip.duration) < 1e-3);
});

test('the pigeon and the fish are scaled nose to tail and face their heading', () => {
  const f = figures();
  for (const [name, kind, make] of [['pigeon', BIRD, () => pigeon()], ['fish', FISH, () => fish()]]) {
    const scene = f.sources[name];
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene, true);
    const length = (box.max.z - box.min.z) * f.fits[name].scale;
    assert.ok(Math.abs(length - kind.length) < kind.length * 0.05, `${name} ${length}`);
    const s = make();
    f.update(dt, [], [s]);
    f.shown.add(s);
    const rig = f.rigOf(s);
    for (const heading of [0, Math.PI / 2]) {
      s.heading = heading;
      rig.update(dt, s);
      const head = rig.bones[LOOKS[name].head.replace('.', '')].getWorldPosition(new THREE.Vector3());
      const hips = rig.bones[LOOKS[name].hips.replace('.', '')].getWorldPosition(new THREE.Vector3());
      const bearing = Math.atan2(head.x - hips.x, head.z - hips.z);
      assert.ok(Math.abs(Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading))) < 0.5, `${name} ${bearing}`);
    }
    assert.equal(f.speeds[name], undefined, 'no gait speeds are measured');
    assert.deepEqual(rig.waterContacts(), []);
  }
});

test('a pigeon plays its own clip for every state, and never a graze', () => {
  const f = figures();
  const want = [['feed', 'idle'], ['alert', 'idle'], ['takeoff', 'takeoff'], ['land', 'land'],
    ['fly', 'flap', { clip: 'flap' }], ['fly', 'glide', { clip: 'glide' }],
    ['flutter', 'takeoff', { va: 1 }], ['flutter', 'takeoff', { va: 0 }], ['flutter', 'land', { va: -1 }]];
  for (const [state, clip, extra] of want) {
    const b = pigeon(state, extra);
    const rig = f.rigOf(b);
    for (let i = 0; i < 30; i++) rig.update(dt, b);
    assert.ok(rig.weights[clip] > 0.95, `${state} ${clip}`);
    assert.equal(rig.weights.graze, undefined);
  }
  assert.throws(() => f.rigOf(pigeon('dead')).update(dt, pigeon('dead')), /No pose/);
});

test('a flying pigeon keeps the height it left the ground at; a fish hangs at its swim depth', () => {
  const f = figures();
  const b = pigeon('feed');
  const rig = f.rigOf(b);
  rig.update(dt, b);
  const standing = rig.model.position.y;
  assert.ok(standing > 0.05, 'on its toes');
  Object.assign(b, { state: 'fly', alt: 5, clip: 'flap' });
  for (let i = 0; i < 20; i++) rig.update(dt, b);
  assert.equal(rig.model.position.y, standing, 'not pulled to the ground');
  b.pitch = 0.3;
  rig.update(dt, b);
  assert.ok(Math.abs(rig.model.rotation.x + 0.3) < 1e-9, 'the whole body pitches');
  const s = fish({ swim: 0.2 });
  const fr = f.rigOf(s);
  for (let i = 0; i < 5; i++) fr.update(dt, s);
  assert.equal(fr.model.position.y, -0.2);
  assert.equal(fr.tips.length, 0);
});

test('a creature posed again after a while resumes from its own clock', () => {
  const f = figures();
  const s = fish({ clipTime: 0, rate: 2 });
  const rig = f.rigOf(s);
  rig.update(dt, s);
  s.clipTime = 7.3;
  rig.update(dt, s);
  const length = rig.actions.swim.getClip().duration;
  assert.ok(Math.abs(rig.actions.swim.time - (7.3 % length)) < 1e-6);
  // A one-shot is held at its end, not looped.
  const b = pigeon('land', { clipTime: 9 });
  const br = f.rigOf(b);
  br.update(dt, b);
  assert.ok(br.actions.land.time > br.actions.land.getClip().duration - 0.01);
  // A clip fading out runs on at its own rate.
  b.state = 'feed';
  b.clipTime = 0;
  const before = br.times.land;
  br.update(dt, b);
  assert.ok(br.times.land > before);
});

test('birds and fish ride a shelf of their own in the same single readback, capped apart from the animals', (t) => {
  const gpu = fakeGPU();
  const f = new AnimalFigures(gltfs, { renderer: gpu });
  const reads = t.mock.method(gpu, 'getContext');
  const view = { x0: -300, y0: -150, cols: 600, rows: 300 };
  const deer = Array.from({ length: 6 }, (_, i) => Object.assign(hind(), { x: i * 30 - 75, y: 10 }));
  const flock = Array.from({ length: 10 }, (_, i) => pigeon('feed', { x: i * 12 - 60, y: -20 }));
  const pack = new Animals({ counts: { wolf: 4 } }).spawn('wolf', { x: 200, y: 60, count: 1 });
  pack.pack.phase = 'hunt';
  const prowler = pack.members[0];
  f.update(dt, [...deer, prowler], flock);
  const out = f.rasterise(view, [...deer, prowler], { x: 0, y: 0 }, flock);
  assert.equal(reads.mock.callCount(), 1, 'one readback');
  assert.equal(out.filter((d) => !d.small).length, MAX_DRAWN);
  assert.equal(out.filter((d) => d.small).length, MAX_SMALL);
  assert.ok(out.some((d) => d.animal === prowler), 'an engaged wolf still outranks the grazers');
  assert.ok(out.filter((d) => d.small).every((d) => d.cells.length > 0), 'the shelf is read back');
  assert.ok(out.filter((d) => d.small).every((d) => !d.air && !d.submerged && d.shadowFade === 1));
  // On phones, fewer of each; only those drawn are posed next frame.
  const phone = new AnimalFigures(gltfs, { renderer: fakeGPU(), phone: () => true });
  phone.update(dt, deer, flock);
  const few = phone.rasterise(view, deer, { x: 0, y: 0 }, flock);
  assert.equal(few.filter((d) => !d.small).length, MAX_DRAWN_PHONE);
  assert.equal(few.filter((d) => d.small).length, MAX_SMALL_PHONE);
  const posedBefore = [...phone.rigs].filter(([s, r]) => flock.includes(s) && r.posed === phone.frameNo).length;
  assert.equal(posedBefore, MAX_SMALL_PHONE);
  phone.update(dt, deer, flock);
  const posed = [...phone.rigs].filter(([s, r]) => flock.includes(s) && r.posed === phone.frameNo);
  assert.equal(posed.length, MAX_SMALL_PHONE);
  assert.ok(posed.every(([s]) => phone.shown.has(s)));
  // Only small creatures: still drawn; nothing in view: nothing read.
  const lone = new AnimalFigures(gltfs, { renderer: fakeGPU() });
  assert.equal(lone.rasterise(view, [], { x: 0, y: 0 }, [pigeon('feed')]).length, 1);
  assert.equal(lone.rasterise(view, [], { x: 0, y: 0 }, [pigeon('feed', { x: 5000 })]).length, 0);
});

test('a newcomer outranking those already drawn waits one frame for its pose, not for ever', () => {
  for (const phone of [false, true]) {
    const f = new AnimalFigures(gltfs, { renderer: fakeGPU(), phone: () => phone });
    const cap = phone ? MAX_SMALL_PHONE : MAX_SMALL;
    const view = { x0: -300, y0: -150, cols: 600, rows: 300 };
    const flock = Array.from({ length: cap }, (_, i) => pigeon('feed', { x: i * 12 - 60, y: -20 }));
    f.update(dt, [], flock);
    f.rasterise(view, [], { x: 0, y: 0 }, flock);
    const flyer = pigeon('fly', { x: 30, y: 10, alt: 2, clip: 'glide' });
    const all = [...flock, flyer];
    const frames = [];
    for (let i = 0; i < 4; i++) {
      f.update(dt, [], all);
      const out = f.rasterise(view, [], { x: 0, y: 0 }, all);
      assert.equal(out.length, cap);
      frames.push(out.some((d) => d.animal === flyer));
    }
    assert.deepEqual(frames, [false, true, true, true], phone ? 'phone' : 'desktop');
  }
});

test('birds rising or flying near come first, then darting fish, then the nearest', () => {
  const f = new AnimalFigures(gltfs, { renderer: fakeGPU() });
  const view = { x0: -300, y0: -150, cols: 600, rows: 300 };
  const near = Array.from({ length: 8 }, (_, i) => pigeon('feed', { x: i * 6 - 24, y: 0 }));
  const flying = pigeon('fly', { x: 150, y: 60, alt: 2, clip: 'glide' });
  const darting = fish({ x: -150, y: 60, state: 'dart' });
  const all = [...near, flying, darting];
  f.update(dt, [], all);
  const out = f.rasterise(view, [], { x: 0, y: 0 }, all);
  assert.ok(out.some((d) => d.animal === flying && d.air && d.shadowFade === 0));
  assert.ok(out.some((d) => d.animal === darting && d.submerged && d.shadowFade === 0));
});

test('a bird 6 m up is framed round its body, whole inside its slot', () => {
  const f = new AnimalFigures(gltfs, { renderer: fakeGPU() });
  const b = pigeon('fly', { x: 0, y: 40, alt: 6, clip: 'glide' });
  const view = { x0: -150, y0: -60, cols: 300, rows: 160 };
  f.update(dt, [], [b]);
  const [d] = f.rasterise(view, [], { x: 0, y: 40 }, [b]);
  assert.ok(d.cells.length > 0);
  const slot = f.slotOf(b, view);
  assert.ok(slot.anchor < b.y - 50, 'raised by its altitude');
  assert.ok(slot.rows < 30, 'a small slot');
  assert.equal(d.base, Math.floor(b.y) - view.y0, 'standing over its ground row');
  assert.ok(Math.max(...d.cells.map((c) => c.sy)) < d.base - 40);
});

test('a fish under water is a soft smudge, no outline, its colour sunk toward the water\'s', () => {
  const f = new AnimalFigures(gltfs, { renderer: fakeGPU() });
  const s = fish({ x: 0, y: 0, swim: 0.2 });
  const view = { x0: -100, y0: -50, cols: 200, rows: 100 };
  f.update(dt, [], [s]);
  const [d] = f.rasterise(view, [], { x: 0, y: 0 }, [s]);
  const soft = new Set([...' .,:;~=≈'].map(glyph));
  assert.ok(d.cells.length > 0);
  for (const c of d.cells) {
    assert.ok(soft.has(c.g), 'no outline glyphs');
    assert.equal(c.br, undefined, 'no blot behind');
    assert.ok(Math.abs(c.k - 0.85 * (1 - 0.2 / 0.6)) < 1e-9);
  }
  // Drawn into water: only plain water cells take it, mixed between the
  // water and the fish.
  const cols = 200;
  const rows = 100;
  const fg = new Uint8ClampedArray(cols * rows * 4);
  const bg = new Uint8ClampedArray(cols * rows * 4).fill(10);
  const glyphs = new Uint16Array(cols * rows);
  const pad = family('water.pad.')[0];
  const crest = family('water.wave.')[0];
  const chop = family('water.chop.')[0];
  const sand = family('water.sand.')[0];
  const r = {
    cols, rows, bg, fg, mask: new Uint8Array(cols * rows).fill(WATER),
    glyphAt: (cell) => glyphs[cell],
    putAt(cell, g, cr, cg, cb) { glyphs[cell] = g; fg.set([cr, cg, cb], cell * 4); this.written.push(cell); },
    written: [],
  };
  const cells = d.cells.map((c) => c.sy * cols + c.sx);
  glyphs[cells[0]] = pad;
  glyphs[cells[1]] = crest;
  glyphs[cells[2]] = chop;
  glyphs[cells[3]] = sand;
  r.mask[cells[4]] = WATER + 1;
  AnimalFigures.drawSubmerged(r, { ...d, cells: [...d.cells, { sx: -1, sy: 0 }, { sx: 0, sy: rows }] });
  assert.ok(!r.written.includes(cells[0]), 'a lily pad stays over it');
  assert.ok(!r.written.includes(cells[1]), 'a crest stays over it');
  assert.ok(!r.written.includes(cells[2]), 'chop stays over it');
  assert.ok(r.written.includes(cells[3]), 'the sandy bed shows it');
  assert.ok(!r.written.includes(cells[4]), 'never off the water');
  const c = d.cells[5];
  const at5 = cells[5] * 4;
  for (const [i, v] of [[0, c.r], [1, c.gg], [2, c.b]]) {
    const lo = Math.min(10, v);
    const hi = Math.max(10, v) + 18;
    assert.ok(fg[at5 + i] >= lo - 1 && fg[at5 + i] <= hi + 1, 'between the water and the fish');
  }
});

test('plain water is only bed and blank water: nothing that floats or catches the moon', () => {
  for (let g = 0; g < PLAIN.length; g++) {
    if (!PLAIN[g]) continue;
    assert.equal(FLOATING[g] ?? 0, 0, `floating ${g}`);
    assert.equal(SHEEN[g] ?? 0, 0, `sheen ${g}`);
  }
  for (const f of ['water.ring.', 'water.bubbles.', 'water.foam.', 'water.glint.', 'water.dash.']) {
    for (const g of family(f)) assert.equal(PLAIN[g], 0, f);
  }
  assert.equal(PLAIN[family('water.caustic.')[0]], 1);
});

test('a bird\'s shadow fades as it rises; a fish has none', () => {
  const r = { cols: 40, rows: 40, fg: new Float32Array(40 * 40 * 4).fill(100), bg: new Float32Array(40 * 40 * 4).fill(100),
    mask: new Uint8Array(40 * 40).fill(WATER + 1) };
  const view = { x0: -20, y0: -20, cols: 40, rows: 40 };
  const b = pigeon('feed', { x: 0, y: 0 });
  AnimalFigures.drawShadow(r, view, { animal: b, shadow: LOOKS.pigeon.shadow, shadowFade: 1 });
  const dark = Math.min(...r.fg);
  assert.ok(dark < 100);
  r.fg.fill(100);
  AnimalFigures.drawShadow(r, view, { animal: b, shadow: LOOKS.pigeon.shadow, shadowFade: 0 });
  AnimalFigures.drawShadow(r, view, { animal: fish(), shadow: null });
  assert.equal(Math.min(...r.fg), 100);
});

test('the pigeon and fish models are credited with their sources and licences', () => {
  const text = readFileSync(new URL('../assets/animals/LICENSE.txt', import.meta.url), 'utf8');
  assert.match(text, /pigeon\.glb/);
  assert.match(text, /Paul Spooner/);
  assert.match(text, /public domain/i);
  assert.match(text, /peripheralarbor\.com\/bird\.blend/);
  assert.match(text, /fish\.glb/);
  assert.match(text, /XWl86YFtpF/);
});
