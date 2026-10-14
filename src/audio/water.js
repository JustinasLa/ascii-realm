import { RecordedSounds } from './recordings.js';

const recording = name => new URL(`../../assets/audio/water/${name}.wav?v=water-field-1`, import.meta.url);
export const WATER_RECORDINGS = Object.freeze({
  step: Object.freeze(Array.from({ length: 6 }, (_, i) => recording(`wade-${i + 1}`))),
  lift: Object.freeze([recording('lift-1'), recording('lift-2')]),
  wash: Object.freeze([recording('wash-1'), recording('wash-2')]),
  skid: Object.freeze([recording('skid-1'), recording('skid-2')]),
  impact: Object.freeze([recording('splash-1'), recording('splash-2')]),
  lightning: Object.freeze([recording('splash-big')]),
});

const profiles = {
  step: { bank: 'step', gain: 0.23 },
  jump: { bank: 'lift', gain: 0.22 },
  land: { bank: 'impact', gain: 0.32 },
  splash: { bank: 'impact', gain: 0.29 },
  slam: { bank: 'impact', gain: 0.34 },
  whirl: { bank: 'wash', gain: 0.25 },
  skid: { bank: 'skid', gain: 0.10 },
  lightning: { bank: 'lightning', gain: 0.40 },
};
const players = new WeakMap();

export class WaterSounds extends RecordedSounds {
  constructor(engine, options) {
    super(engine, WATER_RECORDINGS, options);
    this.lastSkid = null;
  }

  contact(event = {}) {
    if (!Object.hasOwn(profiles, event?.type)) return [];
    const context = this._syncContext();
    if (context?.state !== 'running' || !this._audible()) { this.pause(); return []; }
    if (event.type === 'skid' && this.lastSkid?.context === context
      && context.currentTime >= this.lastSkid.time && context.currentTime - this.lastSkid.time < 0.12) return [];
    const { bank, gain } = profiles[event.type];
    const handles = this.play(bank, event, { gain, key: `water:${event.type}`,
      rate: event.type === 'step' && event.strength > 0.7 ? 1.04 : 1 });
    if (handles.length && event.type === 'skid') this.lastSkid = { context, time: context.currentTime };
    return handles;
  }
}

function playerFor(engine, options) {
  if (!engine || (typeof engine !== 'object' && typeof engine !== 'function')) return null;
  let player = players.get(engine);
  if (!player) { player = new WaterSounds(engine, options); players.set(engine, player); }
  return player;
}

export function prepareWaterSounds(engine, options) {
  return playerFor(engine, options)?.prepare() ?? Promise.resolve(false);
}

export function playWaterSound(engine, event = {}) {
  return playerFor(engine)?.contact(event) ?? [];
}
