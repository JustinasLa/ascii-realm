import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { Player } from '../../src/entities/player.js';
import { Animals } from '../../src/entities/animals.js';
import { Birds } from '../../src/entities/birds.js';
import { Fishes } from '../../src/entities/fish.js';
import { Horses } from '../../src/entities/horses.js';
import { HuntDrops } from '../../src/entities/hunt-drops.js';
import { layLoot, logsOf, LootCredit, rollLoot, rollPay } from '../../src/world/loot.js';
import { Wallet } from '../../src/inventory/wallet.js';
import { Roster } from '../../src/character/roster.js';
import { nameError, normalName } from '../../src/character/rules.js';
import { cleanSkin, PALETTES, presetSkin, PRESETS } from '../../src/character/skin.js';
import { sampleDraft, wantsCreator } from '../../src/character/creation.js';
import { hidesPreview } from '../../src/ui/creator.js';
import { mulberry32 } from '../../src/core/rng.js';
import { Collection } from '../../src/inventory/collection.js';
import { Inventory } from '../../src/inventory/inventory.js';
import { ITEMS } from '../../src/inventory/items.js';
import { INSTRUMENT_IDS, instrumentFalloff, layerNote, noteMidi, prepareInstrument, secondLayer } from '../../src/audio/instruments.js';
import { toMetres } from '../../src/entities/monsters.js';
import { InstrumentKeys } from '../../src/core/instrument-keys.js';
import { MusicNotes } from '../../src/world/music-notes.js';
import { isBow, isThrown } from '../../src/entities/loadout.js';
import { Projectiles } from '../../src/world/projectiles.js';
import { NightLight } from '../../src/world/night-light.js';
import { shaftTier } from '../../src/world/moon-shafts.js';
import { FrameClock, FramePacer, FrameQuality, renderSize } from '../../src/render/budget.js';
import { blockPageGestures, enterFullscreen, fullscreenApi, isStandalone, toggleFullscreen, WakeLock } from '../../src/core/native.js';
import { PlayGate } from '../../src/ui/play-gate.js';
import { ASPECT, GRASS, WATER } from '../../src/world/world.js';
import { PHONE_QUERY, watchPhone } from '../../src/core/phone.js';
import { FRAME_BIAS, LANDSCAPE_QUERY, phoneDefaultCell, watchLayout, ZoomSlots } from '../../src/core/layout.js';
import { assistTarget, castAssist, strikeAssist } from '../../src/core/aim-assist.js';
import { pickStruck, TargetTracker, targetId } from '../../src/core/target.js';
import { createHaptics } from '../../src/core/haptics.js';
import { interaction, performInteraction } from '../../src/core/interact.js';
import { metresBetween } from '../../src/multiplayer/chat.js';
import { figureTop } from '../../src/ui/bubbles.js';
import { displayName } from '../../src/multiplayer/protocol.js';
import { autoColour, hexRgb, memberColour, SOLO_COLOR } from '../../src/multiplayer/tint.js';
import { guardLobbyConnect, lobbyWorldUrl, needsWorldReload, PENDING_LOBBY, resumePendingLobby, sparseWorldUrl,
  woodlandOptions } from '../../src/world/woodland.js';

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

