import { fbm, valueNoise } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { FINE, putCell } from '../render/cells.js';
import { dg, glyph, LAYER, over } from '../render/glyphs.js';
import { MOSS, STONE_MID } from '../render/palette.js';
import { isArchitectureKind, makeArchitectureProp } from './architecture-props.js';
import { makeCampProp } from './camp-props.js';
import { deadwoodBlocks } from './deadwood.js';
import { makeNaturalProp } from './natural-props.js';
import { paleCaps } from './pale-caps.js';
import { fineOf } from './fine-bakes.js';
import { shade } from './glow.js';
import { bakeSurface, canopyOf, cellBounds, fineRecipe, makeCell, recording, replaying, ringGlyph, withCanopy, withFine } from './prop-art.js';
import { propDefinition } from './prop-catalog.js';
import { GLOSS_DAMP, GLOSS_DRY, GLOSS_WET, MOON, VIEW_C, VIEW_S, glossByte } from './surface-light.js';
import { tintRgb } from './moon-tint.js';
import { HOST_TINT, ORES } from './ore-veins.js';
import { makeTree } from './trees.js';
import { treeWind, windGust } from './wind.js';
import { ASPECT, GRASS, WATER } from './world.js';

// Scenery props. Each prop is rasterised once, when its chunk is
// generated, into a list of cells relative to its base (the point where it
// touches the ground). A cell whose glyph carries the LAYER flag stacks on
// the cell drawn just before it at the same place, so one spot can show a
// texture with moss, a nail or a crack over it. Crowns animate without
// rebuilding their geometry.

const LIGHT = (() => {
  const n = Math.hypot(...MOON);
  return MOON.map((x) => x / n);
})();
const STONE_GAP = [24, 22, 36];

// Bakes a sampled prop into base and layered cells (see prop-art.js).
function bake(w, top, bottom, sample, seed, options) {
  return bakeSurface(w, top, bottom, sample, seed, options);
}

// Rocks catch more moonlight than the ground around them, so they stand
// out from it as solid shapes.
const ROCK_LIFT = 1.8;

// A boulder seen from above and in front: an irregular outline over a dome
// cut into flat facets, each lit by the moon at its own angle. Cracks,
// moss on the upturned faces, lichen rosettes and a scatter of pebbles at
// the foot are decided once, so the rock never shimmers.
// Big boulders add what only a large rock shows: sedimentary bedding
// across the face (`strata`), a shadowed undercut where the base tucks in
// (`undercut`), more and wider fissures that fork (`cracks`, `crackWidth`)
// and a skirt of scree (`talus`).
function boulder(rand, seed, { rx, ry, sides, roundness, stone: base, mossCoverage: moss, grit = 0.5,
  strata = 0, undercut = 0, cracks: crackCount = null, crackWidth = 0.32, talus = 0, lichen: lichenOn = true, flecks = null }) {
  const stone = base.map((v) => Math.min(255, v * ROCK_LIFT));
  // Moss takes over the characters it grows on, so a little goes a long way.
  const mossCoverage = moss * 0.5;
  const lift = (c) => c.map((v) => Math.min(255, v * ROCK_LIFT));
  const offset = rand() * Math.PI * 2;
  const corners = Array.from({ length: sides }, (_, i) => {
    const angle = offset + i * Math.PI * 2 / sides + (rand() - 0.5) * 0.4;
    let radius = roundness + rand() * (1 - roundness);
    // A big rock sits on a broad foot: its lower corners stay out wide.
    if (strata && Math.sin(angle) > 0.2) radius = Math.max(radius, 0.92 + rand() * 0.08);
    return [Math.cos(angle) * rx * radius, -ry + Math.sin(angle) * ry * radius];
  });
  const bottom = Math.max(...corners.map((c) => c[1]));
  for (const c of corners) c[1] -= bottom;
  // The dome's normal over the outline's ellipse; up the screen is up.
  const dome = (u, v) => {
    const z = Math.sqrt(Math.max(0.04, 1 - u * u - v * v));
    const n = [u, v * 0.85 - 0.35, z];
    const k = Math.hypot(...n);
    return n.map((x) => x / k);
  };
  const facetCount = 5 + Math.floor(rand() * 4);
  const facets = Array.from({ length: facetCount }, () => {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * 0.85;
    const u = Math.cos(a) * d;
    const v = Math.sin(a) * d;
    const n = dome(u, v).map((x) => x + (rand() - 0.5) * 0.32);
    const k = Math.hypot(...n);
    const lit = Math.max(0, (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / k);
    return { u, v, lit, up: n[1] / k, n: n.map((x) => x / k) };
  });
  // Only the fine bake asks for normals (see fineBoulder): torches and
  // fires rake across a rock's small letters by the way each one faces.
  const normals = { on: false };
  // Tall faces get proportionally shorter crack segments, so they wander.
  const [crackStep, crackJitter] = crackCount ? [Math.min(0.35, 4 / ry), Math.min(0.2, 2.4 / ry)] : [0.35, 0.2];
  const cracks = Array.from({ length: crackCount ?? (rand() < 0.75 ? 1 + Math.floor(rand() * 2) : 0) }, () => {
    const pts = [];
    let u = (rand() - 0.5) * 1.2;
    let v = -0.9;
    while (v < 1) {
      pts.push([u * rx, -ry + v * ry - bottom]);
      u += (rand() - 0.5) * 0.5;
      v += crackStep + rand() * crackJitter;
    }
    return pts;
  });
  // On a big rock a fissure forks: a shorter branch leaves part way down.
  if (crackCount) {
    for (const main of cracks.slice()) {
      if (main.length < 4 || rand() < 0.3) continue;
      const from = main[1 + Math.floor(rand() * (main.length - 3))];
      const side = rand() < 0.5 ? -1 : 1;
      const branch = [from];
      for (let i = 0; i < 3; i++) {
        const [x, y] = branch[branch.length - 1];
        branch.push([x + side * rx * (0.08 + rand() * 0.1), y + ry * (0.1 + rand() * 0.12)]);
      }
      cracks.push(branch);
    }
  }
  // Bedding planes dip gently across the rock, one way or the other.
  // Only big rocks draw these, so small ones keep their random stream.
  const dip = strata ? (rand() - 0.5) * 0.25 : 0;
  const bedPhase = strata ? rand() : 0;
  const inside = (px, py) => {
    let hit = false;
    for (let i = 0, j = sides - 1; i < sides; j = i++) {
      const a = corners[i];
      const b = corners[j];
      if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  };
  const fissures = [0, 1, 2, 3].map((a) => [0, 1].map((v) => dg(`props.fissure.${a}.${v}`)));
  const mossGlyphs = [0, 1, 2, 3, 4, 5].map((i) => dg(`props.moss.${i}`));
  const ridges = [0, 1, 2, 3].map((a) => dg(`props.ridge.${a}`));
  const lichenGlyphs = [0, 1, 2, 3].map((i) => dg(`props.lichen.${i}`));
  const lichen = lift(rand() < 0.5 ? [168, 170, 122] : [176, 128, 82]);
  const seamGlyph = dg('props.seam.0');
  const sample = (px, py) => {
    if (py > 0 || !inside(px, py)) return null;
    const u = px / rx;
    const v = (py + ry + bottom) / ry;
    // Nearest facet, measured on the dome.
    let best = facets[0];
    let next = facets[1];
    let bestD = Infinity;
    let nextD = Infinity;
    for (const f of facets) {
      const d = (u - f.u) ** 2 + (v - f.v) ** 2 * 1.4;
      if (d < bestD) { nextD = bestD; next = best; bestD = d; best = f; } else if (d < nextD) { nextD = d; next = f; }
    }
    // dome(u, v), written out: this runs for every sample of a bake.
    const dz = Math.sqrt(Math.max(0.04, 1 - u * u - v * v));
    const dy = v * 0.85 - 0.35;
    const dk = Math.hypot(u, dy, dz);
    const n0 = u / dk, n1 = dy / dk, n2 = dz / dk;
    const smooth = Math.max(0, n0 * LIGHT[0] + n1 * LIGHT[1] + n2 * LIGHT[2]);
    const grain = (hash2(Math.floor(px * 2.2), Math.floor(py * 1.6), seed + 17) - 0.5) * 0.08;
    let l = Math.max(0, Math.min(1, (best.lit * 0.55 + smooth * 0.55 - 0.5) * 1.5 + 0.48 + grain));
    // The face tucks in under itself near the ground, out of the light.
    const low = undercut ? Math.max(0, 1 + py / (ry * 2 * undercut)) : 0;
    if (low > 0) l *= 1 - low * 0.65;
    let s;
    if (normals.on) {
      // The facet's face blended into the dome the way the moon sees it,
      // with a small bump per small cell, so wet stone sparkles in specks.
      // This runs for every sample of a fine bake, so it is worldNormal
      // written out, into fields made with the sample.
      const fx = Math.floor(px * FINE / ASPECT), fy = Math.floor(py * FINE);
      const fn = best.n;
      const bx = fn[0] + n0 + (hash2(fx, fy, seed + 61) - 0.5) * 0.44;
      const by = fn[1] + n1 + (hash2(fy, fx, seed + 62) - 0.5) * 0.44;
      const bz = fn[2] + n2;
      const wy = VIEW_C * by + VIEW_S * bz;
      const wz = Math.max(0, VIEW_C * bz - VIEW_S * by);
      const k = Math.sqrt(bx * bx + wy * wy + wz * wz) || 1;
      s = { m: 'stone', l, c: stone, nx: bx / k, ny: wy / k, nz: wz / k };
    } else s = { m: 'stone', l, c: stone };
    for (const pts of cracks) {
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [bx, by] = pts[i];
        const vx = bx - ax;
        const vy = by - ay;
        const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
        // A distance is never shorter than either of its legs, so most
        // samples are ruled out before the square root.
        const ex = px - ax - vx * t;
        const ey = py - ay - vy * t;
        if (Math.abs(ex) < crackWidth && Math.abs(ey) < crackWidth && Math.hypot(ex, ey) < crackWidth) {
          const a = (Math.round(-Math.atan2(vy, vx) / (Math.PI / 4)) + 8) % 4;
          s.acc = { g: fissures[a][i % 2], c: STONE_GAP };
          return s;
        }
      }
    }
    // Ore flecks, where a vein's mineral shows through the stone.
    const fleck = flecks?.(px, py, l, best);
    if (fleck) {
      s.acc = fleck;
      return s;
    }
    const patch = valueNoise(px * 0.7, py * 0.9, seed + 29);
    // Where two facets meet: the distance to the bisector between them.
    const gx = (next.u - best.u) * rx;
    const gy = (next.v - best.v) * ry;
    const gap = (nextD - bestD) * rx / (2 * Math.hypot(next.u - best.u, (next.v - best.v) * 1.4) || 1);
    const ridgeEdge = gap < 0.2 && best.lit - next.lit > 0.16 && v < 0.6;
    if (best.up < -0.2 && v < 0.35 && patch < mossCoverage) {
      const deep = 0.7 + patch * 0.5;
      s.acc = { g: mossGlyphs[Math.floor(hash2(Math.floor(px * 3), Math.floor(py), seed) * 6)],
        c: lift([MOSS[0] * deep * (0.7 + l * 0.6), MOSS[1] * deep * (0.7 + l * 0.6), MOSS[2] * deep * (0.6 + l * 0.5)]) };
      return s;
    }
    if (strata && v > -0.35 && low < 0.5) {
      // A bedding line where the layered rock splits; it breaks off here
      // and there, as weathered seams do.
      const bed = (py + px * dip) / strata + bedPhase + valueNoise(px * 0.12, 0, seed + 53) * 0.6;
      if (Math.abs(bed - Math.round(bed)) * strata < 0.5 && valueNoise(px * 0.3, Math.round(bed), seed + 59) > 0.42) {
        s.acc = { g: seamGlyph, c: stone.map((x) => x * (0.45 + l * 0.35)) };
        return s;
      }
    }
    if (ridgeEdge) {
      const a = (Math.round(-Math.atan2(gx, -gy) / (Math.PI / 4)) + 8) % 4;
      s.acc = { g: ridges[a], c: stone.map((x) => x * (0.85 + l * 0.55)) };
    } else if (lichenOn && hash2(Math.floor(px * 1.7), Math.floor(py), seed + 41) < 0.05 * grit + (l > 0.5 ? 0.03 : 0)) {
      s.acc = { g: lichenGlyphs[Math.floor(hash2(Math.floor(px), Math.floor(py), seed + 43) * 4)],
        c: lichen.map((x) => x * (0.55 + l * 0.5)) };
    }
    return s;
  };
  // Pebbles and grit around the foot, on the ground beside the rock.
  const extras = [];
  const half = Math.ceil(rx / ASPECT);
  const count = 2 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const dx = side * (Math.floor(half * (0.55 + rand() * 0.5)) + 1);
    const dy = rand() < 0.6 ? 0 : 1;
    const light = 0.55 + rand() * 0.35;
    const name = rand() < 0.6 ? `pebble.${Math.floor(rand() * 8)}` : `gravel.${Math.floor(rand() * 8)}`;
    extras.push({ dx, dy, g: dg(name), c: stone.map((x) => x * light) });
  }
  // Scree: stones that broke off and rolled out along the foot.
  for (let i = 0; i < talus; i++) {
    const dx = Math.round((rand() * 2 - 1) * half * 1.05);
    const dy = rand() < 0.55 ? 0 : 1 + Math.floor(rand() * 2);
    const light = 0.5 + rand() * 0.4;
    const name = rand() < 0.45 ? `pebble.${Math.floor(rand() * 8)}` : `gravel.${Math.floor(rand() * 8)}`;
    if (!extras.some((e) => e.dx === dx && e.dy === dy)) extras.push({ dx, dy, g: dg(name), c: stone.map((x) => x * light) });
  }
  return { sample, normals, w: Math.ceil(rx / ASPECT) + 1, top: -Math.ceil(ry * 2) - 1, extras,
    shadow: { rx: rx * 1.15, ry: Math.max(1, ry * 0.25), ox: rx * 0.25 } };
}

