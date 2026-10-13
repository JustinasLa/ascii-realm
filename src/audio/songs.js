// Original arcane exploration scores. Positions and lengths are measured in beats.
// Paired scores share mode, tempo, pedal and harmonic rhythm for twilight overlap.
// Melodies are authored phrases with deliberate rests.
export const midiToFrequency = note => 440 * 2 ** ((note - 69) / 12);

const textures = Object.freeze({
  drone: { voice: 'drone', type: 'sine', gain: 0.012, attack: 2,
    decay: 1, sustain: 0.75, release: 2.5, length: 0.94,
    detune: 0, spread: 3, cutoff: 460 },
  choir: { voice: 'choir', type: 'sine', gain: 0.014, attack: 1.5,
    decay: 0.8, sustain: 0.65, release: 2, length: 0.9,
    detune: -2, spread: 6, cutoff: 1100 },
  bowed: { voice: 'bowed', type: 'triangle', gain: 0.012, attack: 1.1,
    decay: 0.9, sustain: 0.72, release: 1.6, length: 0.92,
    detune: 1, spread: 4, cutoff: 780 },
  bell: { voice: 'bell', type: 'sine', gain: 0.022, attack: 0.012,
    decay: 1.4, sustain: 0.02, release: 1.8, length: 0.72,
    detune: 0, spread: 0, cutoff: 1900, ratio: 2.71 },
  breath: { voice: 'breath', type: 'sine', gain: 0.014, attack: 0.7,
    decay: 0.6, sustain: 0.35, release: 1.2, length: 0.85,
    detune: -1, spread: 2, cutoff: 1200 },
});

