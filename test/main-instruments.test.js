import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTRUMENT_IDS, noteMidi } from '../src/audio/instruments.js';
import { SCALE, TILT } from '../src/entities/rig.js';
import { ASPECT } from '../src/world/world.js';
import { HEAD_ROWS, noteColour } from '../src/world/music-notes.js';
import { ITEMS } from '../src/inventory/items.js';
import { loadGame } from './helpers/main-game.js';

const carried = inventory => inventory.slots.filter(Boolean).map(stack => stack.id);

test('?instruments puts one of each instrument in the bag, unequipped and without notices', async () => {
  const { game } = await loadGame(undefined, { href: 'http://localhost/?debug&instruments&skeletons=0&goblins=0&trolls=0&elves=0&animals=0' });
  assert.deepEqual(carried(game.inventory), ['stonePickaxe', ...INSTRUMENT_IDS]);
  assert.equal(game.inventory.equipment.offHand, null);
  assert.deepEqual(game.inventory.equipment.mainHand, { id: 'shortSword', count: 1 });
  assert.deepEqual(game.inventory.events, []);
  assert.deepEqual(game.inventory.hotbar.filter(Boolean), ['shortSword', 'stonePickaxe']);
});

test('without the query nothing hands instruments out', async () => {
  const { game } = await loadGame(undefined, { href: 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0&animals=0' });
  assert.deepEqual(carried(game.inventory), ['stonePickaxe']);
});

// --- Playing the off-hand instrument -------------------------------------

const QUIET = 'http://localhost/?debug&instruments&skeletons=0&goblins=0&trolls=0&elves=0&animals=0';

// Stand-ins that record what the game asks of the sound and the HUD.
function recorders({ state = 'running' } = {}) {
  const played = [];
  const prepared = [];
  const unlocks = [];
  const huds = [];
  const engine = {
    context: { state },
    setListener() {},
    suspend: async () => {},
    unlock() {
      unlocks.push(engine.context.state);
      // Like a real resume: the context runs a moment later.
      return Promise.resolve().then(() => { engine.context.state = 'running'; return true; });
    },
  };
  class GameAudio {
    constructor() { this.music = { update() {} }; this.engine = engine; this.weather = {}; }
    play(event) { played.push(event); }
    pause() {}
    update() {}
  }
  class Hud {
    constructor(options) {
      this.options = options;
      this.views = [];
      this.flashed = [];
      huds.push(this);
      return new Proxy(this, { get: (target, key) => key in target ? target[key] : () => [] });
    }
    setInstrument(view) { this.views.push(view); }
    flashSlot(index) { this.flashed.push(index); }
  }
  const rows = [];
  class AsciiRenderer {
    constructor() { this.cols = 400; this.rows = 400; }
    resize() {}
    draw() {}
    put() {}
    fineInFront() { return false; }
    layer(x, y, g, r, gg, b) { rows.push([x, y, r, gg, b]); }
  }
  // The grass draws the depth-sorted drawables between its layers.
  class Grass {
    constructor() { return new Proxy(this, { get: (target, key) => key in target ? target[key] : () => [] }); }
    drawLayered(r, world, view, time, drawables) { for (const drawable of drawables) drawable.draw(); }
  }
  return { played, prepared, unlocks, huds, engine, rows,
    real: { GameAudio, Hud, AsciiRenderer, Grass, prepareInstrument: (_engine, id) => { prepared.push(id); return Promise.resolve(true); } } };
}

async function performer(id = 'lute', options = {}) {
  const sound = recorders(options);
  const loaded = await loadGame(options.move, { href: QUIET, phone: options.phone, real: { ...sound.real, ...options.real } });
  const { game } = loaded;
  if (id) assert.equal(game.inventory.equip(game.inventory.slots.findIndex(stack => stack?.id === id)), true);
  loaded.frame();
  const instrumentNotes = () => sound.played.filter(event => event.type === 'instrument');
  return { ...loaded, ...sound, hud: sound.huds[0], instrumentNotes };
}

const noteOf = ({ instrument, degree, octave, chord }) => ({ instrument, degree, octave, chord });

test('keys 1-8 play the off-hand instrument at once and snap the selection to slot 9', async () => {
  const { game, keydown, instrumentNotes, hud } = await performer('lute');
  const sword = game.inventory.equipment.mainHand;
  const event = keydown(undefined, { code: 'Digit1' });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(instrumentNotes().map(noteOf), [{ instrument: 'lute', degree: 0, octave: 0, chord: false }]);
  assert.equal(instrumentNotes()[0].x, game.player.x);
  assert.equal(game.inventory.selectedHotbar, 8);
  assert.equal(game.inventory.equipment.mainHand, sword, 'the main hand is untouched');
  assert.equal(game.musicNotes.list.length, 1);
  assert.deepEqual(hud.flashed, [0]);
  keydown(undefined, { code: 'Numpad8' });
  assert.deepEqual(noteOf(instrumentNotes()[1]), { instrument: 'lute', degree: 7, octave: 0, chord: false });
  assert.deepEqual(hud.flashed, [0, 7]);
});

test('Shift plays the second layer: chords on the lute, the octave above on the flute', async () => {
  const { game, keydown, instrumentNotes } = await performer('lute');
  keydown(undefined, { code: 'Digit3', shiftKey: true });
  assert.deepEqual(noteOf(instrumentNotes()[0]), { instrument: 'lute', degree: 2, octave: 0, chord: true });
  game.inventory.equip(game.inventory.slots.findIndex(stack => stack?.id === 'flute'));
  keydown(undefined, { code: 'Digit8', shiftKey: true });
  assert.deepEqual(noteOf(instrumentNotes()[1]), { instrument: 'flute', degree: 7, octave: 1, chord: false });
});

test('a held key never replays, and 9 still selects quick slot 9', async () => {
  const { game, keydown, tap, frame, instrumentNotes } = await performer('lute');
  assert.equal(keydown(undefined, { code: 'Digit2', repeat: true }).defaultPrevented, true);
  assert.equal(instrumentNotes().length, 0);
  assert.equal(keydown(undefined, { code: 'Digit9' }).defaultPrevented, false);
  game.inventory.selectHotbar(0);
  tap('Digit9');
  frame();
  assert.equal(game.inventory.selectedHotbar, 8);
  assert.equal(instrumentNotes().length, 0);
});

test('a quick-slot tap on 1-8 never equips while an instrument is carried', async () => {
  const { game, tap, frame } = await performer('lute');
  game.inventory.selectHotbar(4);
  tap('Digit1');
  frame();
  assert.equal(game.inventory.selectedHotbar, 4);
  assert.equal(game.inventory.equipment.offHand.id, 'lute');
  game.inventory.unequip('offHand');
  tap('Digit1');
  frame();
  assert.equal(game.inventory.selectedHotbar, 0);
});

test('a two-handed weapon takes the instrument off, and 1-8 are quick slots again', async () => {
  const { game, keydown, instrumentNotes } = await performer('lute');
  const bow = Object.values(ITEMS).find(item => item.twoHanded && item.equipmentSlot === 'mainHand').id;
  game.inventory.add(bow);
  game.inventory.equip(game.inventory.slots.findIndex(stack => stack?.id === bow));
  assert.equal(game.inventory.equipment.offHand, null);
  assert.equal(keydown(undefined, { code: 'Digit1' }).defaultPrevented, false);
  assert.equal(instrumentNotes().length, 0);
});

test('the note glyph starts 2 m above the head and is drawn in whole cells', async () => {
  const { game, keydown, frame, rows } = await performer('lute');
  game.player.x = 10.6;
  game.player.y = 100.3;
  frame();
  keydown(undefined, { code: 'Digit1' });
  const [note] = game.musicNotes.list;
  assert.equal(note.x, 10);
  assert.ok(Number.isInteger(note.row));
  frame();
  const drawn = rows.filter(([, , r, g, b]) => r === 255 && g === 6 && b === 6);
  assert.equal(drawn.length, 1);
  assert.ok(drawn.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y)));
  for (let i = 0; i < 20; i++) frame();
  assert.equal(game.musicNotes.list.length, 0, 'gone after 0.3 s');
});