function bakeBoulder(rock, seed, bakeFn) {
  return bakeFn(rock.w, rock.top, 0, rock.sample, seed, { shadow: rock.shadow, extras: rock.extras });
}

// The rock alone, without its shadow and pebbles, in small letters (FINE
// to a cell) for the fine grid. A rock is small enough to bake in one step.
function fineBoulder(rock, seed, bakeFn) {
  return function* fine() {
    rock.normals.on = true;
    return bakeFn(rock.w * FINE, rock.top * FINE, 0, (px, py) => rock.sample(px / FINE, py / FINE), seed);
  };
}

// A standing stone: a tall, slender menhir that tapers to an oblique,
// rounded crown and leans a little. Its edges are hewn, not ruled. It is
// shaped like a boulder (see above), so the same bakes draw it, and it
// keeps its own random draws so boulders stay as they were.
function standingStone(rand, seed) {
  const H = 7.5 + rand() * 3;
  const b = 1.15 + rand() * 0.45;
  const taper = 0.38 + rand() * 0.17;
  const lean = (rand() - 0.5) * 0.16;
  const crownSide = rand() < 0.5 ? -1 : 1;
  const crownDrop = 0.6 + rand() * 0.8;
  const colors = [[109, 122, 139], [145, 127, 106], [135, 137, 143], [122, 136, 119]];
  const stone = colors[Math.floor(rand() * colors.length)].map((v) => Math.min(255, v * ROCK_LIFT));
  const mossCoverage = (0.15 + rand() * 0.35) * 0.5;
  // Flakes run up and down the stone, not around it.
  const facets = Array.from({ length: 5 + Math.floor(rand() * 4) }, () => {
    const u = (rand() - 0.5) * 1.8;
    const v = rand();
    const n = [0.85 * Math.sign(u) * Math.abs(u) ** 1.3 + (rand() - 0.5) * 0.4, -0.12 + (rand() - 0.5) * 0.2,
      Math.sqrt(Math.max(0.05, 1 - u * u))];
    const k = Math.hypot(...n);
    return { u, v, lit: Math.max(0, (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / k), n: n.map((x) => x / k) };
  });
  // Fissures run down from the crown.
  const cracks = Array.from({ length: rand() < 0.6 ? 1 + Math.floor(rand() * 2) : 0 }, () => {
    const pts = [];
    let u = (rand() - 0.5) * 0.9;
    for (let v = 0.95; v > 0.1; v -= 0.12 + rand() * 0.08) {
      pts.push([u, v]);
      u += (rand() - 0.5) * 0.3;
    }
    return pts;
  });
  const half = (h) => {
    const t = Math.min(1, Math.max(0, h / H));
    let w = b * (1 - (1 - taper) * t ** 0.85);
    if (h < 0.6) w *= 1.08;
    return w;
  };
  // The top edge, lower on one shoulder, and its rounded shoulders.
  const crownAt = (s) => H - crownDrop * (1 - (s * crownSide + 1) / 2);
  const round = 0.45 * b * taper;
  const inside = (px, h) => {
    if (h < 0 || h > H) return null;
    const cx = lean * h;
    const w = half(h);
    const side = px < cx ? 0 : 1;
    const wobble = (valueNoise(h * 0.6, side, seed + 71) - 0.5) * 0.18 * b;
    const edge = w + wobble;
    const u = (px - cx) / edge;
    if (Math.abs(u) > 1) return null;
    const crown = crownAt(u);
    if (h > crown) return null;
    // Round off the shoulders: inside a quarter circle at each top corner.
    const dx = Math.abs(px - cx) - (edge - round);
    const dy = h - (crown - round);
    if (dx > 0 && dy > 0 && dx * dx + dy * dy > round * round) return null;
    return { u, crown };
  };
  const fissures = [0, 1, 2, 3].map((a) => [0, 1].map((v) => dg(`props.fissure.${a}.${v}`)));
  const mossGlyphs = [0, 1, 2, 3, 4, 5].map((i) => dg(`props.moss.${i}`));
  const ridges = [0, 1, 2, 3].map((a) => dg(`props.ridge.${a}`));
  const lichenGlyphs = [0, 1, 2, 3].map((i) => dg(`props.lichen.${i}`));
  const lichen = rand() < 0.5 ? [168, 170, 122] : [176, 128, 82];
  const normals = { on: false };
  const sample = (px, py) => {
    const h = -py;
    const at = inside(px, h);
    if (!at) return null;
    const { u, crown } = at;
    const v = h / H;
    let best = facets[0];
    let next = facets[1];
    let bestD = Infinity;
    let nextD = Infinity;
    for (const f of facets) {
      const d = (u - f.u) ** 2 + (v - f.v) ** 2 * 0.25;
      if (d < bestD) { nextD = bestD; next = best; bestD = d; best = f; } else if (d < nextD) { nextD = d; next = f; }
    }
    // A slab, flatter than a column, leaning back a little with the taper;
    // the crown band turns up to the moon.
    const top = Math.max(0, 1 - (crown - h) / 0.8);
    let n0 = 0.85 * Math.sign(u) * Math.abs(u) ** 1.3 * (1 - top);
    let n1 = -0.12 * (1 - top) - 0.8 * top;
    let n2 = Math.sqrt(Math.max(0.05, 1 - u * u)) * (1 - top) + 0.6 * top;
    const nk = Math.hypot(n0, n1, n2);
    n0 /= nk; n1 /= nk; n2 /= nk;
    const smooth = Math.max(0, n0 * LIGHT[0] + n1 * LIGHT[1] + n2 * LIGHT[2]);
    const grain = (hash2(Math.floor(px * 2.2), Math.floor(py * 1.6), seed + 17) - 0.5) * 0.08;
    let l = Math.max(0, Math.min(1, (best.lit * 0.55 + smooth * 0.55 - 0.5) * 1.5 + 0.48 + grain));
    l *= 0.75 + 0.25 * Math.min(1, h / 1.5);
    let s;
    if (normals.on) {
      const fx = Math.floor(px * FINE / ASPECT), fy = Math.floor(py * FINE);
      const fn = best.n;
      const bx = fn[0] + n0 + (hash2(fx, fy, seed + 61) - 0.5) * 0.44;
      const by = fn[1] + n1 + (hash2(fy, fx, seed + 62) - 0.5) * 0.44;
      const bz = fn[2] + n2;
      const wy = VIEW_C * by + VIEW_S * bz;
      const wz = Math.max(0, VIEW_C * bz - VIEW_S * by);
      const k = Math.sqrt(bx * bx + wy * wy + wz * wz) || 1;
      s = { m: 'stone', l, c: stone, nx: bx / k, ny: wy / k, nz: wz / k };
    } else s = { m: 'stone', l, c: stone };
    for (const pts of cracks) {
      for (let i = 1; i < pts.length; i++) {
        const [au, av] = pts[i - 1];
        const [bu, bv] = pts[i];
        const t = Math.max(0, Math.min(1, (v - av) / (bv - av)));
        if (v > Math.max(av, bv) || v < Math.min(av, bv)) continue;
        if (Math.abs(u - (au + (bu - au) * t)) * half(h) < 0.2) {
          const a = (Math.round(-Math.atan2((bv - av) * H, (bu - au) * half(h)) / (Math.PI / 4)) + 8) % 4;
          s.acc = { g: fissures[a][i % 2], c: STONE_GAP };
          return s;
        }
      }
    }
    const patch = valueNoise(px * 0.7, py * 0.9, seed + 29);
    if (patch < mossCoverage && (top > 0.3 || (u > 0.3 && h < 1.5))) {
      const deep = 0.7 + patch * 0.5;
      s.acc = { g: mossGlyphs[Math.floor(hash2(Math.floor(px * 3), Math.floor(py), seed) * 6)],
        c: [MOSS[0] * deep * (0.7 + l * 0.6), MOSS[1] * deep * (0.7 + l * 0.6), MOSS[2] * deep * (0.6 + l * 0.5)]
          .map((x) => Math.min(255, x * ROCK_LIFT)) };
      return s;
    }
    // Where two flakes meet, a vertical ridge.
    const gap = (nextD - bestD) / (2 * Math.abs(next.u - best.u) || 1);
    if (gap < 0.05 && Math.abs(best.lit - next.lit) > 0.12) {
      s.acc = { g: ridges[2], c: stone.map((x) => x * (0.85 + l * 0.55)) };
    } else if (hash2(Math.floor(px * 1.7), Math.floor(py), seed + 41) < (u < 0 ? 0.1 : 0.05)) {
      s.acc = { g: lichenGlyphs[Math.floor(hash2(Math.floor(px), Math.floor(py), seed + 43) * 4)],
        c: lichen.map((x) => Math.min(255, x * ROCK_LIFT) * (0.55 + l * 0.5)) };
    }
    return s;
  };
  // Pebbles at the foot, as a boulder has.
  const extras = [];
  const foot = Math.ceil(b / ASPECT);
  for (let i = 1 + Math.floor(rand() * 3); i > 0; i--) {
    const side = rand() < 0.5 ? -1 : 1;
    const dx = side * (Math.floor(foot * (0.55 + rand() * 0.5)) + 1);
    const dy = rand() < 0.6 ? 0 : 1;
    const light = 0.55 + rand() * 0.35;
    const name = rand() < 0.6 ? `pebble.${Math.floor(rand() * 8)}` : `gravel.${Math.floor(rand() * 8)}`;
    extras.push({ dx, dy, g: dg(name), c: stone.map((x) => x * light) });
  }
  return { sample, normals, b, w: Math.ceil((b + Math.abs(lean) * H + 0.4) / ASPECT) + 1, top: -Math.ceil(H) - 1,
    extras, shadow: { rx: b * 2.4, ry: 0.9, ox: b * 1.3 } };
}

// A builder's standing stone: decorative, but solid like a rock.
function makeStandingStone(x, y, rand, seed, bakeFn = bake) {
  const rock = standingStone(rand, seed);
  return withFine({ kind: 'standing-stone', x, y, footW: rock.b * 0.85 / ASPECT, footH: 0.9,
    cells: bakeBoulder(rock, seed, bakeFn) }, fineBoulder(rock, seed, bakeFn));
}

// A builder's clump of pale caps: decorative, and walked through like the
// mushrooms it grows among.
function makePaleCaps(x, y, rand, seed, bakeFn = bake) {
  const caps = paleCaps(rand, seed);
  return withFine({ kind: 'pale-caps', x, y, footW: caps.b / ASPECT, footH: 0.8,
    cells: bakeBoulder(caps, seed, bakeFn) }, fineBoulder(caps, seed, bakeFn));
}

// Rocks and standing stones: solid stone that is damp by water, keeps the
// grass off its face and stops arrows.
export const isStoneProp = (prop) => prop.kind === 'rock' || prop.kind === 'standing-stone';

function makeRock(x, y, stream, seed = x * 17 + y, bakeFn = bake) {
  const { random: rand, draws } = recording(stream);
  const rx = 2.6 + rand() * 3.2;
  const ry = rx * (0.65 + rand() * 0.2);
  const lavender = rand();
  const stone = STONE_MID.map((v, i) => v * (0.92 + lavender * 0.2) + [8, 5, -6][i] * (1 - lavender));
  const rock = boulder(rand, seed, { rx, ry, sides: 7 + Math.floor(rand() * 3), roundness: 0.66, stone,
    mossCoverage: 0.25 + rand() * 0.35 });
  const cells = bakeBoulder(rock, seed, bakeFn);
  return withFine({ kind: 'rock', x, y, footW: rx / ASPECT, footH: 1.4, bounds: cellBounds(cells), cells },
    fineBoulder(rock, seed, bakeFn), { make: 'rock', x, y, draws, seed });
}

// A small stone standing out of a river, wet and only lightly mossed.
// The water breaks around it (see the current in terrain/water.js).
export function makeRiverStone(x, y, stream, seed = x * 19 + y, bakeFn = bake) {
  const { random: rand, draws } = recording(stream);
  const rx = 0.9 + rand() * 0.7;
  const ry = rx * (0.6 + rand() * 0.2);
  const lavender = rand();
  const stone = STONE_MID.map((v, i) => v * (0.86 + lavender * 0.16) + [6, 4, -4][i] * (1 - lavender));
  const rock = boulder(rand, seed, { rx, ry, sides: 6 + Math.floor(rand() * 3), roundness: 0.7, stone,
    mossCoverage: 0.05 + rand() * 0.1 });
  const cells = bakeBoulder(rock, seed, bakeFn);
  return withFine({ kind: 'rock', x, y, footW: rx / ASPECT, footH: 0.8, bounds: cellBounds(cells), cells,
    wet: true, river: true }, fineBoulder(rock, seed, bakeFn), { make: 'riverStone', x, y, draws, seed });
}

// A landmark boulder, many times a scattered rock's size: a broad, jagged
// mass with bedding lines, forked fissures, a mossy crown, a dark undercut
// and scree at its foot.
function makeBigRock(x, y, stream, seed = x * 23 + y) {
  const { random: rand, draws } = recording(stream);
  const rx = 12 + rand() * 8;
  const ry = rx * (0.58 + rand() * 0.22);
  const lavender = rand();
  // A little paler than a small rock, so the mass holds its own at night.
  const stone = STONE_MID.map((v, i) => (v * (0.9 + lavender * 0.2) + [8, 5, -6][i] * (1 - lavender)) * 1.2);
  const rock = boulder(rand, seed, { rx, ry, sides: 13 + Math.floor(rand() * 6), roundness: 0.5, stone,
    mossCoverage: 0.4 + rand() * 0.4, grit: 1, strata: 3.6 + rand() * 1.8, undercut: 0.16,
    cracks: 2 + Math.floor(rand() * 2), crackWidth: 0.36, talus: 10 + Math.floor(rand() * 8) });
  const cells = bake(rock.w, rock.top, 0, rock.sample, seed, { shadow: rock.shadow, extras: rock.extras });
  return withFine({ kind: 'rock', x, y, footW: rx * 0.9 / ASPECT, footH: Math.max(2, ry * 0.3),
    bounds: cellBounds(cells), cells }, fineBoulder(rock, seed, bake), { make: 'bigRock', x, y, draws, seed });
}

// A fist-high block of ore: fresh, chunky stone tinted by the local rock, with clumps
// of its mineral. Its base, ore, host and seed make it, so a worker rebuilds it exactly.
export function makeOreBlock({ x, y, ore, host, seed }, bakeFn = bake) {
  const rand = mulberry32(seed);
  const rx = 2.2 + rand() * 0.4;
  const ry = rx * (0.6 + rand() * 0.12);
  const tint = HOST_TINT[host];
  const stone = STONE_MID.map((v, i) => v * tint.k + tint.add[i]);
  const kind = ORES[ore];
  const glyphs = [...'%*:;'].map((ch) => glyph(ch));
  const flecks = (px, py, l, facet) => {
    if (valueNoise(px * 1.7, py * 2.3, seed + 73) <= 1 - kind.density) return null;
    const fx = Math.floor(px * FINE / ASPECT), fy = Math.floor(py * FINE);
    const h = hash2(fx, fy, seed + 79);
    if (h >= 0.7) return null;
    const c = kind.patina && facet.up < -0.15 && h < 0.35 ? kind.patina
      : kind.glint && l > 0.55 && h < 0.25 ? kind.glint : kind.fleck;
    const k = (0.65 + 0.75 * l) * (kind.lift ?? 1);
    return { g: glyphs[Math.floor(hash2(fx, fy, seed + 83) * 4)], c: c.map((v) => Math.min(255, v * k)) };
  };
  const rock = boulder(rand, seed, { rx, ry, sides: 5 + Math.floor(rand() * 3), roundness: 0.78, stone,
    mossCoverage: 0, grit: 0.15, lichen: false, cracks: rand() < 0.4 ? 1 : 0, crackWidth: 0.22, flecks });
  // Baked when first asked for (`unbaked` till then), not with its chunk, never with fine normals.
  let cells;
  return withFine({ kind: 'rock', ore, host, x, y, footW: rx * 0.9 / ASPECT, footH: 0.9, unbaked: true,
    bounds: { minX: -rock.w, maxX: rock.w, minY: rock.top, maxY: 2 },
    get cells() {
      if (cells) return cells;
      const fine = rock.normals.on;
      rock.normals.on = false;
      this.bounds = cellBounds(cells = bakeBoulder(rock, seed, bakeFn));
      rock.normals.on = fine;
      this.unbaked = false;
      return cells;
    } }, fineBoulder(rock, seed, bakeFn), { make: 'ore', x, y, ore, host, seed });
}

// Where a big rock stands nothing else grows: its face and a margin around
// its foot.
function underBigRock(rocks, x, y) {
  return rocks.some((r) => Math.abs(x - r.x) < r.footW + 4 && y > r.y + r.bounds.minY - 2 && y < r.y + r.footH + 3);
}

// The builder's original broadleaf, kept so saved scenes look the same.
function makeBuilderTree(x, y, rand, seed = x * 31 + y, bakeFn = bake) {
  const height = 30 + rand() * 12;
  const radius = 8 + rand() * 3.5;
  const blobs = [{ x: 0, y: -height, r: radius }];
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand();
    blobs.push({
      x: Math.cos(a) * radius * 0.65,
      y: -height + Math.sin(a) * radius * 0.5 + 1,
      r: radius * (0.55 + rand() * 0.25),
    });
  }
  const tint = rand();
  const leaf = [40 + tint * 20, 100 + tint * 30, 80 - tint * 20];
  const bark = [96, 74, 56];
  const trunkTop = -height + radius * 0.5;

  const sample = (px, py) => {
    // Canopy: the brightest blob wins, lit from the upper left.
    let best = null;
    for (const bl of blobs) {
      const nx = (px - bl.x) / bl.r;
      const ny = (py - bl.y) / (bl.r * 0.85);
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const l = 0.5 - nx * 0.3 - ny * 0.35 + (1 - d2) * 0.12;
      if (!best || l > best.l) best = { m: 'leaf', l: Math.max(0, Math.min(1, l)), c: leaf };
    }
    if (best) return best;
    const half = 1.4 + (py / -height) * -0.5;
    if (py > trunkTop && py < 0.2 && Math.abs(px) < half) {
      return { m: 'bark', l: Math.max(0, Math.min(1, 0.55 - px / half * 0.35)), c: bark };
    }
    return null;
  };

  const w = Math.ceil((radius * 1.7) / ASPECT);
  const top = -Math.ceil(height + radius);
  let cells;
  // Its leaf masses, for the shadow it casts (see canopy.js).
  return withCanopy({
    kind: 'tree',
    x,
    y,
    footW: 2.4,
    footH: 1.2,
    bounds: { minX: -w - 2, maxX: w + 2, minY: top, maxY: 2 },
    get cells() {
      return cells ??= bakeFn(w, top, 0, sample, seed, { shadow: { rx: 4, ry: 1.3, ox: 1.2 } });
    },
    // Replaced cells (e.g. a rescaled builder prop) bring their own extent.
    set cells(value) { cells = value; this.bounds = null; },
  }, Float32Array.from(blobs.flatMap((bl) => [bl.x, -bl.y, bl.r, bl.r * 0.85])));
}

