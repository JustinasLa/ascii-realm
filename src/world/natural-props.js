import { hash2 } from '../core/rng.js';
import { valueNoise } from '../core/noise.js';
import { dg } from '../render/glyphs.js';
import { ringGlyph, Sprite } from './prop-art.js';
import { ASPECT } from './world.js';

// Geometry is measured in physical row units, as in props.js. Random choices
// happen before sampling, so supersampling and moving a prop never change it.
// Wood and needles are sampled as materials (see prop-art.js); small plants
// are composed glyph by glyph, a flower head with its eye layered over it.
const clamp = (n) => Math.max(0, Math.min(1, n));
const shade = (c, k) => c.map((v) => v * k);

function ellipse(px, py, cx, cy, rx, ry) {
  const nx = (px - cx) / rx;
  const ny = (py - cy) / ry;
  return { nx, ny, d2: nx * nx + ny * ny };
}

function lineDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy));
  return { t, d: Math.hypot(px - ax - vx * t, py - ay - vy * t) };
}

const MOSS = [70, 118, 86];
const FUNGUS = [168, 146, 108];
const pickGlyph = (prefix, n, a, b, seed) => dg(`${prefix}.${Math.floor(hash2(a, b, seed) * n)}`);

function makePine(x, y, rand, seed, bake) {
  const height = 27 + rand() * 7;
  const radius = 6.8 + rand() * 1.8;
  const tint = rand();
  const foliage = [34 + tint * 13, 103 + tint * 26, 76 + tint * 14];
  const bark = [112, 82, 56];
  const canopy = height - 5;
  const layers = Array.from({ length: 5 }, (_, i) => ({
    top: -height + canopy * i * 0.16,
    bottom: -height + canopy * (i * 0.16 + 0.35),
    radius: radius * (0.28 + i * 0.18),
    cx: (rand() - 0.5) * 0.55,
    phase: rand() * Math.PI * 2,
  }));
  const sample = (px, py) => {
    if (py > 0) return null;
    // Upper branches overlap the next tier, giving each a separate dark hem.
    for (const layer of layers) {
      if (py < layer.top || py > layer.bottom) continue;
      const t = (py - layer.top) / (layer.bottom - layer.top);
      const edge = layer.radius * t;
      const jag = 0.35 * Math.sin(py * 3.2 + layer.phase) + 0.25 * Math.sin(px * 2.3 + layer.phase);
      const nx = (px - layer.cx) / Math.max(0.1, edge);
      if (Math.abs(px - layer.cx) > edge + jag * t) continue;
      const hem = t > 0.84 ? -0.22 : 0;
      return { m: 'needle', l: clamp(0.62 - nx * 0.25 - t * 0.2 + hem), c: foliage };
    }
    const trunkWidth = 0.68 + (py + 9) * 0.025;
    if (py >= -10 && Math.abs(px) <= trunkWidth) {
      return { m: 'bark', l: clamp(0.62 - px / trunkWidth * 0.4), c: bark };
    }
    return null;
  };
  return {
    kind: 'pine', x, y, footW: 1.8, footH: 1.1,
    cells: bake(Math.ceil((radius + 0.8) / ASPECT), -Math.ceil(height), 0, sample, seed,
      { shadow: { rx: radius * 0.7, ry: 1.2, ox: 1.5 } }),
  };
}

