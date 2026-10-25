import { glyph } from '../render/glyphs.js';
import { halo, shade } from '../world/glow.js';
import { drawFireLight } from '../world/fire.js';
import { ASPECT } from '../world/world.js';
import { toCells, toMetres } from '../entities/monsters.js';
import { bounded, paintPresentation } from './presentation.js';

const COLORS = { oseni: [255, 163, 35], cerrith: [157, 225, 106], seithr: [91, 224, 255],
  mitlan: [99, 209, 175], martial: [239, 201, 143], illusion: [212, 137, 255] };
// Glow calls allowed across all effects in one frame.
const GLOW_FRAME = 128;
// Following effects smooth their speed over this many seconds, up to MAX_DRIFT m/s.
const DRIFT_TAU = 0.15, MAX_DRIFT = 12;
// Rows per metre of ground depth, the unit fire light is measured in.
const ROWS_PER_METRE = 6.5;

export class SpellEffects {
  constructor() { this.list = []; this.paused = false; }
  add(point, { element = 'martial', shape = 'burst', radius = 2, life = 0.6, follow = null,
    presentation = null, stage = 'pulse', heading = 0, owner = null, seed = 0 } = {}) {
    if (this.paused || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    if (this.list.length >= 160) this.list.shift();
    this.list.push({ x: point.x, y: point.y, element, shape, radius: bounded(radius, 2, 0.2, 40),
      life: bounded(life, 0.6, 0.05, 60), age: 0, follow, presentation, stage, heading, owner,
      seed: bounded(seed, 0, 0, 1000), vx: 0, vy: 0 });
  }
  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || this.paused) return;
    const step = Math.min(dt, 2), k = 1 - Math.exp(-step / DRIFT_TAU);
    for (const e of this.list) {
      e.age += step;
      if (!e.follow) continue;
      // Smoothed velocity in metres a second, so a following ring can lean back.
      const [mx, mz] = toMetres(e.follow.x - e.x, e.follow.y - e.y);
      e.vx += (mx / step - e.vx) * k; e.vy += (mz / step - e.vy) * k;
      const speed = Math.hypot(e.vx, e.vy);
      if (speed > MAX_DRIFT) { e.vx *= MAX_DRIFT / speed; e.vy *= MAX_DRIFT / speed; }
      e.x = e.follow.x; e.y = e.follow.y;
    }
    this.list = this.list.filter(e => e.age < e.life && e.owner?.alive !== false && (e.owner?.vitals?.health ?? e.owner?.health ?? 1) > 0);
  }
  clear() { this.list.length = 0; }
  draw(renderer, view, projectiles = []) {
    const dot = (x, y, char, color, brightness = 1, keepScenery = false, unlit = false) => {
      const sx = Math.floor(x) - view.x0, sy = Math.floor(y) - view.y0;
      if (sx < 0 || sy < 0 || sx >= renderer.cols || sy >= renderer.rows) return;
      // Flames pass behind trees and rocks drawn on the fine grid.
      if (keepScenery && renderer.hasFineGlyph?.(sy * renderer.cols + sx)) return;
      renderer.put(sx, sy, glyph(char), ...color.map(c => c * brightness));
      // Unlit glyphs (cold char) give off no glow onto their neighbours.
      if (!unlit) halo(renderer, sx, sy, brightness * 0.7, ...color);
    };
    // Warm light is the campfires' own, flicker included; scorch shade is a
    // soft disc measured the same way, in row units.
    const light = (x, y, k, reach, e) => {
      const radius = reach * ROWS_PER_METRE;
      if (k > 0) { drawFireLight(renderer, view, e.age, { x, y, intensity: k, seed: e.seed }, radius, 0); return; }
      const bx = x - view.x0, by = y - view.y0;
      const x0 = Math.max(0, Math.floor(bx - radius / ASPECT)), x1 = Math.min(renderer.cols - 1, Math.ceil(bx + radius / ASPECT));
      const y0 = Math.max(0, Math.floor(by - radius)), y1 = Math.min(renderer.rows - 1, Math.ceil(by + radius));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const d = Math.hypot((cx - bx) * ASPECT, cy - by);
          if (d < radius) shade(renderer, (cy * renderer.cols + cx) * 4, -k * (1 - d / radius) ** 2);
        }
      }
    };
    this.paint(dot, projectiles, light);
  }

  // Both the game and the standalone arena consume this world-cell stream.
  // `light(x, y, k, reach, effect)` receives glow calls; the arena has none.
  // Output gets (x, y, char, color, brightness, keepScenery, unlit), with the
  // flags only when a profile sets them.
  paint(output, projectiles = [], light = null) {
    if (this.paused) return;
    const dot = (x, y, char, color, brightness = 1, keepScenery = false, unlit = false) => {
      if (brightness <= 0) return;
      if (unlit) output(x, y, char, color, brightness, keepScenery, true);
      else if (keepScenery) output(x, y, char, color, brightness, true);
      else output(x, y, char, color, brightness);
    };
    // A profile's sixth plot argument is its unlit flag.
    const profileDot = keep => (x, y, char, color, brightness, unlit) => dot(x, y, char, color, brightness, keep, unlit === true);
    const projectileDot = profileDot(false);
    let remaining = 4096, glows = GLOW_FRAME;
    for (const e of this.list) {
      if (remaining <= 0) break;
      if (e.presentation) {
        const out = profileDot(e.presentation.keepScenery === true);
        const sink = light && ((x, y, k, reach) => { if (glows > 0) { glows--; light(x, y, k, reach, e); } });
        remaining -= paintPresentation(e.presentation, e, out, Math.min(256, remaining), sink);
        continue;
      }
      const color = COLORS[e.element] ?? COLORS.martial;
      const progress = e.age / e.life;
      const radius = e.radius * (e.shape === 'burst' ? 0.2 + progress : 1);
      const count = Math.min(100, Math.max(12, Math.ceil(radius * 12)));
      for (let i = 0; i < count; i++) {
        if (--remaining < 0) break;
        const a = i / count * Math.PI * 2 + (e.shape === 'vortex' ? e.age * 2 : 0);
        const [x, y] = toCells(Math.sin(a) * radius, Math.cos(a) * radius);
        dot(e.x + x, e.y + y, e.shape === 'ward' ? '+' : e.shape === 'vortex' ? '~' : '*', color,
          Math.min(1, (1 - progress) * 3));
      }
    }
    for (const p of projectiles) {
      if (remaining <= 0) break;
      const presentation = p.ctx.spell.presentation;
      if (presentation) {
        remaining -= paintPresentation(presentation, { x: p.x, y: p.y - p.h * 5,
          stage: 'projectile', age: p.age, life: p.life, radius: 0.65,
          heading: Math.atan2(p.dx, p.dz) }, projectileDot, Math.min(128, remaining));
        continue;
      }
      const color = COLORS[p.ctx.spell.element] ?? COLORS.martial;
      remaining--; // Reserve a glyph for the projectile head, even without a trail.
      for (let i = 0; i < p.trail.length && remaining > 0; i++) {
        dot(p.trail[i].x, p.trail[i].y - p.h * 5, '.', color, (i + 1) / p.trail.length * 0.6);
        remaining--;
      }
      dot(p.x, p.y - p.h * 5, p.ctx.spell.element === 'seithr' ? '+' : '*', color);
    }
  }
}
