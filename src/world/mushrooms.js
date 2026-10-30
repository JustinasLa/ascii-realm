import { hash2 } from '../core/rng.js';
import { dg, glyph } from '../render/glyphs.js';
import { putCell } from '../render/cells.js';
import { lighten } from './glow.js';
import { ASPECT, CHUNK_SIZE, GRASS, WATER } from './world.js';

const TAU = Math.PI * 2;
const REACH = 6;
const MAX_SPORES = 280;
const distance = (a, b) => Math.hypot((a.x - b.x) * ASPECT, a.y - b.y);
const sporeGlyphs = [...'06oo0'].map(glyph);
const BLANK = glyph(' ');

// Exact damped spring motion stays smooth at different frame rates. The
// previous one-shot impulse and Euler stepping made close passes feel abrupt.
function spring(node, position, velocity, target, frequency, damping, dt) {
  const w = frequency * Math.sqrt(1 - damping * damping);
  const decay = Math.exp(-damping * frequency * dt);
  const c = Math.cos(w * dt), s = Math.sin(w * dt);
  const x = node[position] - target, v = node[velocity];
  node[position] = target + decay * (x * c + (v + damping * frequency * x) / w * s);
  node[velocity] = decay * (v * c - (damping * frequency * v + frequency * frequency * x) / w * s);
}

// Transcribed from the close-up at 00:04.55 in the supplied video. The
// lettering is part of the surface: broad white bands roll over the crown,
// then narrow into darker gills and a substantial, teal-lit pedestal.
// These are distinct silhouettes in the reference, not scaled toadstools.
const PROFILES = {
  dome: { capRows: 5, rows: [
    [-3, 'Q@##BNQ'],
    [-6, '@&8O&S&8S&D8'],
    [-8, '$O|QQQQ8QQqw%Xb'],
    [-8, '&0%$?%$MDQ&8e%'],
    [-7, '@&Qn?%Q%2%b%b'],
    [-8, '&&00Jw@%000'],
    [-6, 'sd0J{dOpwa'],
    [-6, 'zvxnl?xwge'],
    [-5, "n{'zzu?vzf"],
    [-4, 'r*^rcr?j+'],
    [-3, 'xv+}{r;'],
    [-4, 'r;;v{zj'],
    [-3, '|+r*;,'],
    [-3, 'jv;*z'],
  ] },
  crooked: { capRows: 5, rows: [
    [-3, '#@80Q'],
    [-5, '#$|&|QQD'],
    [-5, '8&&D&8O8'],
    [-2, '$DQ#&8'],
    [-1, '&D|DO&&'],
    [-6, 'W0|D$%bds'],
    [-6, '8 \\ $acdzj'],
    [-5, 'uqdrcz*j'],
    [-4, "r'v{-^;"],
    [-4, 'ij*;j+'],
    [-3, 'v;*rj'],
    [-3, ',j|;+'],
  ] },
  button: { capRows: 4, rows: [
    [-2, '@#$QQ8'],
    [-4, '@D8&&&&$p'],
    [-5, '$QQQ8OQ8&p'],
    [-3, '%OO8O&'],
    [-1, 'w&(%b'],
    [-4, 'u0rxbr*++'],
    [-3, "v;rj'*"],
    [-3, 'v*;j'],
  ] },
};

