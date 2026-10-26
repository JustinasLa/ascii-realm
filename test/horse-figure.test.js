import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';
import { HORSE, Horse } from '../src/entities/horses.js';
import { SCALE, TILT } from '../src/entities/rig.js';

const dataURL = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const threeURL = new URL('../vendor/three/three.module.min.js', import.meta.url).href;
// The browser import map resolved in Node, as in animal-figures.test.js:
// only the GPU renderer is replaced, and the horse module loads as a file so
// it counts toward coverage.
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
const { ModelFigure, dressCharacter } = await import(moduleURL('../src/entities/model.js'));
register(dataURL(`
  const redirect = new Map(${JSON.stringify([...modules])});
  export async function resolve(specifier, context, next) {
    if (specifier === 'three') return { url: redirect.get('three'), shortCircuit: true };
    const resolved = await next(specifier, context);
    return redirect.has(resolved.url) ? { url: redirect.get(resolved.url), shortCircuit: true } : resolved;
  }
`));
const { AnimalFigures } = await import('../src/entities/animal-figures.js');
const { FAR, HorseFigures, MAX_DRAWN, MAX_DRAWN_PHONE, NEAR, RIDER, bandCells, groundRowOf, riderLegs } = await import('../src/entities/horse-figure.js');
const THREE = await import(threeURL);

const parse = (path) => {
  const bytes = readFileSync(new URL(path, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
};
const horseGltf = await parse('../assets/animals/horse.glb');
const riderGltf = await parse('../assets/ual1.glb');
const stub = { setPixelRatio() {}, setSize() {}, setClearColor() {} };
const figures = (options = {}) => new HorseFigures(horseGltf, riderGltf, { renderer: stub, ...options });
const dt = 1 / 30;
const COS = Math.sqrt(1 - TILT * TILT);
const V = () => new THREE.Vector3();
const yawOf = (q) => {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);
// Identity of rigs, materials and figures is checked with `same`, never
// assert.equal: a failed assert.equal prints both sides in full, and a rig
// reaches every geometry buffer of the horse and rider, so the message
// alone takes gigabytes.
const same = (actual, expected, message) => assert.ok(actual === expected, message);

// The skinned vertices of a rig's horse, in the space of its model group.
function horsePoints(rig, keep) {
  rig.model.updateMatrixWorld(true);
  const out = [];
  const v = V();
  rig.inner.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    for (let i = 0; i < o.geometry.attributes.position.count; i++) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      rig.model.worldToLocal(v);
      if (keep(v)) out.push(v.clone());
    }
  });
  return out;
}

// A stand-in GPU: renders nothing, notes each slot drawn and whether it was
// drawn as depth, and reads back a solid body in every colour slot, with
// depth from `depthOf(i, j, w, h)` (a byte, or null for none) above it.
function fakeGPU(figs, depthOf = () => 128) {
  const slots = [];
  const gpu = {
    slots, reads: 0, log: [], riders: [],
    setPixelRatio() {}, setSize() {}, setClearColor() {}, setScissorTest() {}, clear() {}, setScissor() {},
    setViewport(x, y, w, h) { this.last = { x, y, w, h }; },
    render() {
      const f = figs();
      const depth = [...f.rigs.values()].every((rig) => rig.surfaces.every((s) => [s.depth].flat()
        .every((m, i) => [s.mesh.material].flat()[i] === m)));
      gpu.log.push(depth ? 'depth' : 'colour');
      gpu.riders.push([...f.rigs.values()].every((rig) => rig.rider.visible));
      slots.push({ ...this.last, depth });
    },
    getContext() {
      return {
        readPixels(x, y, w, h, format, type, out) {
          gpu.reads++;
          out.fill(0);
          for (const s of slots) {
            for (let j = 0; j < s.h; j++) {
              for (let i = 0; i < s.w; i++) {
                if (((i / s.w - 0.5) / 0.3) ** 2 + ((j / s.h - 0.5) / 0.3) ** 2 > 1) continue;
                const o = ((j + s.y) * w + s.x + i) * 4;
                if (!s.depth) out.set([150, 110, 80, 255], o);
                else {
                  const d = depthOf(i, j, s.w, s.h);
                  if (d !== null) out.set([d, d, d, 255], o);
                }
              }
            }
          }
          slots.length = 0;
        },
      };
    },
  };
  return gpu;
}

