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
const { DETAIL, FAR, HorseFigures, MAX_DRAWN, MAX_DRAWN_PHONE, NEAR, RIDER, STILL, TURN, bandCells, coarsen, depthAlpha, groundRowOf,
  mergeFigure, riderLegs, writeDepth } = await import('../src/entities/horse-figure.js');
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

// A stand-in GPU: renders nothing, notes which horses each render shows
// and whether their riders are shown, and reads back a solid body in every
// slot drawn, with the depth in its alpha from `depthOf(i, j, w, h)` (a
// byte from 128 near to 255 far).
function fakeGPU(figs, depthOf = () => 191) {
  const slots = [];
  const gpu = {
    slots, reads: 0, log: [], riders: [],
    setPixelRatio() {}, setSize() {}, setClearColor() {}, setScissorTest() {}, clear() {}, setScissor() {},
    setViewport(x, y, w, h) { this.last = { x, y, w, h }; },
    render() {
      const shown = [...figs().rigs].filter(([, rig]) => rig.model.visible);
      gpu.log.push(shown.map(([horse]) => horse));
      gpu.riders.push(shown.every(([, rig]) => rig.rider.visible));
      slots.push({ ...this.last });
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
                out.set([150, 110, 80, depthOf(i, j, s.w, s.h)], ((j + s.y) * w + s.x + i) * 4);
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

// A stand-in GPU that draws for real, if slowly: every triangle shown,
// skinned and projected by the camera into the slot, the nearest kept, its
// depth written into alpha as the figures' shaders write it. Both faces of
// every triangle are drawn. The rider is painted blue and the horse red, so
// a test can tell their cells apart (a cell all rider has blue 255).
function softGPU(figs) {
  let width = 0;
  let color;
  let depth;
  const gpu = {
    renders: 0, reads: 0,
    setPixelRatio() {}, setClearColor() {}, setScissorTest() {}, setScissor() {},
    setSize(w, h) {
      width = w;
      color = new Uint8Array(w * h * 4);
      depth = new Float32Array(w * h);
    },
    clear() {
      color.fill(0);
      depth.fill(Infinity);
    },
    setViewport(x, y, w, h) { this.view = { x, y, w, h }; },
    render(scene, camera) {
      gpu.renders++;
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      const riders = new Set();
      for (const rig of figs().rigs.values()) rig.rider.traverse((o) => riders.add(o));
      const { x: vx, y: vy, w: vw, h: vh } = this.view;
      const v = V();
      scene.traverse((o) => {
        if (!o.isMesh) return;
        for (let p = o; p; p = p.parent) if (!p.visible) return;
        const pos = o.geometry.attributes.position;
        const at = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          (o.isSkinnedMesh ? o.getVertexPosition(i, v) : v.fromBufferAttribute(pos, i)).applyMatrix4(o.matrixWorld);
          v.applyMatrix4(camera.matrixWorldInverse);
          at[i * 3 + 2] = -v.z;
          v.applyMatrix4(camera.projectionMatrix);
          at[i * 3] = vx + ((v.x + 1) / 2) * vw;
          at[i * 3 + 1] = vy + ((v.y + 1) / 2) * vh;
        }
        const paint = riders.has(o) ? [0, 0, 255] : [255, 0, 0];
        const index = o.geometry.index.array;
        for (let k = 0; k < index.length; k += 3) {
          const [ax, ay, at0, bx, by, bt, cx, cy, ct] = [index[k], index[k + 1], index[k + 2]].flatMap((i) => [...at.subarray(i * 3, i * 3 + 3)]);
          const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          if (!area) continue;
          for (let y = Math.max(vy, Math.floor(Math.min(ay, by, cy))); y < Math.min(vy + vh, Math.ceil(Math.max(ay, by, cy))); y++) {
            for (let x = Math.max(vx, Math.floor(Math.min(ax, bx, cx))); x < Math.min(vx + vw, Math.ceil(Math.max(ax, bx, cx))); x++) {
              const [px, py] = [x + 0.5, y + 0.5];
              const wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
              const wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
              const wc = 1 - wa - wb;
              if (wa < 0 || wb < 0 || wc < 0) continue;
              const t = wa * at0 + wb * bt + wc * ct;
              const d = y * width + x;
              if (t >= depth[d]) continue;
              depth[d] = t;
              color.set([...paint, depthAlpha(t)], d * 4);
            }
          }
        }
      });
    },
    // How far from the camera the nearest surface drawn at a pixel is.
    depthAt(x, y) {
      return depth[y * width + x];
    },
    getContext() {
      return {
        readPixels(x, y, w, h, format, type, out) {
          gpu.reads++;
          for (let j = 0; j < h; j++) out.set(color.subarray(((y + j) * width + x) * 4, ((y + j) * width + x + w) * 4), j * w * 4);
        },
      };
    },
  };
  return gpu;
}

const view = { x0: -200, y0: -100, cols: 400, rows: 200 };
const riderCell = (c) => c.b > 250;

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

test('every planted hoof holds still; only the steps the clips author move one', () => {
  const f = figures();
  const h = new Horse(0, 0, { heading: -0.7 });
  f.update(0, [h]);
  const rig = f.rigs.get(h);
  // One whole idle loop, then one weight shift, at 30 frames a second.
  const idle = Math.round(f.clips.idle.duration / dt);
  const frames = idle + Math.round(HORSE.lengths.shift / dt) + 15;
  const tracks = rig.tips.map(() => []);
  for (let i = 0; i < frames; i++) {
    if (i === idle) h.play('shift');
    f.update(dt, [h]);
    rig.tips.forEach((t, k) => tracks[k].push(t.getWorldPosition(V())));
  }
  // A hoof is in contact while it is on the ground. A step is a hoof the
  // clip lifts: from leaving the ground until it is set back within a
  // centimetre of the spot it stood on (the shift's paw lands ahead and
  // scrapes back to it). Every other sample in contact is planted, however
  // fast it might slide, and must stay within 2 cm of where its planted
  // spell began.
  const CONTACT = 0.015;
  const steps = [];
  const planted = [];
  tracks.forEach((pts, k) => {
    let stepping = null;
    let spell = null;
    let count = 0;
    let found = 0;
    pts.forEach((p, i) => {
      if (stepping) {
        if (p.y < CONTACT && Math.hypot(p.x - stepping.x, p.z - stepping.z) < 0.01) stepping = null;
        else return;
      }
      if (p.y >= CONTACT) {
        stepping = spell ?? pts[i - 1];
        spell = null;
        found++;
        return;
      }
      spell ??= p;
      count++;
      assert.ok(Math.hypot(p.x - spell.x, p.z - spell.z) < 0.02, `hoof ${k} slid while planted at frame ${i}`);
    });
    assert.equal(stepping, null, `hoof ${k} never came back from its step`);
    steps.push(found);
    planted.push(count / pts.length);
  });
  // The idle lifts a fore hoof once a loop and the shift paws with a hind
  // one; every hoof is planted for most of the time, so the check is real.
  assert.deepEqual(steps, [1, 0, 1, 0]);
  assert.ok(planted.every((share) => share > 0.8), `planted ${planted}`);
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

test('depth reads back from alpha as the ground row under each point', () => {
  const frame = { top: 2.4, bottom: -0.6, pxHeight: 234, y: 40 };
  for (const [y, z] of [[0.2, 1], [0.2, -1], [1.4, 0.3], [0, 0], [2.4, 0.4]]) {
    const t = 20 - TILT * y - COS * z;
    const u = COS * y - TILT * z;
    const pixelRow = ((frame.top - u) / (frame.top - frame.bottom)) * frame.pxHeight - 0.5;
    const row = groundRowOf(depthAlpha(t), pixelRow, frame);
    assert.ok(Math.abs(row - (frame.y + z * SCALE * TILT)) < 0.3, `${y} ${z}: ${row}`);
  }
  // Alpha 128 is the nearest depth written and 255 the furthest; beyond
  // them it holds, so anything drawn still reads as covered.
  assert.deepEqual([NEAR - 2, NEAR, FAR, FAR + 2].map(depthAlpha), [128, 128, 255, 255]);
  const bands = bandCells([{ row: 42.2 }, { row: 39.9 }, { row: 41.8 }, { row: 40.4 }], 40.3, 7);
  assert.deepEqual(bands.map((b) => [b.y, b.cells.length, b.base]), [[40.3, 2, 7], [42.3, 2, 7]]);
});

test('every surface writes its depth into alpha as it is drawn, from either side', () => {
  const material = writeDepth(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }));
  const shader = { vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /^varying float vDepth;/);
  assert.match(shader.vertexShader, /#include <project_vertex>\n\tvDepth = -mvPosition\.z;/);
  assert.match(shader.fragmentShader, /^varying float vDepth;/);
  assert.match(shader.fragmentShader,
    /#include <dithering_fragment>\n\tgl_FragColor\.a = \(128\.0 \+ floor\(clamp\(\(vDepth - 17\.0\) \/ 5\.0, 0\.0, 1\.0\) \* 127\.0 \+ 0\.5\)\) \/ 255\.0;/);
  assert.equal(material.side, THREE.DoubleSide);
  assert.ok(material.userData.writesDepth);
  // Everything a rig shows writes depth: the horse, and the rider's body
  // and gear, with the cloak and hood that are seen from both sides.
  const rig = figures().spare[0];
  const shown = [];
  rig.model.traverse((o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    if (o.isMesh) shown.push(o);
  });
  assert.equal(shown.length, 3);
  assert.ok(shown.every((o) => o.material.userData.writesDepth && o.isSkinnedMesh));
  assert.deepEqual(shown.map((o) => o.material.side).sort(), [THREE.FrontSide, THREE.FrontSide, THREE.DoubleSide].sort());
});

test('a coarser copy keeps each vertex it was taken from and drops the triangles that collapse', () => {
  const plane = new THREE.PlaneGeometry(1, 1, 20, 20);
  const coarse = coarsen(plane, 0.25);
  const pos = coarse.attributes.position;
  assert.ok(pos.count <= 25 && pos.count >= 16, `${pos.count} vertices`);
  assert.deepEqual(Object.keys(coarse.attributes).sort(), Object.keys(plane.attributes).sort());
  // Each vertex kept is one of the original's, with its other attributes.
  const original = new Map();
  for (let i = 0; i < plane.attributes.position.count; i++) {
    original.set(`${plane.attributes.position.getX(i)} ${plane.attributes.position.getY(i)}`, plane.attributes.uv.getX(i));
  }
  for (let i = 0; i < pos.count; i++) assert.equal(coarse.attributes.uv.getX(i), original.get(`${pos.getX(i)} ${pos.getY(i)}`));
  const index = coarse.index.array;
  assert.ok(index.length / 3 < 50 && index.length > 0);
  for (let t = 0; t < index.length; t += 3) assert.ok(new Set(index.slice(t, t + 3)).size === 3, 'no collapsed triangle');
  // A geometry without an index is read in order.
  assert.equal(coarsen(plane.toNonIndexed(), 0.25).attributes.position.count, pos.count);
  // The rider's body is a good deal lighter at the size the figures use.
  let full = 0;
  riderGltf.scene.traverse((o) => { if (o.isSkinnedMesh) full += o.geometry.index.count / 3; });
  let light = 0;
  riderGltf.scene.traverse((o) => { if (o.isSkinnedMesh) light += coarsen(o.geometry, DETAIL).index.count / 3; });
  assert.ok(light < full * 0.35, `${light} of ${full}`);
});

test('a merged figure is one mesh a side, moving and coloured as its pieces did', () => {
  // Two bones; a skinned strip on them, a box hung on the second bone, a
  // two-sided card hung through a mirroring group, and a hidden piece.
  const root = new THREE.Group();
  const b0 = new THREE.Bone();
  const b1 = new THREE.Bone();
  b1.position.set(0, 1, 0);
  b0.add(b1);
  root.add(b0);
  const strip = new THREE.BoxGeometry(0.2, 2, 0.2, 1, 4, 1).translate(0, 1, 0);
  const pos = strip.attributes.position;
  const weights = [];
  const indices = [];
  for (let i = 0; i < pos.count; i++) {
    const w = Math.min(1, Math.max(0, pos.getY(i) - 0.5));
    indices.push(0, 1, 0, 0);
    weights.push(1 - w, w, 0, 0);
  }
  strip.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  strip.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  strip.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.count * 3).fill(0.5), 3));
  const body = new THREE.SkinnedMesh(strip, new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }));
  root.add(body);
  root.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton([b0, b1]));
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshLambertMaterial({ color: 0x336699 }));
  box.position.set(0.4, 0.5, 0);
  b1.add(box);
  const flip = new THREE.Group();
  flip.scale.set(-1, 1, 1);
  b1.add(flip);
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshLambertMaterial({ color: 0x808080, side: THREE.DoubleSide }));
  card.position.set(0.3, 0.2, 0.1);
  flip.add(card);
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial());
  hidden.visible = false;
  b0.add(hidden);
  // Where every vertex is after a bend, piece by piece.
  const bend = () => {
    b0.rotation.set(0.2, 0.4, 0);
    b1.rotation.set(0.9, 0, 0.3);
    root.updateMatrixWorld(true);
  };
  const rest = () => {
    b0.rotation.set(0, 0, 0);
    b1.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
  };
  const where = (mesh) => {
    const out = [];
    const v = V();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      (mesh.isSkinnedMesh ? mesh.getVertexPosition(i, v) : v.fromBufferAttribute(mesh.geometry.attributes.position, i)).applyMatrix4(mesh.matrixWorld);
      out.push(v.clone());
    }
    return out;
  };
  bend();
  // Pieces go in the order they are found under the root: the box, then the body.
  const want = { front: [...where(box), ...where(body)], both: where(card) };
  rest();
  const meshes = mergeFigure(root);
  assert.equal(meshes.length, 2);
  const [front, both] = meshes;
  assert.equal(front.material.side, THREE.FrontSide);
  assert.equal(both.material.side, THREE.DoubleSide);
  assert.ok(meshes.every((m) => m.material.vertexColors && m.material.userData.writesDepth && m.parent === root));
  // The pieces are gone, bar the hidden one, left as it was.
  for (const piece of [body, box, card]) assert.ok(piece.parent === null);
  assert.ok(hidden.parent === b0);
  bend();
  for (const [mesh, points] of [[front, want.front], [both, want.both]]) {
    const got = where(mesh);
    assert.equal(got.length, points.length);
    got.forEach((p, i) => assert.ok(p.distanceTo(points[i]) < 1e-5, `vertex ${i} at ${p.toArray()} not ${points[i].toArray()}`));
  }
  // Colours: the box its own, the painted strip times its material.
  const color = front.geometry.attributes.color;
  const blue = new THREE.Color(0x336699);
  assert.ok(Math.abs(color.getZ(0) - blue.b) < 1e-6);
  assert.ok(Math.abs(color.getX(box.geometry.attributes.position.count) - 0.5) < 1e-6);
  // The mirrored card is wound back so its faces still face the way they did.
  const cardIndex = card.geometry.index.array;
  assert.deepEqual([...both.geometry.index.array.slice(0, 3)], [cardIndex[0], cardIndex[2], cardIndex[1]]);
  // A piece hung from no bone can't be merged.
  const loose = new THREE.Group();
  const skin = new THREE.SkinnedMesh(strip.clone(), new THREE.MeshLambertMaterial());
  const lb = new THREE.Bone();
  loose.add(lb, skin);
  loose.updateMatrixWorld(true);
  skin.bind(new THREE.Skeleton([lb, new THREE.Bone()]));
  loose.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshLambertMaterial()));
  assert.throws(() => mergeFigure(loose), /hangs from no bone/);
});

