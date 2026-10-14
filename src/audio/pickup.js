import { noise, tone } from './voices.js';

/**
 * Picking something up: a short cloth or leaf brush over a very quiet,
 * damped contact. It plays on the shared effects bus, so the audio panel's
 * mute and volumes apply, and only for a real, positive pickup.
 */
export function playPickup(engine, event) {
  if (engine?.context?.state !== 'running' || event?.type !== 'pickup' || event.success === false) return [];
  if (event.count !== undefined && (!Number.isFinite(event.count) || event.count <= 0)) return [];
  const position = { bus: 'sfx', x: event.x, y: event.y };
  return [
    noise(engine, { ...position, cutoff: 1150, filterType: 'lowpass', Q: 0.55, duration: 0.2,
      gain: 0.055, attack: 0.008, decay: 0.042, sustain: 0.15, release: 0.15 }),
    tone(engine, { ...position, frequency: 145, duration: 0.09,
      gain: 0.022, attack: 0.003, decay: 0.032, sustain: 0.1, release: 0.055 }),
  ].filter(Boolean);
}
