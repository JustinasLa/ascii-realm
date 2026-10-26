import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NAME_COLOURS } from '../src/multiplayer/tint.js';
import { bindTintPicker, TINT_KEY } from '../src/multiplayer/tint-picker.js';

// Just enough DOM for the picker. Markup is refused, so any HTML use fails.
class El extends EventTarget {
  constructor(tagName) {
    super();
    Object.assign(this, { tagName: tagName.toUpperCase(), children: [], parentNode: null, style: {}, dataset: {},
      attributes: new Map(), className: '', title: '', type: '', value: '', tabIndex: 0, _text: '' });
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(value) { this.children = []; this._text = String(value); }
  set innerHTML(_) { throw new Error('the picker must never use innerHTML'); }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.doc.activeElement = this; }
  click() { this.dispatchEvent(new Event('click')); }
}

function mount({ search = '', stored, storage, getStorage, room = null, auto = [169, 212, 174], showPicker } = {}) {
  const doc = { activeElement: null };
  const make = (tag) => Object.assign(new El(tag), { doc });
  doc.createElement = make;
  const ids = {};
  for (const id of ['lobby-tint-swatches', 'lobby-tint-custom', 'lobby-tint-preview', 'lobby-tint-status', 'lobby-tint-label']) {
    ids[id] = make('div');
  }
  const custom = ids['lobby-tint-custom'];
  custom.opened = 0;
  custom.clicked = 0;
  custom.showPicker = showPicker ?? (() => { custom.opened++; });
  custom.click = () => { custom.clicked++; };
  doc.getElementById = (id) => ids[id] ?? null;
  const items = new Map(stored === undefined ? [] : [[TINT_KEY, stored]]);
  const store = storage ?? {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key),
  };
  const client = { room, sent: [], setTint(tint) { this.sent.push(tint); } };
  const tints = [];
  const picker = bindTintPicker(client, { doc, params: new URLSearchParams(search), getStorage: getStorage ?? (() => store),
    getName: () => 'Ash', autoColour: () => auto, onTint: (tint) => tints.push(tint) });
  const swatches = ids['lobby-tint-swatches'].children;
  const swatch = (id) => swatches.find((button) => button.dataset.tint === id);
  const checked = () => swatches.filter((button) => button.getAttribute('aria-checked') === 'true').map((b) => b.dataset.tint);
  const sample = (id) => swatch(id).children[0];
  const press = (id, key) => {
    const event = new Event('keydown', { cancelable: true });
    event.key = key;
    swatch(id).dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { doc, ids, custom, items, client, tints, picker, swatches, swatch, checked, sample, press,
    status: () => ids['lobby-tint-status'].textContent, preview: ids['lobby-tint-preview'],
    label: () => ids['lobby-tint-label'].textContent };
}

test('Auto, the named colours and Custom are offered in order, Auto chosen at first', () => {
  const { swatches, checked, sample, client, tints, preview, label, items, status } = mount();
  assert.deepEqual(swatches.map((b) => b.dataset.tint), ['auto', ...NAME_COLOURS.map((c) => c.id), 'custom']);
  assert.ok(swatches.every((b) => b.tagName === 'BUTTON' && b.type === 'button' && b.getAttribute('role') === 'radio'));
  assert.deepEqual(swatches.map((b) => b.getAttribute('aria-label')).slice(0, 3), ['Auto', 'Dark Blue', 'Dark Green']);
  assert.equal(swatches.at(-1).getAttribute('aria-label'), 'Custom colour');
  assert.equal(swatches.at(-1).title, 'Custom…');
  assert.deepEqual(checked(), ['auto']);
  assert.deepEqual(swatches.map((b) => b.tabIndex).filter((i) => i === 0).length, 1, 'one tab stop');
  assert.equal(sample('auto').textContent, 'Aa');
  assert.equal(sample('auto').style.color, 'rgb(169, 212, 174)', 'Auto shows your automatic colour');
  assert.equal(sample('gold').style.color, 'rgb(255, 170, 0)');
  assert.equal(sample('dark_blue').style.color, 'rgb(74, 137, 255)', 'shown as it will read');
  assert.equal(sample('custom').textContent, '#', 'no custom colour yet');
  assert.equal(sample('custom').style.color, '');
  assert.equal(preview.textContent, 'Ash');
  assert.equal(preview.style.color, 'rgb(169, 212, 174)');
  assert.equal(label(), ' · Auto');
  assert.deepEqual(client.sent, [null], 'the lobby client learns the colour at once');
  assert.deepEqual(tints, [null]);
  assert.equal(items.size, 0);
  assert.equal(status(), '');
});