test('a horse is drawn in bands: the near legs in a later band than the far ones', () => {
  let f;
  // The left half of each slot is near the camera, the right half far.
  const gpu = fakeGPU(() => f, (i, j, w) => (i < w / 2 ? 140 : 240));
  f = figures({ renderer: gpu });
  const h = new Horse(0, 0, { heading: Math.PI / 2 });
  f.update(dt, [h]);
  const [figure] = f.rasterise(view, [h], h);
  assert.equal(gpu.reads, 1);
  assert.equal(gpu.log.length, 1);
  assert.ok(figure.bands.length >= 2);
  const mid = (figure.cells.reduce((s, c) => s + c.sx, 0)) / figure.cells.length;
  const bandOf = (c) => figure.bands.find((b) => b.cells.includes(c)).y;
  const left = figure.cells.filter((c) => c.sx < mid - 3);
  const right = figure.cells.filter((c) => c.sx > mid + 3);
  assert.ok(Math.min(...left.map(bandOf)) > Math.max(...right.map(bandOf)), 'near cells come later');
  assert.ok(figure.bands.every((b, i, all) => !i || all[i - 1].y < b.y));
  assert.equal(figure.bands.reduce((n, b) => n + b.cells.length, 0), figure.cells.length);
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

test('the rider\'s cells stand on the ground under the rider, before or behind a player in between', () => {
  let f;
  const gpu = softGPU(() => f);
  f = figures({ renderer: gpu });
  const h = new Horse(0.5, 0.5);
  for (const heading of [0, Math.PI / 4, (3 * Math.PI) / 4, Math.PI, (-3 * Math.PI) / 4, -Math.PI / 2]) {
    h.heading = heading;
    f.update(dt, [h]);
    const [figure] = f.rasterise(view, [h], h);
    const { slot } = f.rigs.get(h).raster;
    const height = slot.rows * 6;
    // The ground row under the nearest rider surface in each of the
    // rider's cells, from the exact depth drawn: t deep and u up the
    // camera's plane put it z toward the camera.
    const truth = (c) => {
      let row = -Infinity;
      for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 4; i++) {
          const pixelRow = (c.cy - slot.cy0) * 6 + j;
          const t = gpu.depthAt(slot.x + (c.cx - slot.cx0) * 4 + i, height - 1 - pixelRow);
          if (t === Infinity) continue;
          const u = (h.y - slot.cy0) / SCALE - (pixelRow + 0.5) / height * (slot.rows / SCALE);
          row = Math.max(row, h.y + (COS * (20 - t) - TILT * u) * SCALE * TILT);
        }
      }
      return row;
    };
    const rider = figure.cells.filter(riderCell);
    assert.ok(rider.length > 20, `${rider.length} rider cells at ${heading}`);
    const rows = rider.map(truth);
    rider.forEach((c, i) => assert.ok(Math.abs(c.row - rows[i]) < 0.35, `heading ${heading}: a rider cell on row ${c.row}, its surface on ${rows[i]}`));
    // A player halfway between the horse's middle and the rider's surface
    // furthest from it, toward or away from the camera: the rider's cells
    // nearer the camera than the player are drawn after them, the others
    // before, give or take the cells within half a row of them.
    const front = Math.max(...rows);
    const back = Math.min(...rows);
    const player = front - h.y > h.y - back ? (h.y + front) / 2 : (h.y + back) / 2;
    if (Math.abs(player - h.y) < 0.75) continue;
    const bandOf = (c) => figure.bands.find((b) => b.cells.includes(c)).y;
    const clear = rider.filter((c, i) => Math.abs(rows[i] - player) > 0.5);
    const right = clear.filter((c) => (bandOf(c) > player) === (truth(c) > player));
    assert.ok(clear.length > 10 && right.length === clear.length, `heading ${heading}: ${right.length} of ${clear.length} on the right side of a player on row ${player}`);
  }
});

