import { firePulse } from '../core/fire.js';
import { hash2 } from '../core/rng.js';
import { FINE } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { fineOf } from './fine-bakes.js';
import { drawFireLight } from './fire.js';
import { ASPECT } from './world.js';

// A burning furnace's mouth: embers along its floor and flame letters over
// them, shimmering like a campfire's and breathing with the same pulse.
// Only main.js loads this file; the props themselves are baked in workers.
const EMBERS = [...'*o.'].map((ch) => glyph(ch));
const FLAMES = [...'^\'",'].map((ch) => glyph(ch));
const CORE = [255, 206, 110];
const EDGE = [232, 112, 34];
const shapes = new WeakMap();

// The cells of the mouth's glow ellipse, in small cells once the furnace's
// fine bake is drawn, else in ordinary ones. Each is [dx, dy, ember]: the
// bottom row is the ember bed.
export function glowCells(glow, fine) {
  const k = fine ? FINE : 1;
  const cells = [];
  const y0 = Math.floor((glow.y - glow.ry) * k + 0.5);
  const y1 = Math.ceil((glow.y + glow.ry) * k + 0.5);
  const x1 = Math.ceil((Math.abs(glow.x) + glow.rx) * k / ASPECT);
  for (let dy = y0; dy <= y1; dy++) {
    for (let dx = -x1; dx <= x1; dx++) {
      const nx = (dx * ASPECT / k - glow.x) / glow.rx;
      const ny = ((dy - 0.5) / k - glow.y) / glow.ry;
      if (nx * nx + ny * ny <= 1) cells.push([dx, dy]);
    }
  }
  const bottom = Math.max(...cells.map(([, dy]) => dy));
  for (const cell of cells) cell.push(cell[1] === bottom);
  return cells;
}

export function drawFurnaceGlow(r, view, prop, time) {
  const fine = !!(r.fine && fineOf(prop));
  if (!shapes.has(prop.glow)) shapes.set(prop.glow, [glowCells(prop.glow, false), glowCells(prop.glow, true)]);
  const cells = shapes.get(prop.glow)[fine ? 1 : 0];
  const pulse = firePulse({ seed: prop.seed, intensity: 1 }, time);
  const tick = Math.floor(time * 8) + prop.seed;
  const bx = Math.floor(prop.x) - view.x0, by = Math.floor(prop.y) - view.y0;
  // Small cell (FINE * bx + FINE / 2, FINE * (by + 1) - 1) lies over the base, as in drawProp.
  const x0 = fine ? FINE * bx + (FINE >> 1) : bx, y0 = fine ? FINE * (by + 1) - 1 : by;
  for (const [dx, dy, ember] of cells) {
    const h = hash2(dx, dy, tick);
    const set = ember ? EMBERS : FLAMES;
    const c = ember ? CORE : EDGE;
    const k = pulse * (0.75 + 0.25 * h);
    const g = set[Math.floor(h * set.length)];
    // No backdrop: the mouth's own dark backing and outline stay.
    if (fine) r.fineAt(x0 + dx, y0 + dy, g, c[0] * k, c[1] * k, c[2] * k);
    else r.layer(x0 + dx, y0 + dy, g, c[0] * k, c[1] * k, c[2] * k);
  }
}

// A small warm pool in front of the mouth, under half a campfire's.
export function lightFurnace(r, view, prop, time) {
  drawFireLight(r, view, time, { x: prop.x + prop.glow.x / ASPECT, y: prop.y, seed: prop.seed, intensity: 0.55 },
    10, -prop.glow.y);
}
