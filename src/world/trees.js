import { LAYER as LAYER_BIT, over } from '../render/glyphs.js';
import { hash2 } from '../core/rng.js';
import { FINE } from '../render/cells.js';
import { valueNoise } from '../core/noise.js';
import { FOLIAGE_TINT, FOLIAGE_TINT_AMOUNT, MOONLIGHT, SHADE } from '../render/palette.js';
import { recording, withCanopy, withFine } from './prop-art.js';
import { ASPECT } from './world.js';
import { BARK_RAMP, BIRCH_RAMP, char, edgeChar, leafStroke, rampChar, strokeChar } from './tree-chars.js';
import { branchCrown } from './tree-branches.js';

export const TREE_SPECIES = Object.freeze([
  'oak', 'birch', 'pine', 'spruce', 'acacia', 'jungle', 'cherry', 'willow',
]);
export const MAX_TREE_HEIGHT = 240;
export const MAX_TREE_HALF_WIDTH = 64;
// Leaf litter is scattered on the ground in front of the trunk, below its base.
export const MAX_LITTER_DEPTH = 8;
// Roots run out over the ground toward the viewer, at most this many rows
// below the base.
export const MAX_ROOT_DEPTH = 8;

const TAU = Math.PI * 2;
const SUB_X = [-0.25, 0.25];
const SUB_Y = [-5 / 6, -0.5, -1 / 6];
export const EVERGREEN = new Set(['pine', 'spruce']);
const SEASONS = new Set(['spring', 'summer', 'autumn', 'winter']);
const SWAY = { oak: 1.05, birch: 1.3, pine: 0.7, spruce: 0.55, acacia: 0.8, jungle: 1.1, cherry: 1.2, willow: 1.5 };
const BARK = {
  oak: [146, 104, 72], birch: [214, 216, 204], pine: [160, 98, 66],
  spruce: [122, 94, 80], acacia: [168, 120, 78], jungle: [150, 132, 104],
  cherry: [150, 92, 84], willow: [130, 118, 86],
};
// How each species' bark is textured (see glyph-packs/trees.js).
const BARK_KIND = {
  oak: 'furrow', birch: 'birch', pine: 'plate', spruce: 'plate',
  acacia: 'furrow', jungle: 'smooth', cherry: 'smooth', willow: 'furrow',
};
const SUMMER = {
  oak: [69, 153, 63], birch: [123, 187, 64], pine: [51, 127, 76],
  spruce: [51, 125, 111], acacia: [121, 160, 59], jungle: [44, 151, 85],
  cherry: [234, 130, 173], willow: [121, 176, 83],
};
const SPRING = {
  oak: [110, 184, 68], birch: [157, 203, 81], pine: [67, 147, 84],
  spruce: [65, 143, 118], acacia: [152, 185, 77], jungle: [63, 172, 92],
  cherry: [248, 153, 193], willow: [150, 196, 99],
};
const AUTUMN = {
  oak: [215, 117, 43], birch: [222, 181, 53], pine: [54, 122, 73],
  spruce: [47, 115, 105], acacia: [189, 153, 62], jungle: [113, 151, 62],
  cherry: [222, 115, 106], willow: [190, 180, 70],
};
const WINTER = {
  oak: [160, 126, 87], birch: [176, 162, 113], pine: [55, 103, 104],
  spruce: [57, 111, 124], acacia: [159, 145, 93], jungle: [85, 124, 99],
  cherry: [172, 134, 151], willow: [154, 161, 116],
};
// Autumn crowns turn patch by patch rather than all at once: each leaf mass
// takes one of these colours, so a single crown mixes them.
const AUTUMN_MIX = {
  oak: [[215, 117, 43], [190, 82, 38], [160, 96, 46], [214, 160, 58], [112, 128, 54]],
  birch: [[226, 186, 56], [238, 206, 84], [204, 150, 44], [150, 160, 60]],
  acacia: [[189, 153, 62], [206, 128, 52], [150, 150, 66]],
  jungle: [[113, 151, 62], [70, 140, 74], [170, 160, 60]],
  cherry: [[222, 115, 106], [200, 70, 62], [232, 146, 70], [176, 64, 86]],
  willow: [[190, 180, 70], [214, 188, 64], [150, 164, 70]],
};
const SNOW = [214, 232, 244];
const BARK_NIGHT = [176, 182, 214];
// Dew and moonlit droplets glinting blue among the leaves.
const DEW = [120, 170, 255];
const LEAF_NIGHT = [30, 84, 62];
const MOSS_GREEN = [78, 112, 66];
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const blend = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function leafPalette(species, season, variation) {
  const colors = { spring: SPRING, summer: SUMMER, autumn: AUTUMN, winter: WINTER };
  const pink = species === 'cherry' && season !== 'autumn';
  // The night cools every canopy toward teal. Blossom and autumn colour are
  // only lightly cooled so they still stand out from the green around them.
  const cool = FOLIAGE_TINT_AMOUNT * (pink || season === 'autumn' ? 0.4 : 1);
  const tint = (c) => blend(c, FOLIAGE_TINT, cool).map((v, i) => clamp(v + variation * (i === 1 ? 15 : 8), 0, 255));
  const base = tint(colors[season][species]);
  const mix = season === 'autumn' && AUTUMN_MIX[species] ? AUTUMN_MIX[species].map(tint) : [base];
  return {
    base,
    mix,
    // Cherry trees carry green leaves among their blossom.
    green: tint(season === 'spring' ? [120, 190, 80] : [70, 150, 70]),
    light: pink ? [255, 226, 238] : MOONLIGHT,
    rim: pink ? [205, 196, 240] : [150, 200, 230],
  };
}

// The leaf glyph family of each species.
function foliageFamily(species, season, growth) {
  if (growth === 'bush') {
    return { oak: 'broad', birch: 'round', pine: 'brush', spruce: 'brush', acacia: 'round',
      jungle: 'broad', cherry: season === 'autumn' ? 'almond' : 'almond', willow: 'lance' }[species];
  }
  if (species === 'cherry') return season === 'autumn' ? 'almond' : 'bloom';
  return { oak: 'broad', birch: 'round', pine: 'tuft', spruce: 'brush', acacia: 'spray',
    jungle: 'almond', willow: 'lance' }[species];
}


// Bounds of a wood segment, wide enough for a trunk's flared base.
function padWood(wood) {
  const pad = Math.max(1.5, wood.r0 * (wood.trunk ? 1.9 : 1), wood.r1);
  wood.minX = Math.min(wood.x0, wood.x1) - pad;
  wood.maxX = Math.max(wood.x0, wood.x1) + pad;
  wood.minY = Math.min(wood.y0, wood.y1) - pad;
  wood.maxY = Math.max(wood.y0, wood.y1) + pad;
}

// Trunks swell a little where they meet their roots.
const flare = (s, py) => 1 + 0.45 * Math.exp(py / (s.r0 * 1.7 + 0.5));
// Wood at least this thick (in world units) is filled with bark; anything
// thinner is drawn as a single smooth stroke along its centre line.
const THICK = 0.5;
// The ground is seen from above and in front: a step toward the viewer on
// the ground moves this far down the screen. A trunk's foot is the near
// half of an ellipse this flat, and roots running toward the viewer are
// shortened by it.
const GROUND_TILT = 0.4;
// Where the moon is: up, to the left and in front of the viewer, with x
// across the screen, y down it and z toward the viewer.
const LX0 = -0.5;
const LY0 = -0.62;
const LZ0 = 0.6;

// How far a point lies from a wood segment, where along it, and how far
// across it to the right of its direction (`across`, signed).
function segmentDistance(px, py, s) {
  const vx = s.x1 - s.x0;
  const vy = s.y1 - s.y0;
  const len2 = vx * vx + vy * vy || 1;
  const t = clamp(((px - s.x0) * vx + (py - s.y0) * vy) / len2);
  const radius = s.r0 + (s.r1 - s.r0) * t;
  const cx = px - s.x0 - vx * t;
  const cy = py - s.y0 - vy * t;
  return { distance: Math.hypot(cx, cy), radius, t, across: (cy * vx - cx * vy) / Math.sqrt(len2) };
}

// Moonlight on round wood: `u` runs across the segment from -1 to 1 (its
// left and right edges as it runs), and the surface there faces the moon
// as much as its normal does.
function roundLight(s, u) {
  const vx = s.x1 - s.x0;
  const vy = s.y1 - s.y0;
  const len = Math.hypot(vx, vy) || 1;
  // The direction `across` measures, turned onto the screen.
  const ax = -vy / len;
  const ay = vx / len;
  const nz = Math.sqrt(Math.max(0, 1 - u * u));
  const lambert = (ax * u * LX + ay * u * LY + nz * LZ) / Math.hypot(LX, LY, LZ);
  return clamp(0.1 + 0.9 * lambert);
}

// A twig too thin to fill is lit as an upright one.
const UPRIGHT = { x0: 0, y0: 0, x1: 0, y1: -1 };

// The foot of a grown trunk is modelled as a solid and drawn as one: the
// trunk swells toward the ground into buttresses, each running down and out
// into a root that sinks into the soil, all blended into one surface. Each
// point of the sprite is found by casting a ray into the scene the way the
// view looks, down and away from the viewer, so roots in front hide what is
// behind them and the surface is lit by the way it really faces the moon.
// Coordinates are in physical units around the trunk's axis: x across, h
// up from the ground, z toward the viewer. A point on the screen at height
// h and depth z lies GROUND_TILT * z - h rows below the base.
const FOOT_HEIGHT = 2.4;
const LIGHT3 = (() => {
  const k = Math.hypot(LX0, LY0, LZ0);
  return [LX0 / k, -LY0 / k, LZ0 / k];
})();

