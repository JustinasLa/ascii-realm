// The instrument sound archive (docs/audio-instruments.html): a card per
// instrument with its two rows of keys and buttons that play each row as a
// scale. Every press starts unlocking audio inside the gesture itself, before
// anything waits or is scheduled: unlock() creates and resumes the context
// synchronously, and a browser that gates sound on a gesture only counts that.
import { CHORD_NAMES, INSTRUMENT_IDS, INSTRUMENTS, NOTE_LETTERS, layerNote, noteRange, playInstrumentNote,
  prepareInstrument, secondLayer } from './instruments.js';

export const VOICE_NOTES = Object.freeze({
  accordion: 'Two reeds tuned apart, beating like a musette, through a bellows swell.',
  bagpipe: 'A nasal chanter opened by a grace note, over a quiet drone on C.',
  celticHarp: 'Bright plucked strings with a long ring.',
  dulcimer: 'Three strings to a note, struck with light hammers, shimmering as they beat.',
  flute: 'A breathy tone with a soft chiff at the start and a late vibrato.',
  kalimba: 'A short metal tine with a soft inharmonic overtone and a click.',
  lute: 'Paired gut strings, plucked, through a warm wooden body.',
  trumpet: 'Bright brass that blooms open as it speaks.',
  vielle: 'A bowed string with bow hair at the attack and a delayed vibrato.',
});
// Gap between the notes of a played row, in milliseconds.
export const SCALE_STEP = 333;

const LOCKED = 'Audio could not start. Press a note again.';
// Notes 9-16 repeat the letters of keys 1-8.
const noteName = (slot, number = slot) => 'note ' + number + ' ' + NOTE_LETTERS[slot - 1];

/** Builds the archive into `doc` and wires it to `engine`. Returns { stop, dispose }. */
export function mountInstrumentPreview(engine, doc = globalThis.document, win = globalThis.window) {
  const status = doc.querySelector('#status'), grid = doc.querySelector('#instruments');
  const prepared = new Set();
  let active = [], timers = [];
  const say = text => { status.textContent = text; };
  function stop() {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
    for (const handle of active) handle.stop();
    active = [];
  }
  const secondName = (id, slot) => secondLayer(id) === 'chords' ? 'chord ' + CHORD_NAMES[slot - 1] : noteName(slot, slot + 8);
  function flash(button) {
    button.classList.add('lit');
    setTimeout(() => button.classList.remove('lit'), 180);
  }
  function sound(id, slot, shifted, button) {
    if (!prepared.has(id)) { prepared.add(id); void prepareInstrument(engine, id); }
    const handle = playInstrumentNote(engine, { instrument: id, ...layerNote(id, slot, shifted) });
    if (!handle) { say('That note could not play.'); return; }
    active = active.filter(item => !item.ended);
    active.push(handle);
    flash(button);
    say(INSTRUMENTS[id].name + ' - ' + (shifted ? secondName(id, slot) : noteName(slot)));
  }
  // One key: unlock inside the press, then play once audio runs.
  async function press(id, slot, shifted, button) {
    const unlocking = engine.unlock();
    if (!await unlocking) { say(LOCKED); return; }
    sound(id, slot, shifted, button);
  }
  // A whole row: unlock inside the press, then space the notes out.
  function scale(id, buttons, shifted) {
    const unlocking = engine.unlock();
    stop();
    void unlocking.then(running => { if (!running) { stop(); say(LOCKED); } });
    for (let slot = 1; slot <= 8; slot++) {
      timers.push(setTimeout(() => {
        void unlocking.then(running => { if (running) sound(id, slot, shifted, buttons[slot - 1]); });
      }, (slot - 1) * SCALE_STEP));
    }
  }
  function row(id, shifted) {
    const node = doc.createElement('div');
    node.className = 'row';
    const buttons = [];
    for (let slot = 1; slot <= 8; slot++) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = shifted ? (secondLayer(id) === 'chords' ? CHORD_NAMES[slot - 1] : (slot + 8) + ' ' + NOTE_LETTERS[slot - 1])
        : slot + ' ' + NOTE_LETTERS[slot - 1];
      button.setAttribute('aria-label', INSTRUMENTS[id].name + ' ' + (shifted ? secondName(id, slot) : noteName(slot)));
      button.onclick = () => press(id, slot, shifted, button).catch(() => say('Audio playback failed. Try again.'));
      buttons.push(button);
    }
    node.append(...buttons);
    return { node, buttons };
  }
  doc.querySelector('#stop').onclick = () => { stop(); say('Stopped.'); };
  doc.querySelector('#volume').oninput = event => {
    engine.setVolume('master', Number(event.target.value) / 100);
    doc.querySelector('#level').value = event.target.value + '%';
  };
  for (const id of INSTRUMENT_IDS) {
    const card = doc.createElement('article'), heading = doc.createElement('h2');
    const voice = doc.createElement('small'), mode = doc.createElement('small');
    const layer = secondLayer(id) === 'chords' ? 'chords' : 'notes 9-16';
    card.id = id;
    heading.textContent = INSTRUMENTS[id].name;
    voice.textContent = VOICE_NOTES[id];
    mode.textContent = noteRange(id) + ' - Shift: ' + layer;
    const first = row(id, false), second = row(id, true);
    const firstLabel = doc.createElement('div'), secondLabel = doc.createElement('div');
    firstLabel.className = secondLabel.className = 'row-label';
    firstLabel.textContent = 'Keys 1-8';
    secondLabel.textContent = 'Shift: ' + layer;
    const extras = doc.createElement('div');
    extras.className = 'extras';
    for (const [label, buttons, shifted] of [['Play 1-8', first.buttons, false], ['Play the Shift row', second.buttons, true]]) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.onclick = () => scale(id, buttons, shifted);
      extras.append(button);
    }
    card.append(heading, voice, mode, firstLabel, first.node, secondLabel, second.node, extras);
    grid.append(card);
  }
  say(INSTRUMENT_IDS.length + ' instruments ready to hear.');
  const hidden = () => { if (doc.hidden) stop(); };
  const dispose = () => {
    stop();
    doc.removeEventListener('visibilitychange', hidden);
    win.removeEventListener('pagehide', dispose);
    void engine.dispose();
  };
  doc.addEventListener('visibilitychange', hidden);
  win.addEventListener('pagehide', dispose);
  return { stop, dispose };
}
