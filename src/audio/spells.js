import { noise, tone } from './voices.js';

const bounded = (value, fallback, low, high) => Math.min(high, Math.max(low, Number.isFinite(value) ? value : fallback));

/** Short authored layers on the existing SFX bus, with no extra timers/assets. */
export function playSpellSound(engine, event) {
  if (engine.context?.state !== 'running' || !Number.isFinite(event.x) || !Number.isFinite(event.y)) return [];
  const recipe = event.presentation?.sounds?.[event.stage];
  if (!Array.isArray(recipe)) return [];
  return recipe.slice(0, 8).flatMap(spec => {
    if (!spec || !['tone', 'noise'].includes(spec.kind)) return [];
    const options = { ...spec, bus: 'sfx', x: event.x, y: event.y,
      when: engine.context.currentTime + bounded(spec.delay, 0, 0, 1.5),
      duration: bounded(spec.duration, 0.15, 0.01, 3), gain: bounded(spec.gain, 0.08, 0, 0.3) };
    const handle = (spec.kind === 'noise' ? noise : tone)(engine, options);
    return handle ? [handle] : [];
  });
}