// Hand-placed boulders take one of several minerals and more varied
// outlines than the boulders scattered over the procedural landscape.
function makeSceneryRock(x, y, rand, seed, bakeFn = bake) {
  const rx = 2.6 + rand() * 3.2;
  const ry = rx * (0.55 + rand() * 0.3);
  const count = 7 + Math.floor(rand() * 4);
  const colors = [[109, 122, 139], [145, 127, 106], [135, 137, 143], [122, 136, 119]];
  const stone = colors[Math.floor(rand() * colors.length)];
  const mossCoverage = rand() * 0.65;
  const rock = boulder(rand, seed, { rx, ry, sides: count - 1, roundness: 0.6, stone, mossCoverage, grit: 1 });
  return withFine({ kind: 'rock', x, y, footW: rx / ASPECT, footH: 1.4, cells: bakeBoulder(rock, seed, bakeFn) },
    fineBoulder(rock, seed, bakeFn));
}

function makeBuilderBush(x, y, rand, seed, bakeFn = bake) {
  const radius = 3.5 + rand() * 2;
  const height = 4 + rand() * 2;
  const tint = rand();
  const leaf = [48 + tint * 20, 106 + tint * 30, 62 - tint * 12];
  const blobs = [
    { x: -radius * 0.45, y: -height * 0.5, rx: radius * 0.7, ry: height * 0.6 },
    { x: radius * 0.45, y: -height * 0.45, rx: radius * 0.65, ry: height * 0.55 },
    { x: 0, y: -height * 0.75, rx: radius * 0.75, ry: height * 0.65 },
  ];
  const sample = (px, py) => {
    if (py > 0) return null;
    let best = null;
    for (const blob of blobs) {
      const nx = (px - blob.x) / blob.rx;
      const ny = (py - blob.y) / blob.ry;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const l = 0.5 - nx * 0.22 - ny * 0.28 + (1 - d2) * 0.12;
      if (!best || l > best.l) best = { m: 'leaf', l: Math.max(0, Math.min(1, l)), c: leaf };
    }
    return best;
  };
  return {
    kind: 'bush',
    x,
    y,
    footW: radius * 0.75 / ASPECT,
    footH: 1.5,
    cells: bakeFn(Math.ceil(radius * 1.2 / ASPECT), -Math.ceil(height * 1.5), 0, sample, seed,
      { shadow: { rx: radius, ry: 1.2, ox: radius * 0.2 } }),
  };
}

