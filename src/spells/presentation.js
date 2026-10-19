import { toCells } from '../entities/monsters.js';

export const bounded = (value, fallback, low, high) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : fallback));
export const hasPresentation = spell => typeof spell?.presentation?.draw === 'function';

// Profiles are authored in local metres. Keep malformed geometry outside the
// renderer and cap every call, including long-running zones and projectile fans.
export function paintPresentation(profile, effect, dot, budget = 256) {
  if (typeof profile?.draw !== 'function' || !Number.isFinite(effect.x) || !Number.isFinite(effect.y)) return 0;
  const life = bounded(effect.life, bounded(profile.duration, 0.6, 0.05, 60), 0.05, 60);
  const age = bounded(effect.age, 0, 0, 3600);
  const heading = bounded(effect.heading, 0, -Math.PI * 100, Math.PI * 100);
  const state = { ...effect, life, age, progress: Math.min(1, age / life),
    radius: bounded(effect.radius, 1, 0.1, 40), heading };
  const cos = Math.cos(heading), sin = Math.sin(heading);
  let count = 0;
  const plot = (x, z, char, color, brightness = 1) => {
    if (count >= budget || !Number.isFinite(x) || !Number.isFinite(z)
      || Math.abs(x) > 48 || Math.abs(z) > 48 || !Array.isArray(color)
      || color.length < 3 || !color.slice(0, 3).every(Number.isFinite)) return;
    const [cx, cy] = toCells(x * cos + z * sin, z * cos - x * sin);
    dot(effect.x + cx, effect.y + cy, typeof char === 'string' ? char[0] ?? '*' : '*',
      color.slice(0, 3).map(c => bounded(c, 0, 0, 255)), bounded(brightness, 1, 0, 1));
    count++;
  };
  try { profile.draw(state, plot); } catch { /* Presentation must never interrupt combat. */ }
  return count;
}
