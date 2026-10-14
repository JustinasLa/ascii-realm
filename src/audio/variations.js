// Small recipes, not duplicated audio buffers. Each cue gets its own shuffled
// deck, so all 25 textures play before one returns (including across refills).
export const SOUND_VARIANT_COUNT = 25;
const decks = new WeakMap();
const banks = new Map();

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hash(text) {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

function draw(random) {
  try {
    const value = random();
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999, value)) : 0.5;
  } catch { return 0.5; }
}

/** A finite shuffled playlist that avoids a repeat at a deck boundary. */
export class ShuffleBag {
  constructor(values, random = Math.random) {
    this.values = [...values];
    this.random = random;
    this.remaining = [];
    this.last = undefined;
  }

  next() {
    if (!this.values.length) return undefined;
    if (!this.remaining.length) {
      this.remaining = [...this.values];
      for (let index = this.remaining.length - 1; index > 0; index--) {
        const other = Math.floor(draw(this.random) * (index + 1));
        [this.remaining[index], this.remaining[other]] = [this.remaining[other], this.remaining[index]];
      }
      const end = this.remaining.length - 1;
      if (end > 0 && this.remaining[end] === this.last) {
        [this.remaining[0], this.remaining[end]] = [this.remaining[end], this.remaining[0]];
      }
    }
    return this.last = this.remaining.pop();
  }
}

export function soundVariantBank(key) {
  if (!banks.has(key)) {
    banks.set(key, Object.freeze(Array.from({ length: SOUND_VARIANT_COUNT }, (_, id) => {
      const seed = hash(`${key}:${id}`);
      const random = seededRandom(seed);
      return Object.freeze({
        id, seed,
        timing: 0.84 + random() * 0.28,
        color: 0.78 + random() * 0.44,
        level: 0.84 + random() * 0.16,
        attack: 0.72 + random() * 0.56,
        tail: 0.78 + random() * 0.44,
        pitch: 0.96 + random() * 0.08,
        rate: 0.9 + random() * 0.2,
        offset: (id + 0.5) / SOUND_VARIANT_COUNT,
      });
    })));
  }
  return banks.get(key);
}

/** State belongs to the engine, so unrelated sources never advance a cue's deck. */
export function nextSoundVariant(engine, key, random = Math.random) {
  let state = decks.get(engine);
  if (!state) { state = new Map(); decks.set(engine, state); }
  let deck = state.get(key);
  if (!deck) {
    deck = new ShuffleBag(soundVariantBank(key), random);
    state.set(key, deck);
  }
  return deck.next();
}

/** Vary a whole phrase together, with different material balance per layer. */
export function varySound(variant, options, layer = 0) {
  if (!variant || !options || typeof options !== 'object') return options;
  const random = seededRandom(variant.seed ^ Math.imul(layer + 1, 0x9e3779b1));
  const mix = 0.88 + random() * 0.12;
  const color = variant.color * (0.94 + random() * 0.12);
  const result = { ...options, offset: (variant.offset + layer * 0.173) % 1,
    playbackRate: variant.rate };
  for (const field of ['duration', 'delay', 'decay', 'release']) {
    if (Number.isFinite(options[field])) result[field] = options[field] * variant.timing;
  }
  if (Number.isFinite(options.attack)) result.attack = options.attack * variant.timing * variant.attack;
  if (Number.isFinite(options.cutoff)) result.cutoff = options.cutoff * color;
  if (Number.isFinite(options.gain)) result.gain = options.gain * variant.level * mix;
  if (Number.isFinite(options.sustain)) result.sustain = Math.min(1, options.sustain * variant.tail);
  for (const field of ['frequency', 'endFrequency']) {
    if (Number.isFinite(options[field])) result[field] = options[field] * variant.pitch;
  }
  return result;
}
