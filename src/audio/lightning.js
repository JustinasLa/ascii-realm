import { RecordedSounds } from './recordings.js';
import { ASPECT } from '../world/world.js';

export const LIGHTNING_RECORDINGS = Object.freeze({
  thunder: Object.freeze([new URL('../../assets/audio/lightning/thunder.wav?v=thunder-field-1', import.meta.url)]),
});
const players = new WeakMap();

function playerFor(engine, options) {
  if (!engine || (typeof engine !== 'object' && typeof engine !== 'function')) return null;
  let player = players.get(engine);
  if (!player) {
    player = new RecordedSounds(engine, LIGHTNING_RECORDINGS, { ...options, bus: 'weather', maxVoices: 4 });
    players.set(engine, player);
  }
  return player;
}

export function prepareLightningSounds(engine, options) {
  return playerFor(engine, options)?.prepare() ?? Promise.resolve(false);
}

/** A real thunderclap and rolling tail. Water displacement is routed separately. */
export function playLightning(engine, event = {}) {
  const listener = engine?.listener;
  const x = Number.isFinite(event?.x) ? event.x : Number.isFinite(event?.bearing) && Number.isFinite(listener?.x)
    ? listener.x + event.bearing * 24 / ASPECT : undefined;
  return playerFor(engine)?.play('thunder', { ...event, x }, {
    key: event?.distant ? 'lightning:distant' : 'lightning:close',
    gain: event?.distant ? 0.19 : 0.34,
  }) ?? [];
}