test('a horse with no rider is shown, posed and drawn without one, idling and grazing', () => {
  let f;
  const gpu = softGPU(() => f);
  f = figures({ renderer: gpu });
  const h = new Horse(0.5, 0.5, { heading: Math.PI / 2, rider: false });
  f.update(dt, [h]);
  const rig = f.rigs.get(h);
  const sat = rig.sit.time;
  const ridden = new Horse(0.5, 0.5, { heading: Math.PI / 2 });
  for (const clip of ['idle', 'graze']) {
    h.play(clip);
    for (let i = 0; i < 6; i++) f.update(0.3, [h]);
    assert.ok(!rig.rider.visible, clip);
    assert.equal(rig.sit.time, sat, 'the rider is not posed');
    const [figure] = f.rasterise(view, [h], h);
    assert.ok(figure.cells.length > 100);
    assert.equal(figure.cells.filter(riderCell).length, 0, `no rider cells while ${clip}`);
    assert.equal(figure.shadow, HORSE.shadow);
  }
  // The slot reaches no higher than the horse.
  const alone = f.slotOf(h, view);
  f.update(dt, [ridden, h]);
  const both = f.slotOf(ridden, view);
  assert.ok(alone.rows < both.rows - 4, `${alone.rows} rows alone, ${both.rows} ridden`);
  // Given a rider, it shows, poses and draws them.
  h.rider = { look: 'outlaw' };
  f.update(dt, [h]);
  assert.ok(rig.rider.visible);
  assert.ok(rig.sit.time > sat);
  const [figure] = f.rasterise(view, [h], h);
  assert.ok(figure.cells.filter(riderCell).length > 20);
});