test('the colour kept from last time comes back, cleaned; a broken one is Auto', () => {
  let page = mount({ stored: '#00AAAA' });
  assert.deepEqual(page.checked(), ['dark_aqua']);
  assert.deepEqual(page.client.sent, ['#00aaaa']);
  assert.equal(page.picker.tint, '#00aaaa');
  page = mount({ stored: '#000000' });
  assert.deepEqual(page.checked(), ['dark_gray'], 'black kept by hand comes back lightened');
  for (const stored of ['javascript:alert(1)', 'dark_aqua', '']) {
    page = mount({ stored });
    assert.deepEqual(page.checked(), ['auto'], stored);
  }
  page = mount({ stored: '#123456' });
  assert.deepEqual(page.checked(), ['custom']);
  assert.equal(page.sample('custom').textContent, 'Aa');
  assert.equal(page.sample('custom').style.color, 'rgb(108, 145, 185)');
  assert.equal(page.label(), ' · #6c91b9');
});

test('?tint= in the address wins for this visit and is not kept', () => {
  let page = mount({ search: '?tint=ffaa00', stored: '#00aaaa' });
  assert.deepEqual(page.checked(), ['gold']);
  assert.equal(page.items.get(TINT_KEY), '#00aaaa');
  page = mount({ search: '?tint=%20FFAA00%20' });
  assert.deepEqual(page.client.sent, ['#ffaa00'], 'loosely typed hex is tidied on the page, before it is sent');
  page = mount({ search: '?tint=dark_aqua' });
  assert.deepEqual(page.checked(), ['dark_aqua']);
  assert.deepEqual(page.client.sent, ['#00aaaa'], 'only hex reaches the lobby');
  page = mount({ search: '?tint=__proto__', stored: '#ffaa00' });
  assert.deepEqual(page.checked(), ['gold'], 'an unknown one falls back to the kept colour');
});

test('picking a colour shows it, sends it and keeps it; Auto clears it', () => {
  const page = mount();
  page.swatch('gold').click();
  assert.deepEqual(page.checked(), ['gold']);
  assert.deepEqual(page.client.sent, [null, '#ffaa00']);
  assert.deepEqual(page.tints, [null, '#ffaa00']);
  assert.equal(page.items.get(TINT_KEY), '#ffaa00');
  assert.equal(page.status(), 'Name colour updated. Friends see it when you join a lobby.');
  assert.equal(page.preview.style.color, 'rgb(255, 170, 0)');
  assert.equal(page.label(), ' · Gold');
  page.swatch('dark_red').click();
  assert.equal(page.client.sent.at(-1), '#f15949');
  assert.equal(page.status(), 'Name colour updated. Friends see it when you join a lobby.', 'a named colour is never "lightened"');
  page.client.room = { code: 'ABCDEF' };
  page.swatch('auto').click();
  assert.equal(page.items.has(TINT_KEY), false);
  assert.equal(page.client.sent.at(-1), null);
  assert.equal(page.status(), 'Name colour cleared.', 'in a lobby, friends see it already');
});

test('a custom colour previews while dragged, is sent when let go and is lightened when too dark', () => {
  const page = mount({ room: { code: 'ABCDEF' } });
  page.swatch('custom').click();
  assert.equal(page.custom.opened, 1);
  assert.equal(page.custom.value, '#ffaa00', 'the browser picker starts on Gold');
  page.custom.value = '#000010';
  page.custom.dispatchEvent(new Event('input'));
  assert.deepEqual(page.checked(), ['custom']);
  assert.equal(page.sample('custom').style.color, 'rgb(124, 141, 175)');
  assert.deepEqual(page.client.sent, [null], 'nothing sent while dragging');
  assert.equal(page.items.size, 0);
  page.custom.dispatchEvent(new Event('change'));
  assert.deepEqual(page.client.sent, [null, '#7c8daf']);
  assert.equal(page.items.get(TINT_KEY), '#7c8daf');
  assert.equal(page.status(), 'Name colour updated. Lightened to stay readable.');
  page.swatch('custom').click();
  assert.equal(page.custom.value, '#7c8daf', 'reopening starts on the custom colour');
  page.custom.value = '#ff5555';
  page.custom.dispatchEvent(new Event('change'));
  assert.deepEqual(page.checked(), ['red'], 'a custom pick equal to a named colour selects it');
  assert.equal(page.sample('custom').style.color, 'rgb(124, 141, 175)', 'the last custom colour stays on offer');
});

