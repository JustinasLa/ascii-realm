import { glyph } from '../render/glyphs.js';
import { halo } from '../world/glow.js';
import { toCells } from '../entities/monsters.js';
import { bounded, paintPresentation } from './presentation.js';

const COLORS = { oseni: [255, 163, 35], cerrith: [157, 225, 106], seithr: [91, 224, 255],
  mitlan: [99, 209, 175], martial: [239, 201, 143], illusion: [212, 137, 255] };

export class SpellEffects {
  constructor() { this.list = []; this.paused = false; }
  add(point, { element = 'martial', shape = 'burst', radius = 2, life = 0.6, follow = null,
    presentation = null, stage = 'pulse', heading = 0, owner = null } = {}) {
    if (this.paused || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    if (this.list.length >= 160) this.list.shift();
    this.list.push({ x: point.x, y: point.y, element, shape, radius: bounded(radius, 2, 0.2, 40),
      life: bounded(life, 0.6, 0.05, 60), age: 0, follow, presentation, stage, heading, owner });
  }
  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || this.paused) return;
    for (const e of this.list) { e.age += Math.min(dt, 2); if (e.follow) { e.x = e.follow.x; e.y = e.follow.y; } }
    this.list = this.list.filter(e => e.age < e.life && e.owner?.alive !== false && (e.owner?.vitals?.health ?? e.owner?.health ?? 1) > 0);
  }
  clear() { this.list.length = 0; }
  draw(renderer, view, projectiles = []) {
    const dot = (x, y, char, color, brightness = 1) => {
      const sx = Math.floor(x) - view.x0, sy = Math.floor(y) - view.y0;
      if (sx < 0 || sy < 0 || sx >= renderer.cols || sy >= renderer.rows) return;
      renderer.put(sx, sy, glyph(char), ...color.map(c => c * brightness));
      halo(renderer, sx, sy, brightness * 0.7, ...color);
    };
    this.paint(dot, projectiles);
  }

  // Both the game and the standalone arena consume this world-cell stream.
  paint(output, projectiles = []) {
    if (this.paused) return;
    const dot = (x, y, char, color, brightness = 1) => {
      if (brightness > 0) output(x, y, char, color, brightness);
    };
    let remaining = 4096;
    for (const e of this.list) {
      if (remaining <= 0) break;
      if (e.presentation) { remaining -= paintPresentation(e.presentation, e, dot, Math.min(256, remaining)); continue; }
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
          heading: Math.atan2(p.dx, p.dz) }, dot, Math.min(128, remaining));
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