test('a horse that has not moved keeps its cells; one that has is drawn again', () => {
  let f;
  const gpu = fakeGPU(() => f);
  f = figures({ renderer: gpu });
  const h = new Horse(0, 0, { heading: 0.3 });
  f.update(dt, [h]);
  const [first] = f.rasterise(view, [h], h);
  assert.equal(gpu.reads, 1);
  // The view moves, the horse stays: the same cells, placed anew, and nothing drawn.
  const moved = { ...view, x0: view.x0 + 3, y0: view.y0 - 2 };
  const [again] = f.rasterise(moved, [h], h);
  assert.equal(gpu.reads, 1);
  same(again.cells, first.cells, 'the cells kept');
  assert.ok(again.cells.every((c) => c.sx === c.cx - moved.x0 && c.sy === c.cy - moved.y0));
  assert.equal(again.base, Math.floor(h.y) - moved.y0);
  // A pose that moves no bone by STILL keeps them too.
  f.update(1e-4, [h]);
  f.rasterise(view, [h], h);
  assert.equal(gpu.reads, 1);
  assert.ok(STILL <= 0.0125, 'about a pixel');
  // A tenth of a second of the idle moves the tail more.
  f.update(0.1, [h]);
  f.rasterise(view, [h], h);
  assert.equal(gpu.reads, 2);
  // So does the horse being moved, or turned.
  h.x += 1;
  f.rasterise(view, [h], h);
  assert.equal(gpu.reads, 3);
  // Turned while cut off by the edge of the view, it is drawn as far as
  // the view; shown whole, it is drawn whole; cut off again, that serves.
  h.heading += 0.5;
  f.update(0, [h]);
  const edge = { ...view, x0: Math.floor(h.x) - 4 };
  f.rasterise(edge, [h], h);
  assert.equal(gpu.reads, 4);
  f.rasterise(view, [h], h);
  assert.equal(gpu.reads, 5);
  f.rasterise(edge, [h], h);
  assert.equal(gpu.reads, 5);
  // Losing its rider is drawn at once.
  h.rider = null;
  f.update(0, [h]);
  f.rasterise(view, [h], h);
  assert.equal(gpu.reads, 6);
  assert.deepEqual(gpu.riders.slice(-1), [false]);
  // Of two horses, only the one that moved is drawn.
  const other = new Horse(60, 0);
  f.update(0, [h, other]);
  f.rasterise(view, [h, other], h);
  assert.equal(gpu.reads, 7);
  assert.ok(gpu.log.at(-1).length === 1 && gpu.log.at(-1)[0] === other);
  // A rig handed to a newcomer starts afresh.
  f.update(0, [other]);
  const newcomer = new Horse(0, 0);
  f.update(0, [other, newcomer]);
  same(f.rigs.get(newcomer).raster, null, 'nothing kept for a newcomer');
});

