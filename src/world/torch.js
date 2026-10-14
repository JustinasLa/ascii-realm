import { hash2 } from '../core/rng.js';
import { SWORD_SIDE } from '../entities/combat.js';
import { buildRig, SCALE, TILT } from '../entities/rig.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { drawFireLight } from './fire.js';
import { ASPECT, WATER } from './world.js';

export const TORCH_LIGHT_RADIUS = 27;
export const MAX_THROWN_TORCHES = 12;
const THROW_SPEED = 42;
const THROW_LIFT = 16;
const GRAVITY = 48;
const SHAFT = 6;
const FLAME = [...'^/\\*x%#'].map(glyph);

// Hand position in world-cell offsets, with height separate from the ground
// position. The loaded model supplies the same coordinates as the fallback.
export function torchGrip(player) {
  const arm = buildRig(player).arms.find(a => a.s !== SWORD_SIDE);
  return { x: arm.hand[0] * SCALE / ASPECT, y: arm.hand[2] * SCALE * TILT,
    h: (arm.hand[1] - (player.waterDepth ?? 0)) * SCALE };
}

export class Torches {
  constructor() {
    this.list = [];
    this.nextId = 1;
    this.carried = { id: 'torch-held', seed: 447, intensity: 0.9, carried: true, cells: [] };
  }

  hold(player, pose = torchGrip(player)) {
    Object.assign(this.carried, { x: player.x + pose.x, y: player.y + pose.y, h: Math.max(0, pose.h) });
    return this.carried;
  }

  toggle(player) {
    if (player.handsFull) return 'hands';
    player.torch = !player.torch;
    player.idle = 0;
    return player.torch ? 'drawn' : 'stowed';
  }

  throw(player, pose) {
    if (player.handsFull) return 'hands';
    if (!player.torch) return 'empty';
    if (this.list.length >= MAX_THROWN_TORCHES) return 'busy';
    const held = this.hold(player, pose);
    const id = this.nextId++;
    this.list.push({ id: `torch-${id}`, seed: 447 + id * 37, intensity: 0.9, carried: false,
      x: held.x, y: held.y, h: held.h, age: 0, cells: [],
      vx: Math.sin(player.heading) * THROW_SPEED / ASPECT,
      vy: Math.cos(player.heading) * THROW_SPEED * TILT, vh: THROW_LIFT });
    player.torch = false;
    player.idle = 0;
    return 'thrown';
  }

  update(dt, world, fires) {
    const impacts = [];
    if (!Number.isFinite(dt) || dt <= 0) return impacts;
    // Small steps stop a torch at solid props even during a slow frame.
    // Four seconds is ample to settle any throw, including one from a jump.
    const duration = Math.min(dt, 4);
    for (let index = this.list.length - 1; index >= 0; index--) {
      const torch = this.list[index];
      const steps = Math.ceil(duration * Math.max(60, Math.abs(torch.vx) * 2, Math.abs(torch.vy) * 2));
      for (let i = 0; i < steps; i++) {
        const landingTime = (torch.vh + Math.sqrt(torch.vh ** 2 + 2 * GRAVITY * torch.h)) / GRAVITY;
        const step = Math.min(duration / steps, landingTime);
        const x = torch.x + torch.vx * step;
        const y = torch.y + torch.vy * step;
        if (world.typeAt(x, y) === WATER || world.isWalkable(x, y)) { torch.x = x; torch.y = y; }
        else { torch.vx = 0; torch.vy = 0; }
        torch.h = Math.max(0, torch.h + torch.vh * step - GRAVITY * step * step / 2);
        torch.vh -= GRAVITY * step;
        torch.age += step;
        if (step < landingTime - 1e-8) continue;
        const wet = world.typeAt(torch.x, torch.y) === WATER;
        const before = fires.list.length;
        const fire = wet ? null : fires.ignite(world, torch.x, torch.y);
        // Landing beside a fire that is already burning adds no new one.
        const type = wet ? 'water' : !fire ? 'blocked' : fires.list.length > before ? 'lit' : 'fed';
        impacts.push({ type, x: torch.x, y: torch.y, fire });
        this.list.splice(index, 1);
        break;
      }
    }
    return impacts;
  }

  prepare(view, time, player, pose) {
    const sources = player.torch ? [this.hold(player, pose), ...this.list] : [...this.list];
    const visible = sources.filter(t => t.x >= view.x0 - TORCH_LIGHT_RADIUS / ASPECT
      && t.x <= view.x0 + view.cols + TORCH_LIGHT_RADIUS / ASPECT
      && t.y >= view.y0 - TORCH_LIGHT_RADIUS && t.y - t.h <= view.y0 + view.rows + TORCH_LIGHT_RADIUS);
    for (const torch of visible) {
      const spin = torch.carried ? 0 : torch.age * 9;
      const dx = Math.sin(spin) / ASPECT;
      const dy = -Math.cos(spin);
      const stick = Math.abs(dy) < 0.35 ? '-' : Math.abs(dx) < 0.4 ? '|' : dx * dy < 0 ? '/' : '\\';
      const cells = [];
      for (let i = -1; i <= SHAFT; i++) {
        const wrap = i >= SHAFT - 1;
        cells.push({ dx: Math.round(dx * i), dy: Math.round(-torch.h + dy * i),
          g: glyph(wrap ? '#' : stick), r: wrap ? 205 : 142, gg: wrap ? 142 : 82, b: wrap ? 62 : 32,
          bg: [24, 14, 7] });
      }
      torch.flameX = dx * SHAFT;
      torch.flameH = torch.h - dy * SHAFT;
      for (let h = 0; h < 6; h++) {
        const u = h / 6;
        const drift = Math.sin(time * 11 - h * 0.7 + torch.seed) * u * 1.2;
        const width = (1 - u) * (2.2 + Math.sin(time * 8 + torch.seed) * 0.25);
        for (let x = -3; x <= 3; x++) {
          const heat = 1 - Math.abs(x - drift) / width;
          if (heat <= 0) continue;
          const rnd = hash2(x, h, torch.seed + Math.floor(time * 15));
          cells.push({ dx: Math.round(torch.flameX) + x, dy: -Math.round(torch.flameH) - h,
            g: FLAME[Math.floor(rnd * FLAME.length)], r: 255, gg: 92 + heat * 145, b: 12 + heat ** 3 * 120,
            bg: [heat * 56, heat * 20, heat * 3] });
        }
      }
      for (let i = 0; i < 3; i++) {
        const age = (time * 0.7 + i / 3) % 1;
        cells.push({ dx: Math.round(torch.flameX + Math.sin(i * 7 + age * 4) * 2),
          dy: -Math.round(torch.flameH + 5 + age * 7), g: glyph('.'),
          r: 220 * (1 - age), gg: 130 * (1 - age), b: 25 * (1 - age) });
      }
      torch.cells = cells;
    }
    return visible;
  }

  draw(r, view, torch, write = putCell) {
    const bx = Math.floor(torch.x) - view.x0;
    const by = Math.floor(torch.y) - view.y0;
    for (const c of torch.cells) {
      write(r, bx + c.dx, by + c.dy, c.g, c.r, c.gg, c.b, by, ...(c.bg ?? []));
    }
  }

  light(r, view, time, visible) {
    for (const torch of visible) {
      drawFireLight(r, view, time, { ...torch, x: torch.x + torch.flameX }, TORCH_LIGHT_RADIUS, torch.flameH);
    }
  }
}