function makeFoot(trunk, seed) {
  const r = trunk.r0;
  if (r < 0.55) return null;
  const count = 4 + Math.floor(hash2(seed, 3, 11) * 3);
  const turn = hash2(seed, 5, 7) * Math.PI * 2;
  const roots = [];
  let reach = r;
  for (let i = 0; i < count; i++) {
    const a = turn + (i + (hash2(seed, i, 13) - 0.5) * 0.5) / count * Math.PI * 2;
    const rise = r * (0.55 + hash2(seed, i, 19) * 0.4);
    const wide = 0.45 + hash2(seed, i, 29) * 0.25;
    const root = {
      a, dx: Math.sin(a), dz: Math.cos(a), rise, wide,
      fall: r * (0.75 + hash2(seed, i, 23) * 0.6),
      end: r * (2.3 + hash2(seed, i, 17) * 1.5),
      // No part of the root lies further than this to either side.
      span: r * 0.18 + rise * wide,
    };
    roots.push(root);
    reach = Math.max(reach, root.end);
  }
  const top = r * FOOT_HEIGHT;
  const outer = reach + r;
  let tallest = 0;
  for (const q of roots) tallest = Math.max(tallest, q.rise);
  // Rows from the base: the foot starts this far above it and reaches this
  // far below, where the nearest roots run toward the viewer.
  const from = trunk.y0 - top;
  const bottom = trunk.y0 + reach * GROUND_TILT + r * 0.2;
  // The trunk's own radius at a height, as its segment and flare give it.
  const length = Math.hypot(trunk.x1 - trunk.x0, trunk.y1 - trunk.y0) || 1;
  const stem = (h) => (trunk.r0 + (trunk.r1 - trunk.r0) * clamp(h / length)) * flare(trunk, -h);
  const widest = stem(0) * 1.75;
  const angle = (a, b) => {
    const d = Math.abs(a - b) % (Math.PI * 2);
    return d > Math.PI ? Math.PI * 2 - d : d;
  };
  // The trunk and its roots are joined by a smooth maximum, so a root grows
  // out of the trunk in a curve rather than at a corner.
  const blendK = r * 0.45;
  const smax = (a, b) => {
    const d = Math.max(blendK - Math.abs(a - b), 0);
    return Math.max(a, b) + d * d / (4 * blendK);
  };
  // How far inside the solid a point lies (negative outside). The last
  // call also leaves which part it is in, and how far the point is at
  // least from any root it is outside of, which bounds how far a ray may
  // safely step.
  let inRoot = false;
  let clearance = Infinity;
  const field = (x, h, z) => {
    const rho = Math.hypot(x, z);
    let root = -Infinity;
    clearance = Infinity;
    for (const q of roots) {
      const d = x * q.dx + z * q.dz;
      const across = z * q.dx - x * q.dz;
      const gap = Math.max(Math.abs(across) - q.span, d - q.end, -d, h - q.rise);
      if (gap > 0) {
        clearance = Math.min(clearance, gap);
        continue;
      }
      // A root is a ridge on the ground: tall where it leaves the trunk,
      // lower and narrower outward, until it sinks into the soil.
      const sink = 1 - clamp((d - q.end * 0.55) / (q.end * 0.45));
      const height = q.rise * Math.exp(-Math.max(0, d - r * 0.6) / q.fall) * sink * sink - r * 0.04;
      if (height <= 0) {
        clearance = Math.min(clearance, r * 0.1);
        continue;
      }
      const width = r * 0.18 + height * q.wide;
      const profile = height * Math.sqrt(Math.max(0, 1 - (across / width) ** 2));
      root = Math.max(root, profile - h);
    }
    // The trunk swells toward the ground, most where it runs into a root.
    let trunkIn = -rho;
    if (rho < widest + blendK) {
      const theta = Math.atan2(x, z);
      let lobe = 0;
      for (const q of roots) {
        const t = 1 - (angle(theta, q.a) / 0.62) ** 2;
        if (t > lobe * lobe) lobe = Math.max(lobe, t * t);
      }
      const swell = 1 + 0.75 * Math.exp(-Math.max(0, h) / (r * 0.9)) * (0.15 + 0.85 * lobe) *
        (1 - clamp((h - top * 0.7) / (top * 0.3)));
      trunkIn = stem(Math.max(0, h)) * swell - rho;
    }
    inRoot = root > trunkIn;
    return smax(trunkIn, root);
  };
  return {
    from, bottom, left: trunk.x0 - outer, right: trunk.x0 + outer,
    // The surface seen at a point of the screen, or null where the view
    // reaches the ground first.
    cast(px, py) {
      const x = px - trunk.x0;
      const y = py - trunk.y0;
      if (Math.abs(x) >= outer) return null;
      // Along the view the height above the ground falls with the depth.
      // Nothing lies outside the circle the roots reach, and the steps are
      // as long as the distance to the solid allows.
      const zMax = Math.sqrt(outer * outer - x * x);
      const zEnd = Math.max(-zMax, y / GROUND_TILT);
      // Above the tallest root only the trunk can be in the way, so the
      // ray starts at whichever comes first.
      const near = widest + blendK;
      const zTrunk = Math.abs(x) < near ? Math.sqrt(near * near - x * x) : -Infinity;
      const least = r * 0.08;
      let z = Math.min(zMax, Math.max(zTrunk, (tallest + y) / GROUND_TILT));
      if (z < zEnd) return null;
      let outside = z;
      let inside = null;
      for (;;) {
        const h = GROUND_TILT * z - y;
        const v = field(x, h, z);
        if (v > 0) {
          inside = z;
          break;
        }
        if (z <= zEnd) break;
        outside = z;
        z = Math.max(zEnd, z - Math.max(least, Math.min(-v, clearance) * 0.6));
      }
      if (inside === null) return null;
      // Narrow the step down to the surface.
      for (let i = 0; i < 5; i++) {
        const mid = (inside + outside) / 2;
        if (field(x, GROUND_TILT * mid - y, mid) > 0) inside = mid;
        else outside = mid;
      }
      z = inside;
      const h = Math.max(0, GROUND_TILT * z - y);
      const e = r * 0.06;
      const here = field(x, h, z);
      const root = inRoot;
      const gx = field(x + e, h, z) - here;
      const gh = field(x, h + e, z) - here;
      const gz = field(x, h, z + e) - here;
      const k = Math.hypot(gx, gh, gz) || 1;
      // The outward normal, and how squarely it faces the moon.
      const nx = -gx / k;
      const lambert = nx * LIGHT3[0] - gh / k * LIGHT3[1] - gz / k * LIGHT3[2];
      const rho = Math.hypot(x, z);
      const theta = Math.atan2(x, z);
      return {
        light: clamp(0.1 + 0.9 * lambert),
        // Wood darkens where it meets the soil.
        soil: 0.5 + 0.5 * clamp(h / (r * 1.1)) ** 0.7,
        nx, root, h,
        around: root ? z * Math.cos(theta) - x * Math.sin(theta) : theta * rho,
        along: root ? rho : h,
      };
    },
  };
}

