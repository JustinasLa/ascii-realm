import { glyph } from '../render/glyphs.js';
import { halo } from '../world/glow.js';
import { toCells } from '../entities/monsters.js';

const COLORS = { oseni: [255, 163, 35], cerrith: [157, 225, 106], seithr: [91, 224, 255],
  mitlan: [99, 209, 175], martial: [239, 201, 143], illusion: [212, 137, 255] };

export class SpellEffects {
  constructor() { this.list = []; }
  add(point, { element = 'martial', shape = 'burst', radius = 2, life = 0.6, follow = null } = {}) {
    if (this.list.length >= 160) this.list.shift();
    this.list.push({ x: point.x, y: point.y, element, shape, radius: Math.max(0.2, Math.min(40, radius)),
      life: Math.max(0.05, Math.min(60, life)), age: 0, follow });
  }
  update(dt) {
    for (const e of this.list) { e.age += dt; if (e.follow) { e.x = e.follow.x; e.y = e.follow.y; } }
    this.list = this.list.filter(e => e.age < e.life);
  }
  clear() { this.list.length = 0; }
  draw(renderer, view, projectiles = []) {
    const dot = (x, y, char, color, brightness = 1) => {
      const sx = Math.floor(x) - view.x0, sy = Math.floor(y) - view.y0;
      if (sx < 0 || sy < 0 || sx >= renderer.cols || sy >= renderer.rows) return;
      renderer.put(sx, sy, glyph(char), ...color.map(c => c * brightness));
      halo(renderer, sx, sy, brightness * 0.7, ...color);
    };
    for (const e of this.list) {
      const color = COLORS[e.element] ?? COLORS.martial;
      const progress = e.age / e.life;
      const radius = e.radius * (e.shape === 'burst' ? 0.2 + progress : 1);
      const count = Math.min(100, Math.max(12, Math.ceil(radius * 12)));
      for (let i = 0; i < count; i++) {
        const a = i / count * Math.PI * 2 + (e.shape === 'vortex' ? e.age * 2 : 0);
        const [x, y] = toCells(Math.sin(a) * radius, Math.cos(a) * radius);
        dot(e.x + x, e.y + y, e.shape === 'ward' ? '+' : e.shape === 'vortex' ? '~' : '*', color,
          Math.min(1, (1 - progress) * 3));
      }
    }
    for (const p of projectiles) {
      const color = COLORS[p.ctx.spell.element] ?? COLORS.martial;
      for (let i = 0; i < p.trail.length; i++) dot(p.trail[i].x, p.trail[i].y - p.h * 5, '.', color, (i + 1) / p.trail.length * 0.6);
      dot(p.x, p.y - p.h * 5, p.ctx.spell.element === 'seithr' ? '+' : '*', color);
    }
  }
}