function score({ id, title, bpm, key, root, harmony, melody, night = false,
  lead = night ? 'bell' : 'breath', color = 1 }) {
  const events = [];
  const add = (beat, note, beats, part, variation = {}) => {
    events.push(Object.freeze({ beat, note, beats, part,
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

// Additional scores use authored scale-degree phrases, not random notes or
// transpositions of the original three. Each climate has two distinct pairs.
const modes = {
  Aeolian: [0, 2, 3, 5, 7, 8, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
};

function climatePair({ id, titles, root, key, bpm, chords, day, night,
  season, weather, lead = 'breath', nightLead = 'bell', rhythm = 0, color = 0.9 }) {
  const scale = modes[key.slice(2)];
  const note = degree => root + 24 + Math.floor(degree / 7) * 12 + scale[((degree % 7) + 7) % 7];
  const harmony = chords.map(degree => [note(degree), note(degree + 2)]);
  const phrasing = [[0.75, 2], [1, 1.75], [0.5, 2.5], [1.5, 1.5]][rhythm];
  const melody = (degrees, nocturnal) => degrees.map((degree, bar) => {
    const [offset, length] = nocturnal ? [phrasing[0] + 0.25, phrasing[1] - 0.25] : phrasing;
    const notes = [[offset, note(degree), length]];
    if (bar % 4 === (nocturnal ? 2 : 1)) notes.push([3.25, note(degrees[(bar + 3) % 16]), 0.5]);
    return notes;
  });
  return Object.freeze({
    season, weather,
    day: score({ id: `${id}-day`, title: titles[0], bpm, key, root,
      harmony, melody: melody(day, false), lead, color }),
    night: score({ id: `${id}-night`, title: titles[1], bpm, key, root,
      harmony, melody: melody(night, true), night: true, lead: nightLead, color: color * 0.94 }),
  });
}

const climateScores = [
  {
    id: 'bloom', season: 'spring', titles: ['The First Green', 'Petals Under the Moon'],
    root: 38, key: 'D Aeolian', bpm: 60, chords: [0, 3, 1, 4, 2, 5, 3, 0],
    day: [0, 2, 4, 3, 1, 3, 5, 4, 7, 6, 4, 5, 3, 2, 1, 0],
    night: [7, 4, 5, 2, 3, 1, 2, 0, 9, 7, 6, 4, 5, 3, 1, 0],
  },
  {
    id: 'thaw', season: 'spring', titles: ['Water Beneath the Roots', 'The Seedkeeper'],
    root: 45, key: 'A harmonic minor', bpm: 57, chords: [0, 2, 4, 1, 3, 5, 2, 0],
    day: [4, 2, 3, 0, 1, 4, 6, 5, 7, 9, 8, 6, 4, 3, 6, 7],
    night: [2, 0, 4, 3, 6, 4, 1, 2, 7, 6, 9, 7, 5, 3, 1, 0],
    lead: 'choir', rhythm: 2,
  },
  {
    id: 'meadow', season: 'summer', titles: ['Long Meadow Light', 'Moths at the Lantern'],
    root: 43, key: 'G Aeolian', bpm: 62, chords: [0, 4, 3, 1, 5, 2, 4, 0],
    day: [4, 5, 7, 6, 4, 2, 3, 1, 7, 8, 9, 7, 5, 4, 2, 0],
    night: [9, 7, 4, 5, 6, 3, 4, 2, 8, 6, 7, 5, 4, 1, 2, 0],
    rhythm: 1,
  },
  {
    id: 'lantern', season: 'summer', titles: ['The Quiet Orchard', 'A Thousand Small Lights'],
    root: 38, key: 'D Aeolian', bpm: 59, chords: [2, 0, 3, 5, 1, 4, 3, 0],
    day: [2, 4, 3, 5, 4, 7, 6, 3, 8, 7, 5, 6, 4, 2, 3, 0],
    night: [4, 7, 5, 3, 6, 4, 2, 1, 9, 8, 6, 7, 5, 3, 4, 0],
    lead: 'bowed', rhythm: 2,
  },
  {
    id: 'harvest', season: 'autumn', titles: ['Ochre Fields', 'The Last Harvest Bell'],
    root: 40, key: 'E Phrygian', bpm: 53, chords: [0, 1, 3, 2, 4, 1, 5, 0],
    day: [7, 5, 4, 1, 3, 2, 1, 0, 8, 6, 5, 3, 4, 2, 1, 0],
    night: [4, 1, 0, 2, 5, 3, 1, 0, 7, 4, 5, 2, 3, 1, 2, 0],
    lead: 'bowed', rhythm: 3,
  },
  {
    id: 'leaves', season: 'autumn', titles: ['Leaves on the Old Road', 'Amber Vigil'],
    root: 45, key: 'A harmonic minor', bpm: 55, chords: [3, 0, 2, 4, 1, 5, 3, 0],
    day: [6, 7, 4, 2, 5, 3, 1, 0, 9, 8, 6, 4, 7, 5, 3, 0],
    night: [7, 6, 3, 4, 2, 1, 4, 0, 8, 9, 7, 6, 4, 3, 6, 7],
    lead: 'choir', rhythm: 1, color: 0.85,
  },
  {
    id: 'frost', season: 'winter', titles: ['Frost on the Threshold', 'Stars Above the Ice'],
    root: 38, key: 'D Aeolian', bpm: 46, chords: [0, 3, 5, 1, 4, 2, 3, 0],
    day: [0, 4, 3, 1, 2, 5, 4, 0, 7, 4, 6, 5, 3, 1, 2, 0],
    night: [7, 9, 6, 4, 8, 5, 3, 4, 9, 7, 5, 2, 4, 1, 3, 0],
    lead: 'bell', rhythm: 3, color: 0.74,
  },
  {
    id: 'hearth', season: 'winter', titles: ['The Sheltered Hearth', 'Ashes Until Dawn'],
    root: 41, key: 'F Aeolian', bpm: 49, chords: [0, 2, 5, 3, 1, 4, 2, 0],
    day: [3, 2, 0, 4, 5, 3, 1, 2, 7, 5, 4, 2, 3, 1, 4, 0],
    night: [4, 2, 3, 0, 6, 4, 1, 2, 8, 7, 4, 5, 3, 2, 1, 0],
    lead: 'bowed', nightLead: 'breath', rhythm: 2, color: 0.8,
  },
  {
    id: 'silver-rain', weather: 'rain', titles: ['Silver on the Lake', 'Rain at the Window'],
    root: 43, key: 'G Aeolian', bpm: 52, chords: [0, 3, 2, 5, 1, 4, 2, 0],
    day: [4, 3, 5, 2, 6, 4, 2, 1, 8, 7, 5, 4, 6, 3, 1, 0],
    night: [7, 5, 3, 4, 2, 0, 1, 3, 9, 6, 4, 5, 3, 2, 4, 0],
    lead: 'bell', nightLead: 'bowed', rhythm: 1, color: 0.82,
  },
  {
    id: 'reeds', weather: 'rain', titles: ['Rain Through the Reeds', 'The Sunken Ferry'],
    root: 38, key: 'D Aeolian', bpm: 55, chords: [2, 4, 0, 3, 5, 1, 4, 0],
    day: [2, 5, 4, 0, 3, 6, 5, 2, 7, 9, 6, 4, 5, 3, 1, 0],
    night: [5, 2, 4, 1, 6, 3, 0, 2, 8, 5, 7, 4, 6, 2, 3, 0],
    rhythm: 2,
  },
  {
    id: 'iron-sky', weather: 'storm', titles: ['Under an Iron Sky', 'Thunder Beyond the Keep'],
    root: 40, key: 'E Phrygian', bpm: 50, chords: [0, 1, 4, 2, 3, 5, 1, 0],
    day: [0, 1, 4, 3, 2, 5, 1, 0, 7, 8, 5, 4, 3, 1, 2, 0],
    night: [4, 1, 3, 0, 5, 2, 4, 1, 8, 7, 4, 2, 5, 3, 1, 0],
    lead: 'bowed', nightLead: 'choir', rhythm: 3, color: 0.84,
  },
  {
    id: 'broken-spire', weather: 'storm', titles: ['The Broken Spire', 'Oath in the Downpour'],
    root: 45, key: 'A harmonic minor', bpm: 54, chords: [0, 4, 1, 3, 5, 2, 4, 0],
    day: [6, 4, 7, 3, 5, 2, 6, 4, 9, 6, 8, 5, 7, 4, 6, 0],
    night: [7, 6, 4, 1, 3, 6, 5, 2, 8, 9, 6, 4, 5, 3, 6, 7],
    lead: 'choir', rhythm: 0, color: 0.86,
  },
  {
    id: 'white-road', weather: 'snow', titles: ['The White Road', 'Footprints Without a Name'],
    root: 41, key: 'F Aeolian', bpm: 45, chords: [0, 5, 2, 3, 1, 4, 5, 0],
    day: [4, 0, 2, 5, 3, 1, 4, 2, 7, 3, 5, 8, 6, 4, 2, 0],
    night: [9, 7, 4, 2, 6, 3, 1, 0, 8, 5, 7, 4, 2, 3, 1, 0],
    lead: 'bell', rhythm: 3, color: 0.7,
  },
  {
    id: 'buried-shrine', weather: 'snow', titles: ['The Buried Shrine', 'A Candle in the Snow'],
    root: 38, key: 'D Aeolian', bpm: 48, chords: [3, 0, 4, 1, 5, 2, 3, 0],
    day: [3, 5, 2, 0, 4, 1, 3, 5, 7, 4, 8, 6, 5, 2, 1, 0],
    night: [5, 3, 0, 2, 7, 4, 1, 3, 9, 6, 4, 7, 5, 1, 2, 0],
    lead: 'choir', nightLead: 'breath', rhythm: 2, color: 0.78,
  },
  {
    id: 'wanderer', weather: 'wind', titles: ['The Wanderer Wind', 'Cairns in the Dark'],
    root: 43, key: 'G Aeolian', bpm: 58, chords: [0, 4, 2, 5, 3, 1, 4, 0],
    day: [0, 3, 4, 7, 5, 2, 6, 4, 8, 9, 7, 5, 4, 6, 2, 0],
    night: [7, 4, 2, 5, 3, 6, 4, 0, 9, 8, 5, 7, 6, 3, 1, 0],
    rhythm: 0,
  },
  {
    id: 'dune', weather: 'wind', titles: ['Dust of the Pilgrim', 'The Empty Watchtower'],
    root: 40, key: 'E Phrygian', bpm: 56, chords: [0, 2, 1, 4, 5, 3, 1, 0],
    day: [1, 4, 2, 3, 5, 1, 0, 4, 8, 6, 5, 3, 4, 2, 1, 0],
    night: [4, 5, 1, 0, 2, 4, 3, 1, 7, 8, 4, 6, 5, 2, 1, 0],
    lead: 'bowed', rhythm: 1,
  },
  {
    id: 'lost-path', weather: 'fog', titles: ['Where the Path Vanishes', 'Names in the Fog'],
    root: 38, key: 'D Aeolian', bpm: 47, chords: [0, 3, 1, 5, 2, 4, 3, 0],
    day: [2, 0, 3, 1, 5, 4, 2, 0, 7, 5, 8, 6, 4, 3, 1, 0],
    night: [5, 4, 1, 3, 2, 0, 4, 1, 8, 7, 3, 5, 6, 2, 1, 0],
    lead: 'choir', nightLead: 'bowed', rhythm: 3, color: 0.76,
  },
  {
    id: 'glass-fen', weather: 'fog', titles: ['The Glass Fen', 'A Boat Without Oars'],
    root: 45, key: 'A harmonic minor', bpm: 51, chords: [2, 0, 5, 3, 1, 4, 2, 0],
    day: [4, 6, 3, 1, 2, 5, 4, 0, 8, 6, 9, 7, 5, 3, 6, 7],
    night: [6, 4, 0, 2, 3, 1, 5, 4, 9, 7, 6, 3, 4, 2, 1, 0],
    lead: 'breath', rhythm: 2, color: 0.8,
  },
].map(climatePair);

export const SONGS = Object.freeze({ day: runes, night: veil });
export const SONG_PAIRS = Object.freeze([
  SONGS,
  Object.freeze({ day: gate, night: deep }),
  Object.freeze({ day: sanctum, night: covenant }),
  ...climateScores,
]);
