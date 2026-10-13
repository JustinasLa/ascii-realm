import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/loaders/GLTFLoader.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT } from '../world/world.js';
import { SCALE, TILT } from './rig.js';
import { footPlants } from './footfalls.js';

// The player as a real rigged 3D character playing professionally animated
// clips (Quaternius' Universal Animation Library, CC0), drawn every frame
// into a small offscreen image from the game's camera angle and then turned
// into character cells. The cells are shaded from the rendered image the
// same way the rest of the figure code works: coverage picks between ground,
// outline and fill, brightness picks the glyph.

// Subsamples per cell, across and down.
const SX = 4;
const SY = 6;
const N = SX * SY;
// The region drawn around the feet, in cells.
const COLS = 36;
const ROWS = 32;
const FEET_ROW = 27;

// The camera looks down at the scene; TILT is how much a step towards the
// camera moves a point down the screen, so it is the sine of that angle.
const COS = Math.sqrt(1 - TILT * TILT);

const RAMP = [...' .:-=+*#%@'].map(glyph);
const EDGE = {
  top: glyph('_'),
  topLight: glyph('.'),
  bottom: glyph('"'),
  bottomLight: glyph("'"),
  side: glyph('|'),
  rise: glyph('/'),
  fall: glyph('\\'),
};
const RIM = [150, 178, 220];

const CLIPS = {
  idle: 'Idle_Loop',
  walk: 'Walk_Loop',
  jog: 'Jog_Fwd_Loop',
  sprint: 'Sprint_Loop',
  guard: 'Sword_Idle',
  attack: 'Sword_Attack',
  jumpStart: 'Jump_Start',
  jumpLoop: 'Jump_Loop',
  jumpLand: 'Jump_Land',
  rest: 'Fixing_Kneeling',
};

// three.js strips characters such as '.' from node names on loading.
const bone = (name) => THREE.PropertyBinding.sanitizeNodeName(name);

// The jog in the library is an athlete's bounding stride, far too long for
// someone carrying a sword and pack. Its leg swing and bounce are pulled in
// towards their average by this much, keeping the timing, which shortens
// every step.
const STRIDE_SCALE = { jog: 0.58, sprint: 0.6 };
const LEG_BONES = ['DEF-thigh.L', 'DEF-shin.L', 'DEF-foot.L', 'DEF-toe.L', 'DEF-thigh.R', 'DEF-shin.R', 'DEF-foot.R',
  'DEF-toe.R'].map((n) => THREE.PropertyBinding.sanitizeNodeName(n));

