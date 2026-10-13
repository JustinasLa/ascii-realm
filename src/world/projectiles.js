import { SCALE, TILT } from '../entities/rig.js';
import { glyph } from '../render/glyphs.js';
import { blocks } from './props.js';
import { ASPECT } from './world.js';

const STYLES = {
  arrow: { color: [232, 218, 178], length: 0.38, speed: 20, gravity: 9.8 },
  javelin: { color: [222, 231, 239], length: 0.8, speed: 13, gravity: 9.8 },
  magic: { color: [174, 208, 255], length: 0.25, speed: 12, gravity: 0 },
};
const SHAFT = { horizontal: glyph('-'), vertical: glyph('|'), rising: glyph('/'), falling: glyph('\\') };
const HEAD = { right: glyph('>'), left: glyph('<'), up: glyph('^'), down: glyph('v') };
const MAGIC = glyph('*');
const TRAIL = glyph('.');

function propHeight(prop) {
  // The baked ASCII silhouette already records each obstacle's height.
  // Fixtures and unbaked props can use their kind's normal dimensions.
  let height = prop.kind === 'tree' ? 44 : 8;
  if (prop.cells?.length) {
    height = 0;
    for (const cell of prop.cells) height = Math.max(height, -cell.dy + 1);
  }
  return height;
}

// Flight is in world cells. Event dx/dy are columns/rows per metre (the
// player's SCALE/ASPECT and SCALE*TILT projection); h is height in rows.
// The combat model supplies speed in m/s, gravity in m/s² and lifetime in s.
export class Projectiles {
  constructor() {
    this.list = [];
    this.events = [];
  }

  launch(event) {
    const spec = event?.projectile;
    const style = STYLES[spec?.kind];
    if (!style) return null;
    const { x, y, dx, dy } = event;
    const h = event.h ?? SCALE * 0.75;
    const speed = spec.speed ?? style.speed;
    const gravity = spec.gravity ?? style.gravity;
    const life = spec.lifetime ?? 3;
    const range = spec.range ?? Infinity;
    if (![x, y, dx, dy, h, speed, gravity, life].every(Number.isFinite) ||
      Math.hypot(dx, dy) === 0 || h < 0 || speed <= 0 || gravity < 0 || life <= 0 ||
      !(range > 0)) return null;

    // A bow's double-shot move releases a close pair with a small fan,
    // rather than stacking two invisible arrows at the same coordinates.
    const count = Number.isInteger(spec.count) ? Math.max(1, Math.min(4, spec.count)) : 1;
    if (count > 1) {
      let first = null;
      const fx = dx * ASPECT / SCALE;
      const fy = dy / (SCALE * TILT);
      for (let i = 0; i < count; i++) {
        const angle = (i - (count - 1) / 2) * 0.06;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const shot = this.launch({
          ...event,
          dx: (fx * cos - fy * sin) * SCALE / ASPECT,
          dy: (fx * sin + fy * cos) * SCALE * TILT,
          projectile: { ...spec, count: 1 },
        });
        first ??= shot;
      }
      return first;
    }

    const p = {
      kind: spec.kind,
      x, y, h,
      vx: dx * speed,
      vy: dy * speed,
      vh: 0,
      gravity: gravity * SCALE,
      life,
      maxLife: life,
      range,
      travelled: 0,
      speed,
      strength: event.strength ?? 1,
      damage: event.damage ?? 0,
      color: style.color,
      length: style.length * SCALE,
      trail: [],
    };
    this.list.push(p);
    return p;
  }

  update(dt, world) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const alive = [];
    for (const p of this.list) {
      const duration = Math.min(dt, p.life, (p.range - p.travelled) / p.speed);
      if (duration <= 0) continue;
      const endX = p.x + p.vx * duration;
      const endY = p.y + p.vy * duration;
      const props = world.propsIn(
        Math.min(p.x, endX) - 12, Math.min(p.y, endY) - 3,
        Math.max(p.x, endX) + 12, Math.max(p.y, endY) + 3,
      ).filter((prop) => prop.kind === 'tree' || prop.kind === 'rock');
      // Sub-cell samples prevent a fast arrow crossing a narrow trunk in a
      // single frame. Include vertical travel so a falling shot cannot pass
      // through a low rock between samples either.
      const travel = Math.hypot(p.vx * ASPECT, p.vy) * duration +
        Math.abs(p.vh) * duration + p.gravity * duration * duration / 2;
      const steps = Math.max(1, Math.ceil(travel / 0.5));
      const step = duration / steps;
      let hit = false;
      for (let i = 0; i < steps; i++) {
        p.trail.push({ x: p.x, y: p.y, h: p.h });
        if (p.trail.length > 5) p.trail.shift();
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.h += p.vh * step - p.gravity * step * step / 2;
        p.vh -= p.gravity * step;
        p.life -= step;
        p.travelled += p.speed * step;
        const prop = props.find((obstacle) => blocks(obstacle, p.x, p.y) && p.h <= propHeight(obstacle));
        if (p.h <= 0 || prop) {
          p.h = Math.max(0, p.h);
          this.events.push({
            type: 'impact', kind: p.kind,
            x: p.x, y: p.y, h: p.h,
            strength: p.strength, damage: p.damage,
            prop: prop ?? null,
          });
          hit = true;
          break;
        }
      }
      if (!hit && p.life > 1e-9 && p.travelled < p.range - 1e-9) alive.push(p);
    }
    this.list = alive;
  }

  draw(renderer, view) {
    for (const p of this.list) {
      for (let i = 0; i < p.trail.length; i++) {
        const t = p.trail[i];
        const fade = 0.15 + (i / p.trail.length) * 0.3;
        renderer.put(Math.floor(t.x) - view.x0, Math.floor(t.y - t.h) - view.y0,
          TRAIL, p.color[0] * fade, p.color[1] * fade, p.color[2] * fade);
      }
      const dx = p.vx * ASPECT;
      const dy = p.vy - p.vh;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const shaft = Math.abs(uy) < 0.4 ? SHAFT.horizontal : Math.abs(ux) < 0.4 ? SHAFT.vertical :
        ux * uy < 0 ? SHAFT.rising : SHAFT.falling;
      const head = p.kind === 'magic' ? MAGIC : Math.abs(dx) > Math.abs(dy) ?
        dx > 0 ? HEAD.right : HEAD.left : dy > 0 ? HEAD.down : HEAD.up;
      for (let offset = p.length; offset > 0; offset -= 0.45) {
        renderer.put(
          Math.floor(p.x - ux * offset / ASPECT) - view.x0,
          Math.floor(p.y - p.h - uy * offset) - view.y0,
          p.kind === 'magic' ? TRAIL : shaft,
          p.color[0] * 0.85, p.color[1] * 0.85, p.color[2] * 0.85,
        );
      }
      renderer.put(Math.floor(p.x) - view.x0, Math.floor(p.y - p.h) - view.y0,
        head, ...p.color);
    }
  }
}