// Resample the baked image onto the destination grid. Each destination is
// visited once, so shrinking cannot stack cells and enlarging fills the image
// instead of leaving gaps between its original cells. A spot's layered cells
// travel with its base cell. The ground anchor stays at (0, 0), just as it
// does for procedural props.
// A copy of a cell keeps the way the original faced (see bakeSurface).
function withNormal(cell, from) {
  if (from.nx !== undefined) {
    cell.nx = from.nx;
    cell.ny = from.ny;
  }
  return cell;
}

function scaleCells(cells, scaleX, scaleY = scaleX) {
  if (scaleX === 1 && scaleY === 1) return cells;
  const source = new Map();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    const key = `${cell.dx},${cell.dy}`;
    if (!source.has(key)) source.set(key, []);
    source.get(key).push(cell);
    minX = Math.min(minX, cell.dx);
    maxX = Math.max(maxX, cell.dx);
    minY = Math.min(minY, cell.dy);
    maxY = Math.max(maxY, cell.dy);
  }
  const scaled = [];
  for (let dy = Math.ceil((minY - 0.5) * scaleY); dy <= Math.floor((maxY + 0.5) * scaleY); dy++) {
    for (let dx = Math.ceil((minX - 0.5) * scaleX); dx <= Math.floor((maxX + 0.5) * scaleX); dx++) {
      const group = source.get(`${Math.round(dx / scaleX)},${Math.round(dy / scaleY)}`);
      if (group) for (const c of group) scaled.push(makeCell(dx, dy, c.g, c.r, c.gg, c.b, c.br, c.bgG, c.bb,
        Number.isFinite(c.depth) ? c.depth * scaleY : undefined));
    }
  }
  return scaled;
}

