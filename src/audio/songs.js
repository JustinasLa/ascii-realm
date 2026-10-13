// Original arcane exploration scores. Positions and lengths are measured in beats.
// Paired scores share mode, tempo, pedal and harmonic rhythm for twilight overlap.
// Melodies are authored phrases with deliberate rests.
export const midiToFrequency = note => 440 * 2 ** ((note - 69) / 12);

const textures = Object.freeze({
  drone: { voice: 'drone', gain: 0.012, attack: 2,
    decay: 1, sustain: 0.75, release: 2.5, length: 0.94,
    detune: 0, spread: 3, cutoff: 460 },
  choir: { voice: 'choir', gain: 0.014, attack: 1.5,
    decay: 0.8, sustain: 0.65, release: 2, length: 0.9,
    detune: -2, spread: 6, cutoff: 1100 },
  bowed: { voice: 'bowed', gain: 0.012, attack: 1.1,
    decay: 0.9, sustain: 0.72, release: 1.6, length: 0.92,
    detune: 1, spread: 4, cutoff: 780 },
  bell: { voice: 'bell', gain: 0.022, attack: 0.012,
    decay: 1.4, sustain: 0.02, release: 1.8, length: 0.72,
    detune: 0, spread: 0, cutoff: 1900, ratio: 2.71 },
  breath: { voice: 'breath', gain: 0.014, attack: 0.7,
    decay: 0.6, sustain: 0.35, release: 1.2, length: 0.85,
    detune: -1, spread: 2, cutoff: 1200 },
});

function score({ id, title, bpm, key, root, harmony, melody, night = false,
  lead = night ? 'bell' : 'breath', color = 1 }) {
  const events = [];
  const add = (beat, note, beats, part, variation = {}) => {
    events.push(Object.freeze({ beat, note, beats,
      ...textures[part], ...variation }));
  };
  // A two-bar pedal replaces a metronomic bass pulse. Night adds depth
  // beneath the same fifth, with slow suspended harmony above it.
  harmony.forEach((notes, phrase) => {
    const beat = phrase * 8;
    add(beat, root - (night ? 12 : 0), 8, 'drone', {
      gain: night ? 0.011 : 0.009, cutoff: night ? 320 : 460,
    });
    add(beat, root + 7, 8, 'drone', { gain: 0.006, spread: 2 });
    for (const note of notes) {
      add(beat, note - (night ? 12 : 0), 8, night ? 'bowed' : 'choir', {
        gain: (night ? 0.011 : 0.012) * color,
      });
    }
  });
  melody.forEach((notes, bar) => {
    for (const [offset, note, beats] of notes) {
      add(bar * 4 + offset, note, beats, lead, {
        gain: textures[lead].gain * color,
      });
    }
    // A distant ritual bell marks only the end of each daylight phrase.
    if (!night && bar % 4 === 3) {
      add(bar * 4 + 3, root + 24, 0.8, 'bell', { gain: 0.008, ratio: 2.47 });
    }
  });
  events.sort((a, b) => a.beat - b.beat);
  return Object.freeze({ id, title, bpm, key, bars: 16, beats: 64,
    duration: 64 * 60 / bpm, events: Object.freeze(events) });
}

// Suspensions over D and A, with no bright dominant-to-major cadence.
const mistHarmony = [
  [62, 67], [65, 69], [64, 69], [65, 70],
  [62, 67], [60, 65], [64, 70], [62, 69],
];
const runes = score({
  id: 'day', title: 'Runes in the Mist', bpm: 54, key: 'D Aeolian',
  root: 38, harmony: mistHarmony,
  melody: [
    [[1, 69, 2]],
    [[0.5, 67, 1.5], [3, 65, 0.75]],
    [[1, 64, 2]],
    [[0.5, 65, 2]],
    [[1, 69, 1.5], [3, 70, 0.75]],
    [[0.5, 67, 2.5]],
    [[1, 65, 1.5], [3, 62, 0.75]],
    [[0.5, 64, 2.5]],
    [[1, 74, 2]],
    [[0.5, 72, 1.5], [3, 69, 0.75]],
    [[1, 67, 2]],
    [[0.5, 65, 2]],
    [[1, 69, 1.5], [3, 67, 0.75]],
    [[0.5, 65, 2.5]],
    [[1, 64, 1.5], [3, 65, 0.75]],
    [[0.5, 62, 2.5]],
  ],
});
const veil = score({
  id: 'night', title: 'Beneath the Veil', bpm: 54, key: 'D Aeolian',
  root: 38, harmony: mistHarmony, night: true,
  melody: [
    [[1.5, 74, 1.5]],
    [[0.5, 69, 2]],
    [[1, 70, 1.5], [3, 69, 0.75]],
    [[0.5, 65, 2.5]],
    [[1.5, 67, 1.5]],
    [[0.5, 65, 2]],
    [[1, 64, 1.5], [3, 70, 0.75]],
    [[0.5, 69, 2.5]],
    [[1.5, 77, 1.5]],
    [[0.5, 74, 2]],
    [[1, 72, 1.5], [3, 70, 0.75]],
    [[0.5, 69, 2.5]],
    [[1.5, 65, 1.5]],
    [[0.5, 62, 2]],
    [[1, 64, 1.5], [3, 65, 0.75]],
    [[0.5, 62, 2.5]],
  ],
});

