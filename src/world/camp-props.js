import { hash2 } from '../core/rng.js';
import { FINE } from '../render/cells.js';
import { dg, glyph } from '../render/glyphs.js';
import { ringGlyph, withFine } from './prop-art.js';
import { ASPECT } from './world.js';

// The sampler uses physical row units; bake converts its surface to cells
// (see prop-art.js for the materials). Shape choices consume the prop's
// seeded stream only during construction.
function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}

function inPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

const clamp = (n) => Math.max(0, Math.min(1, n));

function grain(px, py, seed) {
  return (hash2(Math.floor(px * 4), Math.floor(py * 1.7), seed) - 0.5) * 0.09;
}

const IRON = [112, 120, 128];
const ROPE = [176, 156, 108];
const nail = (v = 2) => ({ g: dg(`props.nails.${v}`), c: IRON });

// The rope glyph for a line running along (vx, vy) in physical units.
function ropeGlyph(vx, vy) {
  let a = Math.atan2(vy, vx);
  if (a < 0) a += Math.PI;
  return dg(`props.rope.${Math.round(a / (Math.PI / 8)) % 8}`);
}

// Cells along a straight rope from a to b (physical units, from the base),
// ending in a peg driven into the ground.
function guyRope(ax, ay, bx, by) {
  const cells = [];
  const seen = new Set();
  const steps = Math.ceil(Math.hypot((bx - ax) / ASPECT, by - ay) * 2);
  const g = ropeGlyph(bx - ax, by - ay);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const dx = Math.round((ax + (bx - ax) * t) / ASPECT);
    const dy = Math.ceil(ay + (by - ay) * t);
    const key = `${dx},${dy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push({ dx, dy, g: i === steps ? dg('props.peg') : g, c: i === steps ? [150, 116, 76] : ROPE });
  }
  return cells;
}

function prop(kind, x, y, radius, height, footW, footH, sample, seed, bake, options) {
  return {
    kind,
    x,
    y,
    footW,
    footH,
    cells: bake(Math.ceil(radius / ASPECT) + 1, -Math.ceil(height), 0,
      (px, py) => py > 0 ? null : sample(px, py), seed, options),
  };
}

// A crate: a frame of boards around vertical planks with a cross brace,
// nailed at the corners, its lid lit by the moon.
function makeCrate(x, y, rand, seed, bake) {
  const rx = 2.8 + rand() * 0.6;
  const height = 5.8 + rand() * 1.4;
  const wood = [124 + rand() * 16, 88, 52];
  const brace = [150, 112, 68];
  const outline = [
    [-rx + 0.35, -height], [rx - 0.35, -height],
    [rx, -height + 0.8], [rx, 0], [-rx, 0], [-rx, -height + 0.8],
  ];
  const stencil = rand() < 0.5;
  const sample = (px, py) => {
    if (!inPolygon(px, py, outline)) return null;
    const top = -height + 0.9;
    const side = px / rx;
    if (py < top) return { m: 'plankh', l: clamp(0.82 + grain(px, py, seed) - side * 0.08), c: wood };
    const frameH = Math.abs(py - top) < 0.45 || py > -0.5;
    const frameV = Math.abs(px) > rx - 0.55;
    const crossA = segmentDistance(px, py, -rx + 0.6, -0.6, rx - 0.6, top + 0.45) < 0.36;
    const crossB = segmentDistance(px, py, rx - 0.6, -0.6, -rx + 0.6, top + 0.45) < 0.36;
    // Corner nails.
    const corner = frameV && (Math.abs(py + 0.25) < 0.35 || Math.abs(py - top) < 0.35);
    if (frameH) return { m: 'plankh', l: clamp(0.66 - side * 0.18 + grain(px, py, seed)), c: brace,
      acc: corner ? nail(px < 0 ? 0 : 1) : undefined };
    if (frameV) return { m: 'plank', l: clamp(0.62 - side * 0.2 + grain(px, py, seed)), c: brace };
    const s = { m: 'plank', l: clamp(0.5 - side * 0.18 + grain(px, py, seed)), c: wood };
    // The cross brace is nailed over the planks.
    if (crossA || crossB) {
      s.acc = { g: dg(`props.strip.${crossA ? 1 : 3}.1`), c: brace.map((v) => v * (1.05 - side * 0.15)) };
      return s;
    }
    if (stencil && Math.abs(px + rx * 0.35) < 0.35 && Math.abs(py - (top - 0.3) / 2) < 0.8) {
      s.acc = { g: dg('props.carve.3'), c: [60, 40, 26] };
    }
    return s;
  };
  return prop('crate', x, y, rx, height, rx * 0.9 / ASPECT, 1.25, sample, seed, bake,
    { shadow: { rx: rx * 1.2, ry: 1, ox: rx * 0.3 } });
}

// A barrel: bellied staves bound by riveted iron hoops, its lid of boards.
function makeBarrel(x, y, rand, seed, bake) {
  const rx = 2.2 + rand() * 0.45;
  const height = 6.6 + rand() * 1.4;
  const wood = [124 + rand() * 16, 84, 48];
  const sample = (px, py) => {
    const t = (py + height) / height;
    if (t < 0 || t > 1) return null;
    const side = rx * (0.77 + 0.23 * Math.sin(t * Math.PI));
    const nx = px / side;
    if (Math.abs(nx) > 1) return null;
    const round = Math.sqrt(Math.max(0, 1 - nx * nx));
    const light = clamp(0.42 - nx * 0.38 + round * 0.25);
    const capY = -height + 0.55;
    const cap = (px / (rx * 0.79)) ** 2 + ((py - capY) / 0.62) ** 2;
    if (py < -height + 1 && cap <= 1) {
      if (cap > 0.62) return { m: 'iron', l: 0.55, c: IRON, g: dg('props.hoop.0') };
      return { m: 'plankh', l: clamp(0.82 - px * 0.06 + grain(px, py, seed)), c: wood };
    }
    // Each hoop curves down slightly at its centre, around the rounded body.
    for (const level of [0.2, 0.52, 0.85]) {
      const hoopY = -height + height * level + 0.23 * (1 - nx * nx);
      if (Math.abs(py - hoopY) < 0.42) {
        return { m: 'iron', l: clamp(light + 0.1), c: IRON, g: dg(`props.hoop.${Math.abs(nx) < 0.2 ? 1 : 0}`) };
      }
    }
    return { m: 'plank', l: clamp(light + grain(px, py, seed)), c: wood };
  };
  return prop('barrel', x, y, rx, height, rx * 0.85 / ASPECT, 1.25, sample, seed, bake,
    { shadow: { rx: rx * 1.3, ry: 1, ox: rx * 0.35 } });
}

// A fence: split posts with their cut tops showing, rails lashed to them.
function makeFence(x, y, rand, seed, bake) {
  const rx = 6.3 + rand() * 0.8;
  const height = 5.7 + rand() * 1.2;
  const postX = rx - 0.65;
  const wood = [120 + rand() * 16, 94, 64];
  const sample = (px, py) => {
    if (py < -height || Math.abs(px) > rx) return null;
    const postDistance = Math.abs(Math.abs(px) - postX);
    if (postDistance < 0.62) {
      const u = (Math.abs(px) - postX) / 0.62;
      if (py < -height + 0.7) return { m: 'cut', l: 0.8, c: [184, 150, 104], g: ringGlyph(-u, 0.3) };
      const s = { m: 'plank', l: clamp(0.62 - u * 0.35 + grain(px, py, seed)), c: wood };
      for (const level of [0.3, 0.7]) {
        if (Math.abs(py - (-height + height * level)) < 0.6) s.acc = { g: dg(`props.lash.${level < 0.5 ? 0 : 1}`), c: ROPE };
      }
      return s;
    }
    for (const level of [0.3, 0.7]) {
      const railY = -height + height * level;
      if (Math.abs(py - railY) < 0.45 && Math.abs(px) < postX + 0.3) {
        return { m: 'plankh', l: clamp((py < railY - 0.1 ? 0.78 : 0.5) + grain(px, py, seed)), c: wood };
      }
    }
    return null;
  };
  return prop('fence', x, y, rx, height, postX / ASPECT, 0.7, sample, seed, bake,
    { shadow: { rx: rx, ry: 0.8, ox: 0.6 } });
}

// A ridge tent: a lit front panel with an open flap, a shaded side,
// stitched seams along its edges, and guy ropes pegged out on both sides.
function makeTent(x, y, rand, seed, bake) {
  const rx = 6.5 + rand() * 1;
  const height = 10.4 + rand() * 2;
  const apex = -rx * (0.2 + rand() * 0.05);
  const rightFront = rx * 0.36;
  const backPeak = [rx * 0.42, -height * 0.86];
  const colors = [[150, 112, 70], [104, 125, 68], [80, 118, 145], [155, 82, 70], [176, 164, 132]];
  const canvas = colors[Math.floor(rand() * colors.length)];
  const front = [[-rx, 0], [apex, -height], [rightFront, 0]];
  const side = [[apex, -height], backPeak, [rx, 0], [rightFront, 0]];
  const doorX = (-rx + rightFront) * 0.5;
  const door = [[doorX - 1.8, 0], [doorX + 0.15, -height * 0.64], [doorX + 1.8, 0]];
  const seams = [
    [-rx, 0, apex, -height, 3], [apex, -height, rightFront, 0, 1],
    [apex, -height, ...backPeak, 0], [...backPeak, rx, 0, 1],
  ];
  const sample = (px, py) => {
    const isFront = inPolygon(px, py, front);
    const isSide = inPolygon(px, py, side);
    if (!isFront && !isSide) return null;
    if (isFront && inPolygon(px, py, door)) {
      const doorEdge = segmentDistance(px, py, ...door[0], ...door[1]) < 0.35
        || segmentDistance(px, py, ...door[1], ...door[2]) < 0.35;
      // The flap is rolled back: its edge is lit, the inside is dark.
      if (doorEdge) return { m: 'canvas', l: 0.9, c: canvas, acc: { g: dg('props.seam.2'), c: [214, 200, 160] } };
      return { m: 'plain', l: 0.1, c: [30, 26, 30], g: dg('props.shade.1'), back: 0.3 };
    }
    const fold = Math.sin((px - apex) * 2.8 + py * 0.25) * 0.05;
    const s = { m: 'canvas', l: clamp((isFront ? 0.72 : 0.32) + fold - py / height * 0.08 + grain(px, py, seed)), c: canvas };
    for (const [ax, ay, bx, by, a] of seams) {
      if (segmentDistance(px, py, ax, ay, bx, by) < 0.3) {
        s.acc = { g: dg(`props.seam.${a}`), c: [214, 200, 160].map((v) => v * (isFront ? 1 : 0.6)), edge: true };
      }
    }
    if (py > -0.5) s.l *= 0.7;
    return s;
  };
  // Guy ropes from the ridge ends to pegs in the grass.
  const extras = [
    ...guyRope(apex - 0.3, -height * 0.55, -rx - 3.5, 0),
    ...guyRope(backPeak[0] + 0.3, backPeak[1] * 0.6, rx + 3.2, 0),
  ];
  return prop('tent', x, y, rx + 4, height, rx * 0.8 / ASPECT, 2.2, sample, seed, bake,
    { extras, shadow: { rx: rx * 1.1, ry: 1.2, ox: rx * 0.25 } });
}

// A campfire: a ring of stones around charred, ember-veined logs, with
// tongues of flame rising from the middle.
function makeCampfire(x, y, rand, seed, bake) {
  const radius = 3.6 + rand() * 0.6;
  const height = 7.3 + rand() * 1.2;
  const lean = (rand() - 0.5) * 0.55;
  const stones = Array.from({ length: 9 }, (_, i) => {
    const angle = i / 9 * Math.PI * 2;
    return { x: Math.cos(angle) * (radius - 0.65), y: -1.05 + Math.sin(angle) * 0.6,
      rx: 0.68 + rand() * 0.15, ry: 0.5 + rand() * 0.1, tone: 0.85 + rand() * 0.3 };
  });
  const flame = [
    [-1.7, -1.6], [-2, -3.25], [-1.4, -4.55], [-1.25, -3.8],
    [-0.65 + lean, -height], [0.15 + lean, -height * 0.7],
    [0.85 + lean, -height * 0.92], [1.32, -height * 0.56],
    [1.85, -3.7], [1.65, -1.65],
  ];
  const inner = [[-1.05, -1.6], [-0.7, -3.2], [-0.15, -height * 0.63], [0.85, -3.1], [1, -1.6]];
  const stoneAt = (px, py, front) => {
    for (const stone of stones) {
      if (front !== stone.y > -1.2) continue;
      const nx = (px - stone.x) / stone.rx;
      const ny = (py - stone.y) / stone.ry;
      if (nx * nx + ny * ny <= 1) {
        return { m: 'stone', l: clamp((0.6 - nx * 0.25 - ny * 0.25) * stone.tone), c: [118, 112, 108] };
      }
    }
    return null;
  };
  const sample = (px, py) => {
    // Foreground stones sit across the log ends and the flame's lower edge.
    const front = stoneAt(px, py, true);
    if (front) return front;
    if (inPolygon(px, py, flame)) {
      // Tongues lick up from the top of the fire; below them it glows.
      const tip = !inPolygon(px, py - 0.9, flame);
      const g = dg(`props.flame.${Math.floor(hash2(Math.floor(px * 2), Math.floor(py), seed) * 4)}`);
      if (inPolygon(px, py, inner)) {
        return { m: 'flame', l: 0.9, c: py > -2.6 ? [246, 222, 130] : [240, 172, 56], k: 1, back: 0.55, g };
      }
      return { m: 'flame', l: 0.85, c: [226, 104, 34], k: 1, back: tip ? 0.15 : 0.4, g };
    }
    const logA = segmentDistance(px, py, -radius * 0.8, -2.3, radius * 0.8, -0.7);
    const logB = segmentDistance(px, py, -radius * 0.8, -0.7, radius * 0.8, -2.3);
    if (Math.min(logA, logB) < 0.45) {
      return { m: 'char', l: 0.5 + grain(px, py, seed), c: [96, 64, 44],
        acc: { g: dg(`props.embers.${Math.floor(hash2(Math.floor(px * 2), Math.floor(py), seed) * 3)}`), c: [255, 132, 40] } };
    }
    return stoneAt(px, py, false);
  };
  // Ash and grit on the ground around the ring.
  const extras = [];
  const w = Math.ceil(radius / ASPECT);
  for (let i = 0; i < 4; i++) {
    extras.push({ dx: (i % 2 ? 1 : -1) * (w + Math.floor(rand() * 2)), dy: Math.floor(rand() * 2),
      g: dg(`speck.${Math.floor(rand() * 16)}`), c: [120, 116, 112] });
  }
  return prop('campfire', x, y, radius + 0.15, height, radius * 0.9 / ASPECT, 1.2, sample, seed, bake,
    { extras, shadow: { rx: radius * 1.2, ry: 1, ox: 0.4 } });
}

// A signpost: a pointed board with a carved arrow, nailed to its post.
function makeSignpost(x, y, rand, seed, bake) {
  const height = 9.1 + rand() * 1.5;
  const direction = rand() < 0.5 ? -1 : 1;
  const boardY = -height + 1.2;
  const wood = [134 + rand() * 16, 98, 58];
  const board = [[-3.35, boardY - 1.05], [2.65, boardY - 1.05],
    [4, boardY + 0.2], [2.65, boardY + 1.45], [-3.35, boardY + 1.45]];
  const sample = (px, py) => {
    const sx = px * direction;
    if (inPolygon(sx, py, board)) {
      const s = { m: 'plankh', l: clamp(0.7 - (py - boardY) * 0.12 + grain(sx, py, seed)), c: wood };
      if (Math.abs(sx) < 0.3 && Math.abs(py - boardY) < 0.4) s.acc = nail(2);
      else if (Math.abs(py - boardY - 0.15) < 0.35 && sx > -2.7 && sx < 1.6) s.acc = { g: dg('props.carve.0'), c: [66, 44, 28] };
      else if (Math.abs(py - boardY - 0.15) < 0.5 && sx >= 1.6 && sx < 2.6) {
        s.acc = { g: dg(`props.arrow.${direction > 0 ? 1 : 0}`), c: [66, 44, 28] };
      }
      return s;
    }
    if (py >= -height && Math.abs(px) < 0.5) {
      if (py < -height + 0.5) return { m: 'cut', l: 0.8, c: [184, 150, 104], g: ringGlyph(0, 0.5) };
      return { m: 'plank', l: clamp(0.58 - px * 0.6 + grain(px, py, seed)), c: [124, 88, 50] };
    }
    return null;
  };
  return prop('signpost', x, y, 4, height, 1.05, 0.75, sample, seed, bake,
    { shadow: { rx: 2, ry: 0.8, ox: 1.2 } });
}

// Fitted cobbles in courses a row high, each course shifted half a stone:
// the stone's light on a side (-1 west to 1 east), its tone and whether the
// point is on a joint. The furnace and the alloy forge share them.
function cobble(px, py, seed, side) {
  const j = Math.floor(-py);
  const u = px / 1.5 + (j % 2) * 0.5 + (hash2(j, 0, seed + 7) - 0.5) * 0.3;
  const i = Math.floor(u), tone = hash2(i, j, seed + 7);
  const edge = Math.min((u - i) * 1.5, (i + 1 - u) * 1.5, -py - j, j + 1 + py);
  return { l: clamp(0.45 + tone * 0.25 - side * 0.18 + grain(px, py, seed)), tone, joint: edge < 0.2 };
}

// A furnace: a squat block of fitted cobbles under a stone slab, with a
// dark arched mouth over an iron grate and a flue in its top. Drawn in
// small letters on the fine grid; `glow` is the mouth's inner ellipse,
// where furnace-glow.js draws the fire while it burns.
function makeFurnace(x, y, rand, seed, bake) {
  const rx = 4 + rand() * 0.4;
  const height = 6.2 + rand() * 0.6;
  // The campfire ring's stone, lifted as rocks are so it holds at night.
  const stone = [118, 112, 108].map((v) => v * 1.7);
  const corner = 0.8;
  // The mouth: a round arch of half-width 1.3 from the sill to 2.3 up.
  const arch = (px, py) => py > -1 ? 1.3 - Math.abs(px) : 1.3 - Math.hypot(px, py + 1);
  const sample = (px, py) => {
    if (py < -height) return null;
    const half = rx * (1 + 0.08 * py / height);
    const ax = Math.abs(px);
    if (ax > half) return null;
    const cy = -height + corner;
    if (py < cy && ax > half - corner && Math.hypot(ax - half + corner, py - cy) > corner) return null;
    const side = px / half;
    if (py < -height + 0.9) {
      if (((px - rx * 0.45) / 0.5) ** 2 + ((py + height - 0.45) / 0.25) ** 2 <= 1) {
        return { m: 'plain', l: 0.08, c: [26, 20, 18], g: dg('props.shade.1'), back: 0.3 };
      }
      return { m: 'stone', l: clamp(0.8 - side * 0.1 + grain(px, py, seed)), c: stone };
    }
    const inMouth = arch(px, py);
    if (inMouth > 0 && py > -2.3 && py < -0.2) {
      if (py > -0.6) return { m: 'iron', l: 0.5, c: IRON, g: glyph('=') };
      return { m: 'plain', l: 0.08, c: [30, 22, 18], g: dg('props.shade.1'), back: 0.3 };
    }
    const { l: lit, tone, joint } = cobble(px, py, seed, side);
    let l = lit;
    if (joint) l *= 0.4;
    else if (inMouth > -0.35 && py < -0.2) l = clamp(l + 0.12);
    else if (inMouth > -1 && py < -1.6) l *= 0.6;
    return { m: 'stone', l, c: stone.map((v) => v * (0.9 + tone * 0.2)) };
  };
  const furnace = prop('furnace', x, y, rx, height, rx * 0.9 / ASPECT, 1.4, sample, seed, bake,
    { shadow: { rx: rx * 1.2, ry: 1, ox: rx * 0.3 } });
  furnace.glow = { x: 0, y: -1.35, rx: 1.05, ry: 0.85 };
  return withFine(furnace, function* fine() {
    return bake((Math.ceil(rx / ASPECT) + 1) * FINE, -Math.ceil(height) * FINE, 0,
      (px, py) => py > 0 ? null : sample(px / FINE, py / FINE), seed);
  });
}

// An alloy forge: a wide, low cobble hearth with a bed of coals in its top,
// a clay crucible standing behind them and leather bellows at its west end.
// The coals' embers are baked in, so they show faintly when it's cold; `glow`
// is the bed, where furnace-glow.js draws the fire after a firing.
function makeAlloyForge(x, y, rand, seed, bake) {
  const rx = 4.4 + rand() * 0.4;
  const height = 3.2 + rand() * 0.3;
  const stone = [118, 112, 108].map((v) => v * 1.7);
  const bed = { x: 0.3, y: -height + 0.4, rx: 2.4, ry: 0.4 };
  const sample = (px, py) => {
    // The bellows: plank boards round folded leather, with an iron nozzle.
    const bx = -rx - px;
    if (bx > 0) {
      const dy = py + height * 0.5;
      if (bx < 0.4) return Math.abs(dy) < 0.25 ? { m: 'iron', l: 0.5, c: IRON, g: glyph('=') } : null;
      const half = 0.25 + (bx - 0.4) * 0.4;
      if (bx > 3 || Math.abs(dy) > half) return null;
      if (Math.abs(dy) > half - 0.25) return { m: 'plankh', l: clamp((dy < 0 ? 0.75 : 0.45) + grain(px, py, seed)), c: [136, 98, 60] };
      return { m: 'canvas', l: bx % 0.35 < 0.08 ? 0.25 : 0.5, c: [110, 76, 52] };
    }
    // The crucible, a clay pot behind the coals, its mouth full of molten metal.
    const cx = px - bed.x, t = (-height - py) / 2;
    if (t >= 0 && t <= 1.15) {
      const mouth = (cx / 0.85) ** 2 + ((t - 1) / 0.13) ** 2;
      if (mouth <= 0.45) return { m: 'plain', l: 1, c: [240, 150, 60], g: glyph('~'), back: 0.25 };
      if (mouth <= 1) return { m: 'plain', l: 0.8, c: [170, 112, 82], g: glyph('=') };
      const half = 1.1 - 0.25 * t - (t < 0.15 ? 0.15 - t : 0);
      if (t <= 1 && Math.abs(cx) <= half) return { m: 'stone', l: clamp(0.62 - cx / half * 0.22 + grain(px, py, seed)), c: [150, 96, 70] };
    }
    if (py < -height || Math.abs(px) > rx) return null;
    // The hearth: a lighter lip slab over cobbles, its corners rounded.
    if (py < -height + 0.4 && Math.abs(px) > rx - 0.4 && Math.hypot(Math.abs(px) - rx + 0.4, py + height - 0.4) > 0.4) return null;
    const side = px / rx;
    // The coals: a long bed with rounded ends.
    const ex = Math.max(0, Math.abs(px - bed.x) - bed.rx + bed.ry);
    if (ex * ex + (py - bed.y) ** 2 <= bed.ry * bed.ry) {
      // A third of them are faint embers, even when the forge is cold.
      const ember = hash2(Math.floor(px * 6), Math.floor(py * 6), seed + 11) < 0.33;
      return ember ? { m: 'plain', l: 0.35, c: [150, 60, 28], g: glyph('.,*'[Math.floor(hash2(Math.floor(px * 6), 0, seed) * 3)]), back: 0.3 }
        : { m: 'plain', l: 0.08, c: [30, 22, 18], g: dg('props.shade.1'), back: 0.3 };
    }
    if (py < -height + 0.5) return { m: 'stone', l: clamp(0.75 - side * 0.1 + grain(px, py, seed)), c: stone };
    const { l, tone, joint } = cobble(px, py, seed, side);
    return { m: 'stone', l: joint ? l * 0.4 : l, c: stone.map((v) => v * (0.9 + tone * 0.2)) };
  };
  const top = Math.ceil(height + 2.3);
  const forge = prop('alloy-forge', x, y, rx + 3, top, rx * 0.95 / ASPECT, 1.4, sample, seed, bake,
    { shadow: { rx: rx * 1.3, ry: 1, ox: rx * 0.3 } });
  // The coals and the flames licking up round the crucible's foot.
  forge.glow = { x: bed.x, y: bed.y - 0.3, rx: bed.rx - 0.3, ry: 0.6 };
  return withFine(forge, function* fine() {
    return bake((Math.ceil((rx + 3) / ASPECT) + 1) * FINE, -top * FINE, 0,
      (px, py) => py > 0 ? null : sample(px / FINE, py / FINE), seed);
  });
}

// The smith's tools hanging from the rack, west to east: hammer, small
// hammer, etching tool, whittling knife, engraving burin and needle.
const TOOLS = ['T', 't', '!', '/', 'i', '|'];

// A weapon station: an anvil on a sawn stump, and a rack beside it with the
// six smithing tools hanging from its bar. No fire, so no glow.
function makeWeaponStation(x, y, rand, seed, bake) {
  const sx = -2.8, rx = 1.7 + rand() * 0.2, height = 2;
  // Lifted as the furnace's stone is, so it holds at night.
  const iron = IRON.map((v) => v * 1.6), bark = [177, 126, 81], wood = [192, 141, 87];
  // On whole fine rows, so the face and the bar read as clean lines.
  const top = -height - 1.5;
  const rack = { x0: 1, x1: 5.5, top: -5 };
  const sample = (px, py) => {
    const ax = px - sx, ay = py - top;
    // The anvil: a face slab with a horn to the west and a heel to the east,
    // over a dark waist flaring to its foot on the stump.
    if (ay >= 0 && ay < 0.5 && ax > -1.5 && ax < 2) return { m: 'iron', l: clamp(0.85 - ax * 0.05), c: iron, g: glyph('=') };
    if (ay >= 0 && ay < 0.5 && ax <= -1.5 && ax > -2.7) return { m: 'iron', l: 0.7, c: iron, g: glyph(ax < -2.1 ? '<' : '-') };
    if (ay >= 0.5 && ay < 1 && ax >= 1.3 && ax < 2) return { m: 'iron', l: 0.5, c: iron, g: glyph(']') };
    if (ay >= 0.5 && py < -height && Math.abs(ax) <= 0.6 + (ay - 0.5) ** 2 * 0.7) {
      return { m: 'iron', l: clamp(0.4 - ax * 0.1), c: IRON, g: glyph('#') };
    }
    // The stump: a lighter sawn top with rings, and grained bark below.
    const ring = (ax / rx) ** 2 + ((py + height) / 0.5) ** 2;
    if (ring <= 1) {
      return { m: 'cut', l: clamp(0.8 - ax * 0.1), c: [228, 182, 118],
        g: ringGlyph(-ax, -(py + height) * 3, seed, Math.floor(px * 2), Math.floor(py * 2)) };
    }
    if (py > -height && Math.abs(ax) <= rx * (1 + (py + height) * 0.05)) {
      return { m: 'bark', l: clamp(0.6 - ax / rx * 0.4 + grain(px, py, seed)), c: bark };
    }
    // The rack: two posts and a bar over a dark board, each tool's head over
    // its handle. The board keeps every cell whole when a variant stretches it.
    if (px < rack.x0 - 0.3 || px > rack.x1 + 0.3 || py < rack.top) return null;
    if (py < rack.top + 0.5) return { m: 'plankh', l: clamp(0.75 + grain(px, py, seed)), c: wood };
    if (Math.abs(px - rack.x0) < 0.3 || Math.abs(px - rack.x1) < 0.3) return { m: 'plank', l: clamp(0.6 - (px - rack.x0) * 0.03), c: wood };
    if (py > rack.top + 2) return null;
    const at = (px - rack.x0 - 0.6) / 0.6;
    const tool = TOOLS[Math.floor(at)];
    if (!tool || at % 1 >= 0.5) return { m: 'plain', l: 0.1, c: wood, g: dg('props.shade.1') };
    const head = py < rack.top + 1;
    return { m: 'plain', l: head ? 0.8 : 0.55, c: head ? iron : wood, g: glyph(head ? tool : '|') };
  };
  const station = prop('weapon-station', x, y, 5.8, -rack.top, 5 * 0.95 / ASPECT, 1.2, sample, seed, bake,
    { shadow: { rx: 4.8, ry: 0.9, ox: 0.4 } });
  return withFine(station, function* fine() {
    return bake((Math.ceil(5.8 / ASPECT) + 1) * FINE, rack.top * FINE, 0,
      (px, py) => py > 0 ? null : sample(px / FINE, py / FINE), seed);
  });
}

const MAKERS = { crate: makeCrate, barrel: makeBarrel, fence: makeFence, tent: makeTent, campfire: makeCampfire,
  signpost: makeSignpost, furnace: makeFurnace, 'alloy-forge': makeAlloyForge, 'weapon-station': makeWeaponStation };

export function makeCampProp(kind, x, y, rand, seed, bake) {
  const make = Object.hasOwn(MAKERS, kind) ? MAKERS[kind] : null;
  return make ? make(x, y, rand, seed, bake) : null;
}
