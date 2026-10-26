import assert from 'node:assert/strict';
import test from 'node:test';
import { glyph } from '../src/render/glyphs.js';
import { SCALE } from '../src/entities/rig.js';
import { HEAD_ROWS, MAX_NOTE_GLYPHS, MusicNotes, NOTE_COLOURS, NOTE_GLYPH, NOTE_HEIGHT, NOTE_LIFE, noteColour,
  noteColourIndex, noteRise } from '../src/world/music-notes.js';

// The particle colours of a note block's 25 notes, F#3 to F#5, copied from
// the Minecraft Wiki "Note Block" page at oldid 3840927 (the pinned excerpt).
const WIKI = ['#59E800', '#82CE00', '#ACAC00', '#CE8400', '#E85900', '#F92E00', '#FF0606', '#F9002E', '#E80059',
  '#CE0082', '#AC00AC', '#8200CE', '#5900E8', '#2E00F9', '#0606FF', '#002EF9', '#0059E8', '#0082CE', '#00ACAC',
  '#00CE82', '#00E859', '#00F92E', '#06FF06', '#2EF900', '#59E800'];
const hex = ([r, g, b]) => '#' + [r, g, b].map(v => v.toString(16).toUpperCase().padStart(2, '0')).join('');

// A renderer that records every write, with the arrays a renderer has.
function recorder(cols = 40, rows = 60) {
  const writes = [];
  return { cols, rows, writes, layer: (...args) => writes.push(args) };
}

test('the colour table is the pinned 25-colour note-block table, exactly', () => {
  assert.equal(NOTE_COLOURS.length, 25);
  assert.deepEqual(NOTE_COLOURS.map(hex), WIKI);
  assert.ok(Object.isFrozen(NOTE_COLOURS) && NOTE_COLOURS.every(Object.isFrozen));
});

test('a pitch takes the colour a note block shows for the same note, around a 24-step wheel', () => {
  // C4 is note-block note 6, red.
  assert.equal(noteColourIndex(60), 6);
  assert.deepEqual(noteColour(60), [255, 6, 6]);
  // F#3 and F#5 are notes 0 and 24, which share a colour; the wheel wraps.
  assert.equal(noteColourIndex(54), 0);
  assert.equal(noteColourIndex(78), 0);
  assert.equal(hex(noteColour(54)), '#59E800');
  assert.equal(hex(noteColour(78)), '#59E800');
  assert.equal(noteColourIndex(53), 23);
  assert.equal(noteColourIndex(30), 0);
  assert.equal(noteColourIndex(108), 6);
  // Notes 1-8 of a C4 instrument run from red through magenta and blue.
  assert.deepEqual([60, 62, 64, 65, 67, 69, 71, 72].map(noteColourIndex), [6, 8, 10, 11, 13, 15, 17, 18]);
});

test('the glyph rises on the damped tick curve and lives six ticks', () => {
  assert.equal(noteRise(0), 0);
  assert.equal(noteRise(-1), 0);
  assert.ok(Math.abs(noteRise(0.05) - 0.2) < 0.001);
  assert.ok(Math.abs(noteRise(0.3) - 0.54) < 0.01);
  assert.equal(NOTE_LIFE, 0.3);
  assert.equal(NOTE_GLYPH, 'd');
  const notes = new MusicNotes();
  notes.add({ x: 3, y: 50, top: 20, midi: 60 });
  notes.update(0.29);
  assert.equal(notes.list.length, 1);
  notes.update(0.02);
  assert.equal(notes.list.length, 0);
});

test('the glyph starts 2 m above the head, above the nameplate', () => {
  const notes = new MusicNotes();
  notes.add({ x: 10, y: 50, top: 24, midi: 60 });
  const [note] = notes.list;
  assert.equal(note.row, 24 - NOTE_HEIGHT * SCALE);
  assert.equal(note.row, 24 - 26);
  // The nameplate sits two rows over the head.
  assert.ok(note.row < 24 - 2);
  // A taller figure (a rider) lifts it with the head.
  notes.add({ x: 10, y: 50, top: 10.6, midi: 60 });
  assert.equal(notes.list[1].row, 10 - 26);
  // With the head unknown, it is placed from the feet.
  notes.add({ x: 10, y: 50.7, top: null, midi: 60 });
  notes.add({ x: 10, y: 50.7, top: NaN, midi: 60 });
  assert.equal(notes.list[2].row, 50 - HEAD_ROWS - 26);
  assert.equal(notes.list[3].row, 50 - HEAD_ROWS - 26);
});

test('glyphs are drawn in whole cells, even from fractional positions', () => {
  const notes = new MusicNotes();
  const r = recorder();
  // A performer between cells after walking, and a view at whole cells.
  notes.add({ x: 12.7, y: 40.4, top: 33.6, midi: 60 });
  const [note] = notes.list;
  notes.draw(r, { x0: 2, y0: -10 }, note);
  assert.deepEqual(r.writes, [[10, 33 - 26 + 10, glyph('d'), 255, 6, 6]]);
  for (const [x, y] of r.writes) assert.ok(Number.isInteger(x) && Number.isInteger(y));
  // Rising mid-flight still lands on whole rows, and the column stays put.
  notes.update(0.1);
  notes.draw(r, { x0: 2.5, y0: -10.25 }, note);
  const [x, y] = r.writes[1];
  assert.equal(x, 10);
  assert.equal(y, Math.floor(7 - noteRise(0.1) * SCALE) + 11);
  assert.ok(Number.isInteger(y));
  // Nothing but the one layer write.
  assert.deepEqual(Object.keys(r).sort(), ['cols', 'layer', 'rows', 'writes']);
});

test('glyphs off the screen are skipped', () => {
  const notes = new MusicNotes();
  notes.add({ x: 5, y: 40, top: 30, midi: 60 });
  const [note] = notes.list;
  for (const view of [{ x0: 6, y0: 0 }, { x0: -40, y0: 0 }, { x0: 0, y0: 5 }, { x0: 0, y0: -60 }]) {
    const r = recorder();
    notes.draw(r, view, note);
    assert.deepEqual(r.writes, [], JSON.stringify(view));
  }
});

test('glyphs are capped, oldest first', () => {
  const notes = new MusicNotes();
  for (let i = 0; i < 60; i++) notes.add({ x: i, y: 40, top: 30, midi: 60 + i });
  assert.equal(notes.list.length, MAX_NOTE_GLYPHS);
  assert.equal(notes.list[0].x, 60 - MAX_NOTE_GLYPHS);
  assert.equal(notes.list.at(-1).x, 59);
});