// An old weathered stump: a sawn top with growth rings and drying checks,
// furrowed bark carrying moss on its shaded side and a fungus bracket,
// roots running into the ground.
function makeStump(x, y, rand, seed, bake) {
  const radius = 2.4 + rand() * 1.1;
  const height = 4.5 + rand() * 1.9;
  const topY = -height + 1.05;
  const topRy = 1.15 + rand() * 0.3;
  const pith = [(rand() - 0.5) * 0.4, (rand() - 0.5) * 0.3];
  const bark = [118, 84, 54];
  const cut = [190, 152, 98];
  const checks = [rand() * Math.PI * 2, rand() * Math.PI * 2];
  const fungus = { x: radius * (0.3 + rand() * 0.5), y: topY + 1.6 + rand() * (height - 3.2) };
  const mossSide = 0.35 + rand() * 0.3;
  const roots = [-0.85, 0.85, rand() < 0.5 ? -0.3 : 0.3].map((side) => ({
    ax: side * radius * 0.55, ay: -1.9,
    bx: side * radius * 1.35, by: -0.25,
  }));
  const sample = (px, py) => {
    if (py > 0) return null;
    const top = ellipse(px, py, -0.12, topY, radius, topRy);
    if (top.d2 <= 1) {
      const r = Math.sqrt(top.d2);
      if (r > 0.86) return { m: 'bark', l: 0.75 - top.nx * 0.2, c: bark };
      const ux = top.nx - pith[0];
      const uy = top.ny - pith[1];
      const s = { m: 'cut', l: clamp(0.78 - top.nx * 0.12 - top.ny * 0.1), c: cut,
        g: ringGlyph(-ux, -uy, seed, Math.floor(px * 2), Math.floor(py * 2)) };
      const angle = Math.atan2(uy, ux);
      for (const a of checks) {
        const off = Math.abs(((angle - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (off < 0.22 && r > 0.3) s.acc = { g: dg(`props.fissure.${Math.abs(Math.cos(a)) > 0.7 ? 0 : 2}.0`), c: [76, 52, 34] };
      }
      return s;
    }
    if (py >= topY && py <= -0.2) {
      const t = (py - topY) / -topY;
      const rx = radius * (0.92 + t * 0.07);
      if (Math.abs(px) <= rx) {
        const s = { m: 'bark', l: clamp(0.62 - px / rx * 0.42), c: bark };
        if (Math.hypot((px - fungus.x) * 0.8, py - fungus.y) < 0.75) {
          s.acc = { g: dg(`props.fungus.${seed & 1 ? 1 : 2}`), c: FUNGUS };
        } else if (px / rx > mossSide && valueNoise(px * 1.3, py * 0.8, seed + 3) < 0.55) {
          s.acc = { g: pickGlyph('props.moss', 6, Math.floor(px * 2), Math.floor(py), seed), c: MOSS };
        }
        return s;
      }
    }
    for (const root of roots) {
      const line = lineDistance(px, py, root.ax, root.ay, root.bx, root.by);
      if (line.d < 0.62 * (1 - line.t * 0.62)) return { m: 'barkh', l: clamp(0.5 - px / radius * 0.18), c: bark };
    }
    return null;
  };
  // Leaf litter and a toadstool or two at the foot.
  const extras = [];
  const w = Math.ceil(radius * 1.35 / ASPECT);
  for (let i = 0; i < 3; i++) {
    const dx = (rand() < 0.5 ? -1 : 1) * (w - Math.floor(rand() * 2));
    extras.push({ dx, dy: rand() < 0.5 ? 0 : 1, g: dg(`leaflet.${Math.floor(rand() * 8)}`),
      c: [128 + rand() * 40, 92 + rand() * 20, 52] });
  }
  return {
    kind: 'stump', x, y, footW: radius / ASPECT, footH: 1.2,
    cells: bake(w + 1, -Math.ceil(height + topRy), 0, sample, seed,
      { extras, shadow: { rx: radius * 1.3, ry: 1, ox: radius * 0.35 } }),
  };
}

// A fallen log: horizontal bark with moss along its back, a sawn end
// showing rings, a broken end, and a bracket fungus on its flank.
function makeLog(x, y, rand, seed, bake) {
  const length = 10.5 + rand() * 4;
  const radius = 1.9 + rand() * 0.75;
  const cutRx = 1.15 + rand() * 0.3;
  const slope = (rand() - 0.5) * 0.1;
  const centerY = -radius - 0.65 - Math.abs(slope) * length / 2;
  const endX = length / 2;
  const bark = [114, 82, 52];
  const wood = [192, 154, 102];
  const fungusX = -length * (0.1 + rand() * 0.3);
  const mossStart = -endX + rand() * length * 0.4;
  const mossEnd = mossStart + length * (0.3 + rand() * 0.4);
  const sample = (px, py) => {
    if (py > 0) return null;
    const localY = py - centerY - px * slope;
    const end = ellipse(px, localY, endX, 0, cutRx, radius);
    if (end.d2 <= 1) {
      const r = Math.sqrt(end.d2);
      if (r > 0.85) return { m: 'bark', l: 0.45 - end.ny * 0.2, c: bark };
      return { m: 'cut', l: clamp(0.8 - end.nx * 0.12 - end.ny * 0.12), c: wood,
        g: ringGlyph(-end.nx, -end.ny, seed, Math.floor(px * 2), Math.floor(py * 2)) };
    }
    const left = ellipse(px, localY, -endX, 0, cutRx * 0.75, radius);
    if ((px < -endX || px > endX || Math.abs(localY) > radius) && !(px <= -endX && left.d2 <= 1)) return null;
    const ny = localY / radius;
    const s = { m: 'barkh', l: clamp(0.66 - ny * 0.38 - px / length * 0.08), c: bark };
    if (px < -endX + 0.3) s.m = 'char';
    if (ny < -0.45 && px > mossStart && px < mossEnd && valueNoise(px * 1.1, py, seed + 7) < 0.65) {
      s.acc = { g: pickGlyph('props.moss', 6, Math.floor(px * 2), Math.floor(py), seed), c: MOSS };
    } else if (ny > -0.2 && ny < 0.5 && Math.abs(px - fungusX) < 0.9) {
      s.acc = { g: dg('props.fungus.2'), c: FUNGUS };
    }
    return s;
  };
  return {
    kind: 'log', x, y, footW: (length / 2 + cutRx) / ASPECT, footH: 1.35,
    cells: bake(Math.ceil((endX + cutRx) / ASPECT), -Math.ceil(radius * 2 + 1.5), 0, sample, seed,
      { shadow: { rx: length / 2 + 1, ry: 1, ox: 0.8 } }),
  };
}

// Wild flowers in a loose patch of one or two kinds: stems with a leaf or
// two, heads drawn as petals with a contrasting eye layered over them.
const FLOWERS = [
  { head: 'flower.ring5', eye: 'flower.eye', petal: [228, 104, 140], eyeC: [246, 210, 96] },
  { head: 'flower.ring8', eye: 'flower.eye.big', petal: [236, 230, 212], eyeC: [240, 186, 64] },
  { head: 'flower.ring6', eye: 'flower.eye', petal: [240, 196, 72], eyeC: [150, 92, 40] },
  { head: 'flower.bell', eye: null, petal: [128, 148, 238] },
  { head: 'flower.cup', eye: null, petal: [206, 90, 196] },
  { head: 'flower.ring4', eye: 'flower.eye', petal: [170, 126, 232], eyeC: [250, 232, 150] },
  { head: 'flower.small5', eye: 'flower.eye', petal: [244, 244, 236], eyeC: [236, 200, 90] },
];

function makeFlowers(x, y, rand) {
  const spread = 4 + Math.floor(rand() * 4);
  const count = 5 + Math.floor(rand() * 4);
  const main = FLOWERS[Math.floor(rand() * FLOWERS.length)];
  const second = FLOWERS[Math.floor(rand() * FLOWERS.length)];
  const green = [70, 128, 66];
  const sprite = new Sprite();
  const heads = new Set();
  for (let i = 0; i < count; i++) {
    let dx = Math.round((rand() * 2 - 1) * spread);
    while (heads.has(dx)) dx += dx >= 0 ? 1 : -1;
    heads.add(dx);
    const h = 2 + Math.floor(rand() * 3);
    const kind = rand() < 0.72 ? main : second;
    const light = 0.82 + rand() * 0.3 - dx / spread * 0.06;
    for (let dy = -1; dy > -h; dy--) {
      sprite.put(dx, dy, dy === -1 ? dg(`stem.${Math.floor(rand() * 3)}`) : dg('props.strip.2.0'), shade(green, 0.7 + rand() * 0.2));
      if (rand() < 0.4) sprite.layer(dx, dy, dg(`leaflet.${Math.floor(rand() * 8)}`), shade(green, 0.95 + rand() * 0.2));
    }
    sprite.put(dx, -h, dg(kind.head), shade(kind.petal, light));
    if (kind.eye) sprite.layer(dx, -h, dg(kind.eye), kind.eyeC);
  }
  // Leaves and clover low among the stems.
  for (let dx = -spread - 1; dx <= spread + 1; dx++) {
    if (rand() < 0.75) sprite.put(dx, 0, dg(rand() < 0.5 ? `tuft.${Math.floor(rand() * 4)}` : `clover.${Math.floor(rand() * 4)}`),
      shade(green, 0.6 + rand() * 0.35));
  }
  return { kind: 'flowers', x, y, footW: spread * 0.65, footH: 0.65, cells: sprite.cells() };
}

// A cluster of toadstools: one or two tall ones with a cap spread over
// three cells, and smaller buttons, cap and stem in their own colours.
const CAPS = [
  { c: [200, 58, 44], spots: [240, 232, 214] },
  { c: [212, 128, 52], spots: [246, 214, 160] },
  { c: [150, 96, 66], spots: null },
  { c: [226, 196, 150], spots: null },
];

function makeMushrooms(x, y, rand) {
  const cap = CAPS[Math.floor(rand() * CAPS.length)];
  const stem = [222, 204, 164];
  const sprite = new Sprite();
  const big = 1 + (rand() < 0.4 ? 1 : 0);
  const used = new Set();
  let width = 2;
  for (let i = 0; i < big; i++) {
    const dx = i === 0 ? 0 : (rand() < 0.5 ? -4 : 4);
    const h = 3 + Math.floor(rand() * 2) - i;
    for (let k = -1; k <= 1; k++) {
      sprite.put(dx + k, -h, dg(`props.cap.${k + 1}`), shade(cap.c, [1.12, 1, 0.74][k + 1]));
      if (cap.spots) sprite.layer(dx + k, -h, dg(`props.capspots.${Math.floor(rand() * 4)}`), shade(cap.spots, [1, 0.95, 0.75][k + 1]));
      used.add(dx + k);
    }
    for (let dy = -h + 1; dy <= 0; dy++) sprite.put(dx, dy, dg(`props.stem.${dy === -h + 1 ? 1 : dy === 0 ? 0 : 2}`), stem);
    width = Math.max(width, Math.abs(dx) + 2);
  }
  const buttons = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < buttons; i++) {
    let dx = (rand() < 0.5 ? -1 : 1) * (2 + Math.floor(rand() * 3));
    if (used.has(dx)) dx += dx > 0 ? 1 : -1;
    if (used.has(dx)) continue;
    used.add(dx);
    width = Math.max(width, Math.abs(dx) + 1);
    const light = 0.8 + rand() * 0.3;
    if (rand() < 0.35) {
      sprite.put(dx, 0, dg('mush.small'), shade(cap.c, light));
      continue;
    }
    sprite.put(dx, -1, dg('mush.cap'), shade(cap.c, light));
    if (cap.spots) sprite.layer(dx, -1, dg('mush.spots'), cap.spots);
    sprite.put(dx, 0, dg('mush.stem'), shade(stem, 0.9));
  }
  // Moss and fallen leaves around the base.
  for (let dx = -width; dx <= width; dx++) {
    if (sprite.has(dx, 0)) sprite.layer(dx, 0, dg(`tuft.${Math.floor(rand() * 4)}`), [62, 108, 70]);
    else if (rand() < 0.6) sprite.put(dx, 0, dg(rand() < 0.5 ? `moss.${Math.floor(rand() * 4)}` : `leaflet.${Math.floor(rand() * 8)}`),
      rand() < 0.5 ? [64, 106, 78] : [138, 98, 58]);
  }
  return { kind: 'mushrooms', x, y, footW: width * 0.45, footH: 0.8, cells: sprite.cells() };
}

// A clump of reeds: tall stalks, some topped with a brown cattail head,
// and long leaves arching away from the clump.
function makeReeds(x, y, rand) {
  const count = 7 + Math.floor(rand() * 3);
  const green = [110, 141, 64];
  const straw = [164, 157, 75];
  const heads = [126, 82, 44];
  const sprite = new Sprite();
  let width = 2;
  const stalks = [];
  for (let i = 0; i < count; i++) {
    const baseX = Math.round((rand() - 0.5) * 4);
    const lean = Math.round((i / (count - 1) * 2 - 1) * (1.5 + rand() * 2));
    const h = 7 + Math.floor(rand() * 5);
    stalks.push({ baseX, lean, h, head: i % 2 === 0 });
  }
  stalks.sort((a, b) => b.h - a.h);
  for (const s of stalks) {
    let prev = s.baseX;
    for (let k = 0; k < s.h; k++) {
      const x = s.baseX + Math.round(s.lean * (k / s.h) ** 1.5);
      const g = x === prev ? dg('props.strip.2.0') : dg(x > prev ? 'props.strip.1.0' : 'props.strip.3.0');
      const colour = k < s.h * 0.4 ? green : straw;
      sprite.put(x, -k, g, shade(colour, 0.75 + k / s.h * 0.35));
      prev = x;
      width = Math.max(width, Math.abs(x) + 1);
    }
    const top = s.baseX + s.lean;
    if (s.head) {
      sprite.put(top, -s.h, dg('reed.head'), heads);
      sprite.put(top, -s.h - 1, dg('stem.1'), shade(straw, 0.9));
    } else {
      sprite.put(top, -s.h, dg(`stem.${s.lean < 0 ? 0 : s.lean > 0 ? 2 : 1}`), shade(straw, 1.05));
    }
  }
  // Leaves arch out of the clump on both sides.
  const leaves = 4 + Math.floor(rand() * 3);
  for (let i = 0; i < leaves; i++) {
    const side = i % 2 ? 1 : -1;
    const reach = 2 + Math.floor(rand() * 3);
    for (let k = 1; k <= reach; k++) {
      const x = side * (k + 1);
      const dy = -Math.round(k * 1.4 + rand());
      const g = dg(`props.reedleaf.${side > 0 ? 1 : 0}`);
      if (sprite.has(x, dy)) sprite.layer(x, dy, g, green);
      else sprite.put(x, dy, g, shade(green, 0.8 + rand() * 0.25));
      width = Math.max(width, Math.abs(x) + 1);
    }
  }
  return { kind: 'reeds', x, y, footW: 2.5 / ASPECT, footH: 0.75, cells: sprite.cells() };
}

const NATURAL_MAKERS = {
  pine: makePine,
  stump: makeStump,
  log: makeLog,
  flowers: makeFlowers,
  mushrooms: makeMushrooms,
  reeds: makeReeds,
};

export function makeNaturalProp(kind, x, y, rand, seed, bake) {
  const make = Object.hasOwn(NATURAL_MAKERS, kind) ? NATURAL_MAKERS[kind] : null;
  return make ? make(x, y, rand, seed, bake) : null;
}