// A bake that draws the prop at a different size by sampling its shape
// through a stretch, so textures and outlines stay one cell fine.
function scaledBaker(sx, sy, used) {
  if (sx === 1 && sy === 1) return (...args) => { used.baked = true; return bake(...args); };
  return (w, top, bottom, sample, seed, options = {}) => {
    used.baked = true;
    const shadow = options.shadow && { ...options.shadow, rx: options.shadow.rx * sx,
      ry: options.shadow.ry * sy, ox: (options.shadow.ox ?? options.shadow.rx * 0.25) * sx };
    const extras = options.extras?.map((e) => ({ ...e, dx: Math.round(e.dx * sx), dy: Math.round(e.dy * sy) }));
    return bake(Math.ceil(w * sx) + 1, Math.floor(top * sy) - 1, Math.ceil(bottom * sy),
      (px, py) => {
        const surface = sample(px / sx, py / sy);
        return Number.isFinite(surface?.depth) ? { ...surface, depth: surface.depth * sy } : surface;
      }, seed, { ...options, shadow, extras });
  };
}

// Builder props use their own seed so moving an item does not change its
// appearance. Keep generateProps below on its original random stream.
export function createProp(kind, x, y, options = {}) {
  const definition = propDefinition(kind);
  if (!definition) throw new TypeError(`Unknown scenery prop: ${kind}`);
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new TypeError('Scenery prop coordinates must be finite numbers');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Scenery prop options must be an object');
  }
  const { scale = 1, seed = 1, variant = 1, rotation = definition.defaultRotation ?? 0 } = options;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0.25 || scale > 3) {
    throw new RangeError('Scenery prop scale must be a number between 0.25 and 3');
  }
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError('Scenery prop seed must be a finite number');
  }
  if (variant !== 0 && variant !== 1) throw new RangeError('Unknown scenery variation version');
  if (!Number.isFinite(rotation)) throw new TypeError('Scenery prop rotation must be finite degrees');
  if (rotation && !isArchitectureKind(kind)) throw new RangeError('Only architecture props support rotation');
  const rand = mulberry32(seed);
  // Variation is decided first so the prop can be drawn at its final size.
  let width = 1;
  let height = 1;
  let brightness = 1;
  let warmth = 0;
  if (variant === 1) {
    const variation = mulberry32((seed >>> 0) ^ 0xa341316c);
    width = 0.9 + variation() * 0.22;
    height = 0.9 + variation() * 0.2;
    // Props are no longer mirrored: their light must keep coming from the
    // moon in the upper left. The draw is kept so the stream stays put.
    variation();
    brightness = 0.92 + variation() * 0.18;
    warmth = (variation() - 0.5) * 16;
  }
  const used = { baked: false };
  const bakeFn = scaledBaker(width * scale, height * scale, used);
  const make = { tree: makeBuilderTree, rock: variant === 0 ? makeRock : makeSceneryRock, bush: makeBuilderBush,
    'standing-stone': makeStandingStone, 'pale-caps': makePaleCaps }[kind];
  const prop = make ? make(x, y, rand, seed, bakeFn)
    : makeNaturalProp(kind, x, y, rand, seed, bakeFn) ?? makeCampProp(kind, x, y, rand, seed, bakeFn)
      ?? makeArchitectureProp(kind, x, y, rand, seed, bakeFn, rotation);
  if (!prop) throw new TypeError(`Scenery prop has no factory: ${kind}`);
  let cells = prop.cells;
  // Props composed glyph by glyph are resampled instead.
  if (!used.baked) cells = scaleCells(cells, width * scale, height * scale);
  if (variant === 1) {
    const shade = (value, offset = 0) => Math.max(0, Math.min(255, value * brightness + offset));
    const shadeAll = (list) => list.map((c) => withNormal(makeCell(c.dx, c.dy, c.g, shade(c.r, warmth), shade(c.gg),
      shade(c.b, -warmth), c.br, c.bgG, c.bb, c.depth), c));
    cells = shadeAll(cells);
    const fine = fineRecipe(prop);
    if (fine) withFine(prop, function* shaded() { return shadeAll(yield* fine()); });
  }
  // A worker remakes a builder prop from the same options.
  if (fineRecipe(prop)) withFine(prop, fineRecipe(prop), { make: 'prop', kind, x, y,
    options: { scale, seed, variant, ...(rotation ? { rotation } : {}) } });
  prop.cells = cells;
  prop.footW *= width;
  prop.footH *= height;
  prop.footW *= scale;
  prop.footH *= scale;
  // A tree's leaf masses: x and rx across, h and ry up.
  const canopy = canopyOf(prop);
  if (canopy) withCanopy(prop, canopy.map((v, i) => v * (i % 2 ? height : width) * scale));
  if (prop.unrotatedFootW !== undefined) prop.unrotatedFootW *= width * scale;
  // Composite footprints use local world coordinates, just like footW/H.
  // Scale both axes with the same variation and size used for the artwork.
  if (prop.collisionRects) {
    prop.collisionRects = prop.collisionRects.map(({ minX, maxX, minY, maxY }) => ({
      minX: minX * width * scale, maxX: maxX * width * scale,
      minY: minY * height * scale, maxY: maxY * height * scale,
    }));
  }
  if (prop.collisionPolygons) {
    prop.collisionPolygons = prop.collisionPolygons.map((polygon) => polygon.map(([dx, dy]) =>
      [dx * width * scale, dy * height * scale]));
  }
  // Culling must see the final image rather than the original.
  prop.bounds = cellBounds(prop.cells);
  prop.scale = scale;
  prop.seed = seed;
  prop.solid = definition.solid;
  prop.variant = variant;
  return prop;
}