// Geometry uses physical distances. ASPECT is only read when making a tree:
// world -> props -> trees -> world is a valid ES module initialization cycle.
function geometry(species, rand) {
  const blobs = [];
  const tiers = [];
  const wood = [];
  const strands = [];
  const ellipse = (x, y, rx, ry, layer = 0) => blobs.push({ x, y, rx, ry, layer, spray: species === 'pine' });
  const branch = (x0, y0, x1, y1, r0 = 0.45, r1 = 0.15, trunk = false) => {
    const pad = Math.max(1.5, r0, r1);
    wood.push({ x0, y0, x1, y1, r0, r1, trunk,
      minX: Math.min(x0, x1) - pad, maxX: Math.max(x0, x1) + pad,
      minY: Math.min(y0, y1) - pad, maxY: Math.max(y0, y1) + pad,
    });
  };
  const fork = (x0, y0, x1, y1, spread = 2) => {
    branch(x0, y0, x1, y1, 0.65, 0.24);
    branch(x1, y1, x1 - spread, y1 - 3, 0.24, 0.1);
    branch(x1, y1, x1 + spread * 0.7, y1 - 4, 0.24, 0.1);
  };
  let h;
  let footW = 2.1;
  let footH = 1.15;

  if (species === 'oak') {
    h = 28 + rand() * 5;
    const rx = 7.6 + rand() * 1.2;
    branch(0, 0, -0.4, -h + 4, 1.2, 0.6, true);
    fork(0, -h * 0.51, -5.2, -h + 1, 2.6);
    fork(-0.3, -h * 0.65, 5.4, -h - 1, 2.5);
    ellipse(-0.5, -h - 1, rx, 8.1, 0);
    ellipse(-5.6, -h + 1.2, rx * 0.73, 5.8, 1);
    ellipse(5.4, -h + 0.5, rx * 0.7, 6, 2);
    ellipse(-3.1, -h - 5, rx * 0.67, 5.4, 3);
    ellipse(3.4, -h - 4.1, rx * 0.65, 5.5, 4);
    ellipse(0.8, -h + 4.5, rx * 0.62, 4.4, 5);
  } else if (species === 'birch') {
    h = 41 + rand() * 5;
    footW = 1.55;
    footH = 0.95;
    branch(0, 0, 0.7, -h - 1, 0.83, 0.34, true);
    fork(0.3, -h * 0.54, -3.4, -h + 3.2, 1.9);
    fork(0.4, -h * 0.68, 3.6, -h - 1, 1.7);
    ellipse(0.4, -h - 2, 4.9, 9.4, 0);
    ellipse(-3.4, -h + 4.2, 3.7, 6.4, 1);
    ellipse(3.5, -h + 0.1, 3.5, 6.7, 2);
    ellipse(-1.8, -h - 7.4, 3.1, 5.2, 3);
    ellipse(1.8, -h + 8, 3.5, 5, 4);
  } else if (EVERGREEN.has(species)) {
    const spruce = species === 'spruce';
    h = (spruce ? 49 : 53) + rand() * 7;
    footW = 1.8;
    // Keep the original number of random draws before growth chooses the
    // trunk's footprint; changing the art must not move collision boundaries.
    const count = spruce ? 7 : 6;
    branch(0, 0, 0, -h + 0.7, 0.95, 0.14, true);
    for (let i = 0; i < count; i++) {
      const top = -h + i * h * (spruce ? 0.094 : 0.076);
      const depth = h * (spruce ? 0.2 : 0.13) + i * 0.18;
      const width = (spruce ? 2 : 3) + i * (spruce ? 1.24 : 1.45);
      const lean = (rand() - 0.5) * 0.9;
      if (spruce) tiers.push({ x: lean, y: top, width, depth, layer: i });
      else {
        // Pines carry separate whorls on long exposed trunks. Each bough
        // ends in needle sprays, with sky visible between the whorls.
        ellipse(lean, top + depth * 0.48, width * 0.66, depth * 0.45, i);
        ellipse(lean - width * 0.65, top + depth * 0.74, width * 0.48, depth * 0.3, i);
        ellipse(lean + width * 0.67, top + depth * 0.6, width * 0.46, depth * 0.34, i);
      }
      branch(0, top + depth * 0.35, lean - width * 0.95, top + depth * 0.8, 0.36, 0.12);
      branch(0, top + depth * 0.4, lean + width * 0.95, top + depth * 0.7, 0.36, 0.12);
    }
  } else if (species === 'acacia') {
    h = 31 + rand() * 5;
    const bend = rand() < 0.5 ? -1 : 1;
    branch(0, 0, bend * 1.3, -h * 0.5, 1.05, 0.74, true);
    branch(bend * 1.3, -h * 0.5, bend * 3.7, -h + 1, 0.74, 0.4, true);
    fork(bend * 1.5, -h * 0.58, bend * 3.3 - 5.6, -h - 1.5, 2.7);
    fork(bend * 2, -h * 0.74, bend * 3.3 + 5.4, -h - 1.6, 2.5);
    ellipse(bend * 3.1, -h - 3.5, 9.4, 3.8, 0);
    ellipse(bend * 3.1 - 5.6, -h - 3.9, 4.2, 3.1, 1);
    ellipse(bend * 3.1 + 5.1, -h - 4.6, 4.6, 3, 2);
    ellipse(bend * 3.1 - 1.1, -h - 6.2, 5.5, 2.6, 3);
  } else if (species === 'jungle') {
    h = 46 + rand() * 7;
    footW = 2.4;
    footH = 1.3;
    branch(0, 0, -0.5, -h + 3, 1.55, 0.75, true);
    branch(0, -5, -3.7, 0, 0.85, 0.25);
    branch(0, -6, 3.8, 0, 0.85, 0.25);
    fork(-0.4, -h * 0.7, -6.3, -h + 0.8, 2.8);
    fork(-0.4, -h * 0.76, 6, -h - 0.3, 2.8);
    ellipse(-0.9, -h - 2.7, 8.6, 8.4, 0);
    ellipse(-6.4, -h + 1.9, 5.5, 6.9, 1);
    ellipse(6.1, -h + 0.2, 5.6, 7.2, 2);
    ellipse(1.2, -h - 7.1, 5.5, 6.1, 3);
    ellipse(-2.1, -h + 5.5, 6.2, 5.4, 4);
    for (let i = 0; i < 5; i++) {
      const sx = -8 + i * 3.8 + rand() * 0.8;
      const sy = -h + 3 + rand() * 4;
      const length = 12 + rand() * 12;
      strands.push({ x: sx, y: sy, length, bend: 0.9, radius: 0.23, layer: i, vine: true });
    }
  } else if (species === 'cherry') {
    h = 26 + rand() * 5;
    branch(0, 0, 0.8, -h + 3, 1.05, 0.5, true);
    fork(0.4, -h * 0.51, -5.9, -h + 0.4, 3.1);
    fork(0.6, -h * 0.64, 6.1, -h - 1.2, 3.1);
    ellipse(0.3, -h - 1.8, 8.3, 7.5, 0);
    ellipse(-6.2, -h + 0.6, 5.7, 5.6, 1);
    ellipse(6.4, -h - 0.6, 5.8, 5.7, 2);
    ellipse(-2.6, -h - 6.4, 5.5, 4.7, 3);
    ellipse(3.1, -h - 5.8, 5.9, 4.9, 4);
    ellipse(1.1, -h + 4.5, 6.3, 3.7, 5);
  } else {
    h = 28 + rand() * 6;
    branch(0, 0, -0.8, -h + 2, 1.15, 0.5, true);
    fork(-0.5, -h * 0.56, -6.2, -h - 0.4, 2.4);
    fork(-0.5, -h * 0.68, 6, -h - 1.4, 2.5);
    ellipse(-0.6, -h - 2.1, 8.6, 7.2, 0);
    ellipse(-6, -h + 0.5, 5.4, 5.1, 1);
    ellipse(5.9, -h - 0.2, 5.5, 5.5, 2);
    ellipse(-1.9, -h - 5.3, 6, 4.8, 3);
    for (let i = 0; i < 15; i++) {
      const sx = -10.2 + i * 1.45 + (rand() - 0.5) * 0.3;
      const sy = -h + 1.3 + Math.abs(sx) * 0.11;
      const length = 12 + rand() * 10 + Math.abs(sx) * 0.24;
      strands.push({ x: sx, y: sy, length, bend: Math.sign(sx) * (0.6 + rand() * 0.8), radius: 0.38 + rand() * 0.22, layer: i, vine: false });
    }
  }

  // Roots are visible ground anchors. Twigs preserve each crown's structure
  // when deciduous trees lose most of their leaves in winter.
  branch(-0.3, -2.2, -2.4, 0, 0.65, 0.15);
  branch(0.3, -2.1, 2.2, 0, 0.6, 0.15);
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const anchorX = species === 'acacia' ? blobs[0].x : 0;
    branch(anchorX, b.spray ? b.y - b.ry * 0.25 : -h + 4, b.x, b.y, 0.4, 0.17);
    for (const sign of [-1, 1]) {
      branch(b.x, b.y, b.x + sign * b.rx * 0.66, b.y - b.ry * 0.35, 0.17, 0.1);
      branch(b.x + sign * b.rx * 0.4, b.y - b.ry * 0.2, b.x + sign * b.rx * 0.55, b.y - b.ry * 0.72, 0.13, 0.08);
    }
  }
  return { blobs, tiers, wood, strands, h, footW, footH };
}

function bushGeometry(rand) {
  const shape = { blobs: [], tiers: [], wood: [], strands: [], h: 7, footW: 0, footH: 0 };
  const count = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1) - 0.5) * (6 + rand() * 4);
    // Domed: the middle of the bush stands taller than its sides.
    const dome = 1 - Math.abs(i / (count - 1) - 0.5) * 2;
    const y = -4 - dome * 2.5 - rand() * 1;
    shape.blobs.push({ x, y, rx: 2.6 + rand() * 1.8, ry: 2.8 + rand() * 1.2 + dome * 0.6, layer: i });
    shape.wood.push({ x0: x * 0.3, y0: 0, x1: x, y1: y, r0: 0.25, r1: 0.1,
      trunk: false, minX: x - 5, maxX: x + 5, minY: y - 2, maxY: 2 });
  }
  return shape;
}

// Individual crowns grow around their branch clusters, rather than sharing
// identical circular outlines. Size and lean stay seeded across seasons.
function grow(shape, growth, rand) {
  const mature = growth === 'mature';
  const sx = mature ? 2 + rand() * 0.8 : growth === 'sapling' ? 0.42 + rand() * 0.28 : 0.85 + rand() * 0.55;
  const sy = mature ? 2.15 + rand() * 0.85 : growth === 'sapling' ? 0.4 + rand() * 0.3 : 0.85 + rand() * 0.5;
  const lean = (rand() - 0.5) * (mature ? 0.055 : 0.035);
  const xAt = (x, y) => x * sx - y * sy * lean;
  const clusters = [];
  shape.crowns = [];
  for (const b of shape.blobs) {
    const x = xAt(b.x, b.y);
    const y = b.y * sy;
    const rx = b.rx * sx;
    const ry = b.ry * sy * (0.8 + rand() * 0.2);
    shape.crowns.push({ x, y, rx, ry, layer: b.layer });
    // A core and smaller overlapping lobes provide an irregular crown and
    // visible shaded pockets between outward-facing leaf masses.
    clusters.push({ x, y, rx: rx * 0.58, ry: ry * 0.62, layer: b.layer, depth: rand() * 2 });
    // Many smaller lobes bulging out of the core make a crown of distinct
    // leaf masses, with dark creases between them and a lumpy outline.
    // Pine boughs are already split into three sprays; only a few small
    // lobes are needed on each, keeping their cold bake inexpensive.
    const count = mature ? (b.spray ? 3 : 7) : 4;
    for (let i = 0; i < count; i++) {
      const a = i / count * TAU + rand() * 0.5;
      const reach = 0.55 + rand() * 0.25;
      clusters.push({ x: x + Math.cos(a) * rx * reach,
        y: y + Math.sin(a) * ry * reach * 0.92,
        rx: rx * (0.22 + rand() * 0.14), ry: ry * (0.23 + rand() * 0.13),
        layer: b.layer, depth: 1 + rand() * 4 });
    }
  }
  shape.blobs = clusters;
  for (const tier of shape.tiers) {
    tier.x = xAt(tier.x, tier.y);
    tier.y *= sy;
    tier.width *= sx * (0.82 + rand() * 0.27);
    tier.depth *= sy * (0.9 + rand() * 0.15);
  }
  for (const strand of shape.strands) {
    strand.x = xAt(strand.x, strand.y);
    strand.y *= sy;
    strand.length *= sy;
    strand.radius *= sx;
    strand.bend *= sx;
  }
  for (const wood of shape.wood) {
    wood.x0 = xAt(wood.x0, wood.y0);
    wood.x1 = xAt(wood.x1, wood.y1);
    wood.y0 *= sy;
    wood.y1 *= sy;
    wood.r0 *= sx;
    wood.r1 *= sx;
    padWood(wood);
  }
  shape.h *= sy;
  shape.footW *= sx;
  shape.footH *= mature ? 1.45 : growth === 'sapling' ? 0.6 : 1;
  return shape;
}

