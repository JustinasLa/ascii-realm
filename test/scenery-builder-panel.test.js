import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { brushSize, worldToScreen } from '../src/editor/coordinates.js';
import { Camera } from '../src/world/camera.js';
import { PROP_CATALOG } from '../src/world/prop-catalog.js';
import { ASPECT, STONE, World } from '../src/world/world.js';

let SceneryBuilder;
before(async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    ({ SceneryBuilder } = await import('../src/editor/builder.js'));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

// Just enough of an element for the builder panel: attributes, children for
// the [data-tool] lookup, and real event dispatch through EventTarget.
class FakeElement extends EventTarget {
  constructor(tagName, id) {
    super();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.textContent = '';
    this.clicks = 0;
    if (id) this.id = id;
  }

  get id() { return this.attributes.get('id') ?? ''; }
  set id(value) { this.attributes.set('id', String(value)); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { this.children.push(...nodes); }
  descendants() {
    return this.children.flatMap((child) => child instanceof FakeElement ? [child, ...child.descendants()] : []);
  }
  querySelectorAll(selector) {
    assert.equal(selector, '[data-tool]');
    return this.descendants().filter((element) => element.dataset.tool);
  }
  click() {
    this.clicks++;
    this.dispatchEvent(new Event('click'));
  }
}

const IDS = ['cursor', 'banner', 'mode', 'status', 'undo', 'redo', 'radius', 'scale', 'props',
  'radius-value', 'scale-value', 'ruins', 'reset', 'save', 'load', 'export', 'import', 'file'];
const TERRAIN_TOOLS = ['grass', 'dirt', 'shore', 'water', 'stone', 'erase'];

function setGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

function memoryStorage() {
  const items = new Map();
  return {
    items,
    reads: 0,
    getItem(key) { this.reads++; return items.get(key) ?? null; },
    setItem(key, value) { items.set(key, String(value)); },
  };
}

// Builds a real SceneryBuilder through its constructor on fake browser globals.
function setup(t, { allowed, location = { search: '' }, world = new World(42), callbacks = true } = {}) {
  const elements = new Map();
  const panel = new FakeElement('details', 'scenery-builder');
  elements.set(panel.id, panel);
  const el = {};
  for (const id of IDS) {
    el[id] = new FakeElement(id === 'radius' || id === 'scale' || id === 'file' ? 'input' : 'div', `builder-${id}`);
    elements.set(el[id].id, el[id]);
  }
  for (const tool of TERRAIN_TOOLS) {
    const button = new FakeElement('button');
    button.dataset.tool = tool;
    panel.append(button);
  }
  panel.append(el.props);
  el.radius.value = '6';
  el.scale.value = '1';

  const created = [];
  const rect = { left: 0, top: 0, width: 800, height: 400 };
  const captured = new Set();
  const canvas = Object.assign(new EventTarget(), {
    tagName: 'CANVAS',
    width: 1600,
    height: 800,
    style: {},
    focuses: 0,
    getBoundingClientRect: () => rect,
    focus() { this.focuses++; },
    setPointerCapture: (id) => captured.add(id),
    hasPointerCapture: (id) => captured.has(id),
    releasePointerCapture: (id) => captured.delete(id),
  });
  const document = {
    activeElement: null,
    pointTarget: canvas,
    getElementById: (id) => elements.get(id) ?? null,
    createElement: (tagName) => {
      const element = new FakeElement(tagName);
      created.push(element);
      return element;
    },
    createTextNode: (textContent) => ({ textContent }),
    elementFromPoint() { return this.pointTarget; },
  };
  const window = Object.assign(new EventTarget(), location ? { location } : {});
  const storage = memoryStorage();
  setGlobal(t, 'document', document);
  setGlobal(t, 'window', window);
  setGlobal(t, 'localStorage', storage);

  const renderer = {
    canvas,
    cellW: 12 * ASPECT,
    cellH: 12,
    puts: [],
    put(...args) { this.puts.push(args); },
  };
  renderer.cols = Math.ceil(canvas.width / renderer.cellW);
  renderer.rows = Math.ceil(canvas.height / renderer.cellH);
  const player = { x: 0.5, y: 0.5 };
  const camera = new Camera(0.5, 0.5);
  const calls = { modes: [], resets: 0 };
  const builder = new SceneryBuilder({
    world, player, camera, renderer, allowed,
    ...callbacks && {
      onModeChange: (enabled) => calls.modes.push(enabled),
      onReset: () => calls.resets++,
    },
  });
  const tool = (name) => builder.tools.find((button) => button.dataset.tool === name);
  return { builder, world, player, camera, renderer, canvas, panel, el, document, window, storage, created, calls, tool };
}

function key(code, options = {}) {
  return Object.assign(new Event('keydown', { cancelable: true }), {
    code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...options,
  });
}

function pointerEvent(type, ctx, x, y, options = {}) {
  const { canvas, renderer, camera } = ctx;
  const point = worldToScreen(x, y, canvas.getBoundingClientRect(), renderer, camera.view(renderer));
  return Object.assign(new Event(type, { cancelable: true }), {
    clientX: point.x, clientY: point.y, pointerId: 1, button: 0, buttons: 1, isPrimary: true, ...options,
  });
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const status = (ctx) => ctx.el.status.textContent;

test('the constructor builds the prop palette and describes the starting scene', (t) => {
  const ctx = setup(t);
  const { builder, el } = ctx;
  const groups = [...new Set(PROP_CATALOG.map((prop) => prop.group))];
  assert.equal(el.props.children.length, groups.length);
  for (const [index, group] of groups.entries()) {
    const [heading, grid] = el.props.children[index].children;
    assert.equal(heading.textContent, group);
    assert.equal(heading.id, `builder-props-${group.toLowerCase()}`);
    assert.equal(grid.getAttribute('role'), 'group');
    assert.equal(grid.getAttribute('aria-labelledby'), heading.id);
  }
  assert.deepEqual(builder.tools.map((button) => button.dataset.tool).sort(),
    [...TERRAIN_TOOLS, ...PROP_CATALOG.map((prop) => prop.kind)].sort());
  const crate = ctx.tool('crate');
  assert.equal(crate.title, 'Crate: solid scenery');
  assert.equal(crate.children[0].textContent, '#');
  assert.equal(crate.children[1].textContent, ' Crate');
  assert.equal(ctx.tool('flowers').title, 'Flowers: walk-through decoration');
  assert.equal(builder.storageKey, 'ascii-realm:scenery:v1:42');
  assert.equal(builder.enabled, false);
  assert.equal(ctx.tool('grass').getAttribute('aria-pressed'), 'true');
  assert.equal(crate.getAttribute('aria-pressed'), 'false');
  assert.equal(el.undo.disabled, true);
  assert.equal(el.redo.disabled, true);
  assert.equal(el.radius.disabled, false);
  assert.equal(el.scale.disabled, true);
  assert.equal(status(ctx), 'Seed 42. Choose a tool or start building. 0 terrain cells · 0 placed props.');
});

test('the mode button switches between building and play', (t) => {
  const ctx = setup(t);
  const { builder, el, panel, canvas, calls, camera } = ctx;
  el.mode.click();
  assert.equal(builder.enabled, true);
  assert.equal(el.mode.textContent, 'Return to play (B)');
  assert.equal(el.mode.getAttribute('aria-pressed'), 'true');
  assert.equal(el.banner.hidden, false);
  assert.equal(panel.open, true);
  assert.equal(canvas.style.touchAction, 'none');
  assert.match(status(ctx), /^Building\./);
  camera.x = 300;
  el.mode.click();
  assert.equal(builder.enabled, false);
  assert.equal(el.mode.textContent, 'Start building');
  assert.equal(el.mode.getAttribute('aria-pressed'), 'false');
  assert.equal(el.banner.hidden, true);
  assert.equal(canvas.style.touchAction, '');
  assert.equal(camera.x, ctx.player.x, 'the camera returns to the player');
  assert.deepEqual(calls.modes, [true, false]);
  assert.match(status(ctx), /^Playing with your test scenery\./);
});

test('returning to play moves a player who is standing inside a prop', (t) => {
  const ctx = setup(t);
  const { builder, world, player } = ctx;
  builder.setEnabled(true);
  builder.scene.place('crate', 0.5, 0.5, { scale: 2 });
  assert.equal(world.isWalkable(0.5, 0.5), false);
  Object.assign(player, { vx: 3, trail: [1] });
  assert.equal(builder.setEnabled(false), true);
  assert.notDeepEqual([player.x, player.y], [0.5, 0.5]);
  assert.equal(world.isWalkable(player.x, player.y), true);
  assert.equal(player.vx, 0);
  assert.deepEqual(player.trail, []);
});

test('closing the panel returns to play unless there is no safe ground', (t) => {
  const ctx = setup(t);
  const { builder, panel } = ctx;
  panel.dispatchEvent(new Event('toggle'));
  assert.equal(builder.enabled, false, 'closing while playing does nothing');
  builder.setEnabled(true);
  panel.open = false;
  panel.dispatchEvent(new Event('toggle'));
  assert.equal(builder.enabled, false);

  builder.setEnabled(true);
  builder.world = Object.assign(Object.create(builder.world), { isWalkable: () => false });
  panel.open = false;
  panel.dispatchEvent(new Event('toggle'));
  assert.equal(builder.enabled, true);
  assert.equal(panel.open, true, 'the panel reopens so the scene can be fixed');
  assert.match(status(ctx), /^No safe ground nearby\./);
});

test('tool buttons select and describe a tool and enter building mode', (t) => {
  const ctx = setup(t);
  const { builder, el, canvas } = ctx;
  ctx.tool('flowers').click();
  assert.equal(builder.tool, 'flowers');
  assert.equal(builder.enabled, true);
  assert.ok(canvas.focuses > 0);
  assert.match(status(ctx), /^Selected Flowers\. Walk-through decoration\. /);
  assert.equal(ctx.tool('flowers').getAttribute('aria-pressed'), 'true');
  assert.equal(ctx.tool('grass').getAttribute('aria-pressed'), 'false');
  assert.equal(el.radius.disabled, true);
  assert.equal(el.scale.disabled, false);
  ctx.tool('crate').click();
  assert.match(status(ctx), /^Selected Crate\. \d/);
  ctx.tool('erase').click();
  assert.match(status(ctx), /^Selected erase props\. /);
  ctx.tool('stone').click();
  assert.match(status(ctx), /^Selected stone\. /);
  assert.equal(el.radius.disabled, false);
  assert.equal(el.scale.disabled, true);
});

test('the radius and scale sliders update the brush and their outputs', (t) => {
  const ctx = setup(t);
  const { builder, el } = ctx;
  el.radius.value = '9';
  el.radius.dispatchEvent(new Event('input'));
  assert.equal(builder.radius, 9);
  assert.equal(el['radius-value'].value, '9');
  builder.ghost = {};
  el.scale.value = '1.5';
  el.scale.dispatchEvent(new Event('input'));
  assert.equal(builder.scale, 1.5);
  assert.equal(el['scale-value'].value, '1.5×');
  assert.equal(builder.ghost, null);
});

test('canvas pointer events paint one stroke that the undo and redo buttons replay', (t) => {
  const ctx = setup(t);
  const { builder, world, canvas, el, window } = ctx;
  ctx.tool('stone').click();
  builder.radius = 1;
  const down = pointerEvent('pointerdown', ctx, 0.5, 0.5);
  canvas.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true);
  assert.equal(canvas.hasPointerCapture(1), true);
  canvas.dispatchEvent(pointerEvent('pointermove', ctx, 10.5, 0.5));
  canvas.dispatchEvent(pointerEvent('pointerup', ctx, 10.5, 0.5, { pointerId: 2 }));
  assert.ok(builder.stroke, 'another pointer does not end the stroke');
  canvas.dispatchEvent(pointerEvent('pointerup', ctx, 10.5, 0.5));
  assert.equal(builder.stroke, null);
  assert.equal(canvas.hasPointerCapture(1), false);
  for (let x = 0; x <= 10; x++) assert.equal(world.typeAt(x, 0), STONE);
  assert.equal(el.undo.disabled, false);
  assert.equal(el.redo.disabled, true);

  el.undo.click();
  assert.notEqual(world.typeAt(5, 0), STONE);
  assert.equal(el.undo.disabled, true);
  assert.equal(el.redo.disabled, false);
  assert.match(status(ctx), /^Undid scene edit\. 0 terrain cells/);
  el.redo.click();
  assert.equal(world.typeAt(5, 0), STONE);
  assert.match(status(ctx), /^Redid scene edit\./);

  // Cancel, lost capture and window blur all close an open stroke.
  for (const end of [() => canvas.dispatchEvent(new Event('pointercancel')),
    () => canvas.dispatchEvent(new Event('lostpointercapture')),
    () => window.dispatchEvent(new Event('blur'))]) {
    canvas.dispatchEvent(pointerEvent('pointerdown', ctx, 20.5, 0.5));
    assert.ok(builder.stroke);
    end();
    assert.equal(builder.stroke, null);
  }
  assert.equal(builder.pointer, null, 'blur forgets the pointer');
});

test('pointer leave, release without buttons and the context menu', (t) => {
  const ctx = setup(t);
  const { builder, canvas } = ctx;
  const menu = new Event('contextmenu', { cancelable: true });
  canvas.dispatchEvent(menu);
  assert.equal(menu.defaultPrevented, false, 'play mode keeps the context menu');
  builder.setEnabled(true);
  const buildMenu = new Event('contextmenu', { cancelable: true });
  canvas.dispatchEvent(buildMenu);
  assert.equal(buildMenu.defaultPrevented, true);

  canvas.dispatchEvent(pointerEvent('pointermove', ctx, 3.5, 3.5, { buttons: 0 }));
  assert.ok(builder.pointer);
  canvas.dispatchEvent(new Event('pointerleave'));
  assert.equal(builder.pointer, null);

  canvas.dispatchEvent(pointerEvent('pointerdown', ctx, 3.5, 3.5));
  canvas.dispatchEvent(new Event('pointerleave'));
  assert.ok(builder.pointer, 'the pointer is kept during a stroke');
  canvas.dispatchEvent(pointerEvent('pointermove', ctx, 4.5, 3.5, { buttons: 0 }));
  assert.equal(builder.stroke, null, 'a move with the button released ends the stroke');
  assert.match(status(ctx), /^Scene edited\./);
});

test('a prop is placed once per press and failed stamps report their error', (t) => {
  const ctx = setup(t);
  const { builder, world, canvas } = ctx;
  ctx.tool('crate').click();
  canvas.dispatchEvent(pointerEvent('pointerdown', ctx, 0.5, 0.5));
  canvas.dispatchEvent(pointerEvent('pointermove', ctx, 30.5, 0.5));
  canvas.dispatchEvent(pointerEvent('pointerup', ctx, 30.5, 0.5));
  assert.equal(world.addedProps.size, 1);
  const [crate] = world.addedProps.values();
  assert.deepEqual([crate.kind, crate.x, crate.y], ['crate', 0.5, 0.5]);
  assert.notEqual(builder.nextSeed, crate.seed, 'the next prop gets a fresh seed');

  builder.scale = Number.NaN;
  canvas.dispatchEvent(pointerEvent('pointerdown', ctx, 40.5, 0.5));
  assert.equal(builder.stroke, null);
  assert.equal(world.addedProps.size, 1);
  assert.doesNotMatch(status(ctx), /^Scene edited/);

  ctx.tool('stone').click();
  canvas.dispatchEvent(pointerEvent('pointerdown', ctx, 50.5, 0.5));
  builder.radius = -1;
  const message = status(ctx);
  canvas.dispatchEvent(pointerEvent('pointermove', ctx, 60.5, 0.5));
  assert.equal(builder.stroke, null);
  assert.notEqual(status(ctx), message);
  assert.doesNotMatch(status(ctx), /^Scene edited/);
});

test('ruins and reset buttons edit the scene and notify the game', (t) => {
  const ctx = setup(t);
  const { builder, world, el, calls } = ctx;
  el.ruins.click();
  assert.equal(builder.enabled, true);
  assert.ok(world.addedProps.size > 0);
  assert.equal(calls.resets, 1);
  assert.match(status(ctx), /^Added the column ruins\./);
  el.reset.click();
  assert.equal(world.addedProps.size, 0);
  assert.equal(calls.resets, 2);
  assert.match(status(ctx), /^Restored the generated world\./);
  el.undo.click();
  assert.ok(world.addedProps.size > 0, 'undo recovers the scene after a reset');
});

test('save writes the scene under the seed key and load restores it', (t) => {
  const ctx = setup(t);
  const { builder, el, storage } = ctx;
  el.load.click();
  assert.match(status(ctx), /^No local scene saved for seed 42\./);
  builder.setEnabled(true);
  builder.scene.paint(5.5, 5.5, 3, STONE);
  const painted = builder.scene.serialize();
  el.save.click();
  assert.deepEqual(JSON.parse(storage.items.get('ascii-realm:scenery:v1:42')), painted);
  assert.match(status(ctx), /^Saved locally for seed 42\./);

  builder.scene.reset();
  assert.notDeepEqual(builder.scene.serialize(), painted);
  builder.setEnabled(false);
  el.load.click();
  assert.deepEqual(builder.scene.serialize(), painted);
  assert.equal(builder.enabled, true);
  assert.equal(ctx.calls.resets, 1);
  assert.match(status(ctx), /^Loaded local scene\./);

  storage.setItem = () => { throw new Error('Quota exceeded.'); };
  el.save.click();
  assert.match(status(ctx), /^Could not save locally: Quota exceeded\. Export JSON to keep your scene\./);
});

test('export downloads the scene as a JSON file', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctx = setup(t);
  const { builder, el, created } = ctx;
  let blob;
  const revoked = [];
  t.mock.method(URL, 'createObjectURL', (value) => { blob = value; return 'blob:scene'; });
  t.mock.method(URL, 'revokeObjectURL', (url) => revoked.push(url));
  builder.setEnabled(true);
  builder.scene.paint(5.5, 5.5, 2, STONE);
  el.export.click();
  const link = created.find((element) => element.tagName === 'A');
  assert.equal(link.href, 'blob:scene');
  assert.equal(link.download, 'ascii-realm-scenery-42.json');
  assert.equal(link.clicks, 1);
  assert.equal(blob.type, 'application/json');
  assert.deepEqual(JSON.parse(await blob.text()), builder.scene.serialize());
  assert.match(status(ctx), /^Exported scene JSON\./);
  assert.deepEqual(revoked, []);
  t.mock.timers.tick(1000);
  assert.deepEqual(revoked, ['blob:scene']);
});

test('import opens the file picker, loads JSON and rejects large or broken files', async (t) => {
  const ctx = setup(t);
  const { builder, world, el } = ctx;
  el.import.click();
  assert.equal(el.file.clicks, 1);

  const choose = async (files) => {
    el.file.files = files;
    el.file.value = 'C:\\fakepath\\scene.json';
    el.file.dispatchEvent(new Event('change'));
    await settle();
    assert.equal(el.file.value, '', 'the input is cleared so the same file can be chosen again');
  };
  await choose([]);
  assert.match(status(ctx), /^Seed 42\./, 'cancelling the picker changes nothing');

  let read = false;
  await choose([{ size: 8 * 1024 * 1024 + 1, text: async () => { read = true; return '{}'; } }]);
  assert.equal(read, false);
  assert.match(status(ctx), /^Scene file must be smaller than 8 MiB\./);

  await choose([{ size: 10, text: async () => '{not json' }]);
  assert.match(status(ctx), /JSON/);

  builder.scene.paint(7.5, 7.5, 2, STONE);
  const data = builder.scene.serialize();
  builder.scene.reset();
  assert.notEqual(world.typeAt(7, 7), STONE);
  const text = JSON.stringify(data);
  await choose([{ size: text.length, text: async () => text }]);
  assert.deepEqual(builder.scene.serialize(), data);
  assert.equal(world.typeAt(7, 7), STONE);
  assert.equal(builder.enabled, true);
  assert.match(status(ctx), /^Imported scene\./);
});

test('B toggles building, Escape leaves it and keys in text fields are ignored', (t) => {
  const ctx = setup(t);
  const { builder, window, panel } = ctx;
  const escapeWhilePlaying = key('Escape');
  window.dispatchEvent(escapeWhilePlaying);
  assert.equal(escapeWhilePlaying.defaultPrevented, false);

  const press = key('KeyB');
  window.dispatchEvent(press);
  assert.equal(press.defaultPrevented, true);
  assert.equal(builder.enabled, true);
  window.dispatchEvent(key('KeyB', { repeat: true }));
  window.dispatchEvent(key('KeyB', { ctrlKey: true }));
  window.dispatchEvent(key('KeyB', { altKey: true }));
  assert.equal(builder.enabled, true, 'repeats and modified presses do not toggle');
  builder.keydown({ code: 'KeyB', target: { closest: () => ({}) }, preventDefault() {} });
  assert.equal(builder.enabled, true, 'typing B in a text field does not toggle');
  window.dispatchEvent(key('KeyB'));
  assert.equal(builder.enabled, false);
  assert.equal(panel.open, false);

  window.dispatchEvent(key('KeyB'));
  const escape = key('Escape');
  window.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(builder.enabled, false);

  // With nowhere safe to stand, B keeps building and the panel open.
  window.dispatchEvent(key('KeyB'));
  builder.world = Object.assign(Object.create(builder.world), { isWalkable: () => false });
  window.dispatchEvent(key('KeyB'));
  assert.equal(builder.enabled, true);
  assert.equal(panel.open, true);
});

test('Ctrl+Z and Ctrl+Y undo and redo; Enter applies the tool at the camera centre', (t) => {
  const ctx = setup(t);
  const { builder, world, window, camera } = ctx;
  window.dispatchEvent(key('KeyB'));
  ctx.tool('stone').click();
  builder.radius = 1;
  camera.x = 30.2;
  camera.y = 12.7;
  assert.notEqual(world.typeAt(30, 12), STONE);
  window.dispatchEvent(key('Enter', { repeat: true }));
  assert.notEqual(world.typeAt(30, 12), STONE, 'a held Enter does not stamp again');
  const enter = key('Enter');
  window.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.equal(world.typeAt(30, 12), STONE);
  assert.match(status(ctx), /^Applied tool at camera centre\./);

  const repeatUndo = key('KeyZ', { ctrlKey: true, repeat: true });
  window.dispatchEvent(repeatUndo);
  assert.equal(repeatUndo.defaultPrevented, true);
  assert.equal(world.typeAt(30, 12), STONE, 'a held Ctrl+Z does not undo again');
  window.dispatchEvent(key('KeyZ', { ctrlKey: true }));
  assert.notEqual(world.typeAt(30, 12), STONE);
  assert.match(status(ctx), /^Undid scene edit\./);
  window.dispatchEvent(key('KeyY', { ctrlKey: true }));
  assert.equal(world.typeAt(30, 12), STONE);
  assert.match(status(ctx), /^Redid scene edit\./);
  window.dispatchEvent(key('KeyZ', { metaKey: true }));
  window.dispatchEvent(key('KeyZ', { metaKey: true, shiftKey: true }));
  assert.equal(world.typeAt(30, 12), STONE, 'Cmd+Shift+Z redoes');

  // An action that fails reports its message instead of throwing.
  ctx.tool('crate').click();
  builder.scale = Number.NaN;
  window.dispatchEvent(key('Enter'));
  assert.equal(world.addedProps.size, 0);
  assert.doesNotMatch(status(ctx), /^Applied tool/);
});

test('a lockout through the real constructor blocks every way into building', async (t) => {
  const ctx = setup(t, { allowed: () => false, location: { search: '?scene=ruins' } });
  const { builder, el, window, storage, calls } = ctx;
  await settle();
  assert.equal(ctx.world.addedProps.size, 0, 'the ruins preview is blocked too');
  const before = JSON.stringify(builder.scene.serialize());
  el.mode.click();
  const press = key('KeyB');
  window.dispatchEvent(press);
  assert.equal(press.defaultPrevented, false, 'B is left alone');
  ctx.tool('stone').click();
  el.ruins.click();
  el.reset.click();
  el.undo.click();
  el.load.click();
  assert.equal(storage.reads, 0, 'the local scene is not even read');
  const text = JSON.stringify({ version: 1, terrain: [[0, 0, STONE]], props: [] });
  el.file.files = [{ size: text.length, text: async () => text }];
  el.file.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(JSON.stringify(builder.scene.serialize()), before);
  assert.equal(builder.enabled, false);
  assert.notEqual(el.mode.textContent, 'Return to play (B)');
  assert.deepEqual(calls.modes, []);
  assert.equal(calls.resets, 0);
});

test('?scene=ruins previews the ruins, and &play starts in play mode', async (t) => {
  await t.test('building', async (t) => {
    const ctx = setup(t, { location: { search: '?scene=ruins' } });
    assert.equal(ctx.world.addedProps.size, 0, 'the preset waits for main to finish wiring');
    await settle();
    assert.ok(ctx.world.addedProps.size > 0);
    assert.equal(ctx.builder.enabled, true);
    assert.equal(ctx.panel.open, true);
  });
  await t.test('playing', async (t) => {
    const ctx = setup(t, { location: { search: '?scene=ruins&play' } });
    await settle();
    assert.ok(ctx.world.addedProps.size > 0);
    assert.equal(ctx.builder.enabled, false);
    assert.equal(ctx.panel.open, false);
    assert.deepEqual(ctx.calls.modes, [true, false]);
  });
  await t.test('without a location or callbacks', async (t) => {
    const ctx = setup(t, { location: null, callbacks: false });
    await settle();
    assert.equal(ctx.world.addedProps.size, 0);
    assert.equal(ctx.builder.enabled, false);
    ctx.el.ruins.click();
    assert.ok(ctx.world.addedProps.size > 0, 'the default callbacks are optional');
    assert.equal(ctx.builder.enabled, true);
  });
});

test('the camera pans with WASD only while building outside form controls', (t) => {
  const ctx = setup(t);
  const { builder, camera, document } = ctx;
  builder.updateCamera(1, { x: 1, y: 0 }, false);
  assert.equal(camera.x, 0.5, 'play mode leaves the camera to the game');
  builder.setEnabled(true);
  const start = { x: camera.x, y: camera.y };
  builder.updateCamera(0.5, { x: 1, y: 0 }, false);
  assert.equal(camera.x, start.x + 20 / ASPECT);
  builder.updateCamera(0.5, { x: 0, y: 1 }, true);
  assert.equal(camera.y, start.y + 50);
  builder.updateCamera(0.5, { x: 0, y: 0 }, true);
  assert.equal(camera.y, start.y + 50, 'no input, no movement');
  builder.updateCamera(1e6, { x: -1, y: -1 }, true);
  assert.deepEqual([camera.x, camera.y], [-100000, -100000], 'panning is clamped');

  camera.x = camera.y = 0;
  document.activeElement = new FakeElement('input');
  builder.updateCamera(1, { x: 1, y: 0 }, false);
  assert.equal(camera.x, 0, 'a focused control keeps the keys');
  document.activeElement = null;
  builder.stroke = { id: 9 };
  builder.updateCamera(1, { x: 1, y: 0 }, false);
  assert.equal(camera.x, 0, 'no panning mid-stroke');
});

test('drawPreview shows the brush cursor over the canvas and a ghost prop', (t) => {
  const ctx = setup(t);
  const { builder, el, canvas, renderer, camera, document } = ctx;
  const view = () => camera.view(renderer);
  el.cursor.hidden = false;
  builder.drawPreview(view());
  assert.equal(el.cursor.hidden, true, 'hidden while playing');

  builder.setEnabled(true);
  el.cursor.hidden = false;
  builder.drawPreview(view());
  assert.equal(el.cursor.hidden, true, 'hidden without a pointer');

  canvas.dispatchEvent(pointerEvent('pointermove', ctx, 4.2, 3.7, { buttons: 0 }));
  document.pointTarget = el.panel;
  builder.drawPreview(view());
  assert.equal(el.cursor.hidden, true, 'hidden when the panel covers the pointer');

  document.pointTarget = canvas;
  builder.drawPreview(view());
  const rect = canvas.getBoundingClientRect();
  const centre = worldToScreen(4.5, 3.5, rect, renderer, view());
  const brush = brushSize(builder.radius, rect, renderer);
  assert.equal(el.cursor.hidden, false);
  assert.equal(el.cursor.style.left, `${centre.x}px`);
  assert.equal(el.cursor.style.top, `${centre.y}px`);
  assert.equal(el.cursor.style.width, `${brush.width}px`);
  assert.equal(el.cursor.style.height, `${brush.height}px`);
  assert.equal(el.cursor.style.borderColor, '#b7e7a0');

  ctx.tool('erase').click();
  builder.drawPreview(view());
  assert.equal(el.cursor.style.borderColor, '#df9a80');

  ctx.tool('crate').click();
  builder.drawPreview(view());
  const ghost = builder.ghost;
  assert.equal(ghost.kind, 'crate');
  assert.equal(ghost.seed, builder.nextSeed);
  assert.ok(renderer.puts.length > 0, 'the ghost prop is drawn');
  assert.equal(el.cursor.style.width,
    `${Math.max(8, ghost.footW * 2 * renderer.cellW * rect.width / canvas.width)}px`);
  builder.drawPreview(view());
  assert.equal(builder.ghost, ghost, 'the ghost is reused between frames');

  // A prop elsewhere takes the ghost's seed, so the preview picks a new one.
  builder.scene.place('crate', 90.5, 90.5, { seed: builder.nextSeed });
  builder.drawPreview(view());
  assert.notEqual(builder.ghost, ghost);
  assert.equal(builder.ghost.seed, ghost.seed + 1);
});