const view = { x0: -200, y0: -100, cols: 400, rows: 200 };

test('every clip the horse and rider play is in their models', () => {
  for (const name of Object.values(HORSE.clips)) assert.ok(horseGltf.animations.some((c) => c.name === name), name);
  for (const [key, length] of Object.entries(HORSE.lengths)) {
    const clip = horseGltf.animations.find((c) => c.name === HORSE.clips[key]);
    assert.ok(Math.abs(clip.duration - length) < 0.01, `${key} ${clip.duration}`);
  }
  assert.ok(riderGltf.animations.some((c) => c.name === RIDER.clip));
  assert.throws(() => new HorseFigures({ ...horseGltf, animations: [] }, riderGltf, { renderer: stub }), /Missing clip Idle/);
  assert.throws(() => new HorseFigures(horseGltf, { ...riderGltf, animations: [] }, { renderer: stub }), /Missing clip Sitting/);
});

test('the horse stands with its back at the saddle height, withers above, facing its heading', () => {
  const f = figures();
  const h = new Horse(0, 0, { heading: 0 });
  f.update(0, [h]);
  const rig = f.rigs.get(h);
  const seat = rig.torso.localToWorld(f.fit.seat.clone());
  const back = horsePoints(rig, (v) => Math.abs(v.x) < 0.08 && Math.abs(v.z - seat.z) < 0.08);
  const top = Math.max(...back.map((v) => v.y));
  assert.ok(Math.abs(top - HORSE.backHeight) < 0.02, `back ${top}`);
  const neck = rig.hbones[bone('Neck1')].getWorldPosition(V());
  const withers = Math.max(...horsePoints(rig, (v) => Math.abs(v.x) < 0.1 && v.z > seat.z + 0.2 && v.z < neck.z).map((v) => v.y));
  assert.ok(withers >= 1.55 && withers <= 1.7, `withers ${withers}`);
  for (let k = 0; k < 8; k++) {
    h.heading = (k * Math.PI) / 4;
    f.update(dt, [h]);
    const head = rig.hbones.Head.getWorldPosition(V());
    const body = rig.hbones.Body.getWorldPosition(V());
    const bearing = Math.atan2(head.x - body.x, head.z - body.z);
    assert.ok(Math.abs(wrap(bearing - h.heading)) < (3 * Math.PI) / 180, `heading ${h.heading}: ${bearing}`);
  }
});

test('the lowest hoof stays on the ground through every idle the horse plays', () => {
  const f = figures();
  const h = new Horse(0, 0, { rider: false });
  for (const clip of ['idle', 'shift', 'graze']) {
    h.play(clip);
    for (let i = 0; i < 30; i++) {
      f.update(HORSE.lengths.graze / 30, [h]);
      const rig = f.rigs.get(h);
      rig.model.updateMatrixWorld(true);
      const lowest = Math.min(...rig.tips.map((t) => t.getWorldPosition(V()).y));
      assert.ok(Math.abs(lowest) < 0.01, `${clip} ${lowest}`);
    }
    // The clip played is the one asked for.
    assert.ok(f.rigs.get(h).weights[clip] > 0.99);
  }
});

