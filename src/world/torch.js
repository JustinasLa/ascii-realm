import { hash2 } from '../core/rng.js';
import { SWORD_SIDE } from '../entities/combat.js';
import { buildRig, SCALE, TILT } from '../entities/rig.js';
import { putCell } from '../render/cells.js';
import { dg, glyph, over } from '../render/glyphs.js';
import { drawFireLight, flameCell } from './fire.js';
import { subGlyph } from './glow.js';
import { ASPECT, WATER } from './world.js';

export const TORCH_LIGHT_RADIUS = 27;
export const MAX_THROWN_TORCHES = 12;
const THROW_SPEED = 42;
const THROW_LIFT = 16;
const GRAVITY = 48;
const SHAFT = 6;
const WRAP = dg('bark.1');
const SMOULDER = dg('effects.coal.2');
const EMBER = Array.from({ length: 9 }, (_, i) => dg(`effects.ember.${i}`));

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
    player.torch = !player.torch;
    player.idle = 0;
    return player.torch ? 'drawn' : 'stowed';
  }

  throw(player, pose) {
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
        const at = { dx: Math.round(dx * i), dy: Math.round(-torch.h + dy * i) };
        cells.push({ ...at, g: wrap ? WRAP : glyph(stick), r: wrap ? 150 : 142, gg: wrap ? 98 : 82,
          b: wrap ? 52 : 32, bg: [24, 14, 7] });
        // The pitch-soaked wrap smoulders under the flame.
        const glow = 0.6 + 0.4 * Math.sin(time * 7 + i * 2 + torch.seed);
        if (wrap) cells.push({ ...at, g: over(SMOULDER), r: 255 * glow, gg: 120 * glow, b: 30 * glow });
      }
      torch.flameX = dx * SHAFT;
      torch.flameH = torch.h - dy * SHAFT;
      // A single tongue of flame licking up from the wrap, swaying as it
      // goes and leaning further near its tip.
      const fx = Math.round(torch.flameX);
      const fh = Math.round(torch.flameH);
      const height = 6 + Math.sin(time * 9 + torch.seed) * 0.8;
      const axis = (h) => Math.sin(time * 11 - h * 0.7 + torch.seed) * (h / height) * 1.2;
      const frame = Math.floor(time * 15);
      const heatAt = (h, x) => {
        if (h < 0 || h >= height) return 0;
        const width = (1 - h / height) ** 0.8 * (2.2 + Math.sin(time * 8 + torch.seed) * 0.25);
        return (1 - Math.abs(x - axis(h)) / width) * (1 - h / height * 0.25);
      };
      for (let h = 0; h < Math.ceil(height); h++) {
        for (let x = -3; x <= 3; x++) {
          const heat = heatAt(h, x);
          if (heat <= 0.05) continue;
          flameCell(cells, fx + x, -fh - h, heat, heatAt(h + 1, x), heatAt(h, x - 1), heatAt(h, x + 1),
            axis(h) - x, axis(h + 1) - x, h + 1 >= height, hash2(x, h, torch.seed + frame), 1, 0.9);
        }
      }
      // Embers lift off the flame and wink out.
      for (let i = 0; i < 4; i++) {
        const age = (time * 0.7 + i / 4) % 1;
        const x = torch.flameX + Math.sin(i * 7 + age * 4) * 2;
        const y = -(torch.flameH + 5 + age * 8);
        const fade = (1 - age) * (hash2(i, Math.floor(time * 8), torch.seed) < 0.2 ? 0.35 : 1);
        cells.push({ dx: Math.floor(x + 0.5), dy: Math.floor(y), g: over(subGlyph(EMBER, x + 0.5, y)),
          r: 240 * fade, gg: 140 * fade, b: 30 * fade });
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
