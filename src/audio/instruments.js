// The nine off-hand instruments: their data, the pitch maths that turns a
// played key into notes, and one-shot playback on the records bus. Nothing
// here touches Web Audio until a note is played, so the server can import
// the tables and the note check.
import { buildVoice, prepareStrings, prepareVoice, STRING_VOICES } from './instrument-voices.js';

// Notes 1-8 are C D E F G A B C, rising from the instrument's first note.
export const SCALE = Object.freeze([0, 2, 4, 5, 7, 9, 11]);
export const NOTE_LETTERS = Object.freeze(['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']);
// The triad on each degree of C major, named in ASCII for the note slots.
export const CHORD_NAMES = Object.freeze(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C']);
// At most this many pitches sound at once, counting chords note by note and
// stolen voices until their release has ended.
export const MAX_VOICES = 24;
// How long a stolen voice takes to fade: long enough not to click.
export const STEAL_RELEASE = 0.04;
// Notes start this far ahead of the audio clock, so every point of their
// envelope is still in the future when the audio thread reads it.
export const START_LEAD = 0.01;

// A note's loudness sets how far it carries: 16 m per unit, linearly to silence.
const METRES_PER_LOUDNESS = 16;

// id, name, voice, MIDI number of note 1, what Shift does, note length (s),
// peak level before the records bus (balanced by ear and by measured RMS).
const definitions = [
  ['accordion', 'Accordion', 'reed', 60, 'chord', 1.4, 0.15],
  ['bagpipe', 'Bagpipe', 'chanter', 60, 'octave', 1.3, 0.13],
  ['celticHarp', 'Celtic Harp', 'harp', 72, 'chord', 2.5, 0.47],
  ['dulcimer', 'Dulcimer', 'hammered', 60, 'chord', 2.3, 0.28],
  ['flute', 'Flute', 'breath', 72, 'octave', 1.5, 0.076],
  ['kalimba', 'Kalimba', 'tine', 72, 'chord', 1.4, 0.128],
  ['lute', 'Lute', 'pluck', 60, 'chord', 1.8, 0.3],
  ['trumpet', 'Trumpet', 'brass', 60, 'octave', 1.3, 0.15],
  ['vielle', 'Vielle', 'bowed', 60, 'chord', 1.6, 0.155],
];

export const INSTRUMENTS = Object.freeze(Object.fromEntries(definitions.map(
  ([id, name, voice, root, mode, length, level]) => [id, Object.freeze({
    id, name, voice, root, mode, length, level, loudness: 4, pitch: 1,
  })])));
export const INSTRUMENT_IDS = Object.freeze(definitions.map(([id]) => id));

const instrumentOf = id => typeof id === 'string' && Object.hasOwn(INSTRUMENTS, id) ? INSTRUMENTS[id] : null;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const step = index => 12 * Math.floor(index / 7) + SCALE[index % 7];
const octaveName = midi => `C${Math.floor(midi / 12) - 1}`;

/** What Shift+1-8 plays: 'chords', or 'notes' an octave up (9-16). */
export function secondLayer(id) {
  const instrument = instrumentOf(id);
  if (!instrument) return null;
  return instrument.mode === 'chord' ? 'chords' : 'notes';
}

/**
 * Checks a played note { instrument, degree, octave, chord }: a known
 * instrument, degree 0-7, octave -1, 0 or 1 and a boolean chord. Any
 * instrument may play a chord; the note slots' Shift layer is a separate matter.
 */
export function isInstrumentNote(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.some(key => !['instrument', 'degree', 'octave', 'chord'].includes(key))) return false;
  return Boolean(instrumentOf(value.instrument))
    && Number.isInteger(value.degree) && value.degree >= 0 && value.degree <= 7
    && [-1, 0, 1].includes(value.octave ?? 0)
    && typeof (value.chord ?? false) === 'boolean';
}

/** MIDI notes for a degree (0-7): one pitch, or a root-position triad voiced upwards. */
export function noteMidi(id, degree, octave = 0, chord = false) {
  const instrument = instrumentOf(id);
  if (!instrument) return [];
  const base = instrument.root + 12 * octave;
  const degrees = chord ? [degree, degree + 2, degree + 4] : [degree];
  return degrees.map(index => base + step(index));
}