export async function loadGame(move = { x: 0, y: 0 }, { href = 'http://localhost/?debug', phone = false, coarse = phone,
  width = 800, height = 600, dpr = undefined, wakeLock = true, fullscreen = true, standalone = false, real = {},
  session = new Map(), creator = new URL(href).searchParams.has('creator') } = {}) {
  const taps = new Set();
  const held = new Set();
  let blocked = false;
  let navigatedTo;
  const startupErrors = [];
  let preparedSpellCount = 0;
  let populatedSpellControls = 0;
  const attributes = new Map([['aria-label', 'Game scene. Press B to build scenery.']]);
  const canvas = Object.assign(new EventTarget(), { classList: { add: noop, remove: noop, toggle: noop },
    focus: noop,
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
  // The phone media query: flip `phoneQuery.matches` and dispatch `change`.
  const phoneQuery = Object.assign(new EventTarget(), { matches: phone });
  // The touch-screen query: flip `coarseQuery.matches` to plug in a mouse.
  const coarseQuery = { matches: coarse, addEventListener: noop, removeEventListener: noop };
  // The orientation query: `rotate()` swaps the size and dispatches `change`.
  const landscapeQuery = Object.assign(new EventTarget(), { matches: width > height });
  const queries = { [PHONE_QUERY]: phoneQuery, [LANDSCAPE_QUERY]: landscapeQuery,
    '(display-mode: standalone)': { matches: standalone } };
  const window = Object.assign(new EventTarget(), { innerWidth: width, innerHeight: height,
    devicePixelRatio: dpr, matchMedia: text => queries[text] });
  let pinch = null;
  const hint = { classList: { add: noop, remove: noop }, addEventListener: noop };
  let nextFrame;
  let now = 0;
  let bladeSamples = 0;
  let modelUpdates = 0;
  let cellHeight;
  // The touch controls: the CAST hold hook and what the contextual button shows.
  const touch = { castHold: null, castDrop: null, interactions: [],
    setCastHold(open, drop) { this.castHold = open; this.castDrop = drop; },
    interact: { update: (target) => touch.interactions.push(target) } };
  const vibrations = [];
  const model = {
    gaits: [{ key: 'walk', speed: 1 }, { key: 'jog', speed: 3 }],
    update: () => { modelUpdates++; },
    // What the paused game dresses the model in, as [equipment, skin].
    gear: { applied: [], apply(equipment, skin) { this.applied.push([equipment, skin]); } },
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
  // The page: the play card, the menu's Full screen row, visibility, the
  // Fullscreen API and the Screen Wake Lock, all observable.
  const classes = () => {
    const set = new Set();
    return { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
      toggle: (c, on = !set.has(c)) => (on ? set.add(c) : set.delete(c), on) };
  };
  const element = () => Object.assign(new EventTarget(), { hidden: true, textContent: '', attributes: new Map(),
    classList: classes(), focus: noop,
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; } });
  const gateAction = { textContent: 'TAP TO PLAY' };
  const gateButton = Object.assign(element(), { querySelector: () => gateAction });
  const fullscreenRow = element();
  const audio = { suspends: 0, unlocks: 0 };
  const fullscreenRequests = [];
  const document = Object.assign(new EventTarget(), {
    getElementById: id => id === 'screen' ? canvas : id === 'play-gate' ? gateButton
      : id === 'phone-menu-fullscreen' ? fullscreenRow : hint,
    hidden: false, visibilityState: 'visible', body: { classList: classes() }, fullscreenElement: null,
    documentElement: fullscreen ? { requestFullscreen(options) {
      fullscreenRequests.push(options);
      document.fullscreenElement = this;
      return Promise.resolve();
    } } : {},
    exitFullscreen() { document.fullscreenElement = null; return Promise.resolve(); },
    createElement: () => ({ classList: { add: noop, remove: noop }, hidden: false, textContent: '' }) });
  const locks = { requests: 0, released: 0, refuse: false };
  const navigator = { vibrate: ms => vibrations.push(ms) };
  if (wakeLock) {
    navigator.wakeLock = { request: async () => {
      locks.requests++;
      if (locks.refuse) throw new Error('NotAllowedError');
      const sentinel = new EventTarget();
      sentinel.release = async () => { locks.released++; };
      return sentinel;
    } };
  }
  // The animals' figures: `ready` is resolved with a stand-in once they
  // should appear.
  let figuresLoaded;
  const figuresReady = new Promise(resolve => { figuresLoaded = resolve; });
  const animalFigures = {
    load: () => figuresReady,
    draw: noop,
    drawShadow: noop,
    drawSubmerged: noop,
  };
  // The horses' figures, likewise; every load asked for is noted.
  let horsesLoaded;
  const horsesReady = new Promise(resolve => { horsesLoaded = resolve; });
  const horseLoads = [];
  const horseDraws = [];
  const horseFigures = {
    load: (options) => { horseLoads.push(options); return horsesReady; },
    draw: (r, figure, write) => horseDraws.push(figure),
  };
  const source = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const context = {
    console: { ...console, error: (...args) => startupErrors.push(args) }, URL, URLSearchParams, window,
    // The page's session storage; `session` is the Map behind it.
    sessionStorage: { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, String(value)),
      removeItem: key => session.delete(key) },
    guardLobbyConnect, lobbyWorldUrl, needsWorldReload, PENDING_LOBBY, resumePendingLobby, sparseWorldUrl, woodlandOptions,
    document,
    matchMedia: () => coarseQuery, innerWidth: width, innerHeight: height,
    navigator,
    cancelAnimationFrame: noop, FrameClock, FramePacer, FrameQuality, renderSize,
    blockPageGestures, enterFullscreen, fullscreenApi, isStandalone, toggleFullscreen, WakeLock, PlayGate, installTouchControls: () => touch,
    assistTarget, castAssist, strikeAssist, pickStruck, TargetTracker, targetId, createHaptics, interaction, performInteraction,
    watchPhone, installPinchZoom: (_surface, zoomBy) => { pinch = zoomBy; },
    FRAME_BIAS, phoneDefaultCell, watchLayout, ZoomSlots,
    PhoneMenu: class {
      constructor(options) { Object.assign(this, options); this.open = false; }
      setOpen(open) { this.open = open; this.onToggle(open); }
    },
    // The chat's open state and its rules for opening; the real one is
    // tested on its own.
    ChatUi: class {
      constructor(options) { Object.assign(this, options); this.isOpen = false; this.closes = []; this.updates = 0; }
      open() {
        if (this.isOpen || !this.mayOpen()) return;
        this.isOpen = true;
        this.onToggle(true);
      }
      close(options = {}) {
        this.closes.push(options);
        if (!this.isOpen) return;
        this.isOpen = false;
        this.onToggle(false);
      }
      setAvailable(available) { this.available = available; }
      receive(message, roster) { this.received = [message, roster]; }
      notice(notice) { this.noticed = notice; }
      roster(change) { this.rostered = change; }
      update() { this.updates++; }
    },
    // The creator's open state, what it was opened with and how often it
    // was refitted; the real one is tested on its own. It opens only when a
    // test asks (`creator`, or ?creator in the URL), so the other tests play
    // although their roster is empty.
    CharacterCreator: class {
      constructor(options) { Object.assign(this, options); this.flow = null; this.opened = []; this.refits = 0; }
      get isOpen() { return this.flow !== null; }
      open(options) {
        this.opened.push(options);
        this.mode = options.edit ? 'edit' : options.mode ?? 'first';
        if (creator) this.flow = options;
      }
      refit() { this.refits++; }
      close(character = null) { this.flow = null; this.onClose(character, this.mode); }
    },
    sampleDraft, wantsCreator, hidesPreview,
    // What reaches the speech bubbles; the real ones are tested on their own.
    SpeechBubbles: class {
      constructor(options) { Object.assign(this, options); this.size = 0; this.received = []; this.rostered = []; this.updates = []; }
      receive(message, selfId) { this.received.push([message, selfId]); }
      roster(change) { this.rostered.push(change); }
      update(anchors, projection, form) { this.updates.push({ anchors, projection, form }); }
    },
    // What the nameplates are given each frame; the real ones are tested on
    // their own.
    Nameplates: class {
      constructor(options) { Object.assign(this, options); this.updates = []; }
      update(plates, projection) { this.updates.push({ plates, projection }); }
    },
    figureTop,
    metresBetween,
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
    Inventory, ITEMS, INSTRUMENT_IDS, instrumentFalloff, layerNote, noteMidi, prepareInstrument, secondLayer, InstrumentKeys, MusicNotes,
    // The HUD and the inventory record the names and pages they are given;
    // the real ones are tested on their own.
    Hud: class extends inert() {
      constructor(options) { super(); this.name = options.name; }
      setName(name) { this.name = name; }
    },
    InventoryScreen: class extends inert() {
      constructor(options) { super(); Object.assign(this, options); this.opened = []; }
      setName(name) { this.name = name; }
      setOpen(open, page) {
        this.opened.push([open, page]);
        if (open === (this.isOpen === true)) return;
        this.isOpen = open;
        this.onToggle(open);
      }
    },
    // The character pages count their renders and the buttons focused.
    CharacterPages: class {
      constructor(options) {
        Object.assign(this, options);
        Object.assign(this, { sheet: {}, list: {}, renders: 0, focused: [] });
        for (const id of ['edit', 'create']) this[id] = { focus: () => this.focused.push(id) };
      }
      render() { this.renders++; }
    },
    nameError, normalName,
    GroundItems: inert(), Harvesting: inert(), Collection, HuntDrops, layLoot, logsOf, LootCredit, rollLoot, rollPay, Wallet, Roster, cleanSkin, PALETTES, presetSkin, PRESETS, mulberry32, drawItem: noop, drawResource: noop,
    Mushrooms: class extends inert() {
      constructor() { super(); this.spores = []; this.ambient = []; this.time = 0; }
      nearby() { return null; }
    },
    Projectiles, screenToWorld: () => null, isBow, isThrown, SCALE: 13, TILT: 0.5,
    Spellcasting: class extends inert() { constructor(options) { super(); this.options = options; this.effects = { draw: noop }; } },
    SpellControls: class extends inert() {
      constructor(casting, options) { super(); this.options = options; }
      populate() { populatedSpellControls++; }
    },
    loadSpells: async () => [{ id: 'test-rune', name: 'Test rune' }],
    prepareSpellSounds: (_engine, spells) => { preparedSpellCount = spells.length; },
    moveAxis: () => move,
    wasTapped: code => !blocked && taps.delete(code),
    Player, ASPECT, GRASS, CHUNK_SIZE: 64,
    World: class {
      constructor(seed, options = {}) {
        this.spawn = { x: 0, y: 0 };
        this.options = options;
        this.woodland = options.woodland === 'dense' ? 'dense' : 'sparse';
      }
      isWalkable() { return true; }
      typeAt() { return GRASS; }
      propsIn() { return []; }
      propsInView() { return []; }
      waterDepthAt() { return 0; }
      trim() {}
    },
    Camera: class {
      constructor(x, y) { this.x = x; this.y = y; this.bias = 0; }
      centreY(view) { return this.y - this.bias * view.rows; }
      follow() {}
      shake() {}
      view() { return { x0: 0, y0: 0, rows: 60, cols: 80 }; }
    },
    Fireflies: class { constructor() { this.list = []; } update() {} draw() {} },
    Dust: class { update() {} draw() {} burst() {} sparks() {} breath() {} },
    Footprints: class { draw() {} },
    Ambience: class { update() {} drawMist() {} draw() {} }, lightsOf: () => [],
    Fires: class extends inert() { nearest() { return null; } },
    Torches: inert(),
    WeatherEffects: class extends inert() { constructor() { super(); this.wind = 0; } },
    Fog: inert(), NightLight, shaftTier, MAX_WALKERS: 20, figureScale: () => 1,
    SpellFogStirs: class { collect() { return { walkers: [], bursts: [], whirls: [] }; } },
    fireWeatherWind: () => 0,
    Splashes: class {
      react() {} update() {} precipitate() {}
      drawSurface() {} drawContacts() {} drawSpray() {}
    },
    // Records how the frame drives the river debris.
    Debris: class {
      constructor(options) { this.options = options; this.calls = []; this.pieces = []; this.events = []; }
      update(dt, world, view, player, weather, splashes, bodies) { this.calls.push(['update', dt, bodies]); }
      visible() { return this.pieces; }
      draw(r, view, piece) { this.calls.push(['draw', piece]); }
      reflect(r, view, piece) { this.calls.push(['reflect', piece]); }
      drawSurface() { this.calls.push(['surface']); }
    },
    WATER,
    AsciiRenderer: class {
      // Buffers for the camera's view, for the passes that run on them
      // (moonbeams' patches and columns); a layered glyph is never laid.
      constructor() {
        Object.assign(this, { cols: 80, rows: 60, fg: new Uint8ClampedArray(19200), bg: new Uint8ClampedArray(19200),
          ov: new Uint8ClampedArray(19200), mask: new Uint8Array(4800).fill(GRASS), fineMark: new Uint8Array(4800) });
      }
      hasLayer() { return true; }
      resize(width, height, pixelRatio, cellW, cellH) { cellHeight = cellH; }
      draw() {}
      put() {}
      fineInFront() { return false; }
    },
    buildAtlas: noop, glyph: noop, drawGround: noop, drawSkyReflection: noop,
    drawShadow: noop, drawProp: noop, fineOf: noop, fineBakesPending: () => false, bakeFine: noop, startFineWorkers: noop,
    reflector: noop, dressFigure: noop,
    drawFigure: noop, drawTrail: noop, putCell: noop, putOutlinedCell: noop,
    ModelFigure: { load: () => Promise.resolve(model), library: () => new Promise(noop) },
    Monsters: class extends inert() { constructor() { super(); this.living = []; this.arrows = { landedDrawables: () => [], drawFlying() {} }; } },
    MonsterFigures: class {}, KINDS: {}, toMetres,
    Animals, Birds, Fishes, AnimalFigures: animalFigures, Horses, HorseFigures: horseFigures,
    SceneryBuilder: class {
      constructor(options) { this.enabled = false; this.panel = { open: false }; Object.assign(this, options); }
      setEnabled(value) { this.enabled = value; this.onModeChange(); }
      forceExit() { this.enabled = false; this.onModeChange(); }
      updateCamera() {}
      drawPreview() {}
    },
    GameAudio: class {
      constructor() {
        this.music = { update: noop };
        this.engine = { setListener: noop, suspend: async () => { audio.suspends++; }, unlock: async () => { audio.unlocks++; } };
        this.weather = {};
      }
      play() {}
      pause() { audio.paused = (audio.paused ?? 0) + 1; }
      update() {}
    },
    bindAudioControls: () => Object.assign(() => {}, { updateSong: noop }),
    cleanName: (value) => String(value), playerState: () => ({}),
    displayName, autoColour, hexRgb, memberColour, SOLO_COLOR,
    // Records what the page tells the name-colour picker; the real one is
    // tested on its own.
    bindTintPicker: (client, options) => ({ ...options, renders: 0, render() { this.renders++; } }),
    MultiplayerClient: class {
      constructor(options) {
        this.players = []; this.room = null; this.notesSent = []; this.connects = []; this.leaves = []; this.suspends = 0;
        Object.assign(this, options);
      }
      // Records lobby requests and how the page left a lobby.
      connect(request) { this.connects.push(request); }
      suspend() { this.suspends++; }
      // Records each note offered to the lobby; solo, nothing is sent.
      sendNote(note) { this.notesSent.push(note); return false; }
      leave(notify) { this.leaves.push(notify); }
    },
    RemotePlayers: class { constructor() { this.peers = new Map(); } sync() {} update() {} visible() { return []; } },
    bindMultiplayerControls: noop,
  };
  // `real` swaps stand-ins for real systems (or for test worlds).
  Object.assign(context, real);
  runInNewContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(startupErrors, [], 'the real main module initializes without caught errors');
  assert.equal(preparedSpellCount, 1);
  assert.equal(populatedSpellControls, 1);
  if (window.game) assert.equal(window.game.casting.spells.get('test-rune').name, 'Test rune');
  return {
    game: window.game,
    canvas,
    setPhone(matches) {
      phoneQuery.matches = matches;
      phoneQuery.dispatchEvent(Object.assign(new Event('change'), { matches }));
    },
    setCoarse(matches) { coarseQuery.matches = matches; },
    // Turns the phone: swaps the window's sides and fires the orientation
    // query and a resize, as a browser does.
    rotate() {
      [context.innerWidth, context.innerHeight] = [context.innerHeight, context.innerWidth];
      window.innerWidth = context.innerWidth;
      window.innerHeight = context.innerHeight;
      landscapeQuery.matches = context.innerWidth > context.innerHeight;
      landscapeQuery.dispatchEvent(new Event('change'));
      window.dispatchEvent(new Event('resize'));
    },
    // Resizes the window without turning it, as a sliding browser bar does.
    resizeTo(w, h) {
      [context.innerWidth, context.innerHeight] = [w, h];
      window.innerWidth = w;
      window.innerHeight = h;
      window.dispatchEvent(new Event('resize'));
    },
    pinch: factor => pinch(factor),
    window,
    document,
    gateButton,
    gateAction,
    fullscreenRow,
    fullscreenRequests,
    locks,
    audio,
    // Clicks the play card, as a tap does.
    tapGate: () => gateButton.dispatchEvent(new Event('click')),
    // Hides or shows the page, as switching apps or locking the phone does.
    setHidden(hidden) {
      document.hidden = hidden;
      document.visibilityState = hidden ? 'hidden' : 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    },
    navigatedTo: () => navigatedTo,
    // Whether gameplay input is blocked by a panel, the inventory or chat.
    blocked: () => blocked,
    // Hands the game a stand-in for the animals' figures.
    loadAnimalFigures: async (figures) => {
      figuresLoaded(figures);
      await Promise.resolve();
      await Promise.resolve();
    },
    // Hands the game a stand-in for the horses' figures (or null, as when
    // there is no WebGL for them).
    loadHorseFigures: async (figures) => {
      horsesLoaded(figures);
      await Promise.resolve();
      await Promise.resolve();
    },
    horseLoads,
    horseDraws,
    touch,
    vibrations,
    pointer(type, button = 0, pointerType = 'mouse') {
      (type === 'pointerdown' ? canvas : window).dispatchEvent(Object.assign(new Event(type), { button, pointerType }));
    },
    blur: () => window.dispatchEvent(new Event('blur')),
    hold: code => held.add(code),
    release: code => held.delete(code),
    frame: (dt = 1 / 60) => nextFrame(now += dt * 1000),
    bladeSamples: () => bladeSamples,
    modelUpdates: () => modelUpdates,
    model,
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