// The crown's leaf masses as the ground sees them (see canopy.js), four
// numbers each: x across from the trunk and radius rx in row units, height
// above the base and vertical radius ry in rows. Mature crowns come from
// their grown ellipses, a spruce's from its tiers, each a mass half its
// depth below its top. Taken before the branches split them into sprays.
function leafMasses(shape) {
  const masses = [];
  for (const c of shape.crowns) masses.push(c.x, -c.y, c.rx, c.ry);
  for (const t of shape.tiers) masses.push(t.x, -(t.y + t.depth / 2), t.width, t.depth / 2);
  return Float32Array.from(masses);
}

// Keep only geometry that can touch this row. These bounds include the
// maximum noisy leaf edge and strand bend, so sampling and cell order stay
// unchanged while the empty space beside a tall trunk is skipped.
// The geometry that can touch the band of rows from y - span to y.
function geometryAtRow(shape, y, span = 1) {
  const row = { blobs: [], tiers: [], strands: [], wood: [], left: Infinity, right: -Infinity };
  const include = (parts, part, left, right) => {
    parts.push(part);
    row.left = Math.min(row.left, left);
    row.right = Math.max(row.right, right);
  };
  for (const b of shape.blobs) {
    const ny = Math.max(0, b.y - y, y - span - b.y) / b.ry;
    // The sampler's squared radius is at most 0.8 + 0.22 + 0.05 + 0.2.
    const reach2 = 1.28 - ny * ny;
    if (reach2 < 0) continue;
    const reach = b.rx * Math.sqrt(reach2);
    include(row.blobs, b, b.x - reach, b.x + reach);
  }
  for (const t of shape.tiers) {
    if (t.y > y || t.y + t.depth < y - span) continue;
    const v = Math.min(1, (y - t.y) / t.depth);
    // Both noisy width factors are bounded by 1.08 * 1.04 < 1.13.
    const reach = t.width * (0.04 + v * 0.96) * 1.13;
    include(row.tiers, t, t.x - reach, t.x + reach);
  }
  for (const s of shape.strands) {
    if (s.y > y || s.y + s.length < y - span) continue;
    include(row.strands, s, s.x + Math.min(0, s.bend) - s.radius - 0.24,
      s.x + Math.max(0, s.bend) + s.radius + 0.24);
  }
  for (const s of shape.wood) {
    if (s.minY > y || s.maxY < y - span) continue;
    include(row.wood, s, s.minX, s.maxX);
  }
  const foot = shape.foot;
  if (foot && foot.from < y && foot.bottom > y - span) {
    row.foot = foot;
    row.left = Math.min(row.left, foot.left);
    row.right = Math.max(row.right, foot.right);
  }
  return row;
}

// The moon is up and to the left of the viewer.
const LX = LX0;
const LY = LY0;
const LZ = LZ0;

function makeSampler(shape, species, season, seed) {
  const winter = season === 'winter';
  const evergreen = EVERGREEN.has(species);
  // The crown as a whole is lit like one big sphere, and each leaf mass on
  // it again like a small one: the masses tucked deepest are darkest.
  let crownTop = Infinity;
  let crownBottom = -Infinity;
  let crownLeft = Infinity;
  let crownRight = -Infinity;
  let deepest = -Infinity;
  let shallowest = Infinity;
  for (const b of shape.blobs) {
    crownTop = Math.min(crownTop, b.y - b.ry);
    crownBottom = Math.max(crownBottom, b.y + b.ry);
    crownLeft = Math.min(crownLeft, b.x - b.rx);
    crownRight = Math.max(crownRight, b.x + b.rx);
    deepest = Math.max(deepest, b.depth + Math.min(b.rx, b.ry) * 0.32);
    shallowest = Math.min(shallowest, b.depth);
  }
  for (const t of shape.tiers) {
    crownTop = Math.min(crownTop, t.y);
    crownBottom = Math.max(crownBottom, t.y + t.depth);
    crownLeft = Math.min(crownLeft, t.x - t.width);
    crownRight = Math.max(crownRight, t.x + t.width);
  }
  const crownSpan = Math.max(1, crownBottom - crownTop);
  const cx = (crownLeft + crownRight) / 2;
  const cy = (crownTop + crownBottom) / 2;
  const crx = Math.max(1, (crownRight - crownLeft) / 2);
  const cry = crownSpan / 2;
  const depthSpan = Math.max(0.5, deepest - shallowest);

  // Each row passes only the geometry that can touch it; the crown's
  // lighting above still comes from the whole tree.
  return (px, py, row = shape, thick = THICK) => {
    const grain = hash2(Math.floor(px * 2.2), Math.floor(py * 1.6), seed + 41);
    const clump = valueNoise(px * 0.24, py * 0.2, seed + 89);
    const height = clamp(1 - (py - crownTop) / crownSpan);
    const global = clamp(0.62 - (px - cx) / crx * 0.3 - (py - cy) / cry * 0.45);
    let leaf = null;
    let covers = 0;
    let leafy = -1;

    for (const b of row.blobs) {
      const nx = (px - b.x) / b.rx;
      const ny = (py - b.y) / b.ry;
      const d = nx * nx + ny * ny;
      // Notches at two scales give the edge a leafy silhouette.
      let limit = 0.8 + clump * 0.22 + grain * 0.05;
      if (d > limit) {
        if (leafy < 0) leafy = valueNoise(px * 1.1, py * 0.75, seed + 97);
        limit += leafy * 0.2;
        if (d > limit) continue;
      }
      covers++;
      const rel = d / limit;
      const nz = Math.sqrt(1 - rel);
      const depth = b.depth + nz * Math.min(b.rx, b.ry) * 0.32;
      if (leaf && depth <= leaf.depth) continue;
      leaf = { kind: 'leaf', depth, rel, nx, ny, nz, mass: b, tier: null, strand: null, v: 0 };
    }
    if (leaf) {
      const lobe = clamp(0.35 + (leaf.nx * LX + leaf.ny * LY + leaf.nz * LZ) * 0.65);
      const recess = clamp((leaf.depth - shallowest) / depthSpan);
      // A dark crease where one leaf mass tucks in behind another.
      const crease = covers > 1 && leaf.rel > 0.66 ? clamp((leaf.rel - 0.66) * 3) : 0;
      leaf.light = clamp((lobe * 0.64 + global * 0.36) * (0.52 + recess * 0.48) - crease * 0.3 +
        height * (species === 'spruce' ? 0.35 : 0.14) - 0.04 - (species === 'spruce' ? (1 - height) * 0.08 : 0));
      leaf.edge = leaf.rel > 0.84;
      leaf.rim = leaf.nx < -0.4 && leaf.ny < 0.3 && leaf.rel > 0.78;
    }
    for (const t of row.tiers) {
      const v = (py - t.y) / t.depth;
      if (v < 0 || v > 1) continue;
      const half = t.width * (0.04 + v * 0.96) * (0.86 + clump * 0.22);
      const edge = Math.abs(px - t.x) / (half || 0.01);
      if (edge > 0.96 + grain * 0.08 || v > 0.95 + Math.sin((px - t.x) * 1.3 + t.layer) * 0.045) continue;
      if (leaf && t.layer <= leaf.depth) continue;
      const nx = (px - t.x) / t.width;
      // Each tier is a skirt: pale along its upper surface, sinking into
      // shadow at its hem and under the tier above.
      const light = clamp((0.7 - nx * 0.32 - v * 0.62 + clump * 0.1) * 0.74 + height * 0.3);
      leaf = { kind: 'leaf', depth: t.layer, light, rel: edge, edge: edge > 0.86, rim: nx < -0.45 && v < 0.6,
        nx: px - t.x, ny: v, mass: t, tier: t, strand: null, v };
    }
    for (const s of row.strands) {
      const v = (py - s.y) / s.length;
      if (v < 0 || v > 1) continue;
      const curve = s.x + s.bend * v * v + Math.sin(v * 5 + s.layer * 1.7) * 0.24;
      const width = s.radius * (1 - v * 0.65);
      const across = (px - curve) / (width || 0.01);
      if (Math.abs(across) > 1 || (s.vine && grain < 0.23)) continue;
      // Strands hang below the crown, so they dim toward their tips too.
      const light = clamp(0.6 + (s.tone - 0.5) * 0.36 - v * 0.32 - across * 0.12 + height * 0.2);
      leaf = { kind: 'leaf', light, edge: false, rim: false, strand: s, v, nx: across, ny: 1, mass: s, tier: null, rel: Math.abs(across) };
    }
    if (leaf && !leaf.strand) {
      // Deep in the shade the canopy opens into holes where the branches
      // inside show through.
      const hole = valueNoise(px * 0.5, py * 0.36, seed + 211);
      leaf.gap = hole > 0.69 + leaf.light * 0.2;
    }

    const bare = winter && !evergreen;
    if (leaf && !leaf.gap && !bare && (leaf.light > 0.5 || leaf.strand)) return leaf;
    let wood = null;
    let nearTwig = false;
    // Near the ground the trunk is drawn from its solid foot.
    const foot = row === shape ? (shape.foot && py > shape.foot.from && py < shape.foot.bottom ? shape.foot : null)
      : row.foot;
    const inFoot = foot && py > foot.from;
    if (inFoot) {
      const seen = foot.cast(px, py);
      if (seen) {
        const trunk = shape.wood.find((w) => w.trunk);
        wood = { kind: 'wood', segment: trunk, edge: 0, t: 0, radius: trunk.r0, inCrown: !!leaf, u: seen.nx, foot: seen };
      }
    }
    for (const s of row.wood) {
      if (px < s.minX || px > s.maxX || py < s.minY || py > s.maxY) continue;
      if (s.trunk && inFoot) continue;
      const hit = segmentDistance(px, py, s);
      const radius = s.trunk ? hit.radius * flare(s, py) : hit.radius;
      if (s.trunk && py > s.y0) continue;
      if (hit.distance < 1.5) nearTwig = true;
      // Thin branches are drawn afterwards, as strokes (see strokeWood).
      if (hit.distance > radius || radius < thick) continue;
      if (wood && wood.segment.trunk) continue;
      wood = { kind: 'wood', segment: s, edge: hit.distance / radius, t: hit.t, radius, inCrown: !!leaf,
        u: clamp(hit.across / radius, -1, 1) };
    }
    if (wood && (wood.segment.trunk || !leaf || leaf.gap || bare)) return wood;
    // The trunk rises through the shaded heart of the crown; elsewhere the
    // leaves hide the wood.
    if (leaf && !leaf.gap && !bare) return leaf;
    if (wood) return wood;
    if (leaf && bare) return { kind: 'bare', light: leaf.light, nearTwig, edge: leaf.edge, mass: leaf.mass, v: leaf.v, tier: leaf.tier };
    return leaf;
  };
}

