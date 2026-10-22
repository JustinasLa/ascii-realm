const WHITE = [242, 253, 255];
const ICE = [207, 249, 255];
const EDGE = [99, 210, 255];
const FROST = [119, 181, 220];
const DEEP = [62, 126, 204];
const RAMP = '.:-=+*#%@';
// Screen cells per local metre (SCALE 13 / ASPECT and SCALE * TILT); strokes and
// line sampling follow the projected direction so a rotated shard keeps its edges.
const COLS = 26;
const ROWS = 6.5;
const TAU = Math.PI * 2;
const STAR = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const FLAKE = [[0, -1], [1, -1], [1, 1], [0, 1], [-1, 1], [-1, -1]];

function bounded(value, fallback, min, max) {
  const number = Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : min;
  return Math.max(min, Math.min(max, number));
}
const clamp01 = value => value < 0 ? 0 : value > 1 ? 1 : value;
const smooth = (from, to, value) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const easeOut = (t, power = 3) => 1 - (1 - clamp01(t)) ** power;
const hash = (index, salt = 0) => {
  const s = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const mix = (a, b, t) => {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
};
const ramp = value => RAMP[Math.min(RAMP.length - 1, Math.floor(clamp01(value) * RAMP.length))];

const strokeCells = (cx, cy) => {
  const ax = Math.abs(cx), ay = Math.abs(cy);
  if (ay < ax * 0.36) return '-';
  if (ax < ay * 0.5) return '|';
  return cx * cy > 0 ? '\\' : '/';
};

function view(heading) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const screen = (x, z) => [(x * c + z * s) * COLS, (z * c - x * s) * ROWS];
  return {
    screen,
    // Glyph whose stroke follows the local direction once projected to cells.
    stroke(x, z) {
      const [cx, cy] = screen(x, z);
      return strokeCells(cx, cy);
    },
    // Chevron pointing along a local direction on screen.
    point(x, z) {
      const [cx, cy] = screen(x, z);
      if (Math.abs(cy) * 2 > Math.abs(cx)) return cy > 0 ? 'v' : '^';
      return cx > 0 ? '>' : '<';
    },
    cells(x, z) {
      const [cx, cy] = screen(x, z);
      return Math.hypot(cx, cy);
    },
    // Screen-aligned metres (east, south) back into the local frame.
    local(wx, wz) { return [wx * c - wz * s, wx * s + wz * c]; },
  };
}

// Plot on whole screen cells around a local anchor: (dx, dy) are column/row
// offsets, sampled at cell centres so neighbouring glyphs never share a cell.
function lattice(v, x, z, plot) {
  const [sx, sy] = v.screen(x, z);
  const ox = Math.floor(sx) + 0.5, oy = Math.floor(sy) + 0.5;
  return (dx, dy, char, color, light) => {
    const [lx, lz] = v.local((ox + dx) / COLS, (oy + dy) / ROWS);
    plot(lx, lz, char, color, light);
  };
}