test('a planted hoof holds still through the idle and the weight shift', () => {
  const f = figures();
  const h = new Horse(0, 0, { heading: -0.7 });
  f.update(0, [h]);
  const rig = f.rigs.get(h);
  const tracks = rig.tips.map(() => []);
  for (let i = 0; i < 240; i++) {
    if (i === 30) h.play('shift');
    f.update(dt, [h]);
    rig.model.updateMatrixWorld(true);
    rig.tips.forEach((t, k) => tracks[k].push(t.getWorldPosition(V())));
  }
  let moved = 0;
  for (const pts of tracks) {
    // Planted: on the ground and at rest. The shift paws with one hind
    // hoof, lifting it, setting it down ahead and scraping it back; that is
    // the clip's own and is not held to the limit.
    let from = null;
    pts.forEach((p, i) => {
      const q = pts[Math.max(0, i - 1)];
      const r = pts[Math.min(pts.length - 1, i + 1)];
      const speed = Math.max(Math.hypot(p.x - q.x, p.z - q.z), Math.hypot(r.x - p.x, r.z - p.z)) / dt;
      if (p.y > 0.015 || speed > 0.1) {
        from = null;
        return;
      }
      from ??= p;
      assert.ok(Math.hypot(p.x - from.x, p.z - from.z) < 0.02, `planted hoof slid at frame ${i}`);
    });
    moved = Math.max(moved, Math.max(...pts.map((p) => Math.hypot(p.x - pts[0].x, p.z - pts[0].z))));
  }
  assert.ok(moved > 0.1, 'the shift moves a hoof');
});

