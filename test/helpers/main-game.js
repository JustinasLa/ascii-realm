import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { Player } from '../../src/entities/player.js';
import { Inventory } from '../../src/inventory/inventory.js';
import { ITEMS } from '../../src/inventory/items.js';
import { isBow, isThrown } from '../../src/entities/loadout.js';
import { Projectiles } from '../../src/world/projectiles.js';
import { FrameClock, FrameQuality, renderSize } from '../../src/render/budget.js';
import { ASPECT, GRASS, WATER } from '../../src/world/world.js';

const noop = () => {};

// Run the real frame loop and player state with browser, rendering and audio I/O stubbed.
// A stand-in for systems these tests don't exercise: every method is a no-op
// returning an empty list.
const inert = () => class {
  constructor() {
    this.list = [];
    this.events = [];
    return new Proxy(this, { get: (target, key) => key in target ? target[key] : () => [] });
  }
};

export async function loadGame(move = { x: 0, y: 0 }, { href = 'http://localhost/?debug' } = {}) {
  const taps = new Set();
  const held = new Set();
  let blocked = false;
  let navigatedTo;
  const startupErrors = [];
  let preparedSpellCount = 0;
  let populatedSpellControls = 0;
  const canvas = Object.assign(new EventTarget(), { classList: { add: noop, remove: noop, toggle: noop },
    focus: noop,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
  const window = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 600 });
  const hint = { classList: { add: noop, remove: noop }, addEventListener: noop };
  let nextFrame;
  let now = 0;
  let bladeSamples = 0;
  let modelUpdates = 0;
  let cellHeight;
  const model = {
    gaits: [{ key: 'walk', speed: 1 }, { key: 'jog', speed: 3 }],
    update: () => { modelUpdates++; },
    resetPose: noop,
    rasterise: noop,
    renderPose: noop,
    cells: [],
    waterContacts: () => [],
    torchPose: () => null,
    draw: noop,
    swordLine: () => {
      bladeSamples++;
      return { base: [0, 0], tip: [1, 1] };
    },
  };
  const source = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  runInNewContext(source.replace(/^import .*;\r?\n/gm, ''), {
    console: { ...console, error: (...args) => startupErrors.push(args) }, URL, URLSearchParams, window,
    sessionStorage: { setItem: noop },
    document: { getElementById: id => id === 'screen' ? canvas : hint, hidden: false, addEventListener: noop,
      createElement: () => ({ classList: { add: noop, remove: noop }, hidden: false, textContent: '' }) },
    matchMedia: () => ({ matches: false }), innerWidth: 800, innerHeight: 600,
    cancelAnimationFrame: noop, FrameClock, FrameQuality, renderSize, installTouchControls: noop,
    Grass: inert(),
    MAX_TREE_HALF_WIDTH: 40, MAX_TREE_HEIGHT: 160, MAX_LEAF_DRIFT: 8,
    propInView: () => true, drawLeaves: noop,
    location: { search: new URL(href).search, href, replace: url => { navigatedTo = String(url); } },
    performance: { now: () => 0 },
    requestAnimationFrame: callback => { nextFrame = callback; },
    isDown: (...codes) => !blocked && codes.some(code => held.has(code)),
    isControlTarget: () => false,
    clearInput: () => { taps.clear(); held.clear(); }, isGameplayBlocked: () => blocked,
    setGameplayBlocked: value => { blocked = value; taps.clear(); held.clear(); },
    Inventory, ITEMS, Hud: inert(),
    InventoryScreen: class extends inert() { constructor(options) { super(); Object.assign(this, options); } },
    GroundItems: inert(), Harvesting: inert(), Collection: inert(), drawItem: noop, drawResource: noop,
    Mushrooms: class extends inert() {
      constructor() { super(); this.spores = []; this.ambient = []; }
      nearby() { return null; }
    },
    Projectiles, screenToWorld: () => null, isBow, isThrown, SCALE: 13, TILT: 0.5,
    Spellcasting: class extends inert() { constructor() { super(); this.effects = { draw: noop }; } },
    SpellControls: class extends inert() { populate() { populatedSpellControls++; } },
    loadSpells: async () => [{ id: 'test-rune', name: 'Test rune' }],
    prepareSpellSounds: (_engine, spells) => { preparedSpellCount = spells.length; },
    moveAxis: () => move,
    wasTapped: code => !blocked && taps.delete(code),
    Player, ASPECT, GRASS, CHUNK_SIZE: 64,
    World: class {
      constructor() { this.spawn = { x: 0, y: 0 }; }
      isWalkable() { return true; }
      typeAt() { return GRASS; }
      propsIn() { return []; }
      propsInView() { return []; }
      waterDepthAt() { return 0; }
      trim() {}
    },
    Camera: class {
      constructor(x, y) { this.x = x; this.y = y; }
      follow() {}
      shake() {}
      view() { return { x0: 0, y0: 0, rows: 60, cols: 80 }; }
    },
    Fireflies: class { constructor() { this.list = []; } update() {} draw() {} },
    Dust: class { update() {} draw() {} burst() {} sparks() {} breath() {} },
    Footprints: class { draw() {} },
    Ambience: class { update() {} drawMist() {} draw() {} }, lightsOf: () => [],
    Fires: inert(),
    Torches: inert(),
    WeatherEffects: class extends inert() { constructor() { super(); this.wind = 0; } },
    Fog: inert(), MAX_WALKERS: 20, figureScale: () => 1,
    SpellFogStirs: class { collect() { return { walkers: [], bursts: [], whirls: [] }; } },
    fireWeatherWind: () => 0,
    Splashes: class {
      react() {} update() {} precipitate() {}
      drawSurface() {} drawContacts() {} drawSpray() {}
    },
    WATER,
    AsciiRenderer: class {
      resize(width, height, pixelRatio, cellW, cellH) { cellHeight = cellH; }
      draw() {}
      put() {}
    },
    buildAtlas: noop, glyph: noop, drawGround: noop, drawSkyReflection: noop,
    drawShadow: noop, drawProp: noop, fineOf: noop, fineBakesPending: () => false, bakeFine: noop, startFineWorkers: noop,
    reflector: noop, dressFigure: noop,
    drawFigure: noop, drawNameTag: noop, drawTrail: noop, putCell: noop,
    ModelFigure: { load: () => Promise.resolve(model), library: () => new Promise(noop) },
    Monsters: class extends inert() { constructor() { super(); this.living = []; this.arrows = { landedDrawables: () => [], drawFlying() {} }; } },
    MonsterFigures: class {}, KINDS: {},
    SceneryBuilder: class {
      constructor(options) { this.enabled = false; Object.assign(this, options); }
      setEnabled(value) { this.enabled = value; this.onModeChange(); }
      updateCamera() {}
      drawPreview() {}
    },
    GameAudio: class {
      constructor() { this.music = { update: noop }; this.engine = { setListener: noop }; this.weather = {}; }
      play() {}
      pause() {}
      update() {}
    },
    bindAudioControls: () => Object.assign(() => {}, { updateSong: noop }),
    cleanName: (value) => String(value), PLAYER_COLORS: [[1, 2, 3]], playerState: () => ({}),
    MultiplayerClient: class {
      constructor(options) { this.players = []; this.room = null; Object.assign(this, options); }
      leave() {}
    },
    RemotePlayers: class { sync() {} update() {} visible() { return []; } },
    bindMultiplayerControls: noop,
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(startupErrors, [], 'the real main module initializes without caught errors');
  assert.equal(preparedSpellCount, 1);
  assert.equal(populatedSpellControls, 1);
  assert.equal(window.game.casting.spells.get('test-rune').name, 'Test rune');
  return {
    game: window.game,
    navigatedTo: () => navigatedTo,
    pointer(type, button = 0, pointerType = 'mouse') {
      (type === 'pointerdown' ? canvas : window).dispatchEvent(Object.assign(new Event(type), { button, pointerType }));
    },
    blur: () => window.dispatchEvent(new Event('blur')),
    hold: code => held.add(code),
    release: code => held.delete(code),
    frame: (dt = 1 / 60) => nextFrame(now += dt * 1000),
    bladeSamples: () => bladeSamples,
    modelUpdates: () => modelUpdates,
    cellHeight: () => cellHeight,
    keydown(key, modifiers = {}) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key, ...modifiers });
      window.dispatchEvent(event);
      return event;
    },
    tap(action) {
      if (action !== 'mouse') {
        taps.add(action);
        return;
      }
      canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { button: 0, pointerType: 'mouse' }));
      window.dispatchEvent(Object.assign(new Event('pointerup'), { button: 0, pointerType: 'mouse' }));
    },
  };
}