// Projectile: a spinning hexagonal ice spike, rasterised one glyph per cell,
// with a sweeping glint, side speed lines and a wake of frost motes shed behind.
function shard(effect, plot, v) {
  const age = bounded(effect.age, 0, 0, 3600);
  const fade = clamp01((1 - effect.progress) * 8);
  const k = bounded(effect.radius, 0.65, 0.3, 1.2) / 0.65 * (0.55 + 0.45 * easeOut(age / 0.08, 2));
  const tail = -0.5 * k, tip = 0.8 * k, half = 0.2 * k, length = tip - tail;
  const spin = age * 13;
  const breadth = 0.72 + 0.28 * Math.abs(Math.cos(spin));
  const ridge = Math.sin(spin) * 0.45;
  const glint = (age * 2.6) % 1 * 1.5 - 0.25;
  const profile = s => s < 0.22 ? 0.35 + 0.65 * s / 0.22
    : s < 0.62 ? 1 - 0.12 * (s - 0.22) / 0.4 : 0.88 * (1 - s) / 0.38;

  // Hexagonal spike outline projected to screen cells, then filled one glyph per
  // cell so the silhouette stays solid at every heading without over-plotting.
  const b = half * breadth;
  const outline = [[0, tip], [0.88 * b, tail + 0.62 * length], [b, tail + 0.22 * length],
    [0.35 * b, tail], [-0.35 * b, tail], [-b, tail + 0.22 * length], [-0.88 * b, tail + 0.62 * length]]
    .map(([x, z]) => v.screen(x, z));
  const corners = outline.length;
  const edges = new Float64Array(corners * 4);
  let area = 0, minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (let i = 0; i < corners; i++) {
    const [ax, ay] = outline[i], [bx, by] = outline[(i + 1) % corners];
    edges[i * 4] = ax; edges[i * 4 + 1] = ay; edges[i * 4 + 2] = bx - ax; edges[i * 4 + 3] = by - ay;
    area += ax * by - bx * ay;
    minX = Math.min(minX, ax); maxX = Math.max(maxX, ax);
    minY = Math.min(minY, ay); maxY = Math.max(maxY, ay);
  }
  const sign = area < 0 ? -1 : 1;
  const inside = (px, py) => {
    for (let i = 0; i < corners * 4; i += 4) {
      if ((edges[i + 2] * (py - edges[i + 1]) - edges[i + 3] * (px - edges[i])) * sign < 0) return false;
    }
    return true;
  };
  const x0 = Math.max(-40, Math.floor(minX)), x1 = Math.min(40, Math.ceil(maxX));
  const y0 = Math.max(-14, Math.floor(minY)), y1 = Math.min(14, Math.ceil(maxY));
  let painted = 0;
  for (let cy = y0; cy <= y1 && painted < 78; cy++) {
    for (let cx = x0; cx <= x1 && painted < 78; cx++) {
      // Sample cell centres so the lattice never straddles a cell boundary.
      const px = cx + 0.5, py = cy + 0.5;
      if (!inside(px, py)) continue;
      const [x, z] = v.local(px / COLS, py / ROWS);
      const s = clamp01((z - tail) / length);
      const shine = Math.exp(-(((s - glint) / 0.09) ** 2));
      painted++;
      if (!inside(px - 1, py) || !inside(px + 1, py) || !inside(px, py - 1) || !inside(px, py + 1)) {
        let best = Infinity, glyph = '|';
        for (let i = 0; i < corners * 4; i += 4) {
          const ax = edges[i], ay = edges[i + 1], ex = edges[i + 2], ey = edges[i + 3];
          const t = clamp01(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1));
          const gx = ax + ex * t - px, gy = (ay + ey * t - py) * 2;
          const d = gx * gx + gy * gy;
          if (d < best) { best = d; glyph = strokeCells(ex, ey); }
        }
        plot(x, z, glyph, mix(EDGE, WHITE, shine * 0.8), fade * (0.78 + 0.22 * shine));
        continue;
      }
      const u = x / Math.max(0.01, profile(s) * b);
      const facet = 1 - Math.min(1, Math.abs(u - ridge));
      const light = clamp01(0.22 + 0.36 * facet + 0.14 * s + 0.38 * shine);
      plot(x, z, ramp(light), mix(EDGE, WHITE, light), fade * (0.55 + 0.45 * light));
    }
  }
  plot(0, tip, v.point(0, 1), WHITE, fade);

  for (const side of [-1, 1]) {
    const scroll = (age * 7 + (side > 0 ? 0.5 : 0)) % 1;
    for (let step = 0; step < 4; step++) {
      const d = (step + scroll) / 4;
      plot(side * half * 1.25, tail + 0.25 * k - d * 0.95 * k, v.stroke(0, 1), mix(ICE, FROST, d),
        fade * 0.55 * (1 - d) ** 1.4);
    }
  }

  for (let mote = 0; mote < 20; mote++) {
    const t = (age * 3.2 + hash(mote, 1)) % 1;
    const z = tail - 0.04 - t * 1.6 * k * (0.6 + 0.4 * hash(mote, 2));
    const x = (hash(mote, 3) - 0.5) * half * 1.6 * (1 + 2.2 * t) + Math.sin(age * 7 + mote * 1.7) * 0.05 * t;
    const light = (1 - t) ** 1.6;
    plot(x, z, light > 0.6 ? '*' : light > 0.3 ? ':' : '.', mix(ICE, DEEP, t), fade * 0.85 * light);
  }
}