test('the rider sits the back with their feet in the stirrups at every heading', () => {
  const f = figures();
  const h = new Horse(0, 0);
  f.update(0, [h]);
  const rig = f.rigs.get(h);
  const seatTop = (rig2) => {
    const seat = rig2.model.worldToLocal(rig2.torso.localToWorld(f.fit.seat.clone()));
    return Math.max(...horsePoints(rig2, (v) => Math.abs(v.x) < 0.08 && Math.abs(v.z - seat.z) < 0.08).map((v) => v.y));
  };
  let checked = 0;
  for (let k = 0; k < 8; k++) {
    h.heading = (k * Math.PI) / 4;
    for (let i = 0; i < 4; i++) {
      if (i === 2) h.play('shift');
      f.update(0.4, [h]);
      rig.model.updateMatrixWorld(true);
      // The seat rests on the back, sunk a little into it.
      const contact = rig.model.worldToLocal(rig.hips.getWorldPosition(V()));
      contact.y -= f.fit.seatBelowHips;
      assert.ok(Math.abs(contact.y - (seatTop(rig) - RIDER.seat.sink)) < 0.03, `seat ${contact.y}`);
      // Rider and horse face the same way: the rider turns with the back,
      // the heading applied once.
      const back = rig.torso.getWorldQuaternion(new THREE.Quaternion()).multiply(f.fit.unturn);
      const riderYaw = yawOf(rig.rider.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(Math.abs(wrap(riderYaw - yawOf(back))) < Math.PI / 180, `yaw ${riderYaw} ${yawOf(back)}`);
      assert.ok(Math.abs(wrap(riderYaw - h.heading)) < (10 * Math.PI) / 180);
      rig.legs.forEach((leg, side) => {
        const stirrup = rig.torso.localToWorld(f.fit.stirrups[side].clone());
        const foot = leg.foot.getWorldPosition(V());
        assert.ok(foot.distanceTo(stirrup) < 0.02, `foot ${foot.distanceTo(stirrup)}`);
        // Knees and feet stay outside the barrel.
        for (const joint of [leg.shin, leg.foot]) {
          const at = rig.model.worldToLocal(joint.getWorldPosition(V()));
          assert.ok(Math.abs(at.x) >= f.fit.barrel, `${joint.name} at ${at.x}`);
        }
        // The foot is level: its up is within 15 degrees of the world's.
        const turn = leg.foot.getWorldQuaternion(new THREE.Quaternion()).multiply(leg.rest.clone().invert());
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
        assert.ok(up.y > Math.cos((15 * Math.PI) / 180), `foot up ${up.y}`);
      });
      checked++;
    }
  }
  assert.equal(checked, 32);
  // A slow turn keeps the rider facing with the horse throughout.
  for (let i = 0; i < 20; i++) {
    h.heading += 0.05;
    f.update(dt, [h]);
    const back = rig.torso.getWorldQuaternion(new THREE.Quaternion()).multiply(f.fit.unturn);
    assert.ok(Math.abs(wrap(yawOf(rig.rider.getWorldQuaternion(new THREE.Quaternion())) - yawOf(back))) < Math.PI / 180);
  }
});

test('above the legs the rider plays the seated clip exactly as authored', () => {
  const f = figures();
  const h = new Horse(0, 0, { heading: 1.1 });
  for (let i = 0; i < 17; i++) f.update(dt, [h]);
  const rig = f.rigs.get(h);
  const legs = new Set(rig.legs.flatMap((l) => [l.thigh, l.shin, l.foot].map((b) => b.name)));
  let compared = 0;
  for (const track of f.riderClip.tracks) {
    const [node, prop] = track.name.split('.');
    if (prop !== 'quaternion' || legs.has(node) || !rig.rbones[node]) continue;
    const want = new THREE.Quaternion().fromArray(track.createInterpolant().evaluate(rig.sit.time));
    assert.ok(Math.abs(rig.rbones[node].quaternion.dot(want)) > 1 - 1e-6, node);
    compared++;
  }
  assert.ok(compared > 30, `${compared} bones`);
  // The legs alone are posed to the stirrups, by one function.
  assert.equal(typeof riderLegs, 'function');
});

test('depth reads back as the ground row under each point', () => {
  const frame = { top: 2.4, bottom: -0.6, pxHeight: 234, y: 40 };
  for (const [y, z] of [[0.2, 1], [0.2, -1], [1.4, 0.3], [0, 0]]) {
    const t = 20 - TILT * y - COS * z;
    const byte = Math.round(255 * (1 - (t - NEAR) / (FAR - NEAR)));
    const u = COS * y - TILT * z;
    const pixelRow = ((frame.top - u) / (frame.top - frame.bottom)) * frame.pxHeight - 0.5;
    const row = groundRowOf(byte, pixelRow, frame);
    assert.ok(Math.abs(row - (frame.y + z * SCALE * TILT)) < 0.5, `${y} ${z}: ${row}`);
  }
  const bands = bandCells([{ row: 42.2 }, { row: 39.9 }, { row: 41.8 }, { row: 40.4 }], 40.3, 7);
  assert.deepEqual(bands.map((b) => [b.y, b.cells.length, b.base]), [[40.3, 2, 7], [42.3, 2, 7]]);
});

test('a horse is drawn in bands: the near legs in a later band than the far ones', () => {
  let f;
  // The left half of each slot is near the camera, the right half far; a
  // strip down the middle has no depth at all.
  const gpu = fakeGPU(() => f, (i, j, w) => (Math.abs(i - w / 2) < 8 ? null : i < w / 2 ? 200 : 60));
  f = figures({ renderer: gpu });
  const h = new Horse(0, 0, { heading: Math.PI / 2 });
  f.update(dt, [h]);
  const [figure] = f.rasterise(view, [h], h);
  assert.equal(gpu.reads, 1);
  assert.deepEqual(gpu.log, ['colour', 'depth']);
  assert.ok(figure.bands.length >= 2);
  const mid = (figure.cells.reduce((s, c) => s + c.sx, 0)) / figure.cells.length;
  const bandOf = (c) => figure.bands.find((b) => b.cells.includes(c)).y;
  const left = figure.cells.filter((c) => c.sx < mid - 3);
  const right = figure.cells.filter((c) => c.sx > mid + 3);
  assert.ok(Math.min(...left.map(bandOf)) > Math.max(...right.map(bandOf)), 'near cells come later');
  assert.ok(figure.bands.every((b, i, all) => !i || all[i - 1].y < b.y));
  assert.equal(figure.bands.reduce((n, b) => n + b.cells.length, 0), figure.cells.length);
  // Cells with no depth under them take the horse's own row.
  assert.ok(figure.cells.some((c) => c.row === h.y));
  // Outline glyphs and a shaded body, as the animals have.
  assert.ok(new Set(figure.cells.map((c) => c.g)).size >= 3);
  // The flat switch puts every cell in one band at the horse's row.
  f.flat = true;
  const [flat] = f.rasterise(view, [h], h);
  assert.deepEqual(flat.bands.map((b) => [b.y, b.cells.length]), [[h.y, flat.cells.length]]);
  const written = [];
  HorseFigures.draw(null, flat.bands[0], (...args) => written.push(args));
  assert.equal(written.length, flat.cells.length);
  assert.ok(written.every((w) => w[7] === flat.base));
});

test('one readback serves every horse drawn; the depth pass keeps sidedness, leaves out the rider and is undone', () => {
  let f;
  const gpu = fakeGPU(() => f);
  f = figures({ renderer: gpu });
  const herd = [0, 1].map((i) => new Horse(i * 60, 0));
  f.update(dt, herd);
  const drawn = f.rasterise(view, herd, { x: 0, y: 0 });
  assert.equal(drawn.length, 2);
  assert.equal(gpu.reads, 1);
  assert.deepEqual(gpu.log, ['colour', 'colour', 'depth', 'depth']);
  // The riders are drawn in colour only.
  assert.deepEqual(gpu.riders, [true, true, false, false]);
  for (const rig of f.rigs.values()) {
    for (const s of rig.surfaces) {
      same(s.mesh.material, s.colour, 'colours are back');
      for (const [colour, depth] of [[s.colour, s.depth]].flatMap(([c, d]) => (Array.isArray(c) ? c.map((m, i) => [m, d[i]]) : [[c, d]]))) {
        assert.ok(depth.isMeshDepthMaterial);
        assert.equal(depth.side, colour.side);
      }
    }
    assert.ok(rig.model.visible);
    assert.ok(rig.rider.visible);
  }
  // A double-sided surface gets a double-sided depth, one shared by all.
  const twoSided = f.depthFor(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }));
  assert.equal(twoSided.side, THREE.DoubleSide);
  same(f.depthFor(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })), twoSided, 'shared');
  // Every figure carries what the animals' shadow needs.
  for (const d of drawn) {
    same(d.animal, d.horse, 'the shadow finds the horse');
    assert.equal(d.shadow, HORSE.shadow);
    assert.equal(d.depth, d.horse.y);
  }
  // A wider body than the image grows it.
  f.grow(f.width + 10, f.height + 10);
  assert.equal(f.pixels.length, f.width * f.height * 4);
});

