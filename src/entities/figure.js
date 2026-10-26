import { INSTRUMENTS } from '../audio/instruments.js';
import { ITEMS } from '../inventory/items.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, WATER } from '../world/world.js';
import { SWORD_SIDE } from './combat.js';
import { wears } from './loadout.js';
import { MATERIALS } from './materials.js';
import { add, buildRig, cross, lerp3, mul, project, rotY, SCALE, sub, TILT } from './rig.js';
import { capsule, ellipse, quad } from './shapes.js';

// The outlaw is not a hand-drawn sprite. Its skeleton (see rig.js) is posed
// every frame, dressed in simple shapes (capsules, ellipses, cloth panels)
// that are projected onto the screen, sorted back to front and rasterised
// into character cells with supersampling. That way every movement can be
// animated smoothly and the figure glides between cells instead of snapping.
//
// Shapes live in "row units": one unit is one cell tall, the feet are at the
// origin and up is negative y.

const EDGE = {
  top: glyph('_'),
  topLight: glyph('.'),
  bottom: glyph('"'),
  bottomLight: glyph("'"),
  side: glyph('|'),
  rise: glyph('/'),
  fall: glyph('\\'),
  flat: glyph('-'),
};

// The glyph that best draws a bar running in a given screen direction.
function barGlyph(dx, dy) {
  const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180;
  if (a < 22.5 || a >= 157.5) return EDGE.flat;
  if (a < 67.5) return EDGE.fall;
  if (a < 112.5) return EDGE.side;
  return EDGE.rise;
}

// Collects projected shapes along with their depth, so they can be drawn
// back to front.
class Dresser {
  constructor() {
    this.parts = [];
  }

  add(shape, mat, z) {
    shape.mat = typeof mat === 'string' ? MATERIALS[mat] : mat;
    shape.z = z;
    this.parts.push(shape);
    return shape;
  }

  // A limb segment between two joints, radii in metres.
  limb(a, b, ra, rb, mat, bias = 0) {
    const pa = project(a);
    const pb = project(b);
    const shape = this.add(capsule(pa[0], pa[1], pb[0], pb[1], ra * SCALE, rb * SCALE), mat,
      (pa[2] + pb[2]) / 2 + bias);
    shape.bar = barGlyph(pb[0] - pa[0], pb[1] - pa[1]);
    return shape;
  }

  // A round blob, radii in metres.
  blob(c, rx, ry, mat, bias = 0) {
    const p = project(c);
    return this.add(ellipse(p[0], p[1], rx * SCALE, ry * SCALE), mat, p[2] + bias);
  }

  // A flat panel through four world points (top edge first), e.g. cloth.
  panel(a, b, c, e, mat, bias = 0) {
    const p = [a, b, c, e].map(project);
    const z = (p[0][2] + p[1][2] + p[2][2] + p[3][2]) / 4;
    return this.add(quad(p[0], p[1], p[2], p[3]), mat, z + bias);
  }

  sorted() {
    return this.parts.sort((a, b) => a.z - b.z);
  }
}

// The torso is wider than it is deep, so how wide it looks depends on how
// far it has turned towards the camera.
const across = (rig, w, d) => Math.hypot(w * rig.facing, d * (1 - rig.facing));

// Dresses the posed skeleton, back to front: a lean, hooded outlaw in
// forest green and worn leather, a longbow and quiver on the back and a
// short sword at the hip.
// `equipment` is the inventory's worn gear, slot by slot; without one the
// outlaw is fully dressed. The clothes are always worn for now (see `wears`),
// so the hood, boots and gloves are always drawn; a missing weapon or buckler
// simply is not drawn.
function dress(rig, capeSim, equipment, weapon = null) {
  const d = new Dresser();
  const wearing = (slot) => wears(equipment, slot);
  if (wearing('cape') && capeSim?.pts) cloak(d, rig, capeSim.pts);

  for (const l of rig.legs) {
    d.limb(l.hip, l.knee, 0.074, 0.058, 'hose');
    d.limb(l.knee, l.ankle, 0.056, 0.048, 'hose');
    // Tall soft boots turned down in a cuff below the knee.
    const top = lerp3(l.knee, l.ankle, 0.3);
    d.limb(top, l.ankle, 0.062, 0.054, 'boot', 0.005);
    d.limb(top, lerp3(l.knee, l.ankle, 0.42), 0.07, 0.066, 'leather', 0.01);
    d.limb(l.ankle, l.toe, 0.056, 0.042, 'boot', 0.01);
  }

  quiverAndBow(d, rig);
  tunic(d, rig, wearing('chest'));
  if (equipment === undefined || equipment?.mainHand?.id === 'shortSword') sword(d, rig);
  else if (weapon && rig.sword) heldWeapon(d, rig.sword, weapon);

  for (const a of rig.arms) {
    // Loose sleeves, then bracers and gloves.
    d.limb(a.shoulder, a.elbow, 0.062, 0.054, wearing('chest') ? 'sleeve' : 'linen');
    d.limb(a.elbow, a.wrist, 0.05, 0.046, wearing('chest') ? 'sleeve' : 'linen');
    d.limb(lerp3(a.elbow, a.wrist, 0.3), a.wrist, 0.054, 0.05, 'bracer', 0.01);
    d.limb(a.wrist, a.hand, 0.046, 0.042, 'leather', 0.015);
  }
  if (equipment?.offHand?.id === 'woodenBuckler') buckler(d, rig);
  else if (instrumentFamily(equipment?.offHand?.id)) heldInstrument(d, rig, equipment.offHand.id);

  hood(d, rig);

  return d.sorted();
}

