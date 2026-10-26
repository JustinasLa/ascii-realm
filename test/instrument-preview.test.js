import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioEngine } from '../src/audio/engine.js';
import { INSTRUMENT_IDS } from '../src/audio/instruments.js';
import { SCALE_STEP, VOICE_NOTES, mountInstrumentPreview } from '../src/audio/instrument-preview.js';
import { fakeAudio } from './helpers/instrument-audio.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.textContent = '';
    this.value = '';
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), has: name => classes.has(name) };
  }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = value; }
  buttons() { return this.children.flatMap(child => child.tag === 'button' ? [child] : child.buttons?.() ?? []); }
}

// The page's static markup, as the archive finds it.
function page() {
  const ids = ['status', 'instruments', 'stop', 'volume', 'level'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const doc = Object.assign(new EventTarget(), {
    hidden: false,
    createElement: tag => new Element(tag),
    querySelector: selector => elements[selector.slice(1)],
  });
  const win = new EventTarget();
  const card = id => elements.instruments.children.find(item => item.id === id);
  // Keys 1-8, the Shift row, then the two row buttons.
  const keys = id => card(id).buttons();
  return { doc, win, elements, card, keys };
}

// A real engine on a fake context that starts suspended, as a browser's does
// before the first gesture.
function locked() {
  const fake = fakeAudio({ state: 'suspended' });
  const engine = new AudioEngine({ contextFactory: () => fake.context, storage: null });
  return { fake, engine };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const started = fake => fake.sources().filter(source => source.starts.length).length;

test('the archive shows every instrument with both rows of keys and its row buttons', () => {
  const ui = page();
  const { engine } = locked();
  mountInstrumentPreview(engine, ui.doc, ui.win);
  assert.equal(ui.elements.instruments.children.length, INSTRUMENT_IDS.length);
  for (const id of INSTRUMENT_IDS) {
    const card = ui.card(id);
    assert.equal(card.children[1].textContent, VOICE_NOTES[id]);
    const buttons = ui.keys(id);
    assert.equal(buttons.length, 18);
    assert.deepEqual(buttons.slice(0, 8).map(button => button.textContent), ['1 C', '2 D', '3 E', '4 F', '5 G', '6 A', '7 B', '8 C']);
    assert.deepEqual(buttons.slice(16).map(button => button.textContent), ['Play 1-8', 'Play the Shift row']);
  }
  assert.equal(ui.keys('lute')[9].textContent, 'Dm');
  assert.equal(ui.keys('lute')[9].attributes['aria-label'], 'Lute chord Dm');
  assert.equal(ui.keys('flute')[9].textContent, '10 D');
  assert.equal(ui.keys('flute')[9].attributes['aria-label'], 'Flute note 10 D');
  assert.equal(ui.card('flute').children[2].textContent, 'C5-C7 - Shift: notes 9-16');
  assert.equal(ui.card('lute').children[5].textContent, 'Shift: chords');
  assert.equal(ui.elements.status.textContent, '9 instruments ready to hear.');
  assert.equal(engine.context, null, 'nothing touches audio before a press');
});

test('a key press unlocks and resumes audio inside the click, then plays the note', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = page();
  const { fake, engine } = locked();
  mountInstrumentPreview(engine, ui.doc, ui.win);
  const key = ui.keys('lute')[0];
  key.onclick();
  // Still inside the handler's synchronous run: the context exists and resume was called.
  assert.ok(engine.context, 'the context is created in the gesture');
  assert.equal(fake.context.resumeCalls, 1, 'resume is called in the gesture');
  await settle();
  assert.equal(started(fake), 1, 'the note sounds once audio runs');
  assert.equal(ui.elements.status.textContent, 'Lute - note 1 C');
  assert.equal(key.classList.has('lit'), true);
  t.mock.timers.tick(180);
  assert.equal(key.classList.has('lit'), false);
  // A second press of the same instrument neither resumes nor prepares again.
  ui.keys('lute')[10].onclick();
  await settle();
  assert.equal(fake.context.resumeCalls, 1);
  assert.equal(ui.elements.status.textContent, 'Lute - chord Em');
  ui.keys('flute')[15].onclick();
  await settle();
  assert.equal(ui.elements.status.textContent, 'Flute - note 16 C');
});

test('a row button unlocks inside the click before any note is scheduled', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = page();
  const { fake, engine } = locked();
  mountInstrumentPreview(engine, ui.doc, ui.win);
  ui.keys('trumpet')[17].onclick();
  assert.equal(fake.context.resumeCalls, 1, 'resume is called in the gesture, not in a timer');
  assert.equal(started(fake), 0, 'the notes wait for their timers');
  await settle();
  for (let slot = 1; slot <= 8; slot++) {
    const before = started(fake);
    t.mock.timers.tick(slot === 1 ? 0 : SCALE_STEP);
    await settle();
    assert.ok(started(fake) > before, `note ${slot} of the row sounds`);
    assert.ok(ui.elements.status.textContent.endsWith(`note ${slot + 8} ${'CDEFGABC'[slot - 1]}`));
  }
  assert.equal(fake.context.resumeCalls, 1, 'timers never resume audio themselves');
  // Starting another row stops the one before it, mid-way.
  ui.keys('lute')[16].onclick();
  await settle();
  t.mock.timers.tick(0);
  await settle();
  ui.keys('lute')[17].onclick();
  t.mock.timers.tick(SCALE_STEP * 8);
  await settle();
  assert.ok(ui.elements.status.textContent.startsWith('Lute - chord'), 'only the second row played on');
});