export function makeGlowcap(x, y, seed, size = 1) {
  const phase = hash2(Math.floor(x), Math.floor(y), seed + 3100) * TAU;
  const shape = size >= 0.95 ? 'dome' : size >= 0.78 ? 'crooked' : 'button';
  const profile = PROFILES[shape];
  // A character occupies one cell, without duplicated rows or letters.
  // Size selects the reference's three models, each with its own proportions.
  const height = profile.rows.length - 1;
  const radius = shape === 'dome' ? 11 : 7;
  const cells = [];
  const raster = new Map();
  for (let dy = -height; dy <= 0; dy++) {
    const py = dy + height;
    const row = profile.rows[Math.min(profile.rows.length - 1, Math.floor(py))];
    for (let dx = -radius; dx <= radius; dx++) {
      const px = dx;
      const letter = row[1][px - row[0]];
      // The video has a continuous, near-black bell-shaped backing, with
      // generous darkness at the shoulders and along the shaded right side.
      const ny = (py - profile.rows.length * 0.52) / (profile.rows.length * 0.57);
      const nx = (px - 0.3) / (shape === 'dome' ? 10.3 : 7.1);
      if (!letter && nx * nx + ny * ny > 1) continue;
      const t = py / (profile.rows.length - 1);
      const crown = Math.max(0, 1 - Math.max(0, py - 2.2) / 4.4);
      const light = (0.96 - Math.max(0, px + 2) * 0.027) * (0.97 + Math.sin(phase) * 0.03);
      const core = Math.exp(-(((px + 0.7) / 2.7) ** 2) - ((py - profile.capRows - 1.3) / 2.7) ** 2);
      const low = Math.max(0, 1 - (t - 0.6) * 1.5);
      const color = [
        (37 + crown * 153 + core * 80) * light * low,
        (63 + crown * 128 + core * 144) * light * low,
        (60 + crown * 118 + core * 124) * light * low,
      ];
      const back = [6 + core * 13, 8 + core * 49, 15 + core * 35];
      const cell = { dx, dy, g: letter && letter !== ' ' ? dg(`mushrooms.ascii.${letter.charCodeAt(0)}`) : BLANK,
        color, back, cap: py < profile.capRows };
      cells.push(cell);
      raster.set(`${dx},${dy}`, cell);
    }
  }
  return { kind: 'glowcap', x, y, height, radius, phase, shape, cells, raster,
    bend: 0, velocity: 0, squash: 0, squashVelocity: 0, capBend: 0, capVelocity: 0,
    targetBend: 0, targetSquash: 0, shed: 0, cooldown: 0, brushed: false };
}