// Weapon sprite materials, by the names weapons.js uses. Metal takes the
// colour of the weapon's material tier.
const WEAPON_MAT = { blade: 'blade', darkPlate: 'iron', trim: 'iron', leather: 'leather', wood: 'wood',
  string: 'feather', arrow: 'wood', cloth: 'leather' };
const tinted = new Map();
function weaponMat(weapon, name) {
  const base = MATERIALS[WEAPON_MAT[name] ?? 'iron'] ?? MATERIALS.iron;
  if (name !== 'blade' && name !== 'darkPlate' || !weapon.materialColor) return base;
  const key = `${name}:${weapon.materialColor.join()}`;
  if (!tinted.has(key)) {
    const color = name === 'darkPlate' ? weapon.materialColor.map((c) => c * 0.4) : weapon.materialColor;
    tinted.set(key, { ...base, color });
  }
  return tinted.get(key);
}

const unit = (v) => mul(v, 1 / (Math.hypot(...v) || 1));

// Any weapon other than the short sword, drawn from its sprite parts along
// the blade in hand: x across the blade, y from guard to tip.
function heldWeapon(d, sw, weapon) {
  const blade = unit(sub(sw.tip, sw.guard));
  const side = unit(sub(sw.barA, sw.barB));
  const normal = unit(cross(side, blade));
  const at = (p) => add(add(add(sw.guard, mul(side, p[0])), mul(blade, p[1])), mul(normal, p[2] ?? 0));
  for (const part of weapon.spriteParts ?? []) {
    const mat = weaponMat(weapon, part.material);
    let shape = null;
    if (part.shape === 'limb') shape = d.limb(at(part.a), at(part.b), part.ra, part.rb ?? part.ra, mat, 0.03);
    else if (part.shape === 'blob') shape = d.blob(at(part.c), part.rx, part.ry, mat, 0.03);
    else if (part.shape === 'panel') {
      const p = part.points.map(at);
      shape = d.panel(p[0], p[1], p[2], p[3], mat, 0.03);
    }
    if (shape && part.glyph) shape.glyph = glyph(part.glyph);
  }
}

// A small round buckler strapped to the forearm opposite the sword.
function buckler(d, rig) {
  const arm = rig.arms.find((a) => a.s !== SWORD_SIDE);
  const center = add(lerp3(arm.elbow, arm.wrist, 0.7), rotY([0, 0, 0.07], rig.heading));
  d.blob(center, across(rig, 0.13, 0.04), 0.13, 'iron', 0.025);
  d.blob(center, across(rig, 0.115, 0.032), 0.115, 'wood', 0.026);
  d.blob(center, across(rig, 0.03, 0.02), 0.03, 'iron', 0.027);
}

// What a held instrument looks like on a shape-built figure, by how its
// voice is played: 'strings', 'wind', 'brass' or 'tines', or null for an
// item that isn't an instrument.
const FAMILIES = { pluck: 'strings', harp: 'strings', hammered: 'strings', bowed: 'strings',
  breath: 'wind', chanter: 'wind', reed: 'wind', brass: 'brass', tine: 'tines' };
export function instrumentFamily(id) {
  if (typeof id !== 'string' || !Object.hasOwn(ITEMS, id) || !ITEMS[id].tags?.includes('instrument')) return null;
  return FAMILIES[INSTRUMENTS[id]?.voice] ?? 'strings';
}