// The flattened second is the sealed gate's recurring Phrygian question.
const gateHarmony = [
  [53, 64], [55, 62], [57, 65], [59, 64],
  [53, 60], [55, 64], [57, 62], [59, 65],
];
const gate = score({
  id: 'gate-day', title: 'The Sealed Gate', bpm: 50, key: 'E Phrygian',
  root: 40, harmony: gateHarmony, lead: 'bowed', color: 0.9,
  melody: [
    [[0.75, 64, 2]],
    [[1, 65, 1.5], [3, 64, 0.75]],
    [[0.75, 67, 2]],
    [[1, 62, 2]],
    [[0.75, 69, 2]],
    [[1, 67, 1.5], [3, 65, 0.75]],
    [[0.75, 62, 2]],
    [[1, 64, 2]],
    [[0.75, 71, 2]],
    [[1, 72, 1.5], [3, 71, 0.75]],
    [[0.75, 69, 2]],
    [[1, 67, 2]],
    [[0.75, 65, 2]],
    [[1, 64, 1.5], [3, 62, 0.75]],
    [[0.75, 65, 2]],
    [[1, 64, 2]],
  ],
});
const deep = score({
  id: 'gate-night', title: 'Whispers of the Deep', bpm: 50, key: 'E Phrygian',
  root: 40, harmony: gateHarmony, night: true, color: 0.86,
  melody: [
    [[1.5, 65, 1.5]],
    [[1, 64, 2]],
    [[1.5, 71, 1.5]],
    [[0.5, 69, 1.5], [3, 67, 0.75]],
    [[1.5, 65, 1.5]],
    [[1, 60, 2]],
    [[1.5, 62, 1.5]],
    [[0.5, 65, 1.5], [3, 64, 0.75]],
    [[1.5, 77, 1.5]],
    [[1, 76, 2]],
    [[1.5, 71, 1.5]],
    [[0.5, 72, 1.5], [3, 69, 0.75]],
    [[1.5, 67, 1.5]],
    [[1, 65, 2]],
    [[1.5, 62, 1.5]],
    [[0.5, 65, 1.5], [3, 64, 0.75]],
  ],
});

// A harmonic-minor raised seventh returns as an unresolved ritual motif.
const sanctumHarmony = [
  [60, 68], [62, 69], [65, 71], [64, 68],
  [60, 69], [62, 65], [64, 71], [60, 68],
];
const sanctum = score({
  id: 'sanctum-day', title: 'Forgotten Sanctum', bpm: 56, key: 'A harmonic minor',
  root: 45, harmony: sanctumHarmony, lead: 'choir', color: 0.94,
  melody: [
    [[1, 69, 2]],
    [[0.5, 68, 1.5], [3, 64, 0.75]],
    [[1, 65, 2]],
    [[0.5, 62, 2]],
    [[1, 60, 2]],
    [[0.5, 64, 1.5], [3, 68, 0.75]],
    [[1, 71, 2]],
    [[0.5, 69, 2]],
    [[1, 72, 2]],
    [[0.5, 71, 1.5], [3, 68, 0.75]],
    [[1, 69, 2]],
    [[0.5, 65, 2]],
    [[1, 62, 2]],
    [[0.5, 64, 1.5], [3, 60, 0.75]],
    [[1, 68, 2]],
    [[0.5, 69, 2]],
  ],
});
const covenant = score({
  id: 'sanctum-night', title: 'Embers of the Covenant', bpm: 56, key: 'A harmonic minor',
  root: 45, harmony: sanctumHarmony, night: true, color: 0.92,
  melody: [
    [[1.5, 76, 1.5]],
    [[1, 72, 2]],
    [[0.5, 71, 1.5], [3, 68, 0.75]],
    [[1.5, 69, 1.5]],
    [[1.5, 65, 1.5]],
    [[1, 62, 2]],
    [[0.5, 64, 1.5], [3, 68, 0.75]],
    [[1.5, 69, 1.5]],
    [[1.5, 80, 1.5]],
    [[1, 76, 2]],
    [[0.5, 74, 1.5], [3, 72, 0.75]],
    [[1.5, 71, 1.5]],
    [[1.5, 68, 1.5]],
    [[1, 65, 2]],
    [[0.5, 64, 1.5], [3, 68, 0.75]],
    [[1.5, 69, 1.5]],
  ],
});

export const SONGS = Object.freeze({ day: runes, night: veil });
export const SONG_PAIRS = Object.freeze([
  SONGS,
  Object.freeze({ day: gate, night: deep }),
  Object.freeze({ day: sanctum, night: covenant }),
]);