/** The note a slot (1-8) plays, with or without Shift. */
export function layerNote(id, slot, shifted = false) {
  const layer = secondLayer(id);
  if (!layer || !Number.isInteger(slot) || slot < 1 || slot > 8) return null;
  const degree = slot - 1;
  if (!shifted) return { degree, octave: 0, chord: false };
  return layer === 'chords' ? { degree, octave: 0, chord: true } : { degree, octave: 1, chord: false };
}

/** The range the instrument's two layers span, e.g. 'C4-C5'. */
export function noteRange(id) {
  const instrument = instrumentOf(id);
  if (!instrument) return '';
  const top = instrument.root + (instrument.mode === 'chord' ? 12 : 24);
  return `${octaveName(instrument.root)}-${octaveName(top)}`;
}

/** The keys an instrument answers to, as shown in its item details. */
export function noteReference(id) {
  const layer = secondLayer(id);
  if (!layer) return [];
  const keys = start => NOTE_LETTERS.map((letter, index) => `${start + index}-[${letter}]`).join(' ');
  return [
    `Use keys 1-8 to play notes: ${keys(1)}`,
    layer === 'chords' ? `Hold Shift to play chords: ${keys(1)}` : `Hold Shift to play additional notes: ${keys(9)}`,
  ];
}

const PITCH_LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A MIDI note's name in ASCII, e.g. 60 -> 'C4' (sharps as '#'). */
export function pitchName(midi) {
  return `${PITCH_LETTERS[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

/**
 * What slots 1-8 play, for the note slots: { slot, label, pitches, degree,
 * octave, chord }. Single notes carry their octave ('C4'); chords list only
 * their letters ('D F A'), which is all a slot has room for.
 */
export function noteSlots(id, shifted = false) {
  if (!secondLayer(id)) return [];
  return NOTE_LETTERS.map((letter, index) => {
    const slot = index + 1;
    const note = layerNote(id, slot, shifted);
    const midis = noteMidi(id, note.degree, note.octave, note.chord);
    return { slot, label: note.chord ? CHORD_NAMES[index] : letter,
      pitches: note.chord ? midis.map(midi => pitchName(midi).replace(/-?\d+$/, '')).join(' ') : pitchName(midis[0]),
      ...note };
  });
}

/** How far a note carries, in metres. */
export function hearingRange(id) {
  const instrument = instrumentOf(id);
  return instrument ? instrument.loudness * METRES_PER_LOUDNESS : 0;
}

/** Linear falloff from full loudness at the player to silence at the range. */
export function instrumentFalloff(id, metres) {
  const range = hearingRange(id);
  if (!range || !Number.isFinite(metres)) return 0;
  return clamp(1 - Math.max(0, metres) / range, 0, 1);
}

// The voices sounding on each engine, oldest first.
const pools = new WeakMap();

function poolOf(engine) {
  let pool = pools.get(engine);
  if (!pool) pools.set(engine, pool = []);
  return pool;
}

/** The voices still counted on an engine: playing, waiting to start or fading out. */
export function soundingVoices(engine) {
  const now = engine?.context?.currentTime ?? 0;
  const pool = poolOf(engine);
  for (let index = pool.length - 1; index >= 0; index--) {
    if (pool[index].ended || pool[index].end <= now) pool.splice(index, 1);
  }
  return pool;
}

// Make room for `count` new voices and return their shared start time.
// Stealing drops the oldest voices: one still waiting to start is silent and
// is cancelled outright; one already sounding fades from now and stays
// counted until its release ends. Every fade so ends by now + STEAL_RELEASE,
// which is the latest a new note can have to wait.
function reserve(engine, count, now) {
  const pool = soundingVoices(engine);
  const steady = pool.filter(voice => !voice.fading);
  while (steady.length + count > MAX_VOICES) {
    const oldest = steady.shift();
    if (oldest.start > now) oldest.cancel();
    else oldest.fade(now);
  }
  const allowed = MAX_VOICES - steady.length - count;
  const fading = pool.filter(voice => voice.fading).map(voice => voice.end).sort((a, b) => b - a);
  const start = now + START_LEAD;
  return fading.length > allowed ? Math.max(start, fading[allowed]) : start;
}

/** Renders an instrument's string buffers ahead of its first note. */
export function prepareInstrument(engine, id) {
  const instrument = instrumentOf(id);
  const context = engine?.context;
  if (!instrument || !context || !STRING_VOICES.has(instrument.voice)) return Promise.resolve(false);
  const midis = [];
  for (let index = 0; index < 12; index++) midis.push(instrument.root + step(index));
  return prepareStrings(context, instrument, midis);
}

function startVoice(engine, instrument, midi, at, gain, x, y, company) {
  const route = engine.route('records', x, y);
  if (!route?.input) return null;
  // Instruments set their own loudness; the route only pans.
  route.input.gain.value = gain;
  const built = buildVoice(engine.context, route.input, instrument, midi, at, company);
  if (!built) {
    route.dispose();
    return null;
  }
  const { sources, nodes, envelope } = built;
  let ended = false;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* Already disconnected. */ }
    }
    route.dispose();
  };
  const halt = when => {
    for (const source of sources) {
      try { source.stop(when); } catch { /* A source may already have stopped. */ }
    }
  };
  let remaining = sources.length;
  for (const source of sources) {
    source.onended = () => {
      if (--remaining <= 0) cleanup();
    };
  }
  const voice = {
    instrument: instrument.id,
    midi,
    start: at,
    end: at + instrument.length,
    fading: false,
    get ended() { return ended; },
    // Fade out over the steal release, then stop.
    fade(now, seconds = STEAL_RELEASE) {
      if (ended || voice.fading) return;
      voice.fading = true;
      const from = Math.max(now, voice.start);
      voice.end = Math.min(voice.end, from + seconds);
      try {
        const param = envelope.gain;
        if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(from);
        else {
          param.cancelScheduledValues(from);
          param.setValueAtTime(param.value, from);
        }
        param.linearRampToValueAtTime(0, voice.end);
        halt(voice.end + 0.005);
      } catch {
        stop();
      }
    },
    // A voice that has not started was never heard: drop it without a fade.
    cancel() {
      voice.end = voice.start;
      stop();
    },
    stop,
  };
  function stop() {
    if (ended) return;
    halt();
    cleanup();
  }
  return voice;
}

/**
 * Plays one note or chord as a one-shot on the records bus. `level` (0-1)
 * scales it; a listener's distance falloff goes there. Returns one stoppable
 * handle for the whole note, or null when nothing can sound.
 */
export function playInstrumentNote(engine, event = {}) {
  const context = engine?.context;
  if (context?.state !== 'running') return null;
  const note = { instrument: event.instrument, degree: event.degree,
    octave: event.octave ?? 0, chord: event.chord ?? false };
  if (!isInstrumentNote(note)) return null;
  const level = clamp(Number.isFinite(event.level) ? event.level : 1, 0, 1);
  if (level <= 0) return null;
  const instrument = INSTRUMENTS[note.instrument];
  const midis = noteMidi(note.instrument, note.degree, note.octave, note.chord);
  // Render every buffer first; only then read the clock, so all the pitches
  // share one start time that is still ahead of it.
  try {
    prepareVoice(context, instrument, midis);
  } catch {
    return null;
  }
  // Equal power: a chord is about as loud as a single note.
  const gain = level / Math.sqrt(midis.length);
  const at = reserve(engine, midis.length, context.currentTime);
  const company = soundingVoices(engine).filter(voice => voice.instrument === instrument.id && !voice.fading).length;
  const voices = [];
  for (const midi of midis) {
    const voice = startVoice(engine, instrument, midi, at, gain, event.x, event.y, company + voices.length);
    if (!voice) {
      for (const started of voices) started.stop();
      return null;
    }
    voices.push(voice);
  }
  poolOf(engine).push(...voices);
  return {
    voices,
    end: at + instrument.length,
    get ended() { return voices.every(voice => voice.ended); },
    stop() { for (const voice of voices) voice.stop(); },
    fade(seconds = STEAL_RELEASE) {
      for (const voice of voices) voice.fade(engine.context?.currentTime ?? 0, seconds);
    },
  };
}