// Reflected bounds are measured about this prop's own base. Do not cull
// source cells against the normal viewport when drawing a reflection.
export function propInView(view, prop, reflected = false, marginX = 3) {
  const b = prop.bounds;
  if (!b) return true;
  const x = Math.floor(prop.x) - view.x0;
  const y = Math.floor(prop.y) - view.y0;
  const top = reflected ? y - b.maxY + 1 : y + b.minY;
  const bottom = reflected ? y - b.minY + 1 : y + b.maxY;
  return x + b.maxX + marginX >= 0 && x + b.minX - marginX < view.cols && bottom >= 0 && top < view.rows;
}

// Makes a prop again from the source of its fine bake (see withFine). With
// `fineOnly` a tree skips its ordinary bake.
export function rebuildProp(source, fineOnly = false) {
  const draws = source.draws && replaying(source.draws);
  if (source.make === 'tree') return makeTree(source.x, source.y, draws ?? undefined, { ...source.options, fineOnly });
  if (source.make === 'rock') return makeRock(source.x, source.y, draws, source.seed);
  if (source.make === 'riverStone') return makeRiverStone(source.x, source.y, draws, source.seed);
  if (source.make === 'bigRock') return makeBigRock(source.x, source.y, draws, source.seed);
  if (source.make === 'ore') return makeOreBlock(source);
  if (source.make === 'prop') return createProp(source.kind, source.x, source.y, source.options);
  return null;
}

// Terrain-only queries are safe while a chunk's props are being generated.
// Never query props/isWalkable here: that would recurse into this generator.
export function nearWater(world, x, y) {
  for (let dy = -7; dy <= 7; dy++) {
    for (let dx = -11; dx <= 11; dx++) {
      if ((dx * ASPECT) ** 2 + dy * dy > 49) continue;
      if (world.typeAt(x + dx, y + dy) === WATER) return true;
    }
  }
  return false;
}

export function treeSpeciesAt(world, x, y) {
  const s = world.seed;
  const local = hash2(x, y, s + 715);
  if (nearWater(world, x, y) && local < 0.72) return 'willow';
  const warmth = fbm(x * ASPECT * 0.004, y * 0.004, s + 710, 3);
  const moisture = fbm(x * ASPECT * 0.004, y * 0.004, s + 711, 3);
  if (warmth < 0.4) return local < 0.2 ? 'pine' : moisture > 0.5 ? 'spruce' : 'pine';
  if (warmth > 0.6) return local < 0.15 ? 'oak' : moisture > 0.5 ? 'jungle' : 'acacia';
  const grove = fbm(x * ASPECT * 0.009, y * 0.009, s + 712, 3);
  if (grove > 0.6 && local < 0.85) return 'cherry';
  return (grove < 0.43) !== (local < 0.18) ? 'birch' : 'oak';
}

export function deadwoodConditionAt(world, x, y) {
  if (hash2(x, y, world.seed + 728) < 0.3 && nearWater(world, x, y)) return 'beaver';
  const history = hash2(x, y, world.seed + 727);
  if (history < 0.09) return 'fallen';
  if (history < 0.16) return 'snag';
  if (history < 0.24) return 'stump';
  return null;
}

// Only trees and rocks: a big rock now and then, and a sparse grid of
// mature trees. No bushes, saplings or deadwood.
export function generateProps(world, cx, cy, size) {
  const props = [];
  const seed = world.seed;
  // Big rocks first, at most one per chunk, so trees keep clear.
  const rocks = [];
  {
    const rand = mulberry32(Math.floor(hash2(cx, cy, seed + 2203) * 2 ** 32));
    if (rand() < 0.3) {
      // A base well inside the chunk, so the whole rock stays near its owner.
      const x = cx * size + 12 + Math.floor(rand() * (size - 24));
      const y = cy * size + 8 + Math.floor(rand() * (size - 12));
      const rock = makeBigRock(x + 0.5, y + 0.5, rand);
      const reach = rock.footW;
      const ground = [[0, 0], [-reach, 0], [reach, 0], [-reach * 0.5, -rock.footH], [reach * 0.5, -rock.footH],
        [0, rock.bounds.minY * 0.5]].every(([dx, dy]) => world.typeAt(Math.floor(x + dx), Math.floor(y + dy)) === GRASS);
      const clear = Math.hypot((x + 0.5 - world.spawn.x) * ASPECT, y + 0.5 - world.spawn.y) > 36 + reach * ASPECT + 8;
      if (ground && clear) {
        rocks.push(rock);
        props.push(rock);
        // One or two smaller boulders that split off lie against its foot.
        const fragments = 1 + Math.floor(rand() * 2);
        for (let i = 0; i < fragments; i++) {
          const side = rand() < 0.5 ? -1 : 1;
          const fx = x + side * (reach * (0.85 + rand() * 0.3) + 2);
          const fy = y + 1 + Math.floor(rand() * 3);
          const inChunk = Math.floor(fx / size) === cx && Math.floor(fy / size) === cy;
          if (inChunk && world.typeAt(Math.floor(fx), Math.floor(fy)) === GRASS) props.push(makeRock(Math.floor(fx) + 0.5, fy + 0.5, rand));
        }
      }
    }
  }
  // Widely spaced trees, standing alone or in small loose groups.
  const stepX = 42;
  const stepY = 28;
  for (let gy = 0; gy < size; gy += stepY) {
    for (let gx = 0; gx < size; gx += stepX) {
      const ox = cx * size + gx;
      const oy = cy * size + gy;
      const rand = mulberry32(Math.floor(hash2(ox, oy, seed + 61) * 2 ** 32));
      // The last grid slot can be smaller than stepX. Keep every base in
      // its owning chunk so collision queries still find it near a seam.
      const x = ox + Math.floor(rand() * Math.min(stepX, size - gx));
      const y = oy + Math.floor(rand() * Math.min(stepY, size - gy));
      if (world.typeAt(x, y) !== GRASS) continue;
      // Keep the spawn clearing open.
      if (Math.hypot((x + 0.5 - world.spawn.x) * ASPECT, y + 0.5 - world.spawn.y) < 36) continue;
      if (rocks.length && underBigRock(rocks, x + 0.5, y + 0.5)) continue;

      const forest = fbm(x * ASPECT * 0.01, y * 0.01, seed + 500, 3);
      if (rand() < Math.max(0, forest - 0.44) * 0.2) {
        props.push(makeTree(x + 0.5, y + 0.5, rand, { species: treeSpeciesAt(world, x, y), season: world.season, seed }));
      }
    }
  }
  return props;
}

// What is left of a felled tree: a sawn top showing its growth rings,
// a collar of bark, flared roots and fresh chips on the ground around it.
// Three rows at most, baked once per tree.
const stumps = new WeakMap();
const CUT_WOOD = [204, 166, 112];
const STUMP_BARK = { birch: [190, 192, 188], cherry: [128, 84, 74], acacia: [134, 108, 82],
  pine: [120, 86, 62], spruce: [108, 80, 60], willow: [118, 104, 82] };

function stumpCells(prop) {
  let cells = stumps.get(prop);
  if (cells) return cells;
  cells = [];
  const seed = Math.floor((prop.x * 31 + prop.y * 17) * 7) | 0;
  const half = Math.max(1, Math.min(3, Math.round((prop.footW ?? 2) * 0.75)));
  const bark = STUMP_BARK[prop.species] ?? [128, 92, 62];
  const birch = prop.species === 'birch';
  const put = (dx, dy, g, c, k = 1, back = 0) => cells.push(makeCell(dx, dy, g, c[0] * k, c[1] * k, c[2] * k,
    back ? c[0] * back : undefined, back ? c[1] * back : undefined, back ? c[2] * back + 2 : undefined));
  // The sawn face, with rings around a pith a little off centre.
  for (let dx = -half; dx <= half; dx++) {
    const edge = Math.abs(dx) === half;
    if (edge) {
      put(dx, -2, dg(`props.cut.s.${dx < 0 ? 1 : 3}.2`), CUT_WOOD, dx < 0 ? 1 : 0.7);
      continue;
    }
    const g = ringGlyph(-dx / half, 0.25, seed, dx, -2);
    put(dx, -2, g, CUT_WOOD, 1.02 - (dx + half) / (half * 2) * 0.22, 0.45);
  }
  // A crack across the face.
  if (half > 1) cells.push(makeCell(Math.round(hash2(seed, 1, 3) * 2 - 1), -2, over(dg('props.fissure.2.0')), 70, 48, 34));
  // The bark collar, lit on the left.
  for (let dx = -half; dx <= half; dx++) {
    const t = (dx + half) / (half * 2);
    const g = birch ? dg(`props.birch.${(dx + 4) % 4}`) : dg(`props.bark.${Math.max(0, 3 - Math.round(t * 3))}.${(dx + 8) % 4}`);
    put(dx, -1, g, bark, 1.15 - t * 0.55, 0.28);
  }
  // Moss or a fungus bracket on the shaded side of older stumps.
  if (hash2(seed, 2, 5) < 0.5) cells.push(makeCell(half, -1, over(dg(`props.fungus.${seed & 1}`)), 168, 146, 108));
  // Roots flare into the ground.
  for (let dx = -half - 1; dx <= half + 1; dx++) {
    const outer = Math.abs(dx) > half;
    const t = (dx + half + 1) / (half * 2 + 2);
    if (outer) put(dx, 0, dg(`props.cut.r.${dx < 0 ? 7 : 5}.0`), bark, 0.95 - t * 0.4);
    else put(dx, 0, dg(`props.barkh.${dx < 0 ? 2 : 1}.${(dx + 8) % 4}`), bark, 0.9 - t * 0.45, 0.25);
  }
  // Chips thrown about by the axe.
  for (let k = 0; k < 4; k++) {
    const dx = (k % 2 ? 1 : -1) * (half + 2 + Math.floor(hash2(seed, k, 9) * 3));
    const dy = -Math.floor(hash2(seed, k, 11) * 2);
    cells.push(makeCell(dx, dy, over(dg(`props.chips.${k}`)), 200, 166, 112));
  }
  stumps.set(prop, cells);
  return cells;
}