// An instrument's materials: its own colour, and the trims, each marked with
// its family.
const instrumentMats = new Map();
function instrumentMat(id, family, part) {
  const key = `${id}:${part}`;
  if (!instrumentMats.has(key)) {
    const colour = ITEMS[id].colour;
    const mats = {
      body: { ...MATERIALS[family === 'brass' ? 'iron' : 'wood'], color: colour },
      dark: { ...MATERIALS.wood, color: colour.map((c) => c * 0.45) },
      hole: MATERIALS.void,
      cap: MATERIALS.leather,
      tine: MATERIALS.iron,
    };
    instrumentMats.set(key, { ...mats[part], family });
  }
  return instrumentMats.get(key);
}

// The off-hand instrument, carried as the buckler is: hanging from the hand
// opposite the sword, its long side down the forearm, one simple silhouette
// per family in the item's colour.
function heldInstrument(d, rig, id) {
  const family = instrumentFamily(id);
  const mat = (part) => instrumentMat(id, family, part);
  const arm = rig.arms.find((a) => a.s !== SWORD_SIDE);
  const along = unit(sub(arm.wrist, arm.elbow));
  const forward = rotY([0, 0, 1], rig.heading);
  const side = rotY([1, 0, 0], rig.heading);
  const at = (down, out = 0, across = 0) => add(add(add(arm.hand, mul(along, down)), mul(forward, out)), mul(side, across));
  if (family === 'strings') {
    // A pear body by the hand and a neck running on down.
    const body = at(0.12, 0.07);
    d.limb(body, at(0.44, 0.07), 0.03, 0.024, mat('dark'), 0.025);
    d.blob(body, across(rig, 0.12, 0.06), 0.13, mat('body'), 0.026);
    d.blob(at(0.1, 0.08), across(rig, 0.035, 0.025), 0.035, mat('hole'), 0.027);
  } else if (family === 'wind') {
    // A slim pipe held at the side, capped at its foot.
    d.limb(at(-0.06, 0.04), at(0.42, 0.04), 0.034, 0.03, mat('body'), 0.025);
    d.blob(at(0.42, 0.04), 0.04, 0.04, mat('cap'), 0.026);
  } else if (family === 'brass') {
    // A short tube flaring to a bell.
    d.limb(at(-0.04, 0.05), at(0.26, 0.05), 0.026, 0.034, mat('body'), 0.025);
    d.blob(at(0.31, 0.05), across(rig, 0.1, 0.05), 0.1, mat('body'), 0.026);
  } else {
    // A small box with iron tines.
    d.blob(at(0.08, 0.06), across(rig, 0.1, 0.06), 0.08, mat('body'), 0.025);
    for (const offset of [-0.045, 0, 0.045]) d.limb(at(0.02, 0.1, offset), at(0.1, 0.1, offset), 0.012, 0.012, mat('tine'), 0.027);
  }
}

// A green tunic belted at the waist under a laced leather jerkin, its skirt
// hanging to mid-thigh front and back where the knees push it aside, and a
// pouch on the belt.
function tunic(d, rig, jerkin = true) {
  const at = rig.at;
  const w = (a, b) => across(rig, a, b);
  // Bits on the front vanish when the outlaw turns away, and vice versa.
  const front = (p) => (project(p)[2] > project(rig.waist)[2] ? 0.15 : -0.15);

  d.limb(rig.pelvis, rig.chest, w(0.14, 0.11), w(0.15, 0.105), jerkin ? 'tunic' : 'linen');
  if (jerkin) d.limb(at([0, 0.12, 0.01]), at([0, 0.4, 0.01]), w(0.15, 0.115), w(0.165, 0.115), 'jerkin', 0.02);
  d.limb(at([0, 0.01, 0]), at([0, 0.05, 0]), w(0.15, 0.115), w(0.15, 0.115), 'leather', 0.025);
  const buckle = at([0, 0.03, 0.13]);
  d.blob(buckle, 0.026, 0.024, 'iron', front(buckle));
  const pouch = at([0.12, -0.04, 0.09]);
  d.blob(pouch, 0.05, 0.055, 'leather', front(pouch) * 0.2);

  for (const side of [1, -1]) {
    const z = side * 0.12;
    const push = side > 0 ? rig.kneeFwd : -rig.kneeBack;
    d.panel(at([-0.11, 0.0, z]), at([0.11, 0.0, z]), at([0.13, -0.3, z + push * 0.55]),
      at([-0.13, -0.3, z + push * 0.55]), jerkin ? 'tunic' : 'linen', side * 0.03);
  }
}