test('the glyph rises from the drawn head when the 3D figure is known', async () => {
  const { game, keydown, frame } = await performer('lute');
  // The 3D figure reports its top row once drawn; the glyph starts 2 m
  // (26 rows) over it, whatever the zoom, which never changes world rows.
  game.model.top = 30;
  frame();
  keydown(undefined, { code: 'Digit5' });
  assert.equal(game.musicNotes.list[0].row, 4);
  game.model.top = null;
  frame();
  game.player.y = 80.5;
  keydown(undefined, { code: 'Digit6' });
  assert.equal(game.musicNotes.list[1].row, 80 - 23 - 26, 'placed from the feet while the figure is unknown');
});

test('the hotbar shows the note layout, with Shift held for the second layer, and nothing without an instrument', async () => {
  const { game, frame, hold, release, hud } = await performer('lute');
  assert.deepEqual({ ...hud.views.at(-1) }, { id: 'lute', shifted: false });
  hold('ShiftLeft');
  frame();
  assert.deepEqual({ ...hud.views.at(-1) }, { id: 'lute', shifted: true });
  release('ShiftLeft');
  frame();
  assert.deepEqual({ ...hud.views.at(-1) }, { id: 'lute', shifted: false });
  assert.equal(game.inventory.unequip('offHand'), true);
  frame();
  assert.equal(hud.views.at(-1), null);
});