test('a bone that only turns in place is drawn again once it moves its skin or its shading', () => {
  let f;
  const gpu = fakeGPU(() => f);
  f = figures({ renderer: gpu });
  const h = new Horse(0, 0, { heading: 0.3 });
  f.update(dt, [h]);
  f.rasterise(view, [h], h);
  assert.equal(gpu.reads, 1);
  const rig = f.rigs.get(h);
  const v = new THREE.Vector3();
  const metres = (bone) => (rig.spans.get(bone) ?? 0) * v.setFromMatrixColumn(bone.matrixWorld, 0).length();
  // The tips of the skeleton, horse and rider: turning one moves no joint.
  const tip = (bones, name) => bones.find((b) => b.name === name && !b.children.some((c) => c.isBone));
  const at = new THREE.Vector3();
  const was = new THREE.Vector3();
  const turn = (bone, angle, axis = new THREE.Vector3(1, 0, 0)) => {
    bone.getWorldPosition(was);
    bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
    bone.updateMatrixWorld(true);
    assert.ok(bone.getWorldPosition(at).distanceTo(was) < 1e-6, 'turned in place');
  };
  // The head's skin reaches half a metre, so a turn that moves it a pixel
  // is less than TURN; an ear or a finger is short, so TURN shades it anew.
  const head = rig.joints.find((b) => b.name === 'Head');
  assert.ok(metres(head) > 0.4 && STILL / metres(head) * 1.5 < TURN, `head ${metres(head)} m`);
  let reads = gpu.reads;
  for (const bone of [head, tip(rig.joints, 'Ear4L'), tip(rig.riderJoints, 'DEF-f_index03L')]) {
    assert.ok(bone && metres(bone) > 0, 'a bone bending skin');
    const limit = Math.min(TURN, STILL / metres(bone));
    turn(bone, limit * 0.5);
    f.rasterise(view, [h], h);
    assert.equal(gpu.reads, reads, `${bone.name} turned a little`);
    // Half as much again past it, still short of TURN for the head.
    turn(bone, limit);
    f.rasterise(view, [h], h);
    assert.equal(gpu.reads, ++reads, `${bone.name} turned`);
  }
  assert.ok(TURN <= 0.06, 'about 3°');
  // A bone that bends no skin changes nothing, however far it turns (here
  // about the line to its end, which stays put and frames the slot).
  const bare = rig.joints.find((b) => !rig.spans.get(b) && b.children.length === 1 && !b.children[0].isBone);
  assert.ok(bare, 'a bone bending no skin');
  turn(bare, 1, bare.children[0].position.clone().normalize());
  f.rasterise(view, [h], h);
  assert.equal(gpu.reads, reads);
  // The horse turning on the spot is drawn again too.
  h.heading += TURN;
  f.update(0, [h]);
  f.rasterise(view, [h], h);
  assert.equal(gpu.reads, ++reads);
});