// The hood: drawn up over the head, its face opening dark but for the jaw
// and a glint of eyes, a long pointed tail falling down the back, and a
// short shoulder cape with a dagged hem.
function hood(d, rig) {
  const h = rig.headAt;
  const at = rig.at;
  const head = h([0, 0, 0]);
  const z = project(head)[2];
  // Anything on the face is hidden once the head turns away.
  const front = (p) => (project(p)[2] > z ? 0.3 : -0.3);
  const w = (a, b) => across(rig, a, b);

  // The shoulder cape sits over the upper arms, dagged into points.
  const chest = project(rig.chest)[2];
  const arms = Math.max(...rig.arms.map((a) => project(a.shoulder)[2])) + 0.04;
  const over = arms - chest;
  d.limb(at([0, 0.38, 0]), at([0, 0.5, 0]), w(0.25, 0.15), w(0.17, 0.12), 'hood', over);
  for (let k = -2; k <= 2; k++) {
    const x = k * 0.09;
    for (const zz of [0.08, -0.08]) {
      const tip = at([x * 1.05, 0.28, zz * 1.2]);
      d.limb(at([x, 0.36, zz]), tip, 0.04, 0.006, 'hood', over + (zz > 0 ? 0.01 : -0.2));
    }
  }

  // The liripipe: the hood's tail, hanging down between the shoulders.
  d.limb(h([0, 0.04, -0.12]), at([0.02, 0.32, -0.2]), 0.05, 0.012, 'hood', -0.05);

  d.blob(head, 0.15, 0.17, 'hood');
  // A peak at the crown, pulled forward over the brow.
  d.limb(h([0, 0.12, -0.04]), h([0, 0.17, 0.06]), 0.06, 0.02, 'hood', 0.01);
  const face = h([0, -0.025, 0.12]);
  d.blob(face, 0.085, 0.105, 'void', front(face));
  // Only the jaw catches the light under the shadow of the hood.
  const jaw = h([0, -0.095, 0.125]);
  d.blob(jaw, 0.055, 0.032, 'skin', front(jaw) * 1.05);

  if (rig.eyes > 0.05) {
    for (const s of [-1, 1]) {
      const eye = h([s * 0.038, -0.02, 0.13]);
      d.blob(eye, 0.018, 0.01 * rig.eyes, 'glint', front(eye) * 1.2);
    }
  }
}

// A quiver of arrows slung across the back, fletching showing over the
// shoulder, and an unstrung longbow crossed behind it.
function quiverAndBow(d, rig) {
  const at = rig.at;
  // The bow runs from above one shoulder to behind the opposite knee,
  // bowed gently outward from the back.
  const top = at([0.2, 0.82, -0.17]);
  const mid = at([0.0, 0.2, -0.24]);
  const bottom = at([-0.2, -0.5, -0.19]);
  d.limb(top, mid, 0.016, 0.026, 'wood', -0.03);
  d.limb(mid, bottom, 0.026, 0.016, 'wood', -0.03);
  d.limb(lerp3(mid, top, 0.05), lerp3(mid, bottom, 0.12), 0.032, 0.032, 'leather', -0.029);

  const qTop = at([-0.12, 0.55, -0.16]);
  const qBottom = at([0.1, -0.05, -0.15]);
  d.limb(qBottom, qTop, 0.05, 0.062, 'quiver', -0.02);
  d.limb(lerp3(qBottom, qTop, 0.9), qTop, 0.068, 0.068, 'iron', -0.019);
  const up = sub(qTop, qBottom);
  const len = Math.hypot(...up) || 1;
  // A direction in the torso's frame, turned to face the way the body does.
  const offset = (p) => sub(at(p), rig.pelvis);
  for (let k = 0; k < 4; k++) {
    const base = add(qTop, offset([-0.025 + k * 0.018, 0, 0]));
    const end = add(base, mul(up, (0.13 + (k % 2) * 0.03) / len));
    d.limb(base, end, 0.01, 0.01, 'wood', -0.018);
    d.limb(lerp3(base, end, 0.45), end, 0.022, 0.014, 'feather', -0.017);
  }
}

