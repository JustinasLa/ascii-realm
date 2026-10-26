// The note glyph over a performer's head: one ASCII `d` per note or chord,
// starting 2 m above the head, coloured by pitch like a note block's note,
// rising a little and gone after six ticks. Drawn through the depth-sorted
// drawables, like the glowcap spores, with no glow, ring or fade.
import { glyph } from '../render/glyphs.js';
import { SCALE } from '../entities/rig.js';

export const NOTE_GLYPH = 'd';
// Six ticks of 50 ms.
export const NOTE_LIFE = 0.3;
// The oldest glyph goes first past this many; a lobby of performers stays cheap.
export const MAX_NOTE_GLYPHS = 48;
// Metres above the head where the glyph starts.
export const NOTE_HEIGHT = 2;
// Where a head is assumed to be when the figure's top is unknown: rows above the feet.
export const HEAD_ROWS = Math.round(1.8 * SCALE);

// A note block's 25 particle colours, one per note from F#3 (note 0) to F#5
// (note 24), as listed on the Minecraft Wiki's "Note Block" page (oldid
// 3840927). Each channel is about max(0, sin((n / 24 + k / 3) * 2pi) * 0.65 + 0.35),
// but the table is the source: it differs from that formula in places.
export const NOTE_COLOURS = Object.freeze([
  '#59E800', '#82CE00', '#ACAC00', '#CE8400', '#E85900', '#F92E00', '#FF0606', '#F9002E',
  '#E80059', '#CE0082', '#AC00AC', '#8200CE', '#5900E8', '#2E00F9', '#0606FF', '#002EF9',
  '#0059E8', '#0082CE', '#00ACAC', '#00CE82', '#00E859', '#00F92E', '#06FF06', '#2EF900',
  '#59E800',
].map(hex => Object.freeze([1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)))));

// MIDI 54 is F#3, a note block's note 0.
const NOTE_ZERO = 54;
const NOTE = glyph(NOTE_GLYPH);

/** The note-block note (0-23) of a pitch: its place on the 24-step colour wheel. */
export const noteColourIndex = midi => (((Math.round(midi) - NOTE_ZERO) % 24) + 24) % 24;

/** The glyph colour of a pitch, [r, g, b]. */
export const noteColour = midi => NOTE_COLOURS[noteColourIndex(midi)];

/** Metres risen after `age` seconds: 0.2 m a tick, slowed by 0.66 each tick. */
export const noteRise = age => 0.588 * (1 - 0.66 ** (Math.max(0, age) / 0.05));

export class MusicNotes {
  constructor() {
    this.list = [];
  }

  /**
   * One glyph for a note by a performer standing at (x, y) whose head is at
   * row `top` (null or NaN when unknown). `midi` is the lowest pitch played.
   */
  add({ x, y, top, midi }) {
    const head = Number.isFinite(top) ? Math.floor(top) : Math.floor(y) - HEAD_ROWS;
    this.list.push({ x: Math.floor(x), y, row: head - NOTE_HEIGHT * SCALE, age: 0, colour: noteColour(midi) });
    if (this.list.length > MAX_NOTE_GLYPHS) this.list.splice(0, this.list.length - MAX_NOTE_GLYPHS);
  }

  update(dt) {
    for (const note of this.list) note.age += dt;
    this.list = this.list.filter(note => note.age < NOTE_LIFE);
  }

  /** The note's row this moment: whole cells only. */
  rowOf(note) {
    return Math.floor(note.row - noteRise(note.age) * SCALE);
  }

  /**
   * The screen row the glyph is drawn on. On a short screen 2 m above the
   * head can be above the top edge: while the head itself is in view, the
   * glyph is drawn on the top whole row instead. Its world row is unchanged.
   */
  screenRow(view, note) {
    const y0 = Math.floor(view.y0);
    const y = this.rowOf(note) - y0;
    const top = view.offY > 0 ? 1 : 0;
    return y < top && note.row + NOTE_HEIGHT * SCALE - y0 >= top ? top : y;
  }

  draw(r, view, note) {
    const x = note.x - Math.floor(view.x0);
    const y = this.screenRow(view, note);
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return;
    r.layer(x, y, NOTE, ...note.colour);
  }
}