// Leaf colour for a lighting level: from a cool navy shade through the
// species colour to pale moonlight. Each leaf mass has its own tone.
function leafColor(palette, mass, light, species, season) {
  const tone = mass?.tone ?? 0.5;
  let base = palette.mix[Math.floor(tone * palette.mix.length) % palette.mix.length];
  base = base.map((v, i) => clamp(v * (0.93 + tone * 0.14) + (i === 1 ? (tone - 0.5) * 10 : 0), 0, 255));
  const shade = blend(base.map((v) => v * 0.3), SHADE, 0.5);
  if (light < 0.55) return { base, color: blend(shade, base, light / 0.55) };
  return { base, color: blend(base, palette.light, (light - 0.55) * 0.5) };
}

const rgb = (cell, c) => {
  cell.r = Math.round(clamp(c[0], 0, 255));
  cell.gg = Math.round(clamp(c[1], 0, 255));
  cell.b = Math.round(clamp(c[2], 0, 255));
  return cell;
};


// Accents layered over a few leaf clusters: fruit, cones and catkins.
function accentFor(species, season, leaf, growth) {
  if (growth === 'bush') return null;
  if (EVERGREEN.has(species)) return leaf.v > 0.6 ? { ch: 'v', p: 0.012, c: [126, 84, 56] } : null;
  if (season === 'spring' && (species === 'birch' || species === 'willow' || species === 'oak')) {
    return { ch: ':', p: 0.02, c: [196, 192, 118] };
  }
  if (species === 'oak' && (season === 'summer' || season === 'autumn')) return { ch: 'o', p: 0.014, c: [150, 116, 66] };
  if (species === 'cherry' && season === 'summer') return { ch: 'o', p: 0.03, c: [206, 34, 58] };
  if (species === 'jungle' && season !== 'winter' && leaf.ny > 0.2) return { ch: 'O', p: 0.014, c: [226, 166, 58] };
  return null;
}

// The fine twigs of a bare crown.
const SPRIGS = ["'", ',', '`', '.', 'y', 'v', '/', '\\'];

const BERRIES = [[196, 38, 52], [80, 70, 168], [40, 30, 58], [226, 120, 40]];

// Six subcell samples smooth the outline; each covered cell becomes a glyph
// chosen from what it shows (a leaf cluster facing out of the crown, bark,
// a branch running through it) with highlights, snow, fruit and moss
// layered over it. The returned cells are the complete sprite.
//
// `res` cells are baked across each cell of the world: the fine bake
// (res = FINE) draws the same tree in smaller letters. Noise that shapes
// the tree is read in world cells so both bakes show the same tree.
//
// The bake pauses after every row, so a long one can be spread over several
// frames; `bake` runs it in one go.
function bake(...args) {
  return finish(bakeSteps(...args));
}