// A short sword hung from the belt on the off-hand hip, ready for a cross
// draw. Once drawn the scabbard hangs empty and the blade is in hand.
function sword(d, rig) {
  const at = rig.at;
  const side = -SWORD_SIDE;
  const mouth = at([side * 0.15, 0.0, 0.07]);
  const tip = at([side * 0.23, -0.55, -0.2]);
  d.limb(mouth, tip, 0.03, 0.022, 'leather', 0.02);
  d.limb(lerp3(mouth, tip, 0.9), tip, 0.03, 0.022, 'iron', 0.021);

  const sw = rig.sword;
  if (!sw) {
    const grip = sub(mouth, mul(sub(tip, mouth), 0.2));
    const guardA = at([side * 0.1, 0.02, 0.08]);
    const guardB = at([side * 0.2, -0.02, 0.06]);
    d.limb(guardA, guardB, 0.016, 0.016, 'iron', 0.03);
    d.limb(mouth, grip, 0.018, 0.018, 'leather', 0.03);
    d.blob(grip, 0.026, 0.026, 'iron', 0.031);
    return;
  }
  // In hand: a bright blade with a dark fuller and a plain iron cross.
  d.limb(sw.guard, sw.tip, 0.026, 0.005, sw.glow ? 'bladeGlow' : 'blade', 0.03);
  d.limb(lerp3(sw.guard, sw.tip, 0.05), lerp3(sw.guard, sw.tip, 0.65), 0.007, 0.005, 'iron', 0.031);
  d.limb(sw.barA, sw.barB, 0.018, 0.018, 'iron', 0.032);
  d.limb(sw.pommel, sw.guard, 0.018, 0.018, 'leather', 0.02);
  d.blob(sw.pommel, 0.026, 0.026, 'iron', 0.021);
}

// The hooded cloak: one cloth panel per link of the simulated chain,
// widening towards a ragged hem. It is sorted a little further back than it
// hangs, so it drapes under the quiver and bow rather than over them.
function cloak(d, rig, pts) {
  const lat = rotY([1, 0, 0], rig.heading);
  const n = pts.length;
  const half = (i) => 0.16 + (0.1 * i) / (n - 1);
  // Seen edge-on the cloth would vanish into a line, so give it the bulk of
  // its folds from the side.
  const back = rotY([0, 0, -1], rig.heading);
  const bulk = (i) => mul(back, (1 - rig.facing) * (0.04 + (0.07 * i) / (n - 1)));
  const edge = (i, s) => add(mul(lat, s * half(i)), mul(bulk(i), s));
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    // Which face of the cloth is turned to the camera: the green outside,
    // or the darker lining when it swings round or hangs behind an outlaw
    // facing us.
    const face = cross(sub(b, a), lat)[2] > 0 ? 'lining' : 'cloak';
    d.panel(add(a, edge(i, -1)), add(a, edge(i, 1)), add(b, edge(i + 1, 1)), add(b, edge(i + 1, -1)), face, -0.1);
  }
  // Tatters: strips of uneven length hanging off the hem.
  const hem = pts[n - 1];
  const dir = sub(hem, pts[n - 2]);
  const len = Math.hypot(...dir) || 1;
  for (let k = 0; k < 6; k++) {
    const x = ((k + 0.5) / 6) * 2 - 1;
    const top = add(hem, mul(lat, x * half(n - 1) * 0.9));
    const drop = 0.05 + ((k * 37) % 5) * 0.025;
    d.limb(top, add(top, mul(dir, drop / len)), 0.04, 0.01, 'cloak', -0.1);
  }
}

// Each cell is sampled on a 3x4 grid. Coverage decides between leaving the
// ground showing, drawing an outline glyph and filling the cell with the
// material's texture.
const SUB_X = [1 / 6, 3 / 6, 5 / 6];
const SUB_Y = [1 / 8, 3 / 8, 5 / 8, 7 / 8];
const SAMPLES = SUB_X.length * SUB_Y.length;
const SAMPLE = { nx: 0, ny: 0, u: 0, v: 0 };
const SHADE = { c: null, k: 1 };
const hitPart = new Int16Array(SAMPLES);
const hitLum = new Float32Array(SAMPLES);
const hitU = new Float32Array(SAMPLES);
const hitV = new Float32Array(SAMPLES);

// Moonlight comes from the upper left; edges that face it catch a cold rim.
const LIGHT_X = -0.6;
const LIGHT_Y = -0.8;
const RIM = [150, 178, 220];

