import thunderstorm from './weather/thunderstorm.js';
import { noise } from './voices.js';

const groups = new WeakMap();
const MAX_THUNDER = 4;

// Manual strikes reuse the storm's authored pressure front and rolling tail.
// Natural bolts are triggered by the weather audio's own thunder schedule.
export function playLightning(engine, event = {}) {
  const context = engine?.context;
  if (context?.state !== 'running' || engine.muted || engine.volumes?.master === 0
      || engine.volumes?.ambience === 0 || engine.volumes?.weather === 0) return [];
  const strength = Math.max(0, Math.min(1, Number.isFinite(event.strength) ? event.strength : 1));
  if (!strength) return [];
  let active = (groups.get(engine) ?? []).filter(g => g.some(h => !h.ended));
  while (active.length >= MAX_THUNDER) for (const handle of active.shift()) handle.stop();
  const handles = thunderstorm.events[0].create({ intensity: strength, random: Math.random })
    .map(cue => noise(engine, { ...cue, bus: 'weather', x: event.x, y: event.y,
      when: context.currentTime + (cue.delay ?? 0) })).filter(Boolean);
  active.push(handles);
  groups.set(engine, active);
  return handles;
}