test('without showPicker the hidden input is clicked instead', () => {
  const page = mount({ showPicker: () => { throw new Error('not allowed'); } });
  page.swatch('custom').click();
  assert.equal(page.custom.clicked, 1);
  const bare = mount({ stored: '#00aaaa' });
  bare.custom.showPicker = undefined;
  bare.swatch('custom').click();
  assert.equal(bare.custom.clicked, 1);
  assert.equal(bare.custom.value, '#00aaaa', 'starts on the chosen colour');
});

test('blocked storage leaves the colour for this page only', () => {
  const throwing = () => { throw new Error('blocked'); };
  for (const options of [
    { getStorage: throwing },
    { getStorage: () => null },
    { storage: { getItem: throwing, setItem: throwing, removeItem: throwing } },
  ]) {
    const page = mount(options);
    assert.deepEqual(page.checked(), ['auto']);
    page.swatch('aqua').click();
    assert.deepEqual(page.checked(), ['aqua']);
    assert.equal(page.client.sent.at(-1), '#55ffff');
    page.swatch('auto').click();
    assert.equal(page.status(), 'Name colour cleared. Friends see it when you join a lobby.');
  }
});

test('arrow keys move through the colours like any radio group', () => {
  const page = mount();
  assert.equal(page.press('auto', 'ArrowRight'), true);
  assert.deepEqual(page.checked(), ['dark_blue']);
  assert.equal(page.doc.activeElement, page.swatch('dark_blue'));
  page.press('dark_blue', 'ArrowDown');
  assert.deepEqual(page.checked(), ['dark_green']);
  page.press('dark_green', 'ArrowUp');
  page.press('dark_blue', 'ArrowLeft');
  assert.deepEqual(page.checked(), ['auto']);
  page.press('auto', 'End');
  assert.equal(page.doc.activeElement, page.swatch('custom'));
  assert.deepEqual(page.checked(), ['auto'], 'Custom is only focused until a custom colour exists');
  page.press('custom', 'ArrowRight');
  assert.deepEqual(page.checked(), ['auto'], 'wraps round to Auto');
  page.press('auto', 'ArrowLeft');
  assert.equal(page.doc.activeElement, page.swatch('custom'));
  page.press('custom', 'Home');
  assert.deepEqual(page.checked(), ['auto']);
  assert.equal(page.press('auto', 'a'), false, 'other keys are left alone');
  const custom = mount({ stored: '#123456' });
  custom.press('custom', 'ArrowLeft');
  assert.deepEqual(custom.checked(), ['white']);
  custom.press('white', 'ArrowRight');
  assert.deepEqual(custom.checked(), ['custom'], 'back onto the custom colour');
  assert.equal(custom.client.sent.at(-1), '#6c91b9');
});

test('render follows your lobby colour, and every option has a default', () => {
  const page = mount({ auto: [146, 198, 235] });
  page.picker.render();
  assert.equal(page.sample('auto').style.color, 'rgb(146, 198, 235)');
  assert.equal(page.preview.style.color, 'rgb(146, 198, 235)');
  page.ids['lobby-tint-swatches'].children = [];
  const sent = [];
  const defaults = bindTintPicker({ setTint: (tint) => sent.push(tint) }, { doc: page.doc, getStorage: () => null });
  assert.equal(defaults.tint, null);
  assert.deepEqual(sent, [null]);
  assert.equal(page.preview.textContent, '');
  assert.equal(page.preview.style.color, 'rgb(212, 218, 228)', 'solo, Auto is the solo colour');
});