// Picks the outline glyph for a partly covered cell from the direction the
// covered samples lean (mx, my). Also returns how squarely the edge faces
// the moon, for the rim light.
const OUTLINE = { g: 0, rim: 0 };
function outline(mx, my, cover) {
  const len = Math.hypot(mx, my) || 1;
  const nx = -mx / len;
  const ny = -my / len;
  const a = (Math.atan2(ny, nx) * 180) / Math.PI;
  let g;
  if (a > -112.5 && a <= -67.5) g = cover > 0.5 ? EDGE.top : EDGE.topLight;
  else if (a > 67.5 && a <= 112.5) g = cover > 0.5 ? EDGE.bottom : EDGE.bottomLight;
  else if (a > -22.5 && a <= 22.5) g = EDGE.side;
  else if (a > 157.5 || a <= -157.5) g = EDGE.side;
  // Screen y points down, so an edge facing up and right runs like "\".
  else if (a > -67.5 && a <= -22.5) g = EDGE.fall;
  else if (a > -157.5 && a <= -112.5) g = EDGE.rise;
  else if (a > 22.5 && a <= 67.5) g = EDGE.rise;
  else g = EDGE.fall;
  OUTLINE.g = g;
  OUTLINE.rim = Math.max(0, nx * LIGHT_X + ny * LIGHT_Y);
  return OUTLINE;
}

// Darkens the ground in a soft ellipse under the feet, smaller and fainter
// the higher the warrior is off the ground.
export function drawShadow(r, view, x, y, air = 0) {
  const size = 1 / (1 + air * 1.2);
  const depth = 0.65 * size;
  const { fg, bg, cols } = r;
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  for (let cy = fy - 2; cy <= fy + 2; cy++) {
    const sy = cy - view.y0;
    if (sy < 0 || sy >= view.rows) continue;
    for (let cx = fx - 9; cx <= fx + 9; cx++) {
      const sx = cx - view.x0;
      if (sx < 0 || sx >= view.cols) continue;
      if (r.mask[sy * cols + sx] === WATER) continue;
      const dx = ((cx + 0.5 - x) * ASPECT) / (4.4 * size);
      const dy = (cy + 0.5 - y) / (1.8 * size);
      const d = dx * dx + dy * dy;
      if (d >= 1) continue;
      const k = 1 - depth * (1 - d);
      const o = (sy * cols + sx) * 4;
      for (let c = 0; c < 3; c++) {
        fg[o + c] *= k;
        bg[o + c] *= k;
      }
    }
  }
}

// Poses and dresses the figure: the list of shapes to draw, back to front.
// Built once a frame and shared by the figure and its reflection.
export function dressFigure(state) {
  const depth = state.waterDepth ?? 0;
  if (depth <= 0) return dress(buildRig(state), state.cape, state.equipment, state.weapon);
  const cape = state.cape?.pts ? { pts: state.cape.pts.map((p) => [p[0], p[1] - depth, p[2]]) } : null;
  return dress(buildRig({ ...state, air: state.air - depth }), cape, state.equipment, state.weapon);
}

// One reusable raster for the current pose. Both painter passes replay the
// same shaded cells, retaining all twelve coverage samples and exact colours.
let rasterParts = null;
let rasterX = 0;
let rasterY = 0;
let rasterBounds;
let rasterCount = 0;
let rasterCells = new Float64Array(1024 * 9);
let candidates = new Int32Array(128);
function collectCell(_r, x, y, g, cr, cg, cb, _base, br, bg, bb) {
  const i = rasterCount * 9;
  if (i + 9 > rasterCells.length) {
    const next = new Float64Array(rasterCells.length * 2);
    next.set(rasterCells);
    rasterCells = next;
  }
  rasterCells[i] = x;
  rasterCells[i + 1] = y;
  rasterCells[i + 2] = g;
  rasterCells[i + 3] = cr;
  rasterCells[i + 4] = cg;
  rasterCells[i + 5] = cb;
  rasterCells[i + 6] = br === undefined ? NaN : br;
  rasterCells[i + 7] = bg;
  rasterCells[i + 8] = bb;
  rasterCount++;
}

// Rasterises the dressed figure with its feet at world position
// (state.x, state.y).
export function drawFigure(r, view, state, parts, write = putCell) {
  if (rasterParts !== parts || rasterX !== state.x || rasterY !== state.y) {
    rasterize(state, parts);
  }
  const base = Math.floor(state.y) - view.y0;
  const b = rasterBounds;
  if (write.visible && !write.visible(r, b.x0 - view.x0, b.y0 - view.y0,
    b.x1 - view.x0, b.y1 - view.y0, base)) return;
  for (let n = 0; n < rasterCount; n++) {
    const i = n * 9;
    const x = rasterCells[i] - view.x0;
    const y = rasterCells[i + 1] - view.y0;
    if (write === putCell && (x < 0 || y < 0 || x >= r.cols || y >= r.rows)) continue;
    write(r, x, y, rasterCells[i + 2], rasterCells[i + 3], rasterCells[i + 4], rasterCells[i + 5],
      base, Number.isNaN(rasterCells[i + 6]) ? undefined : rasterCells[i + 6],
      rasterCells[i + 7], rasterCells[i + 8]);
  }
}