function finish(steps) {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

function* bakeSteps(sample, seed, species, season, growth, shape, palette, res = 1) {
  const cells = [];
  const fullHeight = shape.h + 14;
  let left = -4.5;
  let right = 4.5;
  let top = -shape.h - 2;
  let crownBottom = -Infinity;
  for (const b of shape.blobs) {
    left = Math.min(left, b.x - b.rx * 1.04);
    right = Math.max(right, b.x + b.rx * 1.04);
    top = Math.min(top, b.y - b.ry * 1.04);
    crownBottom = Math.max(crownBottom, b.y + b.ry * 0.7);
  }
  for (const t of shape.tiers) {
    left = Math.min(left, t.x - t.width * 1.04);
    right = Math.max(right, t.x + t.width * 1.04);
    top = Math.min(top, t.y);
    crownBottom = Math.max(crownBottom, t.y + t.depth);
  }
  for (const s of shape.strands) {
    left = Math.min(left, s.x + Math.min(0, s.bend) - s.radius - 0.3);
    right = Math.max(right, s.x + Math.max(0, s.bend) + s.radius + 0.3);
    top = Math.min(top, s.y);
  }
  for (const s of shape.wood) {
    left = Math.min(left, s.minX);
    right = Math.max(right, s.maxX);
    top = Math.min(top, s.minY);
  }
  if (shape.foot) {
    left = Math.min(left, shape.foot.left);
    right = Math.max(right, shape.foot.right);
  }
  const minX = Math.max(-MAX_TREE_HALF_WIDTH * res, Math.floor(left * res / ASPECT - 1));
  const maxX = Math.min(MAX_TREE_HALF_WIDTH * res, Math.ceil(right * res / ASPECT + 1));
  const minY = Math.max(1 - MAX_TREE_HEIGHT * res, Math.floor(top * res - 1));
  const bounds = { minX: MAX_TREE_HALF_WIDTH * res, minY: 0, maxX: -MAX_TREE_HALF_WIDTH * res,
    maxY: 1 - MAX_TREE_HEIGHT * res };
  const unit = 1 / res;
  // Wood this thin is stroked rather than filled; small letters fill more.
  const thick = THICK * unit;
  // The foot's roots reach below the base, toward the viewer.
  const maxDy = shape.foot ? Math.min(MAX_ROOT_DEPTH * res, Math.ceil(shape.foot.bottom * res)) : 0;
  const family = foliageFamily(species, season, growth);
  const kind = BARK_KIND[species];
  const bark = BARK[species];
  const winter = season === 'winter';
  const evergreen = EVERGREEN.has(species);
  const bush = growth === 'bush';
  // A bush may bear berries or flowers, chosen once for the whole bush.
  const bushKind = hash2(seed, 7, seed + 5);
  const berry = bush && bushKind < 0.4 && season !== 'spring' ? BERRIES[Math.floor(hash2(seed, 9, 3) * BERRIES.length)] : null;
  const flowers = bush && !berry && bushKind < 0.65 && (season === 'spring' || season === 'summer');

  const woodAt = new Set();
  const push = (cell) => {
    cells.push(cell);
    bounds.minX = Math.min(bounds.minX, cell.dx);
    bounds.minY = Math.min(bounds.minY, cell.dy);
    bounds.maxX = Math.max(bounds.maxX, cell.dx);
    bounds.maxY = Math.max(bounds.maxY, cell.dy);
  };

  for (let dy = minY; dy <= maxDy; dy++) {
    yield;
    const row = geometryAtRow(shape, dy * unit, unit);
    const rowMinX = Math.max(minX, Math.floor(row.left * res / ASPECT - 1));
    const rowMaxX = Math.min(maxX, Math.ceil(row.right * res / ASPECT + 1));
    for (let dx = rowMinX; dx <= rowMaxX; dx++) {
      let hits = 0;
      let leafHits = 0;
      let woodL = 0;
      let woodR = 0;
      let light = 0;
      let leaf = null;
      let wood = null;
      for (let j = 0; j < 3; j++) {
        for (let i = 0; i < 2; i++) {
          const s = sample((dx + SUB_X[i]) * ASPECT * unit, (dy + SUB_Y[j]) * unit, row, thick);
          if (!s) continue;
          hits++;
          if (s.kind === 'wood') {
            if (i === 0) woodL++;
            else woodR++;
            if (!wood || j === 1) wood = s;
          } else {
            leafHits++;
            light += s.light;
            if (!leaf || j === 1) leaf = s;
          }
        }
      }
      if (hits < 2) continue;
      const texture = hash2(dx, dy, seed + 3);
      const phase = hash2(dx, dy, seed + 97) * TAU;
      // The fine bake blots out the ground right up to the outline, so the
      // tree stands out from the grass with a hard edge.
      const solid = hits >= (res > 1 ? 3 : 5);

      if (leafHits > hits / 2 && leaf.kind === 'leaf') {
        // ---- Foliage: a cloud of short leaf strokes ----
        const lt = light / leafHits;
        const flex = clamp(0.24 + (-dy * unit / fullHeight) * 0.61 + (leaf.strand ? 0.12 : 0), 0.2, 1);
        const { color } = leafColor(palette, leaf.mass, lt, species, season);
        const cell = { dx, dy, g: 0, r: 0, gg: 0, b: 0, foliage: true, flex,
          phaseSin: Math.sin(phase), phaseCos: Math.cos(phase), rustle: 0 };
        // The ragged outline of the crown is left open in places, and in
        // the shade the crown opens into dark gaps between the leaves.
        if (!leaf.strand && (leaf.edge || hits < 5) && texture < 0.4) continue;
        // Hanging strands thin out into separate threads.
        if (leaf.strand && hash2(dx, Math.floor(dy / (3 * res)), seed + 37) < 0.45) continue;
        // Leaves are left out here and there, so strokes stay separate
        // dashes instead of joining into zigzags.
        const broken = !leaf.strand && hash2(dx, dy, seed + 211) < 0.2;
        const dark = leaf.gap || broken || (!leaf.strand && texture < 0.06 + clamp(0.34 - lt) * 0.9);
        // Leaves hang out and down from the middle of their mass: needles
        // sweep along a tier, strands hang straight, and every leaf turns a
        // little its own way.
        let ax;
        let ay;
        if (leaf.strand) {
          ax = (texture - 0.5) * 0.25;
          ay = 1;
        } else if (leaf.tier) {
          ax = leaf.nx < 0 ? -0.7 : 0.7;
          ay = 0.6 + leaf.v * 0.8;
        } else {
          // Fan around the twig inside each small mass, curling toward
          // its edge instead of every leaf pointing straight down.
          ax = leaf.nx * 0.65 + (leaf.mass.flowX ?? 0) * 0.6;
          ay = leaf.ny * 0.55 + (leaf.mass.flowY ?? 0.7) * 0.6;
        }
        const turn = leaf.strand ? (texture - 0.5) * 0.3 :
          (valueNoise(dx * unit * 0.18, dy * unit * 0.14, seed + 13) - 0.5) * 1.2 + (hash2(dx, dy, seed + 17) - 0.5) * 0.3;
        const lx = ax * Math.cos(turn) - ay * Math.sin(turn);
        const ly = ax * Math.sin(turn) + ay * Math.cos(turn);
        // Long strokes where the leaves are thick and lit, short ones elsewhere.
        const tip = leaf.strand ? (leaf.v > 0.9 ? 1 : 0) : leaf.edge && texture < 0.18 ? 2 : 0;
        if (dark) cell.g = cell.rustle = char(' ');
        else {
          cell.g = leafStroke(lx, ly, tip, ASPECT);
          cell.rustle = leafStroke(lx * Math.cos(0.2) - ly * Math.sin(0.2), lx * Math.sin(0.2) + ly * Math.cos(0.2), tip, ASPECT);
        }
        // Leaves stay a deep night green; the moon only silvers their tops.
        let c = blend(color, LEAF_NIGHT, family === 'bloom' ? 0.1 : 0.4);
        if (leaf.strand?.vine) c = blend(c, [40, 70, 50], 0.4);
        if (leaf.rim) c = blend(c, palette.rim, 0.25);
        else if (leaf.edge && lt > 0.35 && texture > 0.8) c = blend(c, palette.rim, 0.32);
        else if (lt > 0.66) c = blend(c, palette.light, clamp(lt - 0.64) * 0.4);
        if (winter && evergreen && ((leaf.tier ? leaf.v < 0.3 : leaf.ny < -0.35) ||
          (leaf.edge && texture > 0.75))) c = blend(c, SNOW, 0.45);
        // Fine characters cover less of a cell than grass blades. Lift their
        // ink enough to keep the sprays readable at the widest zoom, while
        // neighbouring leaves still catch different amounts of moonlight.
        c = c.map((v) => v * (1 + hash2(dx, dy, seed + 29) * 0.5));
        rgb(cell, c);
        if (dark) cell.gap = true;
        if (solid) {
          // Hide the ground behind the crown with a near-black of its colour.
          cell.br = Math.round(8 + c[0] * 0.06);
          cell.bgG = Math.round(10 + c[1] * 0.07);
          cell.bb = Math.round(18 + c[2] * 0.07);
        }
        push(cell);
        if (dark) continue;
        // Fruit, berries, blossom and specks of moonlit dew among the leaves.
        const accent = accentFor(species, season, leaf, growth);
        const pick = hash2(dx, dy, seed + 71);
        if (berry && lt > 0.25 && pick < 0.22) {
          cell.g = cell.rustle = char(pick < 0.1 ? 'o' : '%');
          rgb(cell, berry.map((v) => v * (0.7 + lt * 0.4)));
        } else if (flowers && lt > 0.3 && pick < 0.24) {
          cell.g = cell.rustle = char(pick < 0.12 ? '*' : 'o');
          rgb(cell, blend([236, 232, 244], [240, 170, 200], hash2(seed, 1, 2) > 0.5 ? 0.6 : 0));
        } else if (family === 'bloom' && pick < 0.3) {
          cell.g = cell.rustle = char(pick < 0.12 ? 'o' : pick < 0.2 ? '*' : '.');
          rgb(cell, blend(palette.base, palette.light, 0.2 + lt * 0.5));
        } else if (accent && pick < accent.p && lt > 0.2 && lt < 0.6 && !leaf.edge) {
          cell.g = cell.rustle = char(accent.ch);
          rgb(cell, accent.c.map((v) => v * (0.75 + lt * 0.4)));
        } else if (!leaf.strand && pick > 0.987 - lt * 0.006) {
          cell.g = cell.rustle = char(pick > 0.997 ? '*' : '.');
          rgb(cell, blend(DEW, palette.light, lt * 0.4).map((v) => v * (0.6 + lt * 0.5)));
        }
        continue;
      }

      if (leafHits > hits / 2) {
        // ---- A bare winter crown: a lace of fine twigs ----
        const lace = valueNoise(dx * unit * 0.6, dy * unit * 0.4, seed + 301);
        if (species === 'oak' && !bush && texture < 0.07) {
          // Oaks hold on to a few dry brown leaves through the winter.
          const cell = rgb({ dx, dy, g: char(texture < 0.035 ? '%' : '&'),
            r: 0, gg: 0, b: 0, foliage: true, flex: 0.4, phaseSin: Math.sin(phase), phaseCos: Math.cos(phase), rustle: 0 },
          [150, 104, 66].map((v) => v * (0.6 + leaf.light * 0.5)));
          cell.rustle = cell.g;
          push(cell);
          continue;
        }
        if (!(leaf.nearTwig || lace > 0.42 - leaf.light * 0.2) || texture < 0.18) continue;
        let c = bark.map((x) => x * (0.42 + leaf.light * 0.5));
        if (leaf.light > 0.3 && texture > 0.3) c = blend(c, SNOW, 0.6);
        else if (berry && texture > 0.8) c = berry.map((x) => x * 0.8);
        const cell = rgb({ dx, dy, g: char(SPRIGS[Math.floor(texture * SPRIGS.length) % SPRIGS.length]),
          r: 0, gg: 0, b: 0, foliage: false, flex: 0,
          phaseSin: Math.sin(phase), phaseCos: Math.cos(phase), rustle: 0, sprig: true }, c);
        cell.rustle = cell.g;
        push(cell);
        continue;
      }

      // ---- Wood: trunks, boughs and roots, shaded as round wood ----
      const s = wood.segment;
      const nx = wood.u;
      // The foot is lit as the solid it is; elsewhere wood is round.
      const lit = wood.foot ? wood.foot.light : roundLight(s, nx);
      const soil = wood.foot ? wood.foot.soil : 1;
      const shine = woodShine(lit * soil, dy, wood.inCrown);
      let c = barkColor(shine, dx, dy);
      const cell = { dx, dy, g: 0, r: 0, gg: 0, b: 0, foliage: false, flex: 0,
        phaseSin: Math.sin(phase), phaseCos: Math.cos(phase), rustle: 0 };
      // Where the outline of a steep trunk or bough crosses this cell, the
      // cell shows the outline: a bracket, or a slash where it flares.
      // Small letters need no outline: the shading turns the wood away.
      let g = -1;
      if (res === 1 && Math.abs(s.x1 - s.x0) / ASPECT < Math.abs(s.y1 - s.y0) * 1.2) {
        for (const side of [-1, 1]) {
          const fb = outline(s, dy * unit, side) * res - (dx - 0.5);
          const ft = outline(s, (dy - 1) * unit, side) * res - (dx - 0.5);
          const mid = (fb + ft) / 2;
          if (mid < 0 || mid >= 1) continue;
          g = edgeChar(side, side * (fb - ft), texture);
          // The rim facing the moon catches its light.
          if (side < 0) c = blend(c, [214, 222, 236], wood.inCrown ? 0.1 : 0.3);
          break;
        }
      }
      if (g < 0) {
        // Furrows run along the bark and crowd together toward its edges,
        // where the round surface turns away from the viewer.
        const around = wood.foot ? wood.foot.around : Math.asin(nx) * wood.radius;
        const along = wood.foot ? wood.foot.along : -dy * unit;
        const furrow = valueNoise(around * 2.4, along * 0.09, seed + 61) - 0.5;
        const weight = clamp(shine / 0.7 + furrow * (res > 1 ? 0.3 : 0.45) + (texture - 0.5) * (res > 1 ? 0.04 : 0.14));
        if (kind === 'birch' && texture < 0.16) {
          // Dark lenticels across pale birch bark.
          g = char(texture < 0.08 ? '=' : '-');
          c = c.map((v) => v * 0.35);
        } else g = rampChar(kind === 'birch' ? BIRCH_RAMP : BARK_RAMP, weight, hash2(dx, dy, seed + 9));
        if (nx < -0.3 && !wood.inCrown) c = blend(c, [214, 222, 236], 0.12 + clamp(-nx - 0.3) * 0.3);
        // Sky light reflected along the far edge keeps the shadow side round.
        if (nx > 0.75) c = blend(c, [70, 92, 130], clamp((nx - 0.75) * 4) * 0.22);
        // Furrows are dark cracks.
        if (res > 1) c = c.map((v) => v * (0.9 + furrow * 0.35));
      }
      if (winter && !s.trunk && !woodAt.has((dy - 1) * 1024 + dx) && texture > 0.15) {
        // Snow lies along the upper side of a bough.
        c = blend(c, SNOW, 0.7);
      } else if (kind !== 'birch' && s.trunk && nx > 0.2 && dy * unit > -shape.h * 0.6 &&
        valueNoise(dx * unit * 0.45, dy * unit * 0.22, seed + 401) > 0.52) {
        // Moss grows up the shaded side of the trunk.
        c = blend(c, MOSS_GREEN.map((v) => v * (0.55 + shine * 0.6)), 0.6);
      }
      cell.g = cell.rustle = g;
      rgb(cell, c);
      if (solid) {
        cell.br = Math.round(8 + c[0] * 0.08);
        cell.bgG = Math.round(8 + c[1] * 0.07);
        cell.bb = Math.round(14 + c[2] * 0.07);
      }
      cell.wood = wood.foot?.root ? 'root' : 'stem';
      cell.inCrown = wood.inCrown;
      push(cell);
      woodAt.add(dy * 1024 + dx);
    }
  }
  strokeWood();
  outlineWood();
  return { cells: cells.filter((cell) => !cell.dead), bounds };

  // Like the trees drawn in ordinary cells, wood in small letters is drawn
  // as an outline filled with shaded letters: brackets down a trunk's
  // sides, slashes where it flares or a root slopes, and dashes along the
  // top of a root. Each edge cell takes the character for the way the edge
  // runs through it, found from which of its neighbours are wood. In
  // ordinary cells the trunk already has its outline (see outline), so only
  // roots are traced.
  function outlineWood() {
    const at = new Map();
    for (const cell of cells) if (cell.wood && !cell.dead && !(cell.g & LAYER_BIT)) at.set(cell.dy * 4096 + cell.dx, cell);
    const solid = (x, y) => at.has(y * 4096 + x);
    for (const cell of at.values()) {
      if (res === 1 && cell.wood !== 'root') continue;
      const x = cell.dx;
      const y = cell.dy;
      const left = !solid(x - 1, y);
      const right = !solid(x + 1, y);
      const up = !solid(x, y - 1);
      let g = -1;
      let side = 0;
      if (left && right) g = char('|');
      else if (left) {
        side = -1;
        // The edge moves out going down where the cell below and to the
        // left is wood (a flare), and in where the one above it is.
        const out = solid(x - 1, y + 1);
        const back = solid(x - 1, y - 1);
        g = out && !back ? char('/') : back && !out ? char('\\') : edgeChar(-1, 0, hash2(x, y, seed + 7));
      } else if (right) {
        side = 1;
        const out = solid(x + 1, y + 1);
        const back = solid(x + 1, y - 1);
        g = out && !back ? char('\\') : back && !out ? char('/') : edgeChar(1, 0, hash2(x, y, seed + 7));
      } else if (up) {
        // The top of a root where it slopes, down the way the wood above it
        // ends. Flat tops, and the lower edge where the wood sinks into the
        // ground, are left to the shading.
        const higherLeft = solid(x - 1, y - 1);
        const higherRight = solid(x + 1, y - 1);
        if (higherLeft !== higherRight) g = higherLeft ? char('\\') : char('/');
        side = -0.5;
      }
      if (g < 0) continue;
      cell.g = cell.rustle = g;
      let c = [cell.r, cell.gg, cell.b];
      // The rims facing the moon catch its light; the others sink into shade.
      if (side < 0 && !cell.inCrown) c = blend(c, [214, 222, 236], side === -1 ? 0.3 : 0.18);
      else if (side > 0) c = c.map((v) => v * 0.8);
      rgb(cell, c);
    }
  }

  // Round bark: bright where it faces the moon, falling off steeply into
  // shadow on the far side so trunks read as solid columns. The canopy
  // shades the wood beneath and inside it.
  function woodShine(light, dy, inCrown) {
    let shine = light * 0.88;
    if (!winter || evergreen) {
      if (inCrown) shine *= 0.55;
      else if (crownBottom > -Infinity && !bush) shine *= 0.7 + 0.3 * clamp((dy * unit - crownBottom) / 26);
    }
    return shine;
  }

  // Under the moon bark is cooled toward grey but keeps its species'
  // brown, like the trunks of a night forest.
  function barkColor(shine, dx, dy) {
    const rough = valueNoise(dx * unit * 0.7, dy * unit * 0.12, seed + 71);
    if (kind === 'birch') return blend(bark, [236, 236, 226], 0.2).map((v) => v * (0.16 + shine * 0.8));
    const night = blend(bark, BARK_NIGHT, 0.25);
    return night.map((v) => (v * (0.22 + shine * 1.1) + 6) * (0.88 + rough * (res > 1 ? 0.1 : 0.22)));
  }

  // Thin branches and twigs: one stroke glyph per row (or per column for a
  // flat branch), entering and leaving each cell where the branch's centre
  // line does, so every branch is a single smooth line. They show below
  // the crown, through its holes, and everywhere in a bare winter crown.
  function strokeWood() {
    const gridW = maxX - minX + 1;
    const occupied = new Int32Array(gridW * (maxDy + 1 - minY));
    const strokes = [];
    cells.forEach((cell, i) => {
      if ((cell.g & LAYER_BIT) || cell.dx < minX || cell.dx > maxX || cell.dy < minY || cell.dy > maxDy) return;
      occupied[(cell.dy - minY) * gridW + cell.dx - minX] = i + 1;
    });
    const place = (x, y, g, snowy) => {
      if (x < minX || x > maxX || y < minY || y > maxDy) return;
      const at = (y - minY) * gridW + x - minX;
      if (occupied[at] === -1) return;
      const found = occupied[at] - 1;
      const old = found >= 0 ? cells[found] : null;
      // Leaves and bark hide the branch; holes in the crown and the bare
      // winter twig lace give way to it.
      if (old && !(old.gap || old.sprig)) return;
      const shine = woodShine(roundLight(UPRIGHT, -0.3), y, !!old?.gap) * (winter && !evergreen ? 1.05 : 0.9);
      let c = barkColor(shine, x, y);
      if (snowy && winter) c = blend(c, SNOW, 0.6);
      const cell = rgb({ dx: x, dy: y, g, r: 0, gg: 0, b: 0, foliage: false, flex: 0,
        phaseSin: 0, phaseCos: 1, rustle: g }, c);
      if (old) {
        // Take over the slot (keeping its background) and drop its layer.
        cell.br = old.br;
        cell.bgG = old.bgG;
        cell.bb = old.bb;
        old.dead = true;
        const next = cells[found + 1];
        if (next && next.dx === x && next.dy === y && (next.g & LAYER_BIT)) next.dead = true;
      }
      occupied[at] = -1;
      strokes.push(cell);
    };
    for (const s of shape.wood) {
      if (s.trunk) continue;
      const sx0 = s.x0 * res / ASPECT;
      const sx1 = s.x1 * res / ASPECT;
      const sy0 = s.y0 * res;
      const sy1 = s.y1 * res;
      const spanX = Math.abs(sx1 - sx0);
      const spanY = Math.abs(sy1 - sy0);
      if (spanX < 1e-6 && spanY < 1e-6) continue;
      if (spanX <= spanY) {
        // Steep: one cell per row.
        const xAt = (y) => sx0 + (sx1 - sx0) * (y - sy0) / (sy1 - sy0);
        const top = Math.min(sy0, sy1);
        const bottom = Math.max(sy0, sy1);
        for (let y = Math.floor(top) + 1; y <= Math.ceil(bottom); y++) {
          const ym = (Math.min(y, bottom) + Math.max(y - 1, top)) / 2;
          const radius = s.r0 + (s.r1 - s.r0) * clamp((ym - sy0) / (sy1 - sy0));
          if (radius >= thick) continue;
          const x = Math.round(xAt(ym));
          place(x, y, strokeChar(xAt(y) - xAt(y - 1), 1), false);
        }
      } else {
        // Flat: one cell per column.
        const yAt = (x) => sy0 + (sy1 - sy0) * (x - sx0) / (sx1 - sx0);
        const left = Math.min(sx0, sx1);
        const right = Math.max(sx0, sx1);
        for (let x = Math.round(left); x <= Math.round(right); x++) {
          const xm = (Math.max(x - 0.5, left) + Math.min(x + 0.5, right)) / 2;
          const radius = s.r0 + (s.r1 - s.r0) * clamp((xm - sx0) / (sx1 - sx0));
          if (radius >= thick) continue;
          const y = Math.ceil(yAt(xm));
          place(x, y, strokeChar(1, yAt(x + 0.5) - yAt(x - 0.5)), true);
        }
      }
    }
    for (const cell of strokes) push(cell);
  }
}

// Where the left (side -1) or right outline of a wood segment crosses row
// boundary y, in cells. A leaning segment is wider across than its radius.
function outline(s, y, side) {
  const t = clamp((y - s.y0) / (s.y1 - s.y0 || 1));
  const lean = (s.x1 - s.x0) / (s.y1 - s.y0 || 1);
  const radius = (s.r0 + (s.r1 - s.r0) * t) * (s.trunk ? flare(s, y) : 1) * Math.sqrt(1 + lean * lean);
  return (s.x0 + (s.x1 - s.x0) * t + side * radius) / ASPECT;
}


const LITTER = [',', '.', "'", '~', '`'];
const NEEDLES = ['-', "'", ','];
const PETALS = ['.', "'", ','];

// Leaves, needles and petals lying in the grass in front of the trunk,
// thickest close to it. They are layered over whatever ground is there.
function scatterLitter(cells, bounds, species, season, seed, crownHalf, growth) {
  const halfW = Math.max(4, Math.min(crownHalf * 0.8, 30));
  const depth = Math.min(MAX_LITTER_DEPTH, Math.round(2 + halfW * 0.16));
  // The litter's ground is part of the sprite in every season, so its
  // bounds do not change with the season.
  bounds.maxY = Math.max(bounds.maxY, depth);
  bounds.minX = Math.min(bounds.minX, -Math.ceil(halfW));
  bounds.maxX = Math.max(bounds.maxX, Math.ceil(halfW));
  if (growth === 'bush' && season !== 'autumn') return;
  const evergreen = EVERGREEN.has(species);
  const blossom = species === 'cherry' && season === 'spring';
  if (season === 'winter' && !evergreen) return;
  const amount = evergreen ? 0.32 : blossom ? 0.4 : season === 'autumn' ? 0.5 : 0.12;
  const autumnMix = AUTUMN_MIX[species] ?? [AUTUMN[species]];
  for (let dy = 1; dy <= depth; dy++) {
    for (let dx = -Math.ceil(halfW); dx <= Math.ceil(halfW); dx++) {
      const d = (dx / halfW) ** 2 + (dy / (depth + 0.5)) ** 2;
      if (d >= 1) continue;
      const roll = hash2(dx, dy, seed + 501);
      if (roll > amount * (1 - d) ** 1.3) continue;
      const pick = hash2(dx, dy, seed + 503);
      let ch;
      let c;
      if (evergreen) {
        if (pick < 0.08) { ch = 'o'; c = [118, 84, 58]; }
        else { ch = NEEDLES[Math.floor(pick * NEEDLES.length)]; c = season === 'winter' ? [120, 96, 72] : [132, 92, 60]; }
      } else if (blossom) {
        ch = PETALS[Math.floor(pick * PETALS.length)];
        c = [236, 176, 204];
      } else if (pick < 0.08) {
        ch = '-';
        c = [110, 84, 60];
      } else {
        ch = LITTER[Math.floor(pick * LITTER.length)];
        c = season === 'autumn' ? autumnMix[Math.floor(hash2(dx, dy, seed + 507) * autumnMix.length)]
          : [120, 112, 62];
      }
      // Lying in the crown's shade, the litter is dim; nearer the edge of
      // the shade it catches a little more light.
      const dim = 0.42 + d * 0.25;
      cells.push(rgb({ dx, dy, g: over(char(ch)), r: 0, gg: 0, b: 0, foliage: false, flex: 0,
        phaseSin: 0, phaseCos: 1, rustle: over(char(ch)), litter: true }, c.map((v) => v * dim)));
      bounds.maxY = Math.max(bounds.maxY, dy);
      bounds.minX = Math.min(bounds.minX, dx);
      bounds.maxX = Math.max(bounds.maxX, dx);
    }
  }
}

// Every cell gets the same fields in the same order: drawing loops over
// tens of thousands of them each frame and stays fast on uniform objects.
const uniform = (c) => ({ dx: c.dx, dy: c.dy, g: c.g, r: c.r, gg: c.gg, b: c.b, br: c.br, bgG: c.bgG, bb: c.bb,
  foliage: c.foliage, flex: c.flex, phaseSin: c.phaseSin, phaseCos: c.phaseCos, rustle: c.rustle, litter: !!c.litter });

// `fineOnly` skips the ordinary bake: a worker rebuilding the tree for its
// fine bake needs only that (see fine-worker.js).
export function makeTree(x, y, rand, { species = 'oak', season = 'summer', seed = 1, growth = 'mature', girth,
  fineOnly = false } = {}) {
  if (!TREE_SPECIES.includes(species)) species = 'oak';
  if (!SEASONS.has(season)) season = 'summer';
  const spriteSeed = Math.floor(hash2(Math.floor(x * 32), Math.floor(y * 32), seed + TREE_SPECIES.indexOf(species) * 197) * 0x100000000);
  // A deterministic fallback also makes this useful to sprite galleries.
  // Draws from a given stream are kept so a worker can make the same tree.
  let draw = 0;
  const recorded = typeof rand === 'function' ? recording(rand) : null;
  const random = recorded ? recorded.random : () => hash2(draw++, spriteSeed, seed + 17);
  if (!['mature', 'sapling', 'bush'].includes(growth)) growth = 'mature';
  const shape = grow(growth === 'bush' ? bushGeometry(random) : geometry(species, random), growth, random);
  // A bush's contact shadow is enough; a tree shades the ground around it.
  const canopy = growth === 'bush' ? null : leafMasses(shape);
  branchCrown(shape, species, growth, spriteSeed);
  // Trunk age varies independently of crown size: slender trees and broad,
  // old trunks can share the same height and species.
  const thickness = Number.isFinite(girth) ? clamp(girth, 0.6, 2) :
    growth === 'mature' ? 0.6 + hash2(Math.floor(x), Math.floor(y), seed + 741) * 1.4 : 1;
  for (const wood of shape.wood) {
    // Tall stems stay slender; age can still produce a broad old trunk.
    const factor = wood.trunk ? thickness * 0.95 : 0.6 + thickness * 0.4;
    wood.r0 *= factor;
    wood.r1 *= factor;
    padWood(wood);
  }
  shape.footW *= thickness;
  shape.footH *= Math.sqrt(thickness);
  if (growth !== 'bush') shape.foot = makeFoot(shape.wood.find((w) => w.trunk), spriteSeed);
  // Every leaf mass gets its own tone, seeded by its place in the crown so
  // seasons recolour the same masses.
  for (const part of [...shape.blobs, ...shape.tiers, ...shape.strands]) {
    part.tone = hash2(Math.floor(part.x * 7), Math.floor(part.y * 7), spriteSeed + 13);
  }
  const palette = leafPalette(species, season, random() - 0.5);
  const sample = makeSampler(shape, species, season, spriteSeed);
  // The same tree in small letters, FINE to a cell, for the fine grid.
  const fine = function* fine() {
    const { cells: small } = yield* bakeSteps(sample, spriteSeed, species, season, growth, shape, palette, FINE);
    return small.map(uniform);
  };
  if (fineOnly) return withFine({ kind: growth === 'bush' ? 'bush' : 'tree', x, y }, fine);
  const { cells, bounds } = bake(sample, spriteSeed, species, season, growth, shape, palette);
  const top = bounds.minY;
  // The crown's half width, in cells, from its geometry (the same in every season).
  let crownHalf = 0;
  for (const b of shape.blobs) crownHalf = Math.max(crownHalf, Math.abs(b.x) + b.rx);
  for (const t of shape.tiers) crownHalf = Math.max(crownHalf, Math.abs(t.x) + t.width);
  crownHalf /= ASPECT;
  scatterLitter(cells, bounds, species, season, spriteSeed, crownHalf, growth);
  for (let i = 0; i < cells.length; i++) cells[i] = uniform(cells[i]);
  return withCanopy(withFine({
    kind: growth === 'bush' ? 'bush' : 'tree', growth, species, season, x, y,
    girth: thickness,
    footW: shape.footW, footH: shape.footH,
    height: bounds.maxY - top + 1,
    top,
    bounds,
    cells,
    leafColor: palette.base.map(Math.round),
    textureSeed: spriteSeed,
    phase: hash2(Math.floor(x * 16), Math.floor(y * 16), spriteSeed + 157) * TAU,
    sway: SWAY[species] * (growth === 'sapling' ? 1.25 : growth === 'bush' ? 0.65 : 1),
  }, fine, { make: 'tree', x, y, draws: recorded?.draws ?? null, options: { species, season, seed, growth, girth } }), canopy);
}

export function makeBush(x, y, rand, options = {}) {
  return makeTree(x, y, rand, { ...options, growth: 'bush' });
}