// Shatter: a white flash and a starburst of straight ice spikes that crack off
// from the tips, tumbling fragments with drag, a frost shock ring on the ground
// sized to the effect radius and lingering frost mist.
function shatter(effect, plot, v, radius) {
  const p = effect.progress;
  const fade = (1 - p) ** 0.9;
  const at = lattice(v, 0, 0, plot);
  const flash = (1 - smooth(0, 0.28, p)) * fade;
  if (flash > 0.01) {
    at(0, 0, '@', WHITE, flash);
    for (const [cx, cy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) at(cx, cy, '#', ICE, flash * 0.85);
  }

  const grow = easeOut(p / 0.1, 3);
  const crumble = smooth(0.28, 0.8, p);
  for (let ray = 0; ray < STAR.length; ray++) {
    const [ax, ay] = STAR[ray];
    const jag = 0.7 + 0.5 * hash(ray, 1);
    const base = (1.6 + radius * 1.6) * jag;
    const steps = Math.max(2, Math.min(ay ? 8 : 14, Math.round(ay ? (ax ? base * 0.9 : base) : base * 2)));
    const glyph = strokeCells(ax, ay);
    const keep = 1.02 - crumble * (0.85 + 0.3 * hash(ray, 2));
    for (let step = 1; step <= steps; step++) {
      const q = step / steps;
      if (q > grow + 0.01 || q > keep - 0.12 * crumble * hash(ray * 13 + step, 3)) break;
      const tip = step === steps || (step + 1) / steps > Math.min(grow + 0.01, keep);
      const glint = Math.exp(-(((q - p * 4) / 0.22) ** 2));
      at(ax * step, ay * step, tip ? '*' : glyph, mix(WHITE, EDGE, q * 0.7 - glint * 0.5),
        fade * (tip ? 1 : 0.7 + 0.3 * Math.max(glint, 1 - q)));
    }
  }

  const drift = (1 - Math.exp(-5 * p)) / (1 - Math.exp(-5));
  for (let shard = 0; shard < 18; shard++) {
    const a = shard / 18 * TAU + hash(shard, 7) * 0.35;
    const d = radius * (0.08 + (0.25 + 0.3 * hash(shard, 8)) * drift);
    const tumble = a + p * (hash(shard, 9) - 0.5) * 16;
    const light = fade * (0.6 + 0.4 * hash(shard, 10)) * smooth(0, 0.06, p);
    plot(Math.sin(a) * d, Math.cos(a) * d, v.stroke(Math.sin(tumble), Math.cos(tumble)),
      mix(WHITE, FROST, p * 1.2), light);
    const behind = d - radius * 0.06;
    plot(Math.sin(a) * behind, Math.cos(a) * behind, '.', FROST, light * 0.5);
  }

  // The shock ring is laid down as short contiguous dashes along its tangent.
  const ring = radius * (0.2 + 0.8 * easeOut(p, 3));
  const ringLight = 0.85 * (1 - p) ** 2;
  for (let dash = 0; dash < 16; dash++) {
    const a = dash / 16 * TAU + 0.1;
    if (hash(dash, 11) < smooth(0.45, 1, p) * 0.7) continue;
    const r = ring * (1 + 0.06 * Math.cos(6 * a));
    const [tx, ty] = v.screen(Math.cos(a), -Math.sin(a));
    const glyph = strokeCells(tx, ty);
    const [sx, sy] = glyph === '-' ? [1, 0] : glyph === '|' ? [0, 1] : glyph === '/' ? [1, -1] : [1, 1];
    const dashAt = lattice(v, Math.sin(a) * r, Math.cos(a) * r, plot);
    for (let step = -1; step <= 1; step++) {
      dashAt(sx * step, sy * step, glyph, mix(ICE, FROST, p + Math.abs(step) * 0.2), ringLight * (step ? 0.7 : 1));
    }
  }

  for (let mote = 0; mote < 14; mote++) {
    const a = hash(mote, 12) * TAU;
    const r = radius * (0.15 + 0.4 * hash(mote, 13)) * (0.6 + 0.4 * drift);
    const twinkle = 0.6 + 0.4 * Math.sin(p * 18 + mote * 2.1);
    plot(Math.sin(a) * r, Math.cos(a) * r, mote % 3 ? '.' : ':', FROST,
      fade * 0.5 * twinkle * smooth(0.05, 0.3, p));
  }
}

// Trail tick: a small cluster of twinkling frost left hanging where the shard passed.
function frostPuff(effect, plot, v, radius) {
  const p = effect.progress;
  const fade = (1 - p) ** 1.2;
  for (let step = 0; step < 6; step++) {
    if (hash(step, 21) < p * 1.1) continue;
    const z = (step / 5 - 0.5) * radius * 0.7;
    plot(0, z, v.stroke(0, 1), mix(ICE, FROST, p), fade * 0.5 * (1 - Math.abs(step / 5 - 0.5)));
  }
  for (let mote = 0; mote < 14; mote++) {
    const big = mote < 7;
    const a = hash(mote, 22) * TAU;
    const spread = radius * (big ? 0.28 : 0.45) * (0.4 + 0.6 * hash(mote, 23)) * (1 + 0.6 * p);
    const x = Math.cos(a) * spread * 0.6;
    const z = Math.sin(a) * spread - p * radius * 0.25;
    const twinkle = 0.55 + 0.45 * Math.sin(p * 14 + hash(mote, 24) * TAU);
    const light = fade * twinkle * (big ? 0.9 : 0.45);
    plot(x, z, big ? (light > 0.5 ? '*' : '+') : '.', mix(WHITE, DEEP, p * 0.7 + (big ? 0 : 0.3)), light);
  }
}

// Cast: frost snaps inward, flashes into a six-armed crystal that blooms in front
// of the caster, flings a cone of needles forward, then sublimates into motes.
function bloom(effect, plot, v, radius) {
  const p = effect.progress;
  const fade = (1 - p) ** 0.7;
  const cz = radius * 0.32;

  const gather = 1 - smooth(0.1, 0.17, p);
  if (gather > 0.01) {
    const k = clamp01(p / 0.14);
    for (let mote = 0; mote < 14; mote++) {
      const a = mote / 14 * TAU + hash(mote, 31) * 0.4 + (1 - k) * 1.4;
      const r = radius * (0.22 + 1.15 * (1 - k * k));
      plot(Math.sin(a) * r, cz + Math.cos(a) * r, k > 0.6 ? '*' : ':', mix(FROST, WHITE, k),
        gather * (0.35 + 0.65 * k));
    }
  }

  const at = lattice(v, 0, cz, plot);
  const flash = Math.exp(-(((p - 0.13) / 0.07) ** 2));
  if (flash > 0.02) {
    at(0, 0, '@', WHITE, flash);
    for (const [cx, cy] of [[1, 0], [-1, 0], [2, 0], [-2, 0], [0, 1], [0, -1]]) {
      at(cx, cy, Math.abs(cx) === 2 ? '+' : '#', ICE, flash * (Math.abs(cx) === 2 ? 0.6 : 0.85));
    }
  }

  // The crystal faces the camera and is laid out on whole screen cells: a
  // vertical spine plus four 1:1 diagonals reads as an upright hexagonal flake.
  const grow = easeOut((p - 0.07) / 0.2, 3);
  if (grow > 0) {
    const size = radius * 7.5 * (grow + 0.14 * Math.sin(Math.PI * grow));
    const retract = smooth(0.42, 0.96, p);
    const reach = (ray, q) => q <= 1.02 - retract * (0.9 + 0.2 * hash(ray, 32));
    for (let ray = 0; ray < 6; ray++) {
      const [ax, ay] = FLAKE[ray];
      const steps = Math.max(1, Math.min(9, Math.round(ax ? size * 0.9 : size)));
      const glyph = ax === 0 ? '|' : ax * ay > 0 ? '\\' : '/';
      for (let step = 1; step <= steps; step++) {
        const q = step / steps;
        if (!reach(ray, q)) break;
        const tip = step === steps || !reach(ray, (step + 1) / steps);
        at(ax * step, ay * step, tip ? '*' : glyph, mix(WHITE, EDGE, q * 0.9),
          fade * (tip ? 1 : 0.95 - 0.35 * q));
      }
      const fork = Math.round(steps * 0.55);
      if (steps < 3 || !reach(ray, fork / steps + 0.15)) continue;
      for (let step = 1; step <= 2; step++) {
        const light = fade * (0.85 - 0.2 * step);
        if (ax === 0) {
          at(-step, ay * (fork + step), ay > 0 ? '/' : '\\', ICE, light);
          at(step, ay * (fork + step), ay > 0 ? '\\' : '/', ICE, light);
        } else {
          at(ax * fork, ay * (fork + step), '|', ICE, light);
          at(ax * (fork + step), ay * fork, '-', ICE, light);
        }
      }
    }
    if (p > 0.2) at(0, 0, retract > 0.5 ? '+' : '#', WHITE, fade * (1 - retract * 0.6));
  }

  for (let needle = 0; needle < 10; needle++) {
    const t = clamp01((p - 0.06 - hash(needle, 34) * 0.08) / 0.42);
    if (t <= 0 || t >= 1) continue;
    const a = (hash(needle, 35) - 0.5) * 0.9;
    const ux = Math.sin(a), uz = Math.cos(a);
    const d = radius * (0.3 + 1.8 * easeOut(t, 3));
    const light = (1 - t) ** 1.3;
    plot(ux * d, cz + uz * d, v.stroke(ux, uz), mix(WHITE, EDGE, t), light);
    const back = d - radius * 0.14 * (1 - t * 0.5);
    plot(ux * back, cz + uz * back, v.stroke(ux, uz), EDGE, light * 0.55);
  }

  const wave = clamp01((p - 0.1) / 0.6);
  if (wave > 0 && wave < 1) {
    const r = radius * (0.25 + 1.05 * easeOut(wave, 2));
    for (let point = 0; point < 28; point++) {
      const a = point / 28 * TAU;
      if (hash(point, 36) < wave * 0.6) continue;
      const rr = r * (1 + 0.06 * Math.cos(6 * a));
      plot(Math.sin(a) * rr, cz + Math.cos(a) * rr, v.stroke(Math.cos(a), -Math.sin(a)),
        mix(ICE, FROST, wave), 0.7 * (1 - wave) ** 1.6);
    }
  }

  const linger = smooth(0.18, 0.32, p) * (1 - p) ** 1.1;
  if (linger > 0.005) {
    for (let mote = 0; mote < 16; mote++) {
      const a = mote / 16 * TAU + hash(mote, 37);
      const r = radius * (0.35 + 0.55 * hash(mote, 38) + 0.45 * easeOut(p, 2));
      const x = Math.sin(a) * r + Math.sin(p * 9 + mote) * 0.05;
      const z = cz + Math.cos(a) * r - p * radius * 0.2;
      const twinkle = 0.55 + 0.45 * Math.sin(p * 22 + mote * 1.9);
      plot(x, z, twinkle > 0.8 ? '*' : mote % 2 ? '.' : ':', mix(ICE, DEEP, p), linger * twinkle * 0.8);
    }
  }
}

// Aura/zone: hexagonal rime spreads across the ground with crystals at its
// corners and frost feathers reaching inward; snow drifts down, then it thaws.
function rime(effect, plot, v, radius) {
  const p = effect.progress;
  const age = bounded(effect.age, 0, 0, 3600);
  const form = 0.12 + 0.88 * easeOut(p / 0.2, 3);
  const thaw = smooth(0.72, 1, p);
  const fade = (1 - p) ** 0.7;
  const settle = fade * smooth(0.02, 0.14, p);
  const hex = radius * 0.66 * form * (1 + 0.06 * smooth(0.5, 1, p));
  // Screen-aligned hexagon (flat top and bottom) so the rime reads the same at any heading.
  const corner = index => {
    const a = index / 6 * TAU;
    return v.local(Math.cos(a) * hex, Math.sin(a) * hex * 0.9);
  };
  const glint = age * 0.9 % 1 * 6;
  for (let side = 0; side < 6; side++) {
    const [ax, az] = corner(side), [bx, bz] = corner(side + 1);
    const dx = bx - ax, dz = bz - az;
    const [cx, cy] = v.screen(dx, dz);
    const steps = Math.max(2, Math.min(16, Math.ceil(Math.max(Math.abs(cx), Math.abs(cy)))));
    const glyph = strokeCells(cx, cy);
    for (let step = 0; step < steps; step++) {
      if (hash(side * 29 + step, 41) < thaw) continue;
      const t = step / steps;
      const around = Math.abs(side + t - glint);
      const shine = Math.exp(-((Math.min(around, 6 - around) / 0.35) ** 2));
      plot(ax + dx * t, az + dz * t, glyph, mix(EDGE, WHITE, 0.25 + shine * 0.75),
        fade * (0.62 + 0.38 * shine));
    }
    const [ox, oz] = v.local(Math.cos(side / 6 * TAU), Math.sin(side / 6 * TAU));
    if (hash(side, 42) * 0.8 + 0.2 > thaw) {
      plot(ax, az, '*', WHITE, settle * (0.6 + 0.4 * Math.sin(age * 4 + side * 1.3) ** 2));
      for (let step = 1; step <= 2; step++) {
        const d = hex * step * 0.1 * (1 - thaw);
        plot(ax + ox * d, az + oz * d, v.stroke(ox, oz), ICE, settle * (0.8 - step * 0.25));
      }
    }
    for (let step = 1; step <= 3; step++) {
      if (hash(side * 5 + step, 43) < thaw * 1.3) continue;
      const d = hex * step * 0.13;
      plot(ax - ox * d, az - oz * d, step < 3 ? v.stroke(ox, oz) : ':', FROST, settle * (0.6 - step * 0.1));
    }
  }
  for (let mote = 0; mote < 8; mote++) {
    if (hash(mote, 44) < thaw) continue;
    const a = mote / 8 * TAU + hash(mote, 45) * 0.4;
    const r = hex * 0.42 * (0.7 + 0.3 * hash(mote, 46));
    const twinkle = 0.5 + 0.5 * Math.sin(age * 6 + mote * 2.3);
    const [x, z] = v.local(Math.cos(a) * r, Math.sin(a) * r);
    plot(x, z, twinkle > 0.7 ? '+' : '.', mix(ICE, FROST, 0.5), settle * 0.55 * twinkle);
  }
  for (let flake = 0; flake < 12; flake++) {
    const t = (age * 0.8 + hash(flake, 47)) % 1;
    const wx = (hash(flake, 48) - 0.5) * radius * 1.7 + Math.sin(age * 2 + flake) * 0.08;
    const wz = (t - 0.75) * radius * 1.1;
    const [x, z] = v.local(wx, wz);
    plot(x, z, flake % 3 ? '.' : '*', ICE, fade * 0.7 * Math.sin(Math.PI * t) * smooth(0, 0.15, p));
  }
}

// Short aura refreshes (the slow re-applied each second) send a single hexagonal
// chill ripple outward instead of re-growing the whole rime on top of itself.
function chill(effect, plot, v, radius) {
  const p = effect.progress;
  const hex = radius * 0.66 * (1 + 0.5 * easeOut(p, 2));
  const light = 0.75 * (1 - p) ** 1.5 * smooth(0, 0.08, p);
  for (let side = 0; side < 6; side++) {
    const a = side / 6 * TAU, b = (side + 1) / 6 * TAU;
    const [ax, az] = v.local(Math.cos(a) * hex, Math.sin(a) * hex * 0.9);
    const [bx, bz] = v.local(Math.cos(b) * hex, Math.sin(b) * hex * 0.9);
    const dx = bx - ax, dz = bz - az;
    const [cx, cy] = v.screen(dx, dz);
    const steps = Math.max(2, Math.min(16, Math.ceil(Math.max(Math.abs(cx), Math.abs(cy)))));
    const glyph = strokeCells(cx, cy);
    for (let step = 0; step < steps; step++) {
      if (hash(side * 31 + step, 51) < p * 0.9) continue;
      plot(ax + dx * step / steps, az + dz * step / steps, step ? glyph : '+', mix(ICE, FROST, p), light);
    }
  }
}

export default {
  id: 'ice-shard',
  duration: 0.86,
  draw(effect, plot) {
    const life = bounded(effect.life, 0.86, 0.001, 60);
    const progress = bounded(effect.progress, (effect.age ?? 0) / life, 0, 1);
    if (progress >= 1) return;
    const state = { ...effect, progress, age: bounded(effect.age, progress * life, 0, 3600) };
    const v = view(bounded(effect.heading, 0, -1000, 1000));
    switch (effect.stage) {
      case 'projectile': shard(state, plot, v); break;
      case 'impact': shatter(state, plot, v, bounded(effect.radius, 2, 0.6, 3.5)); break;
      case 'pulse': {
        const radius = bounded(effect.radius, 1, 0.3, 3.5);
        if (radius >= 2) shatter(state, plot, v, radius);
        else frostPuff(state, plot, v, radius);
        break;
      }
      case 'aura': (life < 0.6 ? chill : rime)(state, plot, v, bounded(effect.radius, 1, 0.4, 2.5)); break;
      case 'zone': rime(state, plot, v, bounded(effect.radius, 2, 0.6, 3.5)); break;
      default: bloom(state, plot, v, bounded(effect.radius, 0.8, 0.4, 1.6));
    }
  },
  sounds: {
    // Recorded ice under strain opens into one crisp launch crack and cold air.
    cast: [
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-strain.wav', gain: 0.26, rate: 0.96, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-crack.wav', gain: 0.56, rate: 1.08, delay: 0.085 },
      { kind: 'recording', url: '/assets/audio/spells/seithr/cold-breath.wav', gain: 0.12, rate: 1.05, delay: 0.1 },
    ],
    // A physical lake fracture lands first; loose ice settles behind it.
    // This also accompanies the runtime's repeated slow-aura binding.
    impact: [
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-split.wav', gain: 0.52, rate: 0.94, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-grit.wav', gain: 0.23, rate: 1.08, delay: 0.075 },
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-rumble.wav', gain: 0.16, rate: 0.9, delay: 0.035 },
    ],
    // A single quiet recorded grain; no persistent bed on repeated trail ticks.
    pulse: [
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-tick.wav', gain: 0.12, rate: 1.2, delay: 0 },
    ],
  },
};