function rasterize(state, parts) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of parts) {
    x0 = Math.min(x0, p.x0);
    x1 = Math.max(x1, p.x1);
    y0 = Math.min(y0, p.y0);
    y1 = Math.max(y1, p.y1);
  }
  rasterBounds = { x0: Math.floor(state.x + x0 / ASPECT), x1: Math.floor(state.x + x1 / ASPECT),
    y0: Math.floor(state.y + y0), y1: Math.floor(state.y + y1) };
  rasterCount = 0;
  if (candidates.length < parts.length) candidates = new Int32Array(parts.length * 2);
  for (let cy = rasterBounds.y0; cy <= rasterBounds.y1; cy++) {
    for (let cx = rasterBounds.x0; cx <= rasterBounds.x1; cx++) {
      // Broad phase once per cell, instead of scanning every armour piece
      // for each of its twelve sub-samples.
      let count = 0;
      const px0 = (cx + SUB_X[0] - state.x) * ASPECT;
      const px1 = (cx + SUB_X[2] - state.x) * ASPECT;
      const py0 = cy + SUB_Y[0] - state.y;
      const py1 = cy + SUB_Y[3] - state.y;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.x1 < px0 || p.x0 > px1 || p.y1 < py0 || p.y0 > py1) continue;
        candidates[count++] = i;
      }
      if (count) shadeCell(null, cx, cy, cx, cy, state, parts, 0, collectCell, count);
    }
  }
  rasterParts = parts;
  rasterX = state.x;
  rasterY = state.y;
}

function shadeCell(r, sx, sy, cx, cy, state, parts, base, write, count) {
  let hits = 0;
  let mx = 0;
  let my = 0;
  let front = -1;
  let claim = -1;
  let claimLum = 0;
  let k = 0;
  for (const oy of SUB_Y) {
    for (const ox of SUB_X) {
      const px = (cx + ox - state.x) * ASPECT;
      const py = cy + oy - state.y;
      hitPart[k] = -1;
      for (let candidate = 0; candidate < count; candidate++) {
        const i = candidates[candidate];
        const p = parts[i];
        if (px < p.x0 || px > p.x1 || py < p.y0 || py > p.y1) continue;
        if (!p.test(px, py, SAMPLE)) continue;
        // Invert the projection at this part's depth to discard samples
        // below the surface, including the fallback figure before GLB load.
        if (state.waterDepth > 0.001 && py > p.z * TILT * SCALE) continue;
        hitPart[k] = i;
        hitLum[k] = 0.62 - 0.3 * SAMPLE.nx - 0.2 * SAMPLE.ny;
        hitU[k] = SAMPLE.u;
        hitV[k] = SAMPLE.v;
        hits++;
        mx += ox - 0.5;
        my += oy - 0.5;
        if (i > front) front = i;
        if (p.mat.claim && i > claim) {
          claim = i;
          claimLum = hitLum[k];
        }
        break;
      }
      k++;
    }
  }
  // Lights and blades are thinner than a cell but must never be outvoted
  // by what surrounds them.
  if (claim >= 0) {
    const p = parts[claim];
    const [cr, cg, cbl] = p.mat.color;
    const l = p.mat.emissive ? 1 : 0.55 + 0.45 * Math.max(0, Math.min(1, claimLum));
    write(r, sx, sy, p.glyph ?? (p.mat.tex ? p.mat.tex() : p.bar), cr * l, cg * l, cbl * l, base, 6, 10, 14);
    return;
  }
  if (hits < 3) return;

  // Which part covers the most samples, and where the frontmost part's own
  // samples lean, in case its edge runs through this cell.
  let best = -1;
  let bestN = 0;
  let frontN = 0;
  let fmx = 0;
  let fmy = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const p = hitPart[i];
    if (p < 0) continue;
    if (p === front) {
      frontN++;
      fmx += SUB_X[i % 3] - 0.5;
      fmy += SUB_Y[(i / 3) | 0] - 0.5;
    }
    if (p === best) continue;
    let n = 0;
    for (let j = i; j < SAMPLES; j++) if (hitPart[j] === p) n++;
    if (n > bestN) {
      bestN = n;
      best = p;
    }
  }
  let lum = 0;
  let u = 0;
  let v = 0;
  for (let i = 0; i < SAMPLES; i++) {
    if (hitPart[i] !== best) continue;
    lum += hitLum[i];
    u += hitU[i];
    v += hitV[i];
  }
  lum /= bestN;
  u /= bestN;
  v /= bestN;

  const part = parts[best];
  const mat = part.mat;
  const [mr, mg, mb] = mat.color;

  if (hits < SAMPLES - 2) {
    // The silhouette: an outline glyph over a dark backing, so every limb
    // stands out cleanly against the grass. It catches a faint cold rim all
    // round, brightest where the edge faces the moon.
    const o = outline(mx, my, hits / SAMPLES);
    const l = 0.45 + 0.25 * lum;
    const t = Math.min(1, 0.3 + o.rim * 0.65);
    const cover = hits / SAMPLES;
    write(r, sx, sy, o.g, mr * l + (RIM[0] - mr * l) * t, mg * l + (RIM[1] - mg * l) * t,
      mb * l + (RIM[2] - mb * l) * t, base, 3 + 4 * cover, 4 + 4 * cover, 7 + 5 * cover);
    return;
  }

  // Fully covered cells blot out the grass behind with a dark backing.
  const br = 3 + mr * 0.06;
  const bgG = 3 + mg * 0.06;
  const bb = 5 + mb * 0.08;

  if (front !== best && frontN >= 3 && frontN <= SAMPLES - 3) {
    // A part overlapping another: trace its edge so limbs stay readable.
    const f = parts[front].mat.color;
    const o = outline(fmx, fmy, frontN / SAMPLES);
    const l = 0.55 + 0.4 * o.rim;
    write(r, sx, sy, o.g, f[0] * l, f[1] * l, f[2] * l, base, br, bgG, bb);
    return;
  }

  const b = Math.max(0, Math.min(0.999, lum));
  // Textures may repaint details in another colour or brightness.
  SHADE.c = mat.color;
  SHADE.k = mat.emissive ? 1 : 0.35 + b * 0.85;
  const g = mat.tex ? mat.tex(b, u, v, SHADE) : part.bar;
  const [tr, tg, tb] = SHADE.c;
  write(r, sx, sy, g, tr * SHADE.k, tg * SHADE.k, tb * SHADE.k, base, br, bgG, bb);
}