// Scales the swing of a clip's leg rotations and the hips' bounce about
// their averages, in place.
function shortenStride(clip, k) {
  for (const track of clip.tracks) {
    const [node, prop] = track.name.split('.');
    const v = track.values;
    if (prop === 'quaternion' && LEG_BONES.includes(node)) {
      // The average orientation, with every key on the same side as the first.
      const n = v.length / 4;
      const mean = new THREE.Quaternion(0, 0, 0, 0);
      const q = new THREE.Quaternion();
      const first = new THREE.Quaternion().fromArray(v, 0);
      for (let i = 0; i < n; i++) {
        q.fromArray(v, i * 4);
        const s = q.dot(first) < 0 ? -1 : 1;
        mean.x += q.x * s;
        mean.y += q.y * s;
        mean.z += q.z * s;
        mean.w += q.w * s;
      }
      mean.normalize();
      for (let i = 0; i < n; i++) {
        q.fromArray(v, i * 4);
        if (q.dot(mean) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        mean.clone().slerp(q, k).toArray(v, i * 4);
      }
    } else if (prop === 'position' && node === THREE.PropertyBinding.sanitizeNodeName('DEF-hips')) {
      const n = v.length / 3;
      let my = 0;
      for (let i = 0; i < n; i++) my += v[i * 3 + 1];
      my /= n;
      for (let i = 0; i < n; i++) v[i * 3 + 1] = my + (v[i * 3 + 1] - my) * k;
    }
  }
}

// Picks the outline glyph for a partly covered cell from the direction the
// covered samples lean, and how squarely that edge faces the moon.
function outline(mx, my, cover) {
  const len = Math.hypot(mx, my) || 1;
  const nx = -mx / len;
  const ny = -my / len;
  const a = (Math.atan2(ny, nx) * 180) / Math.PI;
  let g;
  if (a > -112.5 && a <= -67.5) g = cover > 0.5 ? EDGE.top : EDGE.topLight;
  else if (a > 67.5 && a <= 112.5) g = cover > 0.5 ? EDGE.bottom : EDGE.bottomLight;
  else if ((a > -22.5 && a <= 22.5) || a > 157.5 || a <= -157.5) g = EDGE.side;
  else if ((a > -67.5 && a <= -22.5) || (a > 112.5 && a <= 157.5)) g = EDGE.fall;
  else g = EDGE.rise;
  return { g, rim: Math.max(0, nx * -0.6 + ny * -0.8) };
}

export class ModelFigure {
  static async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new ModelFigure(gltf);
  }

  constructor(gltf) {
    const canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(COLS * SX, ROWS * SY, false);
    this.renderer.setClearColor(0x000000, 0);
    this.pixels = new Uint8Array(COLS * SX * ROWS * SY * 4);

    this.scene = new THREE.Scene();
    // Moonlight from the upper left and in front, a cold rim from behind,
    // and a little sky light so the shadowed side is not black.
    const moon = new THREE.DirectionalLight(0xd0dcff, 2.6);
    moon.position.set(-3, 5, 4);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 1.4);
    rim.position.set(2, 3, -5);
    this.scene.add(moon, rim, new THREE.HemisphereLight(0x8090b0, 0x202418, 0.9));

    this.model = gltf.scene;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      // Dark, undyed cloth and leather; the mannequin's joint rings a shade
      // darker still.
      const joint = o.material?.name === 'M_Joints';
      o.material = new THREE.MeshLambertMaterial({ color: joint ? 0x2a2622 : 0x5d5048 });
    });
    this.scene.add(this.model);
    this.bones = {};
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
    });

    this.sword = this.makeSword();

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
    this.camera.position.set(0, TILT * 20, COS * 20);
    this.camera.lookAt(0, 0, 0);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [key, name] of Object.entries(CLIPS)) {
      const clip = gltf.animations.find((c) => c.name === name);
      if (STRIDE_SCALE[key]) shortenStride(clip, STRIDE_SCALE[key]);
      const a = this.mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(0);
      this.actions[key] = a;
    }
    for (const k of ['attack', 'jumpStart', 'jumpLand']) {
      this.actions[k].setLoop(THREE.LoopOnce, 1);
      this.actions[k].clampWhenFinished = true;
    }
    this.weights = Object.fromEntries(Object.keys(CLIPS).map((k) => [k, k === 'idle' ? 1 : 0]));

    // How fast each locomotion clip moves over the ground, and when in it
    // the left foot touches down, measured from the feet themselves.
    this.gaits = ['walk', 'jog', 'sprint'].map((k) => this.measure(k));
    this.phase = 0;
    this.oneShot = null;
    this.lastMove = null;
    this.landed = false;
    this.windingUp = false;
    this.cells = [];
  }

  // A plain short sword, held in the right hand when drawn.
  makeSword() {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.7, 0.012), new THREE.MeshBasicMaterial({ color: 0xd8e0f0 }));
    blade.position.y = 0.42;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.03), new THREE.MeshLambertMaterial({ color: 0x8a8a90 }));
    guard.position.y = 0.07;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.03), new THREE.MeshLambertMaterial({ color: 0x3a2a1e }));
    g.add(blade, guard, grip);
    g.userData.tip = new THREE.Vector3(0, 0.77, 0);
    g.userData.base = new THREE.Vector3(0, 0.08, 0);
    g.visible = false;
    const hand = this.bones[bone('DEF-hand.R')];
    hand.add(g);
    // Point the blade out along the fingers, held in a fist.
    g.rotation.set(0, 0, 0);
    g.position.set(0, 0.08, 0.02);
    return g;
  }

  // Plays a locomotion clip on its own through one loop and finds how fast
  // a planted foot moves back (the clip's ground speed) and when the left
  // foot touches down.
  measure(key) {
    const a = this.actions[key];
    const dur = a.getClip().duration;
    const foot = this.bones[bone('DEF-foot.L')];
    for (const other of Object.values(this.actions)) other.setEffectiveWeight(0);
    a.setEffectiveWeight(1);
    const steps = 120;
    const p = new THREE.Vector3();
    const ys = [];
    const zs = [];
    for (let i = 0; i < steps; i++) {
      a.time = (i / steps) * dur;
      this.mixer.update(0);
      this.model.updateMatrixWorld(true);
      foot.getWorldPosition(p);
      ys.push(p.y);
      zs.push(p.z);
    }
    a.setEffectiveWeight(0);
    // A planted foot is near its lowest and sliding back under the body;
    // how fast it slides is the clip's ground speed.
    const low = Math.min(...ys);
    const down = (i) => ys[i] < low + 0.05;
    const speeds = [];
    let strike = 0;
    for (let i = 0; i < steps; i++) {
      const j = (i + 1) % steps;
      const v = ((zs[i] - zs[j]) * steps) / dur;
      if (down(i) && down(j) && v > 0) speeds.push(v);
      if (down(i) && !down((i + steps - 1) % steps)) strike = i / steps;
    }
    speeds.sort((x, y) => x - y);
    const speed = speeds[Math.floor(speeds.length / 2)] || 1;
    return { key, speed, cycle: speed * dur, strike };
  }

  // Sets the pose for this frame from the player's state.
  update(dt, p) {
    const cb = p.combat;
    const speed = p.speed;
    const w = { idle: 0, walk: 0, jog: 0, sprint: 0, guard: 0, attack: 0, jumpStart: 0, jumpLoop: 0, jumpLand: 0, rest: 0 };

    // Locomotion: blend the clips whose ground speed brackets ours.
    const [wk, jg, sp] = this.gaits;
    const moving = Math.min(1, speed / (wk.speed * 0.5));
    let loco;
    if (speed <= wk.speed) loco = { walk: 1 };
    else if (speed <= jg.speed) {
      const t = (speed - wk.speed) / (jg.speed - wk.speed);
      loco = { walk: 1 - t, jog: t };
    } else {
      const t = Math.min(1, (speed - jg.speed) / (sp.speed - jg.speed));
      loco = { jog: 1 - t, sprint: t };
    }
    // Advance one shared gait cycle by ground covered, so the feet keep pace
    // with the ground whichever clips are mixed.
    let perMetre = 0;
    for (const g of this.gaits) perMetre += (loco[g.key] ?? 0) / g.cycle;
    const before = this.phase;
    const after = before + speed * dt * perMetre;
    this.phase = after % 1;
    const plants = moving > 0.5 && p.air === 0 && p.windUp < 0
      && !cb.charge && (!cb.move || cb.move === 'draw' || cb.move === 'sheathe') && !this.oneShot
      ? footPlants(before, after) : [];
    for (const g of this.gaits) {
      const a = this.actions[g.key];
      a.time = (((this.phase + g.strike) % 1) + 1) % 1 * a.getClip().duration;
    }
    const still = 1 - moving;
    w.idle = still;
    for (const k in loco) w[k] = loco[k] * moving;

    // Standing with the sword out, hold a guard instead of idling.
    if (cb.inHand) {
      w.guard = w.idle;
      w.idle = 0;
    }
    // Resting on one knee.
    if (p.kneel > 0.01) {
      for (const k in w) w[k] *= 1 - p.kneel;
      w.rest = p.kneel;
    }
    // Jumping.
    const windingUp = p.windUp >= 0;
    // Unused one-shot clips still advance with the mixer; replay anticipation
    // once when gathering for each jump.
    if (windingUp && !this.windingUp) this.actions.jumpStart.reset().play();
    this.windingUp = windingUp;
    if (windingUp || p.air > 0) {
      for (const k in w) w[k] = 0;
      if (windingUp) w.jumpStart = 1;
      else w.jumpLoop = 1;
      this.landed = false;
    } else if (!this.landed && p.landed > 0) {
      this.landed = true;
      this.start('jumpLand', 1.4);
    }

    // Sword swings play the attack clip over everything else.
    const swing = cb.move && cb.move !== 'draw' && cb.move !== 'sheathe' ? cb.move : null;
    if (swing && swing !== this.lastMove) {
      const rate = { a: 1.4, b: 1.6, d: 1.5, c: 1.1, thrust: 1.7, plunge: 1.2, spin: 1.0 }[swing] ?? 1.3;
      this.start('attack', rate);
    }
    this.lastMove = cb.move;
    if (this.oneShot) {
      const a = this.actions[this.oneShot.key];
      this.oneShot.t += dt;
      const left = a.getClip().duration / this.oneShot.rate - this.oneShot.t;
      const k = Math.min(1, this.oneShot.t / 0.06, Math.max(0, left / 0.12));
      for (const key in w) w[key] *= 1 - k;
      w[this.oneShot.key] = k;
      if (left <= 0) this.oneShot = null;
    }

    // Ease each weight towards its target so changes never pop.
    const ease = 1 - Math.exp(-dt * 14);
    for (const k in w) {
      this.weights[k] += (w[k] - this.weights[k]) * ease;
      this.actions[k].setEffectiveWeight(this.weights[k]);
    }
    this.mixer.update(dt);
    for (const g of this.gaits) {
      const a = this.actions[g.key];
      a.time = (((this.phase + g.strike) % 1) + 1) % 1 * a.getClip().duration;
    }
    this.mixer.update(0);

    this.sword.visible = cb.inHand;
    this.model.rotation.y = p.heading + (cb.spin ?? 0);
    this.model.updateMatrixWorld(true);
    for (const side of plants) {
      const foot = this.bones[bone(side === 0 ? 'DEF-foot.L' : 'DEF-foot.R')];
      const at = foot.getWorldPosition(new THREE.Vector3());
      p.events.push({ type: 'step', x: p.x + at.x * SCALE / ASPECT,
        y: p.y + at.z * SCALE * TILT, strength: Math.min(1, speed / 5) });
    }
    this.model.position.y = p.air;
    this.model.updateMatrixWorld(true);
  }

  // Starts a one-shot clip from the beginning at a given playback rate.
  start(key, rate) {
    const a = this.actions[key];
    a.reset();
    a.timeScale = rate;
    a.play();
    this.oneShot = { key, rate, t: 0 };
  }

  // Where a point on the model ends up on screen, in cells from the feet.
  toScreen(v) {
    return [(v.x * SCALE) / ASPECT, (-v.y * COS + v.z * TILT) * SCALE];
  }

  // The sword's base and tip on screen, in cells from the feet, if drawn.
  swordLine() {
    if (!this.sword.visible) return null;
    const base = this.sword.localToWorld(this.sword.userData.base.clone());
    const tip = this.sword.localToWorld(this.sword.userData.tip.clone());
    return { base: this.toScreen(base), tip: this.toScreen(tip) };
  }

  // Renders the model for the feet at world cell (x, y) and turns the image
  // into cells: { sx, sy, g, r, gg, b, br, bgG, bb } relative to the view.
  rasterise(view, x, y) {
    const cx0 = Math.floor(x) - (COLS >> 1);
    const cy0 = Math.floor(y) - FEET_ROW;
    const w = COLS * SX;
    const h = ROWS * SY;
    const widthM = (COLS * ASPECT) / SCALE;
    const heightM = ROWS / SCALE;
    // Offset the frustum so the feet land exactly at their fractional cell.
    const fx = (x - cx0) / COLS;
    const fy = (y - cy0) / ROWS;
    const cam = this.camera;
    cam.left = -fx * widthM;
    cam.right = (1 - fx) * widthM;
    cam.top = fy * heightM;
    cam.bottom = -(1 - fy) * heightM;
    cam.updateProjectionMatrix();

    this.renderer.render(this.scene, cam);
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    const px = this.pixels;

    const cells = [];
    let top = Infinity;
    for (let cy = 0; cy < ROWS; cy++) {
      for (let cx = 0; cx < COLS; cx++) {
        let hits = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let mx = 0;
        let my = 0;
        for (let j = 0; j < SY; j++) {
          // WebGL rows run bottom-up.
          const row = h - 1 - (cy * SY + j);
          for (let i = 0; i < SX; i++) {
            const o = (row * w + cx * SX + i) * 4;
            if (px[o + 3] < 128) continue;
            hits++;
            r += px[o];
            g += px[o + 1];
            b += px[o + 2];
            mx += (i + 0.5) / SX - 0.5;
            my += (j + 0.5) / SY - 0.5;
          }
        }
        if (hits < 3) continue;
        top = Math.min(top, cy);
        r /= hits;
        g /= hits;
        b /= hits;
        const sx = cx0 + cx - view.x0;
        const sy = cy0 + cy - view.y0;
        const lum = (r * 0.3 + g * 0.55 + b * 0.15) / 255;
        if (hits < N - 4) {
          // The silhouette, picked out with a cold moonlit rim.
          const o = outline(mx, my, hits / N);
          const t = Math.min(1, 0.35 + o.rim * 0.6);
          const k = 0.9;
          cells.push({ sx, sy, g: o.g, r: r * k + (RIM[0] - r * k) * t, gg: g * k + (RIM[1] - g * k) * t,
            b: b * k + (RIM[2] - b * k) * t, br: 4, bgG: 5, bb: 8 });
          continue;
        }
        const ch = RAMP[Math.min(RAMP.length - 1, 2 + Math.floor(lum * 1.6 * (RAMP.length - 2)))];
        const k = 1.25;
        cells.push({ sx, sy, g: ch, r: Math.min(255, r * k), gg: Math.min(255, g * k), b: Math.min(255, b * k),
          br: 3 + r * 0.05, bgG: 3 + g * 0.05, bb: 5 + b * 0.06 });
      }
    }
    this.cells = cells;
    this.top = top === Infinity ? null : cy0 + top;
    this.base = Math.floor(y) - view.y0;
    return cells;
  }

  // Draws the cells from the last rasterise through a writer (see cells.js).
  draw(r, write) {
    for (const c of this.cells) write(r, c.sx, c.sy, c.g, c.r, c.gg, c.b, this.base, c.br, c.bgG, c.bb);
  }
}
