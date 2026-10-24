import assert from 'node:assert/strict';
import test from 'node:test';
import { bindAudioControls } from '../src/audio/controls.js';
import { WeatherAudio } from '../src/audio/weather.js';

test('audio controls respect activation, browser shortcuts and listener cleanup', async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const window = globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  document.createElement = () => ({});
  let unbind;
  t.after(() => {
    unbind?.();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const ids = ['audio-mute', 'audio-status', 'audio-skip', 'audio-song',
    'audio-weather', 'weather-intensity', 'weather-description', 'grass-preview'];
  const elements = new Map(ids.map(id => {
    const element = new EventTarget();
    element.setAttribute = () => {};
    element.replaceChildren = (...nodes) => { element.children = nodes; };
    return [`#${id}`, element];
  }));
  const weatherSelect = elements.get('#audio-weather');
  weatherSelect.options = [{ value: 'clear', textContent: 'Clear' }];
  weatherSelect.append = option => weatherSelect.options.push(option);
  elements.get('#weather-intensity').nextElementSibling = {};
  const root = {
    querySelector: selector => elements.get(selector),
    querySelectorAll: () => [],
  };
  let unlocks = 0;
  let skips = 0;
  const engine = {
    muted: false,
    unlock: async () => { unlocks++; },
    toggleMute() { this.muted = !this.muted; },
  };
  const music = { currentSong: 'Test song', skip() { skips++; } };
  const weather = new WeatherAudio(engine, { storage: null });
  unbind = bindAudioControls(engine, music, weather, () => {}, root);
  assert.equal(weatherSelect.options.length, weather.presets.length + 1);
  assert.equal(weatherSelect.value, 'clear');
  assert.equal(elements.get('#weather-intensity').nextElementSibling.value, '60%');
  const send = (type, properties, target) => {
    const event = Object.assign(new Event(type, { cancelable: true }), properties);
    if (target) Object.defineProperty(event, 'target', { value: target });
    window.dispatchEvent(event);
    return event;
  };

  send('keydown', { code: 'Escape' });
  assert.equal(unlocks, 0, 'Escape is not a user activation');
  for (const pointerType of ['touch', 'pen']) {
    const before = unlocks;
    send('pointerdown', { pointerType });
    assert.equal(unlocks, before, `${pointerType} activates on release`);
    send('pointerup', { pointerType });
    assert.equal(unlocks, before + 1);
  }
  send('pointerdown', { pointerType: 'mouse' });
  assert.equal(unlocks, 3, 'mouse presses can unlock immediately');
  send('pointerup', { pointerType: 'mouse' });
  assert.equal(unlocks, 3, 'a mouse click does not need a duplicate attempt');
  send('keydown', { code: 'KeyW', repeat: false });
  assert.equal(unlocks, 4);

  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    for (const code of ['KeyM', 'KeyN']) {
      const event = send('keydown', { code, [modifier]: true, repeat: false });
      assert.equal(event.defaultPrevented, false, 'browser shortcuts retain their default action');
      assert.equal(engine.muted, false, `${modifier}+${code} must not mute`);
      assert.equal(skips, 0, `${modifier}+${code} must not skip`);
      assert.equal(unlocks, 4, 'browser shortcuts must not attempt audio activation');
    }
  }
  const focusedControl = elements.get('#audio-mute');
  focusedControl.closest = selector => selector === '#audio-controls' ? root : null;
  for (const shiftKey of [false, true]) {
    send('keydown', { code: 'KeyM', shiftKey, repeat: false }, focusedControl);
    assert.equal(engine.muted, !shiftKey, 'M works while an audio control has focus');
    send('keydown', { code: 'KeyN', shiftKey, repeat: false }, focusedControl);
    assert.equal(skips, shiftKey ? 2 : 1, 'N works while an audio control has focus');
  }
  assert.equal(unlocks, 8, 'plain and Shift-modified audio shortcuts still unlock sound');

  for (const target of [
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { isContentEditable: true },
    { closest: () => ({}) },
  ]) {
    for (const code of ['KeyM', 'KeyN']) {
      const event = send('keydown', { code, repeat: false }, target);
      assert.equal(event.defaultPrevented, false, 'typing retains its default action');
      assert.equal(engine.muted, false, `${code} typed in an editor must not mute`);
      assert.equal(skips, 2, `${code} typed in an editor must not skip`);
    }
  }
  const shadowHost = { tagName: 'DIV' };
  for (const code of ['KeyM', 'KeyN']) {
    send('keydown', { code, repeat: false,
      composedPath: () => [{ tagName: 'INPUT' }, shadowHost, window] }, shadowHost);
    send('keydown', { code, repeat: false, isComposing: true });
    const consumed = new Event('keydown', { cancelable: true });
    Object.assign(consumed, { code, repeat: false });
    consumed.preventDefault();
    window.dispatchEvent(consumed);
    send('keydown', { code, repeat: true });
    assert.equal(engine.muted, false, `${code} must not escape a control or repeat`);
    assert.equal(skips, 2, `${code} must not skip during editing, composition or repeat`);
  }
  const beforeUnbind = unlocks;

  unbind();
  send('pointerdown', { pointerType: 'mouse' });
  send('pointerup', { pointerType: 'touch' });
  send('keydown', { code: 'KeyW', repeat: false });
  assert.equal(unlocks, beforeUnbind, 'all activation listeners are removed');
  await Promise.resolve();
});