// The glowing smear a swing leaves behind: the blade's recent positions,
// joined into bands that fade with age and towards the hilt.
const TRAIL_LIFE = 0.16;
const TRAIL_COLOR = [176, 224, 255];
const TRAIL_HIT = { nx: 0, ny: 0, u: 0, v: 0 };
export function drawTrail(r, view, trail, time) {
  for (let i = 0; i + 1 < trail.length; i++) {
    const a = trail[i];
    const b = trail[i + 1];
    const fade = 1 - (time - a.t) / TRAIL_LIFE;
    if (fade <= 0) continue;
    // Corners in row units: hilt then tip of one sample, tip then hilt of
    // the next.
    const shape = quad([a.hx * ASPECT, a.hy], [a.tx * ASPECT, a.ty], [b.tx * ASPECT, b.ty],
      [b.hx * ASPECT, b.hy]);
    const g = barGlyph((a.tx - a.hx) * ASPECT, a.ty - a.hy);
    for (let cy = Math.floor(shape.y0); cy <= Math.floor(shape.y1); cy++) {
      for (let cx = Math.floor(shape.x0 / ASPECT); cx <= Math.floor(shape.x1 / ASPECT); cx++) {
        if (!shape.test((cx + 0.5) * ASPECT, cy + 0.5, TRAIL_HIT)) continue;
        // v runs across the band from hilt (-1) to tip (+1).
        const k = fade * (0.25 + 0.75 * Math.max(0, (TRAIL_HIT.v + 1) / 2));
        r.put(cx - view.x0, cy - view.y0, g, TRAIL_COLOR[0] * k, TRAIL_COLOR[1] * k, TRAIL_COLOR[2] * k);
      }
    }
  }
}

export const TRAIL_SECONDS = TRAIL_LIFE;

// The warrior's name floating above the helm, as in an online RPG. `top` is
// the highest point of the dressed figure, in rows above the feet.
export function drawNameTag(r, view, state, parts, name, color = [212, 218, 228]) {
  let top = 0;
  for (const p of parts) top = Math.min(top, p.y0);
  const sy = Math.floor(state.y + top - 2) - view.y0;
  const sx = Math.floor(state.x - name.length / 2) - view.x0;
  for (let i = 0; i < name.length; i++) {
    r.put(sx + i, sy, glyph(name[i]), ...color);
    r.putBg(sx + i, sy, 8, 10, 14);
  }
}
