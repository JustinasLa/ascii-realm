// Touch aim assist: a strike or cast from the on-screen buttons turns
// toward the nearest enemy in a narrow cone ahead. It is evaluated only at
// the moment of the press, so it never locks on, and the keyboard and mouse
// never use it. It only turns the body: a cut still lands only within the
// weapon's reach and the sword's own hit arc.
import { ASPECT } from '../world/world.js';
import { SCALE, TILT } from '../entities/rig.js';

// Half the cone's width either side of the facing (60° in total).
export const AIM_ASSIST_HALF_ANGLE = Math.PI / 6;
// Strikes look one stride, in metres, beyond the weapon's reach.
export const STRIKE_ASSIST_SLACK = 1;
// Casts look this far, in metres, when a spell names no travel range.
export const CAST_ASSIST_FALLBACK = 40;

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

// How far a spell's projectiles fly: the largest plain `mr` / `maxrange`
// among its steps, in metres as the casting system reads them.
export function castAssistRange(spell) {
  let range = 0;
  for (const node of Object.values(spell?.nodes ?? {})) {
    for (const step of node.steps ?? []) {
      const value = Number(step.args?.mr ?? step.args?.maxrange);
      if (Number.isFinite(value)) range = Math.max(range, value);
    }
  }
  return range || CAST_ASSIST_FALLBACK;
}

// The nearest living foe within `range` metres (its body radius counts) and
// `halfAngle` of `from.heading`, with the heading that faces it, or null.
// Of two foes equally near, the one closer to straight ahead wins.
export function assistTarget(from, foes, { range, halfAngle = AIM_ASSIST_HALF_ANGLE }) {
  let best = null;
  for (const foe of foes) {
    if (!foe.alive || foe.state === 'rise') continue;
    const mx = (foe.x - from.x) * ASPECT / SCALE;
    const mz = (foe.y - from.y) / (SCALE * TILT);
    const distance = Math.hypot(mx, mz);
    if (distance - (foe.kind?.radius ?? 0) > range) continue;
    const heading = Math.atan2(mx, mz);
    const off = Math.abs(wrap(heading - from.heading));
    if (off > halfAngle) continue;
    if (!best || distance < best.distance || distance === best.distance && off < best.off) {
      best = { foe, heading, distance, off };
    }
  }
  return best && { foe: best.foe, heading: best.heading, distance: best.distance };
}

// A sword cut looks a stride beyond the weapon's reach.
export function strikeAssist(player, foes) {
  return assistTarget(player, foes, { range: (player.feel?.reach ?? 0.95) + STRIKE_ASSIST_SLACK });
}

// An attack spell looks as far as it flies; heals and wards are never pulled
// toward an enemy.
export function castAssist(player, foes, spell) {
  if (!spell || spell.supportive) return null;
  return assistTarget(player, foes, { range: castAssistRange(spell) });
}