test('at most two are drawn, on phones too, nearest the player first; none out of view', () => {
  let phone = false;
  let f;
  f = figures({ renderer: fakeGPU(() => f), phone: () => phone });
  const herd = [5, 1, 4, 0, 3, 2].map((i) => new Horse(i * 50, 0));
  f.update(dt, herd);
  const near = { x: 0, y: 0 };
  assert.equal(MAX_DRAWN, 2);
  assert.deepEqual(f.rasterise(view, herd, near).map((d) => d.horse.x), [0, 50]);
  phone = true;
  assert.equal(MAX_DRAWN_PHONE, 2);
  assert.deepEqual(f.rasterise(view, herd, near).map((d) => d.horse.x), [0, 50]);
  assert.equal(f.rasterise({ x0: 9000, y0: 0, cols: 10, rows: 10 }, herd, near).length, 0);
  // Just off the left of the view, close enough to be framed but wholly outside it.
  same(f.slotOf(herd[3], { x0: 58, y0: -30, cols: 40, rows: 40 }), null, 'no slot');
  // Rigs of horses taken away wait for the next.
  const rig = f.rigs.get(herd[0]);
  f.update(dt, herd.slice(1));
  assert.ok(f.spare.includes(rig));
  const newcomer = new Horse(0, 0);
  f.update(dt, [...herd.slice(1), newcomer]);
  same(f.rigs.get(newcomer), rig, 'the newcomer takes the rig left over');
  assert.equal(f.spare.length, 0);
});

