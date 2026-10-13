import { solveBallisticShot } from '../core/ballistics.js';
import { SCALE, TILT } from '../entities/rig.js';
import { glyph } from '../render/glyphs.js';
import { blocks } from './props.js';
import { ASPECT } from './world.js';

const STYLES = {
  arrow: { color: [232, 218, 178], length: 0.38, speed: 20, gravity: 9.8 },
  spear: { color: [174, 247, 204], length: 1.25, speed: 9.5, gravity: 5 },
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

// Exact positive ground crossing, including a downward shot whose flight
// is too short for an ordinary frame. Rationalization preserves near hits.
function groundTime(height, velocity, gravity) {
  if (height <= 0) return velocity <= 0 ? 0 : gravity > 0 ? 2 * velocity / gravity : Infinity;
  if (gravity === 0) return velocity < 0 ? -height / velocity : Infinity;
  const root = Math.hypot(velocity, Math.sqrt(2 * gravity * height));
  return velocity < 0 ? 2 * height / (root - velocity) : (velocity + root) / gravity;
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
    const aimed = spec.kind === 'arrow' && event.aimTarget != null;
    const target = aimed ? { x: event.aimTarget.x, y: event.aimTarget.y } : null;
    const velocity = spec.velocity;
    const explicitVelocity = Array.isArray(velocity) && velocity.length === 3 && velocity.every(Number.isFinite);
    if (![x, y, h, speed, gravity, life].every(Number.isFinite) ||
      (!aimed && !explicitVelocity && (![dx, dy].every(Number.isFinite) || Math.hypot(dx, dy) === 0)) ||
      (aimed && ![target.x, target.y].every(Number.isFinite)) ||
      (velocity != null && !explicitVelocity) || h < 0 || speed <= 0 || gravity < 0 || life <= 0 ||
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
          // Paired aimed arrows share the cursor but take slightly different
          // arcs and durations. Unaimed shots retain their original fan.
          projectile: { ...spec, count: 1, speed: aimed ? speed * (1 + (i - (count - 1) / 2) * 0.04) : speed },
        });
        first ??= shot;
      }
      return first;
    }

    const shot = aimed ? solveBallisticShot(
      [0, h / SCALE, 0],
      [(target.x - x) * ASPECT / SCALE, 0, (target.y - y) / (SCALE * TILT)],
      speed, gravity,
    ) : null;
    if (aimed && !shot) return null;
    const launchVelocity = shot?.velocity ?? (explicitVelocity ? velocity : null);

    const p = {
      kind: spec.kind,
      x, y, h,
      vx: launchVelocity ? launchVelocity[0] * SCALE / ASPECT : dx * speed,
      vy: launchVelocity ? launchVelocity[2] * SCALE * TILT : dy * speed,
      vh: launchVelocity ? launchVelocity[1] * SCALE : 0,
      gravity: gravity * SCALE,
      life: shot?.duration ?? life,
      maxLife: shot?.duration ?? life,
      range: aimed ? Infinity : range,
      travelled: 0,
      speed: shot?.speed ?? speed,
      elapsed: 0,
      flightTime: shot?.duration ?? null,
      target,
      strength: event.strength ?? 1,
      damage: event.damage ?? 0,
      color: style.color,
      length: style.length * SCALE,
      trail: [],
    };
    if (![p.vx, p.vy, p.vh, p.gravity].every(Number.isFinite)) return null;
    this.list.push(p);
    return p;
  }

  update(dt, world) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const alive = [];
    for (const p of this.list) {
      const duration = Math.min(dt, p.life, p.target ? Infinity : (p.range - p.travelled) / p.speed);
      if (duration <= 0) {
        if (p.target && p.flightTime === 0) {
          this.events.push({ type: 'impact', kind: p.kind, x: p.target.x, y: p.target.y, h: 0,
            strength: p.strength, damage: p.damage, prop: null });
        }
        continue;
      }
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
      const finishesFlight = p.target && duration >= p.life;
      let hit = false;
      for (let i = 0; i < steps; i++) {
        p.trail.push({ x: p.x, y: p.y, h: p.h });
        if (p.trail.length > 5) p.trail.shift();
        const crossing = groundTime(p.h, p.vh, p.gravity);
        const arrived = finishesFlight && i === steps - 1;
        const landed = crossing <= step || arrived;
        const advance = Math.min(step, crossing, p.target ? Math.max(0, p.flightTime - p.elapsed) : Infinity);
        p.x += p.vx * advance;
        p.y += p.vy * advance;
        p.h += p.vh * advance - p.gravity * advance * advance / 2;
        p.vh -= p.gravity * advance;
        p.elapsed += advance;
        p.life = p.target ? Math.max(0, p.flightTime - p.elapsed) : p.life - advance;
        p.travelled += p.speed * advance;
        if (landed) {
          p.h = 0;
          if (p.target) {
            p.x = p.target.x;
            p.y = p.target.y;
          }
        }
        const prop = props.find((obstacle) => blocks(obstacle, p.x, p.y) && p.h <= propHeight(obstacle));
        if (landed || prop) {
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
      if (!hit && (p.target ? p.life > 0 : p.life > 1e-9 && p.travelled < p.range - 1e-9)) alive.push(p);
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