export class Mushrooms {
  constructor(world, { spawnRate = 0.15 } = {}) {
    if (!Number.isFinite(spawnRate) || spawnRate < 0 || spawnRate > 1) throw new RangeError('Mushroom spawn rate must be between 0 and 1');
    this.world = world;
    this.spawnRate = spawnRate;
    this.chunks = new WeakMap();
    this.active = new Set();
    this.spores = [];
    this.ambient = [];
    this.time = 0;
    this.starters = [];
    // Keep one of the previous seven starter mushrooms at the 15% density.
    // Search dry, walkable ground instead of placing them inside the ruins.
    const starterBudget = Math.round(7 * spawnRate);
    for (let i = 0; i < Math.min(5, starterBudget); i++) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const angle = -0.55 + i * 1.15 + attempt * 0.19;
        const radius = 12 + Math.floor(attempt / 8) * 5;
        const x = Math.floor(world.spawn.x + Math.cos(angle) * radius / ASPECT) + 0.5;
        const y = Math.floor(world.spawn.y + Math.sin(angle) * radius) + 0.5;
        if (!this.open(x, y) || this.starters.some(p => distance(p, { x, y }) < 6)) continue;
        this.starters.push(makeGlowcap(x, y, world.seed, i % 3 === 0 ? 1.1 : 0.7 + i * 0.06));
        break;
      }
    }
    for (const p of this.starters.filter(p => p.shape === 'dome')) {
      if (this.starters.length >= starterBudget) break;
      for (const side of [1, -1]) {
        const x = p.x + side * 13, y = p.y + 3;
        if (!this.open(x, y) || this.starters.some(other => distance(other, { x, y }) < 4.5)) continue;
        this.starters.push(makeGlowcap(x, y, world.seed, 0.64));
        break;
      }
    }
  }

  open(x, y) {
    return [[0, 0], [-2, 0], [2, 0], [0, -1], [0, 1]].every(([dx, dy]) =>
      this.world.typeAt(x + dx, y + dy) === GRASS && this.world.isWalkable(x + dx, y + dy));
  }

  nodesOf(cx, cy) {
    const chunk = this.world.chunk(cx, cy);
    let nodes = this.chunks.get(chunk);
    if (nodes) return nodes;
    nodes = this.starters.filter(p => Math.floor(p.x / CHUNK_SIZE) === cx && Math.floor(p.y / CHUNK_SIZE) === cy);
    for (let gy = 0; gy < CHUNK_SIZE; gy += 32) {
      for (let gx = 0; gx < CHUNK_SIZE; gx += 32) {
        const ox = cx * CHUNK_SIZE + gx, oy = cy * CHUNK_SIZE + gy;
        const roll = hash2(ox, oy, this.world.seed + 3110);
        if (roll > 0.46) continue;
        const x = ox + 6 + hash2(ox, oy, this.world.seed + 3111) * 20;
        const y = oy + 5 + hash2(ox, oy, this.world.seed + 3112) * 20;
        const count = 2 + Math.floor(roll * 7);
        for (let i = 0; i < count; i++) {
          const px = Math.floor(x + Math.cos(i * 2.4) * i * 4) + 0.5;
          const py = Math.floor(y + Math.sin(i * 2.4) * i * 3) + 0.5;
          if (Math.floor(px / CHUNK_SIZE) !== cx || Math.floor(py / CHUNK_SIZE) !== cy
            || distance(this.world.spawn, { x: px, y: py }) < 22 || !this.open(px, py)) continue;
          if (nodes.some(p => distance(p, { x: px, y: py }) < 4)) continue;
          nodes.push(makeGlowcap(px, py, this.world.seed, i === 0 ? 1 : 0.48 + i * 0.1));
        }
      }
    }
    // Thin the completed candidates independently: lowering the cluster roll
    // would also change cluster size and would remove more than 85%.
    nodes = nodes.filter(p => this.starters.includes(p)
      || hash2(Math.floor(p.x), Math.floor(p.y), this.world.seed + 3113) < this.spawnRate);
    this.chunks.set(chunk, nodes);
    return nodes;
  }

  nodesIn(x0, y0, x1, y1, loadedOnly = false) {
    const nodes = [];
    for (let cy = Math.floor(y0 / CHUNK_SIZE); cy <= Math.floor(y1 / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor(x0 / CHUNK_SIZE); cx <= Math.floor(x1 / CHUNK_SIZE); cx++) {
        if (loadedOnly && !this.world.loaded(cx, cy)?.props) continue;
        for (const p of this.nodesOf(cx, cy)) {
          if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
            && this.world.typeAt(p.x, p.y) === GRASS && this.world.isWalkable(p.x, p.y)) nodes.push(p);
        }
      }
    }
    return nodes;
  }

  reachable(player, node) {
    const steps = Math.max(1, Math.ceil(distance(player, node) * 2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = player.x + (node.x - player.x) * t;
      const y = player.y + (node.y - player.y) * t;
      if (this.world.typeAt(x, y) === WATER || !this.world.isWalkable(x, y)) return false;
    }
    return true;
  }

  nearby(player) {
    if (player.air > 0.3 || player.vitals?.dead) return null;
    let nearest = null, reach = REACH;
    for (const p of this.nodesIn(player.x - 11, player.y - REACH, player.x + 11, player.y + REACH)) {
      const d = distance(player, p);
      if (d <= reach && this.reachable(player, p)) { nearest = p; reach = d; }
    }
    return nearest;
  }

  interact(player) {
    const node = this.nearby(player);
    if (!node || node.cooldown > this.time) return false;
    node.cooldown = this.time + 2.4;
    node.squashVelocity -= 1.9;
    node.velocity += player.x < node.x ? 6 : -6;
    this.active.add(node);
    // The clip uses sparse, slowly tumbling rings, in sage and pale ochre.
    // Stagger the release so it rolls out of the gills instead of flashing.
    for (let i = 0; i < 24; i++) {
      const roll = hash2(i, Math.floor(this.time * 1000), Math.floor(node.phase * 1000));
      const angle = i * 2.39996 + node.phase;
      const speed = 0.8 + roll * 2.2;
      this.spores.push({ x: node.x + Math.cos(angle) * node.radius * 0.45,
        y: node.y, h: node.height * 0.48 + Math.sin(angle) * 0.6,
        vx: Math.cos(angle) * speed / ASPECT, vy: Math.sin(angle) * speed * 0.35,
        rise: 1.8 + roll * 1.4,
        age: -i / 24 * 0.45, life: 2.8 + roll * 1.4,
        phase: angle, g: sporeGlyphs[i % sporeGlyphs.length],
        color: i % 5 === 0 ? [177, 179, 115] : [133, 194, 166] });
    }
    if (this.spores.length > MAX_SPORES) this.spores.splice(0, this.spores.length - MAX_SPORES);
    return true;
  }

  shedSpores(node, count) {
    for (let i = 0; i < count; i++) {
      const roll = hash2(i, Math.floor(this.time * 1000), Math.floor(node.phase * 1000) + 91);
      const angle = node.phase + roll * TAU;
      this.spores.push({ x: node.x + Math.cos(angle) * node.radius * 0.58 + node.bend * 0.5,
        y: node.y + Math.sin(angle) * 0.6,
        h: node.height * 0.48 * (1 + node.squash),
        vx: Math.cos(angle) * (0.4 + roll) + node.velocity * 0.1,
        vy: Math.sin(angle) * 0.35, rise: 1.3 + roll * 1.1,
        age: 0, life: 3.8 + roll * 1.4, phase: angle,
        g: sporeGlyphs[i % sporeGlyphs.length], color: roll > 0.8 ? [177, 179, 115] : [133, 194, 166] });
    }
    if (this.spores.length > MAX_SPORES) this.spores.splice(0, this.spores.length - MAX_SPORES);
  }

  update(dt, player, fromX = player.x, fromY = player.y) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    const travel = Math.hypot((player.x - fromX) * ASPECT, player.y - fromY);
    const speed = travel / dt;
    const moving = speed > 0.12 && !(player.air > 0.4) && !player.vitals?.dead;
    for (const p of this.active) {
      p.targetBend = p.targetSquash = 0;
      p.brushed = false;
    }
    const near = this.nodesIn(player.x - 20, player.y - 11, player.x + 20, player.y + 11);
    for (const p of near) {
      const d = distance(player, p);
      if (moving && d < 9 && this.reachable(player, p)) {
        const u = Math.max(0, Math.min(1, (9 - d) / 7));
        const pressure = u * u * (3 - 2 * u);
        const side = Math.max(-1, Math.min(1, (p.x - player.x) * ASPECT / Math.max(d, 1)));
        // Continuous pressure follows the passer-by; the top lags the stalk.
        p.targetBend = side * Math.min(2.4, speed * 0.22 + 0.35) * pressure;
        p.targetSquash = -Math.min(0.07, speed * 0.006) * pressure;
        p.brushed = true;
        this.active.add(p);
      }
    }
    // Reset plants left behind too, so returning after a long walk works.
    for (const p of this.active) {
      spring(p, 'bend', 'velocity', p.targetBend, 7.2, 0.34, dt);
      spring(p, 'squash', 'squashVelocity', p.targetSquash, 8.6, 0.4, dt);
      spring(p, 'capBend', 'capVelocity', p.bend, 9, 0.42, dt);
      // A moving cap releases buoyant spores, including after the
      // player has passed. Standing beside a resting plant does not emit.
      const energy = Math.abs(p.velocity) + Math.abs(p.capVelocity) * 0.55 + Math.abs(p.squashVelocity) * 8;
      if (energy > 0.25) {
        p.shed += Math.min(12, energy * 2) * dt;
        const count = Math.min(2, Math.floor(p.shed));
        if (count) { p.shed -= count; this.shedSpores(p, count); }
      }
      if (!p.brushed && Math.abs(p.bend) + Math.abs(p.velocity) + Math.abs(p.squash) + Math.abs(p.squashVelocity)
        + Math.abs(p.capBend) + Math.abs(p.capVelocity) < 0.002) {
        p.bend = p.velocity = p.squash = p.squashVelocity = p.capBend = p.capVelocity = p.shed = 0;
        this.active.delete(p);
      }
    }
    for (const s of this.spores) {
      s.age += dt;
      if (s.age < 0) continue;
      s.x += (s.vx + Math.sin(this.time * 1.6 + s.phase) * 0.65) * dt;
      s.y += s.vy * dt;
      s.h += s.rise * dt;
      s.vx *= Math.exp(-dt * 0.65);
      s.vy *= Math.exp(-dt * 0.8);
    }
    this.spores = this.spores.filter(s => s.age < s.life);
  }

  // `below` reaches further south only, for caps raised into the view from
  // below it.
  prepare(view, loadedOnly = false, below = 0) {
    const nodes = this.nodesIn(view.x0 - 13, view.y0 - view.rows - 20,
      view.x0 + view.cols + 13, view.y0 + view.rows + 20 + below, loadedOnly);
    // A few long-lived motes hang around each patch even at rest, as in the
    // reference. Derive them from time and position rather than accumulating
    // particles for unloaded countryside.
    this.ambient = [];
    for (const p of nodes) {
      for (let i = 0; i < 3; i++) {
        const phase = p.phase + i * 2.39996;
        const life = 8 + i * 1.7;
        const age = (this.time + phase * 3) % life;
        this.ambient.push({ x: p.x + Math.cos(phase) * (10 + i * 3) / ASPECT + Math.sin(age * 0.5 + phase) * 2,
          y: p.y + Math.sin(phase) * (5 + i * 2), h: 1 + age * 0.8,
          age, life, phase, g: sporeGlyphs[i], ambient: true,
          color: i === 2 ? [159, 165, 104] : [115, 174, 146] });
      }
    }
    return nodes;
  }

  draw(r, view, node, write = putCell) {
    const bx = Math.floor(node.x) - view.x0, by = Math.floor(node.y) - view.y0;
    const pulse = 0.98 + Math.sin(this.time * 1.8 + node.phase) * 0.02;
    const bounce = Math.max(-0.22, Math.min(0.18, node.squash));
    const floating = write === putCell && typeof r.putFloating === 'function';
    // Inverse sampling keeps the black silhouette closed while it squashes
    // and stretches. Moving source cells forwards left holes in the cap.
    const reach = node.radius + Math.ceil(Math.max(Math.abs(node.bend), Math.abs(node.capBend))) + 3;
    for (let dy = -Math.ceil(node.height * (1 + Math.max(0, bounce))) - 2; dy <= 0; dy++) {
      const flex = Math.max(0, -dy / (node.height * (1 + bounce)));
      const bend = node.bend + (node.capBend - node.bend) * flex;
      const shift = bend * (flex * flex + Math.sin(flex * Math.PI) * 0.22);
      const stretch = 1 - bounce * 0.65 * Math.min(1, flex);
      for (let dx = -reach; dx <= reach; dx++) {
        const sx = Math.round((dx - shift) / stretch);
        const sy = Math.round((dy - dx * node.capBend * 0.025 * flex) / (1 + bounce));
        const c = node.raster.get(`${sx},${sy}`);
        if (!c) continue;
        const light = c.cap ? 1 : pulse;
        write(r, bx + dx, by + dy, floating ? BLANK : c.g,
          c.color[0] * light, c.color[1] * light, c.color[2] * light, by, ...c.back);
      }
    }
    if (floating) {
      r.beginFloating();
      for (const c of node.cells) {
        if (c.g === BLANK) continue;
        const flex = -c.dy / node.height;
        const bend = node.bend + (node.capBend - node.bend) * flex;
        const shift = bend * (flex * flex + Math.sin(flex * Math.PI) * 0.22);
        const x = c.dx * (1 - bounce * 0.65 * flex) + shift;
        const y = c.dy * (1 + bounce) + c.dx * node.capBend * 0.025 * flex;
        const light = c.cap ? 1 : pulse;
        r.putFloating(bx + x, by + y, c.g, c.color[0] * light, c.color[1] * light, c.color[2] * light);
      }
    }
  }

  // `glow` is how much of it shows: all of it at night, less by day.
  drawGlow(r, view, nodes, glow = 1) {
    for (const p of nodes) {
      const bx = Math.floor(p.x) - view.x0, by = Math.floor(p.y) - view.y0;
      const centreY = by - p.height + PROFILES[p.shape].capRows + 1.3;
      // The blue-green bloom belongs inside the gills, above the ground.
      // Light the finished cells too so foreground grass catches its edge.
      for (let y = Math.max(0, Math.floor(centreY - 4)); y <= Math.min(r.rows - 1, Math.ceil(centreY + 4)); y++) {
        for (let x = Math.max(0, bx - 5); x <= Math.min(r.cols - 1, bx + 4); x++) {
          const d2 = ((x - bx + 0.7) / 4.5) ** 2 + ((y - centreY) / 3.2) ** 2;
          if (d2 < 1) lighten(r, (y * r.cols + x) * 4, (1 - d2) ** 2 * 0.45 * glow, 80, 187, 155, 0.65);
        }
      }
      const pulse = 0.55 + Math.sin(this.time * 1.8 + p.phase) * 0.025;
      for (let dy = -5; dy <= 2; dy++) {
        const y = by + dy;
        if (y < 0 || y >= r.rows) continue;
        for (let dx = -9; dx <= 9; dx++) {
          const x = bx + dx;
          if (x < 0 || x >= r.cols) continue;
          const d2 = (dx / 9) ** 2 + ((dy + 1) / 5) ** 2;
          if (d2 < 1) lighten(r, (y * r.cols + x) * 4, (1 - d2) ** 2 * pulse * 0.12 * glow, 35, 139, 111, 0.4);
        }
      }
    }
  }

  drawSpore(r, view, s) {
    const x = Math.floor(s.x) - view.x0, y = Math.floor(s.y - s.h) - view.y0;
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return;
    const fade = Math.min(1, s.age * 7) * Math.min(1, (s.life - s.age) * 1.3);
    if (fade <= 0.04) return;
    const color = s.color;
    r.layer(x, y, s.g, color[0] * fade, color[1] * fade, color[2] * fade);
    if (!s.ambient) lighten(r, (y * r.cols + x) * 4, fade * 0.06, 42, 146, 105, 0.4);
  }
}