test('string buffers are prepared once per instrument and audio context', async () => {
  const { game, frame, prepared, engine } = await performer('lute');
  frame();
  frame();
  assert.deepEqual(prepared, ['lute']);
  game.inventory.equip(game.inventory.slots.findIndex(stack => stack?.id === 'harp' || stack?.id === 'celticHarp'));
  frame();
  assert.deepEqual(prepared, ['lute', 'celticHarp']);
  engine.context = { state: 'running' };
  frame();
  assert.deepEqual(prepared, ['lute', 'celticHarp', 'celticHarp']);
  engine.context = { state: 'suspended' };
  game.inventory.equip(game.inventory.slots.findIndex(stack => stack?.id === 'lute'));
  frame();
  assert.deepEqual(prepared, ['lute', 'celticHarp', 'celticHarp']);
});

test('a note key resumes suspended sound inside the press, then the note plays', async () => {
  const { keydown, instrumentNotes, unlocks } = await performer('lute', { state: 'suspended' });
  keydown(undefined, { code: 'Digit4' });
  assert.deepEqual(unlocks, ['suspended'], 'resumed synchronously in the key handler');
  assert.equal(instrumentNotes().length, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(instrumentNotes().map(noteOf), [{ instrument: 'lute', degree: 3, octave: 0, chord: false }]);
});

test('a note that cannot start its sound still shows, and stays silent', async () => {
  const { keydown, instrumentNotes, engine, game } = await performer('lute', { state: 'suspended' });
  engine.unlock = () => Promise.resolve(false);
  keydown(undefined, { code: 'Digit4' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(instrumentNotes().length, 0);
  assert.equal(game.musicNotes.list.length, 1);
});

test('one check refuses keys and clicks: builder, typing, inventory, rune wheel, chat, death', async () => {
  const { game, keydown, hud, instrumentNotes, document, frame } = await performer('lute');
  const click = (index, shiftKey = false) => hud.options.onSelect(index, { shiftKey });
  click(1, true);
  assert.deepEqual(noteOf(instrumentNotes()[0]), { instrument: 'lute', degree: 1, octave: 0, chord: true });
  click(1);
  assert.equal(instrumentNotes()[1].chord, false);
  game.inventory.selectHotbar(0);
  click(8);
  assert.equal(game.inventory.selectedHotbar, 8, 'slot 9 is still a quick slot');
  const count = () => instrumentNotes().length;
  const refused = (label) => {
    const before = count();
    const event = keydown(undefined, { code: 'Digit2' });
    click(2);
    assert.equal(count(), before, label);
    return event;
  };
  game.builder.enabled = true;
  assert.equal(refused('builder').defaultPrevented, true, 'claimed so it cannot equip');
  game.builder.enabled = false;
  document.activeElement = { tagName: 'input' };
  refused('typing in a field');
  document.activeElement = { isContentEditable: true };
  refused('typing in an editor');
  document.activeElement = null;
  game.spellControls.menu = { isOpen: true };
  refused('rune wheel');
  game.spellControls.menu = { isOpen: false };
  game.freeze = true;
  refused('frozen');
  game.freeze = false;
  game.player.vitals.health = 0;
  refused('dead');
  game.player.vitals.health = 50;
  game.chat.onToggle(true);
  refused('chat open');
  game.chat.onToggle(false);
  game.inventoryScreen.isOpen = true;
  game.inventoryScreen.onToggle(true);
  assert.equal(refused('inventory').defaultPrevented, false, 'the inventory keeps its own digit keys');
  game.inventoryScreen.isOpen = false;
  game.inventoryScreen.onToggle(false);
  frame();
  const before = count();
  keydown(undefined, { code: 'Digit2' });
  assert.equal(count(), before + 1, 'plays again once everything is shut');
});

test('a key from a text field types instead of playing', async () => {
  const field = { tagName: 'INPUT' };
  const { keydown, instrumentNotes } = await performer('lute', { real: { isControlTarget: target => target === field } });
  const event = keydown(undefined, { code: 'Digit1', composedPath: () => [field] });
  assert.equal(event.defaultPrevented, false);
  assert.equal(instrumentNotes().length, 0);
});

test('phones keep their quick slots: keys and taps never play', async () => {
  const { game, keydown, hud, instrumentNotes, frame } = await performer('lute', { phone: true });
  assert.equal(keydown(undefined, { code: 'Digit1' }).defaultPrevented, false, 'even from a Bluetooth keyboard');
  assert.equal(hud.views.at(-1), null);
  hud.options.onSelect(0, {});
  frame();
  assert.equal(game.inventory.selectedHotbar, 0);
  assert.equal(instrumentNotes().length, 0);
});

test('Shift still runs while chords play', async () => {
  const { game, keydown, frame, hold, instrumentNotes } = await performer('lute', { move: { x: 1, y: 0 } });
  hold('ShiftLeft');
  for (let i = 0; i < 40; i++) {
    if (i % 10 === 0) keydown(undefined, { code: 'Digit1', shiftKey: true });
    frame();
  }
  assert.equal(instrumentNotes().length, 4);
  assert.ok(instrumentNotes().every(event => event.chord));
  assert.ok(game.player.run > 0.6, `running (${game.player.run})`);
});

// --- Friends' notes ---------------------------------------------------------

test('every played note is offered to the lobby, and a refused one is not', async () => {
  const { game, keydown } = await performer('lute');
  keydown(undefined, { code: 'Digit1' });
  keydown(undefined, { code: 'Digit3', shiftKey: true });
  assert.deepEqual(game.multiplayer.notesSent.map(note => ({ ...note })), [
    { instrument: 'lute', degree: 0, octave: 0, chord: false },
    { instrument: 'lute', degree: 2, octave: 0, chord: true },
  ]);
  game.builder.enabled = true;
  keydown(undefined, { code: 'Digit2' });
  assert.equal(game.multiplayer.notesSent.length, 2, 'nothing is sent that was not played');
});

// A friend `metres` away along a direction, built with the inverse of
// toMetres so the screen's tilt is part of the sum.
const offset = (metres, [ex, ez]) => [metres * ex * SCALE / ASPECT, metres * ez * SCALE * TILT];

async function listener(options) {
  const loaded = await performer(null, options);
  const peers = loaded.game.remotePlayers.peers;
  const at = (id, metres, direction = [1, 0], figure) => {
    const [dx, dy] = offset(metres, direction);
    peers.set(id, { id, player: { x: loaded.game.player.x + dx, y: loaded.game.player.y + dy }, figure });
    return peers.get(id).player;
  };
  return { ...loaded, at };
}

const C = { instrument: 'lute', degree: 0, octave: 0, chord: false };

test("a friend's note plays from their figure, fading linearly to silence at 64 m", async () => {
  const { game, at, instrumentNotes } = await listener();
  const near = at('a1', 0);
  game.multiplayer.onNote({ from: 'a1', note: C });
  assert.deepEqual({ ...instrumentNotes()[0] }, { type: 'instrument', ...C, x: near.x, y: near.y, level: 1 });
  at('a1', 32);
  game.multiplayer.onNote({ from: 'a1', note: { ...C, degree: 4, chord: true } });
  assert.ok(Math.abs(instrumentNotes()[1].level - 0.5) < 1e-9);
  assert.equal(instrumentNotes()[1].chord, true);
  at('a1', 32, [0, 1]);
  game.playRemoteNote('a1', C);
  assert.ok(Math.abs(instrumentNotes()[2].level - 0.5) < 1e-9, 'north and south are measured in metres too');
  const glyphs = game.musicNotes.list.length;
  for (const metres of [64, 70]) {
    at('a1', metres);
    game.multiplayer.onNote({ from: 'a1', note: C });
  }
  assert.equal(instrumentNotes().length, 3, 'nothing is played from 64 m on');
  assert.equal(game.musicNotes.list.length, glyphs, 'and no glyph is shown');
});

test("a friend's note shows its glyph over their head, coloured by the root", async () => {
  const { game, at } = await listener();
  const friend = at('a1', 5, [1, 0], [{ y0: -30 }, { y0: -10 }]);
  game.multiplayer.onNote({ from: 'a1', note: { ...C, degree: 4 } });
  const [glyph] = game.musicNotes.list;
  assert.equal(glyph.x, Math.floor(friend.x));
  assert.equal(glyph.row, Math.floor(friend.y - 30) - 2 * SCALE);
  assert.deepEqual([...glyph.colour], noteColour(noteMidi('lute', 4, 0, false)[0]));
  // A friend not yet drawn still gets a glyph, from the assumed head.
  const unseen = at('b2', 5);
  game.multiplayer.onNote({ from: 'b2', note: C });
  assert.equal(game.musicNotes.list[1].row, Math.floor(unseen.y) - HEAD_ROWS - 2 * SCALE);
});

test('a hidden tab hears the note but piles up no glyphs', async () => {
  const { game, at, instrumentNotes, setHidden } = await listener();
  at('a1', 3);
  setHidden(true);
  game.multiplayer.onNote({ from: 'a1', note: C });
  assert.equal(instrumentNotes().length, 1);
  assert.equal(game.musicNotes.list.length, 0);
});

test('notes from unknown or departed friends are ignored', async () => {
  const { game, at, instrumentNotes } = await listener();
  game.multiplayer.onNote({ from: 'ffff', note: C });
  at('a1', 3);
  game.remotePlayers.peers.delete('a1');
  game.multiplayer.onNote({ from: 'a1', note: C });
  assert.equal(instrumentNotes().length, 0);
  assert.equal(game.musicNotes.list.length, 0);
});

test('phones hear and see friends play, though they cannot play themselves', async () => {
  const { game, at, instrumentNotes } = await listener({ phone: true });
  at('a1', 10);
  game.multiplayer.onNote({ from: 'a1', note: C });
  assert.equal(instrumentNotes().length, 1);
  assert.equal(game.musicNotes.list.length, 1);
});