// Sprites are immutable between edits. Index contiguous rows without
// reordering their cells: base glyphs and their layers keep painter order.
// Weak keys let this index disappear with evicted chunks and edited sprites.
const spriteRows = new WeakMap();
const depthSlices = new WeakMap();

// Interleave these immutable cell subsets with actors/grass at prop.y + depth.
// Quarter-row bands bound sorting work while preserving each spot's painter
// order. Cache by the source cells so replacing a bake invalidates the slices.
export function propDepthSlices(prop) {
  const cells = prop.cells;
  const cached = depthSlices.get(cells);
  if (cached?.length === cells.length) return cached.slices;
  let slices = null;
  if (cells.some((c) => Number.isFinite(c.depth))) {
    const bands = new Map();
    let lastDx, lastDy, lastDepth;
    for (const cell of cells) {
      const layered = cell.g >= LAYER && cell.dx === lastDx && cell.dy === lastDy;
      const depth = layered ? lastDepth : Math.round((Number.isFinite(cell.depth) ? cell.depth : 0) * 4) / 4 || 0;
      if (!bands.has(depth)) bands.set(depth, []);
      bands.get(depth).push(cell);
      lastDx = cell.dx;
      lastDy = cell.dy;
      lastDepth = depth;
    }
    slices = [...bands].sort(([a], [b]) => a - b).map(([depth, cells]) => ({ depth, cells }));
  }
  depthSlices.set(cells, { length: cells.length, slices });
  return slices;
}

function rowsOf(cells) {
  let cached = spriteRows.get(cells);
  if (cached?.length === cells.length) return cached.rows;
  const rows = [];
  for (let start = 0; start < cells.length;) {
    const y = cells[start].dy;
    let end = start;
    let left = Infinity, right = -Infinity, flex = 0;
    while (end < cells.length && cells[end].dy === y) {
      const c = cells[end++];
      left = Math.min(left, c.dx);
      right = Math.max(right, c.dx);
      if (c.foliage) flex = Math.max(flex, Math.abs(c.flex));
    }
    const pad = Math.ceil(flex * 1.5);
    rows.push({ start, end, y, left: left - pad, right: right + pad });
    start = end;
  }
  spriteRows.set(cells, { length: cells.length, rows });
  return rows;
}

// The moon, up and to the left in front of the viewer, throws a tree's
// shadow back and to the right over the ground around its foot. The grass
// there, already drawn, is darkened rather than replaced; grass drawn in
// front of the tree afterwards stays in the light.
function groundShadow(r, view, prop, bx, by) {
  const rx = prop.footW * 2.4;
  const ry = Math.max(1.2, prop.footH * 1.4);
  const ox = prop.footW * 0.9;
  const oy = -ry * 0.45;
  for (let dy = Math.floor(oy - ry); dy <= 0; dy++) {
    const sy = by + dy;
    if (sy < 0 || sy >= view.rows) continue;
    for (let dx = Math.floor(ox - rx); dx <= Math.ceil(ox + rx); dx++) {
      const sx = bx + dx;
      if (sx < 0 || sx >= view.cols) continue;
      const nx = (dx - ox) / rx;
      const ny = (dy - oy) / ry;
      const d = nx * nx + ny * ny;
      if (d >= 1) continue;
      shade(r, (sy * r.cols + sx) * 4, 0.6 * (1 - d) ** 1.5);
    }
  }
}

// Rows above its base where a prop's outline of nothing starts, and over
// how many more rows it grows to full strength.
const GROUND_HALO = 1;
const HALO_RISE = 3;
const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const GLOSS_BYTE = [GLOSS_DRY, GLOSS_DAMP, GLOSS_WET].map(glossByte);
const GROUND_FG = [0, 0, 0];
const GROUND_BG = [0, 0, 0];

// Draws a prop's fine bake (see fine-bakes.js) into the renderer's small
// cells, with its ground cells beneath it on the ordinary grid.
function drawFine(r, view, prop, baked, t, player, seed, bx, by) {
  const { cells: p, ground } = baked;
  if (prop.kind === 'tree') groundShadow(r, view, prop, bx, by);
  // The prop's ground cells (its pebbles, its baked contact shadow) replace
  // ground a tree's shadow has already darkened or a moonbeam lit: they
  // take the same light as they go down, once (see night-light.js).
  const night = r.night;
  for (const c of ground) {
    const sy = by + c.dy;
    if (sy < 0 || sy >= view.rows) continue;
    const wx = view.x0 + bx + c.dx, wy = view.y0 + sy;
    const k = night ? night.lightAt(wx, wy) : 1;
    const t = night ? night.tint : 0;
    if (k === 1 && t === 0) putCell(r, bx + c.dx, sy, c.g, c.r, c.gg, c.b, by, c.br, c.bgG, c.bb);
    else {
      const [cr, cg, cb] = tintRgb(GROUND_FG, c.r * k, c.gg * k, c.b * k, t);
      if (c.br === undefined) putCell(r, bx + c.dx, sy, c.g, cr, cg, cb, by, undefined, c.bgG * k, c.bb * k);
      else {
        const [br, bgG, bb] = tintRgb(GROUND_BG, c.br * k, c.bgG * k, c.bb * k, t);
        putCell(r, bx + c.dx, sy, c.g, cr, cg, cb, by, br, bgG, bb);
      }
    }
  }
  const tree = prop.kind === 'tree' || prop.kind === 'bush';
  const sway = tree ? treeWind(prop, t, seed) * FINE : 0;
  const gust = tree ? windGust(seed, prop.x, prop.y, t) : 0;
  const sin = tree ? Math.sin(t * 1.4) : 0;
  const cos = tree ? Math.cos(t * 1.4) : 0;
  const sheen = Math.max(0, gust - 0.55) * 0.18;
  const reveal = player && prop.y > player.y ? player.foliageBounds : null;
  const burn = prop.burning ? prop.burning.progress : 0;
  const char = 1 - burn * 0.85;
  // Small cell (FINE * bx + dx + FINE / 2, FINE * (by + 1) + dy - 1) is the
  // one whose middle lies over the prop's own point dx, dy (see bake).
  const fx0 = FINE * bx + (FINE >> 1);
  const fy0 = FINE * (by + 1) - 1;
  const top = -fy0;
  const bottom = view.rows * FINE - fy0;
  const right = view.cols * FINE - fx0;
  const { dx: cdx, dy: cdy, g: cg, rustle, color, back, solid, foliage, flex, phaseSin, phaseCos, rows, normal, bump } = p;
  // How glossy a rock's stone is: wet in a river, damp by the water.
  const gloss = bump ? GLOSS_BYTE[prop.wet ? 2 : prop.damp ? 1 : 0] : 0;
  let lastDx = 0;
  let lastDy = 0;
  let lastShift = 0;
  let lastHidden = true;
  for (let q = 0; q < rows.length; q += 5) {
    const y = rows[q + 2];
    // The outline of nothing fades out toward the ground the prop stands
    // on: none at its foot, all of it a few rows up.
    const halo = Math.round(15 * clamp((-y / FINE - GROUND_HALO) / HALO_RISE));
    if (y < top || y >= bottom || rows[q + 4] < -fx0 || rows[q + 3] >= right) {
      lastDx = lastDy = NaN;
      lastHidden = true;
      continue;
    }
    for (let i = rows[q]; i < rows[q + 1]; i++) {
      const g = cg[i];
      let shift = 0;
      if (g >= LAYER && cdx[i] === lastDx && cdy[i] === lastDy) {
        if (lastHidden) continue;
        shift = lastShift;
      } else {
        lastDx = cdx[i];
        lastDy = cdy[i];
        lastHidden = true;
        if (foliage[i]) shift = Math.round(sway * flex[i]);
        lastShift = shift;
      }
      const dx = cdx[i] + shift;
      if (foliage[i] && reveal && g < LAYER) {
        const nx = (Math.floor(prop.x) + dx / FINE - reveal.x) / reveal.rx;
        const ny = (Math.floor(prop.y) + y / FINE - reveal.y) / reveal.ry;
        const d2 = nx * nx + ny * ny;
        if (d2 < 1 && hash2(cdx[i], y, prop.textureSeed) < (1 - d2) * 0.93) continue;
      }
      if (g < LAYER) lastHidden = false;
      const k = i * 3;
      const br = solid[i] ? back[k] : undefined;
      if (!foliage[i]) {
        if (gloss && bump[i]) {
          r.fineAt(fx0 + dx, fy0 + y, g, color[k], color[k + 1], color[k + 2], br, back[k + 1], back[k + 2], halo,
            normal[i * 2], normal[i * 2 + 1], gloss, y < 0 ? Math.min(255, -y) : 0);
        } else r.fineAt(fx0 + dx, fy0 + y, g, color[k], color[k + 1], color[k + 2], br, back[k + 1], back[k + 2], halo);
        continue;
      }
      const flutter = sin * phaseCos[i] + cos * phaseSin[i];
      const light = 1 + flutter * 0.035 + sheen;
      const ch = flutter > 0.94 && gust > 0.58 ? rustle[i] : g;
      let red = color[k] * light, green = color[k + 1] * light, blue = color[k + 2] * light;
      if (burn) {
        const ember = burn * prop.burning.heat * (0.7 + Math.sin(t * 7 + cdx[i] + y) * 0.3);
        red = red * char + 95 * ember;
        green = green * char + 26 * ember;
        blue *= char;
      }
      r.fineAt(fx0 + dx, fy0 + y, ch, red, green, blue, br, back[k + 1], back[k + 2], halo);
    }
  }
}