test('one readback serves every horse drawn, each drawn alone in its slot', () => {
  let f;
  const gpu = fakeGPU(() => f);
  f = figures({ renderer: gpu });
  const herd = [0, 1].map((i) => new Horse(i * 60, 0));
  f.update(dt, herd);
  const drawn = f.rasterise(view, herd, { x: 0, y: 0 });
  assert.equal(drawn.length, 2);
  assert.equal(gpu.reads, 1);
  assert.equal(gpu.log.length, 2);
  gpu.log.forEach((shown, i) => assert.ok(shown.length === 1 && shown[0] === herd[i], `render ${i} shows its horse alone`));
  assert.deepEqual(gpu.riders, [true, true]);
  for (const rig of f.rigs.values()) assert.ok(rig.model.visible);
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

test('at most four are drawn, two on phones, nearest the player first; none out of view', () => {
  let phone = false;
  let f;
  f = figures({ renderer: fakeGPU(() => f), phone: () => phone });
  const herd = [5, 1, 4, 0, 3, 2].map((i) => new Horse(i * 50, 0));
  f.update(dt, herd);
  const near = { x: 0, y: 0 };
  assert.equal(MAX_DRAWN, 4);
  assert.deepEqual(f.rasterise(view, herd, near).map((d) => d.horse.x), [0, 50, 100, 150]);
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
  // Horse and rider are drawn from a few merged meshes: the horse one, the
  // rider one for the body and gear and one for the cloth seen from both
  // sides; the gear left off (the buckler, the hair under the hood) stays out.
  const shown = (root) => {
    const out = [];
    root.traverse((o) => {
      for (let p = o; p !== root; p = p.parent) if (!p.visible) return;
      if (o.isMesh) out.push(o);
    });
    return out;
  };
  assert.equal(shown(rig.inner).length, 1);
  assert.equal(shown(rig.rider).length, 2);
  assert.ok(!rig.gear.buckler.visible && !rig.gear.hair.visible);
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

test('on raised ground a horse and its rider are drawn through the horse\'s lifted view', () => {
  let f;
  f = figures({ renderer: fakeGPU(() => f, () => 200) });
  const h = new Horse(0, 0, { heading: Math.PI / 2 });
  f.update(dt, [h]);
  const rows = ([figure]) => [figure.base, figure.cells.map((c) => c.sy)];
  const [base, plain] = rows(f.rasterise(view, [h], h));
  assert.ok(plain.length > 0);
  const lifted = rows(f.rasterise(view, [h], h, () => ({ ...view, y0: view.y0 + 9 })));
  assert.deepEqual(lifted, [base - 9, plain.map((sy) => sy - 9)]);
});

test('a pitched camera frames horse and rider, and reads ground rows, where the pitch draws them', async () => {
  const { BASE_LOOK, pitchLook } = await import('../src/world/camera.js');
  const { assertPitched } = await import('./helpers/pitch-check.js');
  const f = figures();
  const h = new Horse(0.4, 0.2, { heading: 0.6, rider: { look: 'outlaw' } });
  for (let i = 0; i < 6; i++) f.update(dt, [h]);
  const rig = f.rigOf(h);
  assert.equal(f.pitch, BASE_LOOK);
  assert.deepEqual(rig.reach(), rig.reach(BASE_LOOK.up));
  const view = { x0: -100, y0: -100, cols: 200, rows: 200 };
  for (const deg of [30, 25, 45]) {
    const look = pitchLook(deg);
    f.setLook(look);
    const dir = f.camera.position.clone().normalize();
    assert.ok(Math.abs(dir.y - look.sin) < 1e-9 && Math.abs(dir.z - look.cos) < 1e-9);
    const slot = f.slotOf(h, view);
    assert.ok(assertPitched(f, rig.model, h.x, h.y, slot, look) > 10);
  }
  // A point on the ground 0.3 m nearer the viewer, read back from its depth
  // and its pixel row, is put on its own ground row at any pitch.
  const ground = (look, frame) => {
    const z = 0.3;
    const t = 20 - look.cos * z;
    const u = -look.sin * z;
    const byte = 128 + ((t - NEAR) / (FAR - NEAR)) * 127;
    const pixelRow = ((frame.top - u) / (frame.top - frame.bottom)) * frame.pxHeight - 0.5;
    return groundRowOf(byte, pixelRow, frame) - (frame.y + z * SCALE * TILT);
  };
  const frame = { top: 3, bottom: -1, pxHeight: 300, y: 7 };
  assert.ok(Math.abs(ground(BASE_LOOK, frame)) < 1e-9, 'the usual pitch without sin and cos');
  const look = pitchLook(45);
  assert.ok(Math.abs(ground(look, { ...frame, sin: look.sin, cos: look.cos })) < 1e-9);
});