test('when audio cannot start, presses and rows say so and schedule nothing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = page();
  const engine = new AudioEngine({ contextFactory: () => null, storage: null });
  mountInstrumentPreview(engine, ui.doc, ui.win);
  ui.keys('kalimba')[0].onclick();
  await settle();
  assert.equal(ui.elements.status.textContent, 'Audio could not start. Press a note again.');
  ui.elements.status.textContent = '';
  ui.keys('kalimba')[16].onclick();
  await settle();
  assert.equal(ui.elements.status.textContent, 'Audio could not start. Press a note again.');
  ui.elements.status.textContent = '';
  t.mock.timers.tick(SCALE_STEP * 8);
  await settle();
  assert.equal(ui.elements.status.textContent, '', 'the row was cancelled');
});

test('failed notes and failed unlocks are reported', async () => {
  const ui = page();
  let unlock = async () => true;
  const engine = { context: null, unlock: () => unlock(), setVolume() {}, async dispose() {} };
  mountInstrumentPreview(engine, ui.doc, ui.win);
  ui.keys('vielle')[0].onclick();
  await settle();
  assert.equal(ui.elements.status.textContent, 'That note could not play.');
  unlock = () => { throw new Error('No audio'); };
  ui.keys('vielle')[0].onclick();
  await settle();
  assert.equal(ui.elements.status.textContent, 'Audio playback failed. Try again.');
});

test('stop, volume, hiding and leaving the page', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ui = page();
  const { fake, engine } = locked();
  const preview = mountInstrumentPreview(engine, ui.doc, ui.win);
  ui.elements.volume.oninput({ target: { value: '35' } });
  assert.equal(engine.volumes.master, 0.35);
  assert.equal(ui.elements.level.value, '35%');
  ui.keys('accordion')[0].onclick();
  await settle();
  ui.keys('accordion')[1].onclick();
  await settle();
  ui.elements.stop.onclick();
  assert.equal(ui.elements.status.textContent, 'Stopped.');
  assert.ok(fake.sources().every(source => source.stops.length === 2), 'every note is stopped');
  // A row in progress stops when the page is hidden, not while it is shown.
  ui.keys('accordion')[16].onclick();
  await settle();
  t.mock.timers.tick(0);
  await settle();
  const sounding = started(fake);
  ui.doc.dispatchEvent(new Event('visibilitychange'));
  ui.doc.hidden = true;
  ui.doc.dispatchEvent(new Event('visibilitychange'));
  t.mock.timers.tick(SCALE_STEP * 8);
  await settle();
  assert.equal(started(fake), sounding, 'no further notes after hiding');
  ui.win.dispatchEvent(new Event('pagehide'));
  await settle();
  assert.equal(engine.context, null, 'leaving disposes the engine');
  assert.equal(fake.context.state, 'closed');
  preview.dispose();
});