export function drawProp(r, view, prop, write = putCell, t = 0, player = null, seed = 1, reflected = false, cells = prop.cells) {
  const direct = write === putCell;
  if (direct && !propInView(view, prop)) return;
  const bx = Math.floor(prop.x) - view.x0;
  const by = Math.floor(prop.y) - view.y0;
  const baked = cells === prop.cells && direct && r.fine && !prop.chopped ? fineOf(prop, true) : null;
  if (baked) {
    drawFine(r, view, prop, baked, t, player, seed, bx, by);
    return;
  }
  if (prop.chopped) {
    for (const c of stumpCells(prop)) {
      const char = prop.burnt ? 0.24 : 1;
      write(r, bx + c.dx, by + c.dy, c.g, c.r * char, c.gg * char, c.b * char, by,
        c.br === undefined ? undefined : c.br * char, c.bgG === undefined ? undefined : c.bgG * char,
        c.bb === undefined ? undefined : c.bb * char);
    }
    return;
  }
  const bounds = prop.bounds;
  if (write.visible && bounds && !write.visible(r, bx + bounds.minX - 3, by + bounds.minY,
    bx + bounds.maxX + 3, by + bounds.maxY, by)) return;
  const tree = prop.kind === 'tree' || prop.kind === 'bush';
  const sway = tree ? treeWind(prop, t, seed) : 0;
  const gust = tree ? windGust(seed, prop.x, prop.y, t) : 0;
  const sin = tree ? Math.sin(t * 1.4) : 0;
  const cos = tree ? Math.cos(t * 1.4) : 0;
  const sheen = Math.max(0, gust - 0.55) * 0.18;
  // The figure has already been drawn when its base is behind this tree.
  // Stable local dither lets it show through nearby leaves without changing
  // the renderer's glyph index channel or punching holes in solid wood.
  const reveal = player && prop.y > player.y ? player.foliageBounds : null;
  // A layered cell follows the base cell before it at the same spot: it
  // sways with it and is hidden with it.
  let lastDx = 0;
  let lastDy = 0;
  let lastShift = 0;
  let lastHidden = true;
  for (const row of rowsOf(cells)) {
    const sy = by + row.y;
    if ((direct && (sy < 0 || sy >= view.rows || bx + row.right < 0 || bx + row.left >= view.cols)) ||
      (reflected && (by - row.y + 1 < 0 || by - row.y + 1 >= view.rows)) ||
      (write.visible && !write.visible(r, bx + row.left, sy, bx + row.right, sy, by))) {
      lastDx = lastDy = NaN;
      lastHidden = true;
      continue;
    }
    for (let i = row.start; i < row.end; i++) {
      const c = cells[i];
      let shift = 0;
      if (c.g >= LAYER && c.dx === lastDx && c.dy === lastDy) {
        if (lastHidden) continue;
        shift = lastShift;
      } else {
        lastDx = c.dx;
        lastDy = c.dy;
        lastHidden = true;
        if (c.foliage) shift = Math.round(sway * c.flex);
        lastShift = shift;
      }
      const sy = by + c.dy;
      // Reject invisible rows before calculating foliage lighting or texture.
      // Reflections need source rows above the view, measured about the base.
      if (direct && (sy < 0 || sy >= view.rows)) continue;
      if (reflected && (by - c.dy + 1 < 0 || by - c.dy + 1 >= view.rows)) continue;
      const dx = c.dx + shift;
      const sx = bx + dx;
      if ((direct || reflected) && (sx < -1 || sx >= view.cols + 1)) continue;
      if (c.foliage && reveal && c.g < LAYER) {
        const nx = (Math.floor(prop.x) + dx - reveal.x) / reveal.rx;
        const ny = (Math.floor(prop.y) + c.dy - reveal.y) / reveal.ry;
        const d2 = nx * nx + ny * ny;
        if (d2 < 1 && hash2(c.dx, c.dy, prop.textureSeed) < (1 - d2) * 0.93) continue;
      }
      if (c.g < LAYER) lastHidden = false;
      if (!c.foliage) {
        write(r, sx, sy, c.g, c.r, c.gg, c.b, by, c.br, c.bgG, c.bb);
        continue;
      }
      const flutter = sin * c.phaseCos + cos * c.phaseSin;
      const light = 1 + flutter * 0.035 + sheen;
      const ch = flutter > 0.94 && gust > 0.58 && c.rustle !== undefined ? c.rustle | (c.g & LAYER) : c.g;
      let red = c.r * light, green = c.gg * light, blue = c.b * light;
      if (prop.burning) {
        const burn = prop.burning.progress;
        const char = 1 - burn * 0.85;
        const ember = burn * prop.burning.heat * (0.7 + Math.sin(t * 7 + c.dx + c.dy) * 0.3);
        red = red * char + 95 * ember;
        green = green * char + 26 * ember;
        blue *= char;
      }
      write(r, sx, sy, ch, red, green, blue, by, c.br, c.bgG, c.bb);
    }
  }
}

export function blocks(prop, x, y) {
  if (prop.chopped) return false;
  if (prop.solid === false) return false;
  // Wild shrubs are soft; a builder bush is placed as an obstacle.
  if (prop.kind === 'bush' && prop.solid !== true) return false;
  if (prop.kind === 'deadwood') return deadwoodBlocks(prop, x, y);
  if (prop.collisionPolygons) {
    const dx = x - prop.x, dy = y - prop.y;
    return prop.collisionPolygons.some((polygon) => {
      let sign = 0;
      for (let i = 0; i < polygon.length; i++) {
        const [ax, ay] = polygon[i], [bx, by] = polygon[(i + 1) % polygon.length];
        const cross = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
        // Match rectangle collision's open boundary, tolerating yaw roundoff.
        if (Math.abs(cross) <= 1e-9) return false;
        const side = Math.sign(cross);
        if (sign && sign !== side) return false;
        sign = side;
      }
      return polygon.length >= 3;
    });
  }
  if (prop.collisionRects) {
    const dx = x - prop.x;
    const dy = y - prop.y;
    return prop.collisionRects.some(({ minX, maxX, minY, maxY }) =>
      dx > minX && dx < maxX && dy > minY && dy < maxY);
  }
  const dx = (x - prop.x) / prop.footW;
  const dy = (y - prop.y) / prop.footH;
  return dx * dx + dy * dy < 1;
}
