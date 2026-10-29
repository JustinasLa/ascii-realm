import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CHORD_NAMES, INSTRUMENT_IDS, INSTRUMENTS, NOTE_LETTERS, SCALE, hearingRange, instrumentFalloff,
  isInstrumentNote, layerNote, noteMidi, noteRange, noteReference, noteSlots, pitchName, secondLayer,
} from '../src/audio/instruments.js';
import { INSTRUMENT_ITEMS } from '../src/inventory/instrument-items.js';
import { itemArt } from '../src/ui/item-art.js';

const CHORDS = ['accordion', 'celticHarp', 'dulcimer', 'kalimba', 'lute', 'vielle'];
const OCTAVES = ['bagpipe', 'flute', 'trumpet'];
const HIGH = ['celticHarp', 'flute', 'kalimba'];

test('the nine instruments are frozen data with the reference numbers', () => {
  assert.deepEqual(INSTRUMENT_IDS, ['accordion', 'bagpipe', 'celticHarp', 'dulcimer', 'flute',
    'kalimba', 'lute', 'trumpet', 'vielle']);
  assert.ok(Object.isFrozen(INSTRUMENTS) && Object.isFrozen(INSTRUMENT_IDS));
  for (const id of INSTRUMENT_IDS) {
    const instrument = INSTRUMENTS[id];
    assert.ok(Object.isFrozen(instrument));
    assert.equal(instrument.id, id);
    assert.equal(instrument.loudness, 4);
    assert.equal(instrument.pitch, 1);
    assert.equal(instrument.mode, CHORDS.includes(id) ? 'chord' : 'octave');
    assert.equal(instrument.root, HIGH.includes(id) ? 72 : 60, `${id} starts on C5 or C4`);
    assert.ok(instrument.length >= 1 && instrument.length <= 2.5, `${id} has a natural note length`);
    assert.ok(instrument.level > 0 && instrument.level < 1);
  }
  assert.deepEqual([...SCALE], [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual([...NOTE_LETTERS], ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']);
  assert.deepEqual([...CHORD_NAMES], ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C']);
});

test('notes climb the C major scale and chords are root-position triads voiced upwards', () => {
  const steps = [0, 2, 4, 5, 7, 9, 11, 12];
  const triads = [[60, 64, 67], [62, 65, 69], [64, 67, 71], [65, 69, 72],
    [67, 71, 74], [69, 72, 76], [71, 74, 77], [72, 76, 79]];
  for (const id of INSTRUMENT_IDS) {
    const root = INSTRUMENTS[id].root;
    for (const octave of [-1, 0, 1]) {
      for (let degree = 0; degree < 8; degree++) {
        assert.deepEqual(noteMidi(id, degree, octave), [root + 12 * octave + steps[degree]]);
        const chord = noteMidi(id, degree, octave, true);
        assert.deepEqual(chord, triads[degree].map(midi => midi - 60 + root + 12 * octave));
        assert.ok(chord[0] < chord[1] && chord[1] < chord[2], 'voiced upwards from the root');
      }
    }
  }
  assert.deepEqual(noteMidi('lute', 7, 0, true), [72, 76, 79]);
  assert.deepEqual(noteMidi('lute', 0), [60], 'octave and chord default to a plain note');
  assert.deepEqual(noteMidi('shortSword', 0), []);
});

test('the note layer: notes 1-8, then chords or notes 9-16 with Shift, never slot 9', () => {
  for (const id of CHORDS) assert.equal(secondLayer(id), 'chords');
  for (const id of OCTAVES) assert.equal(secondLayer(id), 'notes');
  assert.equal(secondLayer('shortSword'), null);
  for (let slot = 1; slot <= 8; slot++) {
    assert.deepEqual(layerNote('lute', slot), { degree: slot - 1, octave: 0, chord: false });
    assert.deepEqual(layerNote('lute', slot, true), { degree: slot - 1, octave: 0, chord: true });
    assert.deepEqual(layerNote('flute', slot, true), { degree: slot - 1, octave: 1, chord: false });
  }
  // Notes 9-16 are the scale an octave up: 9 is C an octave above 1.
  const nine = layerNote('trumpet', 1, true);
  assert.deepEqual(noteMidi('trumpet', nine.degree, nine.octave, nine.chord), [72]);
  for (const slot of [9, 0, 10, NaN, 1.5, '1']) assert.equal(layerNote('lute', slot), null);
  assert.equal(layerNote('shortSword', 1), null);
});

test('a played note is a known instrument, degree 0-7, octave -1 to 1 and a boolean chord', () => {
  for (const instrument of INSTRUMENT_IDS) {
    for (const octave of [-1, 0, 1]) {
      for (let degree = 0; degree < 8; degree++) {
        for (const chord of [false, true]) {
          assert.ok(isInstrumentNote({ instrument, degree, octave, chord }), 'chords play on any instrument');
        }
      }
    }
  }
  assert.ok(isInstrumentNote({ instrument: 'lute', degree: 3 }), 'octave and chord are optional');
  for (const value of [
    null, undefined, 'lute', 3, [], { instrument: 'harp', degree: 0 }, { instrument: 'toString', degree: 0 },
    { instrument: 'lute', degree: 8 }, { instrument: 'lute', degree: -1 }, { instrument: 'lute', degree: 1.5 },
    { instrument: 'lute', degree: '1' }, { instrument: 'lute', degree: 0, octave: 2 },
    { instrument: 'lute', degree: 0, octave: 0.5 }, { instrument: 'lute', degree: 0, chord: 'yes' },
    { instrument: 'lute', degree: 0, chord: 1 }, { instrument: 'lute', degree: 0, volume: 1 },
  ]) assert.equal(isInstrumentNote(value), false, JSON.stringify(value));
});

test('item details show the keys in the reference wording', () => {
  assert.deepEqual(noteReference('lute'), [
    'Use keys 1-8 to play notes: 1-[C] 2-[D] 3-[E] 4-[F] 5-[G] 6-[A] 7-[B] 8-[C]',
    'Hold Shift to play chords: 1-[C] 2-[D] 3-[E] 4-[F] 5-[G] 6-[A] 7-[B] 8-[C]',
  ]);
  assert.deepEqual(noteReference('flute'), [
    'Use keys 1-8 to play notes: 1-[C] 2-[D] 3-[E] 4-[F] 5-[G] 6-[A] 7-[B] 8-[C]',
    'Hold Shift to play additional notes: 9-[C] 10-[D] 11-[E] 12-[F] 13-[G] 14-[A] 15-[B] 16-[C]',
  ]);
  assert.deepEqual(noteReference('shortSword'), []);
  assert.deepEqual(noteReference(undefined), []);
  assert.equal(noteRange('lute'), 'C4-C5');
  assert.equal(noteRange('celticHarp'), 'C5-C6');
  assert.equal(noteRange('trumpet'), 'C4-C6');
  assert.equal(noteRange('flute'), 'C5-C7');
  assert.equal(noteRange('shortSword'), '');
});

test('a note carries 64 m, fading linearly to silence', () => {
  for (const id of INSTRUMENT_IDS) assert.equal(hearingRange(id), 64);
  assert.equal(hearingRange('shortSword'), 0);
  assert.equal(instrumentFalloff('lute', 0), 1);
  assert.equal(instrumentFalloff('lute', 32), 0.5);
  assert.equal(instrumentFalloff('lute', 48), 0.25);
  assert.equal(instrumentFalloff('lute', 64), 0);
  assert.equal(instrumentFalloff('lute', 100), 0);
  assert.equal(instrumentFalloff('lute', -5), 1);
  assert.equal(instrumentFalloff('lute', NaN), 0);
  assert.equal(instrumentFalloff('lute', Infinity), 0);
  assert.equal(instrumentFalloff('shortSword', 0), 0);
});

test('instrument text, art and source are plain ASCII', () => {
  const ascii = /^[\x20-\x7e\n]*$/;
  const strings = [...CHORD_NAMES, ...NOTE_LETTERS];
  for (const id of INSTRUMENT_IDS) {
    strings.push(INSTRUMENTS[id].name, noteRange(id), ...noteReference(id), itemArt(id));
  }
  for (const item of INSTRUMENT_ITEMS) {
    strings.push(item.name, item.shortName, item.glyph, item.groundGlyph, item.description,
      ...Object.values(item.stats).map(String));
  }
  for (const id of INSTRUMENT_IDS) {
    for (const note of [...noteSlots(id), ...noteSlots(id, true)]) strings.push(note.label, note.pitches);
  }
  for (const text of strings) assert.match(text, ascii, text);
  for (const file of ['src/audio/instruments.js', 'src/audio/instrument-voices.js',
    'src/inventory/instrument-items.js', 'src/audio/instrument-preview.js', 'docs/audio-instruments.html',
    'src/core/instrument-keys.js', 'src/world/music-notes.js', 'src/entities/instrument-shapes.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const bad = [...source].find(char => !/[\x20-\x7e\n]/.test(char));
    assert.equal(bad, undefined, `${file} has a non-ASCII character`);
  }
});

test('every instrument has its own picture of at most 11 columns by 9 rows', () => {
  const pictures = new Set();
  for (const id of INSTRUMENT_IDS) {
    const picture = itemArt(id);
    assert.notEqual(picture, '?', `${id} has art`);
    const rows = picture.split('\n');
    assert.ok(rows.length >= 4 && rows.length <= 9, id);
    assert.ok(rows.every(row => row.length <= 11), id);
    pictures.add(picture);
  }
  assert.equal(pictures.size, INSTRUMENT_IDS.length);
});

test('peers already receive an off-hand instrument through synced equipment', async () => {
  const { readEquipment } = await import('../src/multiplayer/protocol.js');
  for (const id of INSTRUMENT_IDS) assert.deepEqual(readEquipment({ offHand: { id } }).offHand, { id, count: 1 });
  assert.equal(readEquipment({ mainHand: { id: 'lute' } }).mainHand, null, 'never in the main hand');
});

test('pitch names are ASCII note names with their octave', () => {
  assert.deepEqual([48, 60, 61, 72, 84, 59, 0, -1].map(pitchName), ['C3', 'C4', 'C#4', 'C5', 'C6', 'B3', 'C-1', 'B-2']);
});

test('the note slot layout: notes, then chords or the octave above with Shift', () => {
  const pick = (id, shifted, key) => noteSlots(id, shifted).map(note => note[key]);
  assert.deepEqual(pick('lute', false, 'label'), ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']);
  assert.deepEqual(pick('lute', false, 'pitches'), ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
  assert.deepEqual(pick('lute', true, 'label'), ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'C']);
  assert.deepEqual(pick('lute', true, 'pitches'), ['C E G', 'D F A', 'E G B', 'F A C', 'G B D', 'A C E', 'B D F', 'C E G']);
  assert.deepEqual(pick('flute', false, 'pitches'), ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6']);
  assert.deepEqual(pick('flute', true, 'pitches'), ['C6', 'D6', 'E6', 'F6', 'G6', 'A6', 'B6', 'C7']);
  assert.deepEqual(pick('trumpet', true, 'pitches'), ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6']);
  assert.deepEqual(pick('trumpet', true, 'label'), ['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']);
  assert.deepEqual(noteSlots('lute', true)[1], { slot: 2, label: 'Dm', pitches: 'D F A', degree: 1, octave: 0, chord: true });
  assert.deepEqual(noteSlots('flute', true)[7], { slot: 8, label: 'C', pitches: 'C7', degree: 7, octave: 1, chord: false });
  for (const id of INSTRUMENT_IDS) {
    for (const shifted of [false, true]) {
      assert.deepEqual(noteSlots(id, shifted).map(note => note.slot), [1, 2, 3, 4, 5, 6, 7, 8]);
      for (const note of noteSlots(id, shifted)) {
        const { degree, octave, chord } = layerNote(id, note.slot, shifted);
        assert.deepEqual([note.degree, note.octave, note.chord], [degree, octave, chord]);
      }
    }
  }
  assert.deepEqual(noteSlots('woodenBuckler'), []);
  assert.deepEqual(noteSlots(undefined, true), []);
});