test('the shadow of a horse is the animals\' shadow at its length', () => {
  let f;
  f = figures({ renderer: fakeGPU(() => f) });
  const h = new Horse(30, 15, { heading: Math.PI / 2 });
  f.update(dt, [h]);
  const [figure] = f.rasterise({ x0: 0, y0: 0, cols: 60, rows: 30 }, [h], h);
  const cols = 60;
  const r = { cols, fg: new Float32Array(cols * 30 * 4).fill(100), bg: new Float32Array(cols * 30 * 4).fill(100),
    mask: new Uint8Array(cols * 30).fill(2) };
  AnimalFigures.drawShadow(r, { x0: 0, y0: 0, cols, rows: 30 }, figure);
  const dark = (x, y) => r.fg[(y * cols + x) * 4] < 100;
  assert.ok(dark(30, 15) && dark(50, 15), 'long across the screen side-on');
  assert.ok(!dark(30, 22));
});

test('the models load once each, and without WebGL the horses go undrawn', async (t) => {
  const urls = [];
  t.mock.method(ModelFigure, 'library', async (url) => {
    urls.push(url);
    return url.includes('horse') ? horseGltf : riderGltf;
  });
  const f = await HorseFigures.load({ renderer: stub });
  assert.ok(f instanceof HorseFigures);
  assert.deepEqual(urls.sort(), ['assets/animals/horse.glb', 'assets/ual1.glb']);
  const warn = t.mock.method(console, 'warn', () => {});
  same(await HorseFigures.load(), null, 'no figures without WebGL');
  assert.equal(warn.mock.callCount(), 1);
});

test('the rider is dressed as the outlaw is', () => {
  const { model, bones, gear, armory } = dressCharacter(riderGltf);
  assert.ok(model !== riderGltf.scene, 'a copy');
  const source = [];
  riderGltf.scene.traverse((o) => { if (o.isBone) source.push(o.name); });
  assert.deepEqual(Object.keys(bones).sort(), source.sort());
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    assert.ok(o.material.isMeshLambertMaterial);
    assert.equal(typeof o.material.userData.joint, 'boolean');
  });
  assert.ok(gear.cloak && armory.hip);
  // The rider's cloak is taken up to the saddle; the player's is not.
  const f = figures();
  const rig = f.spare[0];
  assert.ok(Math.abs(rig.gear.cloak.scale.y / gear.cloak.scale.y - 0.55) < 1e-9);
  assert.equal(rig.gear.cloak.scale.x, gear.cloak.scale.x);
  // Only the horse is drawn as depth.
  let horseMeshes = 0;
  rig.inner.traverse((o) => { if (o.isMesh) horseMeshes++; });
  assert.ok(horseMeshes >= 8);
  assert.equal(rig.surfaces.length, horseMeshes);
});

test('the horse model is credited, CC0, as published bar its duplicate clips, and light', () => {
  const text = readFileSync(new URL('../assets/animals/LICENSE.txt', import.meta.url), 'utf8');
  assert.match(text, /horse\.glb/);
  assert.match(text, /fae7a7ec91e0d6a33554efb896fac9c4e8c632644183bcb8cc962f673d3ce609/);
  const size = statSync(new URL('../assets/animals/horse.glb', import.meta.url)).size;
  assert.ok(size < 0.9 * 1024 * 1024, `${size} bytes`);
  assert.equal(horseGltf.animations.length, 13);
  assert.ok(horseGltf.animations.every((c) => !c.name.includes('|')));
  const credits = readFileSync(new URL('../docs/credits.md', import.meta.url), 'utf8');
  assert.match(credits, /horse/);
});
