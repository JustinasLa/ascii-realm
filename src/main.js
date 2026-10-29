import { screenToWorld } from './core/aim.js';
import { clearInput, isControlTarget, isDown, isGameplayBlocked, moveAxis, setGameplayBlocked, wasTapped } from './core/input.js';
import { SceneryBuilder } from './editor/builder.js';
import { GameAudio } from './audio/audio.js';
import { prepareSpellSounds } from './audio/spells.js';
import { bindAudioControls } from './audio/controls.js';
import { INSTRUMENT_IDS, instrumentFalloff, layerNote, noteMidi, prepareInstrument, secondLayer } from './audio/instruments.js';
import { InstrumentKeys } from './core/instrument-keys.js';
import { MusicNotes } from './world/music-notes.js';
import { installTouchControls } from './core/touch.js';
import { assistTarget, castAssist, strikeAssist } from './core/aim-assist.js';
import { pickStruck, TargetTracker, targetId } from './core/target.js';
import { createHaptics } from './core/haptics.js';
import { interaction, performInteraction } from './core/interact.js';
import { FRAME_BIAS, phoneDefaultCell, watchLayout, ZoomSlots } from './core/layout.js';
import { watchPhone } from './core/phone.js';
import { installPinchZoom } from './core/pinch.js';
import { blockPageGestures, enterFullscreen, fullscreenApi, isStandalone, toggleFullscreen, WakeLock } from './core/native.js';
import { dressFigure, drawFigure, drawShadow, drawTrail } from './entities/figure.js';
import { ModelFigure } from './entities/model.js';
import { KINDS, Monsters, toMetres } from './entities/monsters.js';
import { figureScale, MonsterFigures } from './entities/monster-figures.js';
import { Animals } from './entities/animals.js';
import { Birds } from './entities/birds.js';
import { Fishes } from './entities/fish.js';
import { AnimalFigures } from './entities/animal-figures.js';
import { Horses } from './entities/horses.js';
import { HorseFigures } from './entities/horse-figure.js';
import { HuntDrops } from './entities/hunt-drops.js';
import { isBow, isThrown } from './entities/loadout.js';
import { Player } from './entities/player.js';
import { Spellcasting } from './spells/casting.js';
import { loadSpells } from './spells/catalog.js';
import { SpellControls } from './spells/controls.js';
import { SCALE, TILT } from './entities/rig.js';
import { Collection } from './inventory/collection.js';
import { Inventory } from './inventory/inventory.js';
import { ITEMS } from './inventory/items.js';
import { Wallet } from './inventory/wallet.js';
import { Roster } from './character/roster.js';
import { nameError, normalName } from './character/rules.js';
import { cleanSkin, PALETTES, presetSkin, PRESETS } from './character/skin.js';
import { sampleDraft, wantsCreator } from './character/creation.js';
import { metresBetween } from './multiplayer/chat.js';
import { MultiplayerClient } from './multiplayer/client.js';
import { bindMultiplayerControls } from './multiplayer/controls.js';
import { displayName, playerState } from './multiplayer/protocol.js';
import { RemotePlayers } from './multiplayer/remote-players.js';
import { autoColour, hexRgb, memberColour, SOLO_COLOR } from './multiplayer/tint.js';
import { bindTintPicker } from './multiplayer/tint-picker.js';
import { putOutlinedCell } from './render/cells.js';
import { buildAtlas } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
import { ChatUi } from './ui/chat.js';
import { CharacterPages } from './ui/character-pages.js';
import { CharacterCreator, hidesPreview } from './ui/creator.js';
import { figureTop, SpeechBubbles } from './ui/bubbles.js';
import { Nameplates } from './ui/nameplates.js';
import { Hud } from './ui/hud.js';
import { InventoryScreen } from './ui/inventory.js';
import { PhoneMenu } from './ui/phone-menu.js';
import { PlayGate } from './ui/play-gate.js';
import { FrameClock, FramePacer, FrameQuality, renderSize } from './render/budget.js';
import { Camera, liftView } from './world/camera.js';
import { Ambience, lightsOf } from './world/ambience-fx.js';
import { Dust } from './world/dust.js';
import { Fires } from './world/fire.js';
import { Fireflies } from './world/fireflies.js';
import { Fog } from './world/fog.js';
import { NightLight } from './world/night-light.js';
import { shaftTier } from './world/moon-shafts.js';
import { SpellFogStirs } from './world/fog-spells.js';
import { MAX_WALKERS } from './world/fog-wake.js';
import { Footprints } from './world/footprints.js';
import { Mushrooms } from './world/mushrooms.js';
import { drawGround, raisedRows } from './world/ground.js';
import { Grass } from './world/grass.js';
import { Harvesting } from './world/harvesting.js';
import { Mining, toolOf } from './world/mining.js';
import { drawItem, drawResource } from './world/item-draw.js';
import { layLoot, logsOf, LootCredit, rollLoot, rollPay } from './world/loot.js';
import { mulberry32 } from './core/rng.js';
import { drawLeaves, MAX_LEAF_DRIFT } from './world/leaves.js';
import { Projectiles } from './world/projectiles.js';
import { drawProp, propDepthSlices, propInView } from './world/props.js';
import { bakeFine, fineBakesPending, fineOf, startFineWorkers } from './world/fine-bakes.js';
import { reflector } from './world/reflection.js';
import { drawSkyReflection } from './world/sky.js';
import { Splashes } from './world/splashes.js';
import { Debris } from './world/debris.js';
import { Torches } from './world/torch.js';
import { MAX_TREE_HALF_WIDTH, MAX_TREE_HEIGHT } from './world/trees.js';
import { WeatherEffects } from './world/weather.js';
import { ASPECT, CHUNK_SIZE, GRASS, WATER, World } from './world/world.js';
import { guardLobbyConnect, lobbyWorldUrl, needsWorldReload, PENDING_LOBBY, resumePendingLobby, sparseWorldUrl, woodlandOptions } from './world/woodland.js';

const FONT = '"Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace';
const params = new URLSearchParams(location.search);
const ruinPreview = params.get('scene') === 'ruins';
// Cell height in CSS px; width follows from ASPECT so the world keeps its shape.
// Zooming sets a target and the cell size glides toward it every frame.
let cellH = ruinPreview ? 6 : 8;
let zoomTarget = cellH;
// The furthest zoom: below this cell height (CSS px) grass blades, swaying
// trees and reflections would be too small to draw, so the view stops here.
const MIN_CELL = 4.5;
// Views with more cells than this generate missing chunks over several
// frames rather than all at once.
const WIDE_VIEW = 150_000;
const MAX_CELL = 24;

const canvas = document.getElementById('screen');
const status = document.getElementById('status');
let renderer;
try {
  renderer = new AsciiRenderer(canvas, buildAtlas(FONT));
} catch (error) {
  status.textContent = 'ASCII Realm needs WebGL2. Please open it in a browser with hardware acceleration enabled.';
  status.hidden = false;
  throw error;
}
// Touch screens, phones and tablets alike, show the on-screen controls.
const coarse = matchMedia('(pointer: coarse)');
// A performance flag for the render budget, deliberately broader than the
// phone layout check below.
const mobile = coarse.matches || Math.min(innerWidth, innerHeight) <= 600;
// Phones get the stripped-down layout (style.css) and no scenery builder.
const device = watchPhone(window, (phone) => onPhoneChange(phone));
// Phones lay out for portrait or landscape (style.css follows the same
// query), each with its own default zoom and camera framing.
const layout = watchLayout(window, (next, previous) => onOrientation(next, previous));
// The default zoom for this phone screen, in either orientation.
const phoneDefault = orientation => phoneDefaultCell(orientation, innerWidth, innerHeight, window.devicePixelRatio);
if (device.phone && !ruinPreview) cellH = zoomTarget = phoneDefault(layout.orientation);
const quality = new FrameQuality();
// Phones hold an even frame rate, and draw fewer cells as a last resort.
const pacer = new FramePacer({ enabled: () => device.phone });
const clock = new FrameClock();
// The page never zooms; a pinch only zooms the scene.
blockPageGestures(document);

const baseChunks = mobile ? 64 : 128;

function resize() {
  const { dpr, cell } = renderSize(window.innerWidth, window.innerHeight,
    window.devicePixelRatio, cellH, mobile, quality.scale, device.phone ? pacer.cellCeiling : undefined);
  renderer.resize(window.innerWidth, window.innerHeight, dpr, cell * ASPECT, cell);
  fitChunks?.();
}
// Set once the world exists: sizes its chunk cache to the view.
let fitChunks = null;
// A phone's screen also changes size without turning, as its browser bars
// slide away: the default follows it so the view stays in the cell budget,
// unless the player has pinched a zoom of their own in this orientation.
function onWindowResize() {
  if (creator.isOpen) creator.refit();
  else if (device.phone && !ruinPreview && !pinched) cellH = zoomTarget = phoneDefault(layout.orientation);
  resize();
}
window.addEventListener('resize', onWindowResize);
resize();

// Zoom is multiplicative so each notch feels the same at any scale.
function zoomBy(factor) {
  // Start from the displayed scale when a very large screen has enlarged
  // the cells; otherwise several taps would be swallowed below that floor.
  const displayed = renderer.cellH / renderer.dpr;
  if (displayed > cellH + 0.001) {
    cellH = displayed;
    zoomTarget = Math.max(zoomTarget, displayed);
  }
  zoomTarget = Math.max(MIN_CELL, Math.min(MAX_CELL, zoomTarget * factor));
}
const touch = installTouchControls(zoomBy, { isPhone: () => device.phone });
// A pinched zoom is remembered per orientation until the page is reloaded.
const zoomSlots = new ZoomSlots({ portrait: null, landscape: null });
let pinched = false;
installPinchZoom(canvas, (factor) => {
  pinched = true;
  zoomBy(factor);
});

function updateZoom(dt) {
  if (cellH === zoomTarget) return;
  const k = 1 - Math.exp(-14 * dt);
  cellH *= (zoomTarget / cellH) ** k;
  if (Math.abs(cellH - zoomTarget) < 0.005) cellH = zoomTarget;
  resize();
}

// Mouse wheel or +/- to zoom in and out. Trackpads send many tiny deltas and
// mice a few large ones, so scale by the distance scrolled.
window.addEventListener('wheel', (e) => {
  if (e.target !== canvas) return;
  e.preventDefault();
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  zoomBy(Math.exp(-Math.max(-200, Math.min(200, px)) * 0.0012));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (isControlTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '+' || e.key === '=') zoomBy(1.15);
  if (e.key === '-' || e.key === '_') zoomBy(1 / 1.15);
});

const requestedSeed = Number(params.get('seed'));
const seed = Number.isSafeInteger(requestedSeed) && requestedSeed !== 0 ? requestedSeed : 1;
// ?woodland=dense grows groves and ?flora=1 or 0 picks the wild flowers. Dense
// woods are this page's own: a page starting in or on its way to a lobby
// plays the sparse world the lobby shares.
const session = (() => { try { return sessionStorage; } catch { return null; } })();
const sessionHas = (key) => { try { return session.getItem(key) !== null; } catch { return false; } };
const inLobby = params.has('room') || sessionHas('ascii-realm-rejoin') || sessionHas(PENDING_LOBBY);
// ?scene=hill raises a ridge and a knoll round spawn (see docs/terrain.md);
// only this page draws relief, so a lobby plays on flat land.
const hillScene = params.get('scene') === 'hill' && !inLobby;
const world = new World(seed, { ...woodlandOptions(params, { inLobby }), season: params.get('season') ?? undefined,
  maxChunks: baseChunks, meadow: ruinPreview || hillScene, spawnRuins: !ruinPreview && !hillScene,
  ...(hillScene ? { relief: 'hill', rivers: false } : {}) });
// Keep every chunk a zoomed-out view touches, including the tallest trees
// above and below it, or chunks would be rebuilt every frame.
fitChunks = () => {
  const across = Math.ceil(renderer.cols / CHUNK_SIZE) + 3;
  const down = Math.ceil((renderer.rows + 2 * MAX_TREE_HEIGHT) / CHUNK_SIZE) + 3;
  world.maxChunks = Math.max(baseChunks, Math.ceil(across * down * 1.5));
  world.trim();
};
fitChunks();
const { spawn } = world;
const player = new Player(spawn.x, spawn.y);
// The outlaw sets out with the sword at the hip and a stone pickaxe for ore
// veins (and the torch, which is not an item). Only ore can be gathered.
const inventory = new Inventory({ starter: false });
inventory.add('shortSword');
inventory.equip(0);
inventory.assignHotbar(0, 'shortSword');
inventory.add('stonePickaxe');
inventory.assignHotbar(1, 'stonePickaxe');
// Until instruments can be crafted, ?instruments puts one of each in the bag.
if (params.has('instruments')) for (const id of INSTRUMENT_IDS) inventory.add(id);
inventory.events.length = 0;
// The pouch: money carried, in cents, kept on this device between visits.
let walletStorage = null;
try { walletStorage = localStorage; } catch {}
const wallet = new Wallet({ storage: walletStorage });
// The player's characters, kept on this device. The active one is played:
// its name and skin. Without one the outlaw is Kael in today's outfit.
const characters = new Roster({ storage: walletStorage, bypassCooldown: params.has('debug'), events: window,
  onChange: () => applyCharacter() });
player.skin = cleanSkin(characters.active?.skin);
// ?name=... shows another valid name for this visit, for testing; the
// roster keeps the character's own.
const nameOverride = params.has('name') && !nameError(params.get('name')) ? normalName(params.get('name')) : null;
const shownName = () => nameOverride ?? characters.active?.sheet.name ?? 'Kael';
let name = shownName();
// Shows the active character everywhere, after it changes here or in another
// tab. The creator's preview keeps its own skin while it is open.
function applyCharacter() {
  name = shownName();
  hud.setName(name);
  inventoryScreen.setName(name);
  if (!creator.isOpen) player.skin = cleanSkin(characters.active?.skin);
  characterPages.render();
  renderLobby?.(multiplayer);
}
// Plants in the world: they burn and the sword cuts them, but drop nothing.
// Harvestable tufts and berry bushes stay disabled.
const harvesting = new Harvesting(world, null, { wild: false });
const mushrooms = new Mushrooms(world);
player.equipment = inventory.equipment;
const camera = new Camera(spawn.x, spawn.y - 11);
// While the creator is open the camera zooms in and frames the outlaw in
// the free part of the screen; the zoom and framing glide there and back,
// or snap with reduced motion. Closing restores the zoom from before. The
// creator's turn buttons and drag turn the outlaw towards `turnGoal`.
let framing = null;
let heldZoom = null;
let turnGoal = 0;
function frameCreator(next) {
  if (!framing) {
    if (pinched) zoomSlots.set(layout.orientation, zoomTarget);
    heldZoom = zoomTarget;
    // A three-quarter view of the figure.
    player.heading = turnGoal = 0.3;
  }
  framing = next;
  zoomTarget = next.cell;
  if (reducedMotion) snapFraming();
}
function unframe() {
  framing = null;
  player.heading = Math.atan2(Math.sin(player.heading), Math.cos(player.heading));
  if (device.phone && !ruinPreview) {
    const slot = zoomSlots.get(layout.orientation);
    pinched = slot !== null;
    zoomTarget = slot ?? phoneDefault(layout.orientation);
  } else zoomTarget = heldZoom;
  if (reducedMotion) snapFraming();
}
function framingGoal() {
  return framing ?? { bias: device.phone ? FRAME_BIAS[layout.orientation] : 0, biasX: 0 };
}
function glideFraming(dt) {
  const goal = framingGoal();
  const k = 1 - Math.exp(-14 * dt);
  for (const key of ['bias', 'biasX']) {
    camera[key] += (goal[key] - camera[key]) * k;
    if (Math.abs(goal[key] - camera[key]) < 1e-4) camera[key] = goal[key];
  }
  if (framing) player.heading += (turnGoal - player.heading) * k;
}
function snapFraming() {
  applyFraming();
  cellH = zoomTarget;
  resize();
}

// Portrait phones show more of the world ahead; everything else is centred.
function applyFraming() {
  Object.assign(camera, framingGoal());
}
applyFraming();
// A turned phone keeps the pinched zoom it left and returns to the one it
// had, and snaps to it at once, as the controls re-lay out in CSS.
function onOrientation(next, previous) {
  if (!device.phone) return;
  // The creator frames the outlaw for the new layout instead.
  if (creator.isOpen) creator.refit();
  else {
    if (pinched) zoomSlots.set(previous, zoomTarget);
    if (!ruinPreview) {
      const slot = zoomSlots.get(next);
      pinched = slot !== null;
      cellH = zoomTarget = slot ?? phoneDefault(next);
    }
  }
  applyFraming();
  resize();
}
const fireflies = new Fireflies();
const ambience = new Ambience();
const dust = new Dust();
const footprints = new Footprints();
const grass = new Grass();
const splashes = new Splashes();
// Driftwood and flotsam on the rivers: local and never saved.
const debris = new Debris({ season: world.season, world });
const fires = new Fires({ resourcesIn: (...bounds) => harvesting.resourcesIn(...bounds) });
const torches = new Torches();
const weather = new WeatherEffects({ onImpact: (world, bolt) => fires.ignite(world, bolt.x, bolt.y, { source: 'lightning' }) });
const sound = new GameAudio(world);
// This URL defines a misty meadow preview without saving over weather preferences.
if (ruinPreview) {
  sound.weather.preset = 'fog';
  sound.weather.intensity = 0.6;
}
sound.weather.onLightning = event => {
  const bolt = weather.strike(world, camera.view(renderer), event);
  if (bolt) hearWild({ type: 'lightning', x: bolt.x, y: bolt.y, strength: bolt.strength });
  return bolt;
};
let summonLightning = false;
const lightningButton = document.getElementById('lightning-test');
const requestLightning = () => { summonLightning = true; };
lightningButton.addEventListener('click', requestLightning);
sound.music.update({ night: 1 });
const unbindAudio = bindAudioControls(sound.engine, sound.music, sound.weather, () => sound.pause());
sound.engine.setListener(camera.x, camera.y);
window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    sound.pause();
    void sound.engine.suspend();
  } else {
    unbindAudio();
    lightningButton.removeEventListener('click', requestLightning);
    void sound.dispose();
  }
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted && sound.engine.context && !gate.waiting) void sound.engine.unlock();
});

// With ?debug in the URL the game state is reachable from the console, and
// setting `freeze` stops the wanderer updating so a pose can be inspected.
const fog = new Fog();
const fogSpells = new SpellFogStirs();
const nightLight = new NightLight();
const debug = { player, camera, world, grass, splashes, debris, weather, fog, nightLight, fires, torches, renderer, quality, inventory,
  ambience, fireflies, dust, footprints,
  harvesting, mushrooms, touch,
  layout: { zoomSlots, phoneDefaultCell, get orientation() { return layout.orientation; }, get bias() { return camera.bias; } },
  audio: sound.engine, sound, get time() { return time; }, freeze: false, metrics: { frames: 0, workMs: 0, bubblesMs: 0, intervalMs: 0, rate: 60, nightMs: 0, shaftMs: 0 },
  // ?pintime=<seconds> freezes the world and holds the render clock there.
  pinTime: params.has('debug') && params.has('pintime') ? Number(params.get('pintime')) || 0 : null };
debug.freeze = debug.pinTime !== null;
if (params.has('debug')) window.game = debug;

const fireStatus = document.getElementById('fire-status');

// The reduced-motion setting is kept from its change events: reading the
// query on every frame costs a style check.
const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', (event) => { reducedMotion = event.matches; });

// The character creator, built before the phone menu and the inventory so
// its key listener runs first: a key listener added before this one would
// get keys the creator owns. A first visit opens it (?creator always, never
// with ?nocreator or ?nogate), and ?debug&creator=<page> opens that page on
// a sample character.
const creator = new CharacterCreator({ root: document.getElementById('creator-root'),
  outside: ['hud-root', 'touch-controls', 'panel-dock', 'phone-menu', 'chat', 'chat-open', 'inventory-root', 'screen']
    .map((id) => document.getElementById(id)),
  cells: [MIN_CELL, MAX_CELL],
  onPreview: (skin) => { player.skin = skin; },
  onFrame: frameCreator,
  onTurn: (by) => {
    turnGoal += by;
    if (reducedMotion) player.heading = turnGoal;
  },
  // Create is the player's tap to play. Edit, and a new character
  // cancelled, go back to the page they came from.
  onClose: (character, mode) => {
    applyCharacter();
    unframe();
    blockGameplay();
    // A lobby on another world reloads the page, which would lose a new
    // character this visit couldn't save, so its waiting join is dropped.
    // A kept join goes in under the name now played, not the one it was
    // asked with (an invite asks before the first character exists).
    const unsaved = character && characters.saveError;
    if (deferredJoin && !unsaved) connectLobby({ ...deferredJoin, name });
    if (mode === 'edit' || mode === 'new' && !character) {
      inventoryScreen.setOpen(true, mode === 'edit' ? 'character' : 'characters');
      (mode === 'edit' ? characterPages.edit : characterPages.create)?.focus();
      if (character) hud.notify(lobbyNote('Changes saved.'));
    } else if (character) {
      startPlay();
      if (mode === 'new') hud.notify(lobbyNote(`Now playing as ${name}.`));
    } else if (gated()) gate.show('start');
    if (unsaved) hud.notify(unsaved);
    if (deferredJoin && unsaved) hud.notify('The lobby wasn\'t joined: it could reload the page and lose this character.');
    deferredJoin = null;
    if (!inventoryScreen.isOpen) canvas.focus({ preventScroll: true });
  } });
debug.creator = creator;
if (wantsCreator(params, characters)) {
  const start = params.has('debug') && params.get('creator');
  creator.open({ roster: characters, start: start || 'welcome', draft: start ? sampleDraft(characters, Date.now()) : null });
}
// Nothing may hurt the player while the creator is open: every blow, spell
// and burn lands through takeDamage, and a friend's spell aimed at the
// player, which can also set health or shove, is dropped.
const playerShielded = () => creator.isOpen;
const takeDamage = player.takeDamage.bind(player);
player.takeDamage = (amount, attacker) => playerShielded() ? 0 : takeDamage(amount, attacker);

// On phones the corner menu opens the panel dock as a full-screen sheet.
// It is built before the inventory so its keys are handled first.
const phoneMenu = new PhoneMenu({
  button: document.getElementById('phone-menu'),
  dock: document.getElementById('panel-dock'),
  closeButton: document.getElementById('phone-menu-close'),
  inventoryButton: document.getElementById('phone-menu-inventory'),
  outside: ['touch-controls', 'hud-root', 'screen', 'chat', 'chat-open'].map((id) => document.getElementById(id)),
  canvas,
  phone: device,
  onToggle: (open) => {
    if (open) chat.close();
    blockGameplay();
    cancelActions();
  },
  onInventory: () => inventoryScreen.setOpen(true),
});
debug.phoneMenu = phoneMenu;
debug.device = device;

// Phones start, and come back from being hidden, behind a "Tap to play"
// card with the whole world paused. The tap unlocks sound, goes full screen
// where the browser can and keeps the screen awake. ?nogate skips the card
// for tools and benchmarks.
const wakeLock = new WakeLock({ nav: navigator, doc: document });
const gate = new PlayGate({ button: document.getElementById('play-gate'), doc: document,
  onShow: () => {
    void sound.engine.suspend();
    chat.close({ keepDraft: true });
    updateWakeLock();
  },
  onStart: startPlay });
// Inside the tap on the card or on Create: the browser allows sound and full
// screen only here.
function startPlay() {
  void sound.engine.unlock();
  if (device.phone && !isStandalone(window)) void enterFullscreen(document, document.documentElement);
  clock.reset();
  cancelActions();
  updateWakeLock();
  canvas.focus({ preventScroll: true });
}
// Tools and benchmarks (?nogate) never see the card.
const gated = () => device.phone && !params.has('nogate');
function updateWakeLock() {
  wakeLock.want(device.phone && !gate.waiting && !debug.freeze && !builder.enabled);
}
// The menu's Full screen row, where the browser has the Fullscreen API and
// the game is not already running full screen from the home screen.
const fullscreenRow = document.getElementById('phone-menu-fullscreen');
function updateFullscreenRow() {
  const api = fullscreenApi(document);
  fullscreenRow.hidden = !api || isStandalone(window);
  fullscreenRow.textContent = api?.active ? 'Leave full screen' : 'Full screen';
}
fullscreenRow.addEventListener('click', () => { void toggleFullscreen(document); });
for (const type of ['fullscreenchange', 'webkitfullscreenchange']) document.addEventListener(type, updateFullscreenRow);
updateFullscreenRow();
debug.native = { gate, wakeLock, pacer, get clock() { return clock; }, get fullscreen() { return fullscreenApi(document)?.active ?? false; } };

// The status frames, quick slots and the inventory screen.
const hud = new Hud({
  player, inventory, name, wallet,
  // The page's own top-corner panels, which a note glyph keeps clear of.
  covers: [document.getElementById('panel-dock'), document.getElementById('phone-menu'), document.getElementById('zoom-controls')],
  // With an instrument in the off hand, clicking a note slot plays it
  // (Shift-click the second layer) and never equips the slot's gear.
  onSelect: (index, event) => {
    if (index < 8 && heldInstrument()) {
      if (canPlay()) playSlot(index + 1, Boolean(event?.shiftKey));
    } else selectHotbar(index);
    canvas.focus({ preventScroll: true });
  },
  onInventory: () => inventoryScreen.toggle(),
});
// A rename or switch reaches a lobby on the next join.
const lobbyNote = (text) => multiplayer.room ? `${text} Others see the new name when you next join.` : text;
// Edit, Create character and Play as wait until the player has not been
// hurt for this many seconds of play, so the menu can't pause a fight. The
// refusal stays on the page and nothing else happens.
const HURT_LOCK_S = 10;
function hurtLock() {
  const left = HURT_LOCK_S - (time - lastHurt);
  return left > 0 ? { ok: false, reason: `You were hurt recently. Try again in ${Math.ceil(left)} s.` } : { ok: true };
}
// Opens the creator from the inventory, which closing unblocks play.
function openCreator(options) {
  const lock = hurtLock();
  if (!lock.ok) return lock;
  inventoryScreen.setOpen(false);
  creator.open({ roster: characters, ...options });
  blockGameplay();
  return lock;
}
// The character menu's pages, tabs in the inventory. Switching applies the
// new name and skin on the next frame, with no reload.
const characterPages = new CharacterPages({ doc: document, roster: characters, name: () => name,
  inLobby: () => !!multiplayer.room, equipment: () => inventory.equipment,
  onEdit: () => openCreator({ start: 'summary', edit: characters.active }),
  onCreate: () => openCreator({ start: 'creation', mode: 'new' }),
  onPlay: (id) => {
    const lock = hurtLock();
    if (!lock.ok) return lock;
    const result = characters.switchTo(id);
    if (result.ok) {
      applyCharacter();
      hud.notify(lobbyNote(`Now playing as ${name}.`));
    }
    return result;
  } });
debug.characterPages = characterPages;
const inventoryScreen = new InventoryScreen({
  inventory, player, name,
  pages: [{ id: 'character', label: 'Character', node: characterPages.sheet, onShow: () => characterPages.render() },
    { id: 'characters', label: 'Characters', node: characterPages.list, onShow: () => characterPages.render() }],
  onToggle: (open) => {
    if (open) chat.close();
    blockGameplay();
    cancelActions();
    if (!open) canvas.focus({ preventScroll: true });
  },
  onNotify: (message, kind = 'info') => hud.notify(message, kind),
  phone: () => device.phone,
});
// Play stops while any of these is open, and resumes only once all are shut.
function blockGameplay() {
  setGameplayBlocked(creator.isOpen || phoneMenu.open || inventoryScreen.isOpen || chat.isOpen);
}
debug.hud = hud;
debug.wallet = wallet;
debug.characters = characters;
// Dresses the outlaw in a preset (by id) or any skin, cleaned, for screenshot
// tools. Nothing is saved.
debug.setSkin = (skin) => (player.skin = typeof skin === 'string' ? presetSkin(skin) : cleanSkin(skin));
debug.skins = { PRESETS, PALETTES };
debug.inventoryScreen = inventoryScreen;

// Friends in a lobby share the world's seed and see one another walk about.
// Joining a lobby on another seed reloads the page into that world. Lobbies
// share neither dense woods nor the hill scene's raised ground.
const reloadsForLobby = world.woodland === 'dense' || hillScene;
const remotePlayers = new RemotePlayers();
const multiplayer = new MultiplayerClient({
  getState: () => playerState(player),
  onJoin: (lobby) => {
    if (needsWorldReload(lobby, seed, world.woodland) || reloadsForLobby) {
      const url = lobbyWorldUrl(location.href, lobby, multiplayer.options?.server);
      try { sessionStorage.setItem('ascii-realm-rejoin', lobby.code); } catch {}
      // A dense or hill page reloads before it connects (below), so it never gets
      // here; if it ever does, it keeps its seat in the lobby while it
      // reloads into the sparse world, rather than leaving it.
      if (reloadsForLobby) multiplayer.suspend();
      else multiplayer.leave(false);
      location.replace(url);
      return;
    }
    // Meet friends where they are, unless this is the lobby's first player.
    if (lobby.self && multiplayer.players.some((member) => member.id !== lobby.id)) {
      player.x = lobby.self.x;
      player.y = lobby.self.y;
      camera.x = player.x;
      camera.y = player.y - 11;
    }
  },
  onSnapshot: (members, selfId) => remotePlayers.sync(members, selfId),
});
debug.multiplayer = multiplayer;
debug.remotePlayers = remotePlayers;
// Creating or joining a lobby from dense woods or the hill scene reloads into
// the sparse world first, and the request is made there, so no lobby ever
// holds a dense or raised page. Where the browser won't keep the request
// across the reload, the page stays and says what to do instead.
const lobbyBlocked = `Leave ${hillScene ? 'the hill scene' : 'the dense woods'} first: lobbies play in the plain world, and this browser won't let the page carry your request there.`;
guardLobbyConnect(multiplayer, { dense: reloadsForLobby, storage: session,
  reload: (request) => location.replace(sparseWorldUrl(location.href, request)),
  blocked: () => { multiplayer.setStatus('error', lobbyBlocked); hud.notify(lobbyBlocked, 'info'); } });
// While the creator is open the lobby waits; the last join asked for is made
// once it closes. A dense page's reload waits too, and so does a request
// resumed after one.
let deferredJoin = null;
const connectLobby = multiplayer.connect.bind(multiplayer);
multiplayer.connect = (options) => { if (creator.isOpen) deferredJoin = options; else connectLobby(options); };
const renderLobby = bindMultiplayerControls(multiplayer, {
  name: () => name, seed: () => seed,
  onDone: () => canvas.focus({ preventScroll: true }),
});
resumePendingLobby(multiplayer, session);
// Your name colour: what you chose (null for Auto), and how the lobby shows
// you. Your own nameplate shows it solo too.
let chosenTint = null;
const selfMember = () => multiplayer.room ? multiplayer.players.find((member) => member.id === multiplayer.id) : null;
const tintPicker = bindTintPicker(multiplayer, { doc: document, params: new URLSearchParams(location.search),
  getName: () => { const self = selfMember(); return self ? displayName(self) : name; },
  autoColour: () => { const self = selfMember(); return self ? autoColour(self.color) : SOLO_COLOR; },
  onTint: (tint) => { chosenTint = tint; } });
debug.tint = tintPicker;
// Lobby chat. It opens only in a lobby, with nothing else in the way, and
// Escape closes a panel opened over it before the chat. The builder and the
// rune wheel are declared further down and are read only once a key or tap
// arrives.
const panelOpen = () => creator.isOpen || builder.enabled || inventoryScreen.isOpen || phoneMenu.open || !!spellControls.menu?.isOpen;
const chat = new ChatUi({ doc: document, win: window, phone: device, client: multiplayer, scene: canvas,
  isControlTarget,
  mayOpen: () => !!multiplayer.room && !gate.waiting && !panelOpen() && !isGameplayBlocked(),
  isCovered: panelOpen,
  onToggle: (open) => {
    blockGameplay();
    cancelActions();
    if (!open) canvas.focus({ preventScroll: true });
  },
  colorOf: memberColour });
debug.chat = chat;
// What players say floats over their heads, above the scene and below the HUD.
const bubbles = new SpeechBubbles({ doc: document, root: document.getElementById('bubble-root'),
  reducedMotion: () => reducedMotion });
debug.bubbles = bubbles;
// Every player's name over their head, below the bubbles.
const nameplates = new Nameplates({ doc: document, root: document.getElementById('nameplate-root') });
debug.nameplates = nameplates;
multiplayer.onChat = (message) => {
  chat.receive(message, multiplayer.players);
  bubbles.receive(message, multiplayer.id);
};
multiplayer.onChatNotice = (notice) => chat.notice(notice);
multiplayer.onRoster = (change) => {
  chat.roster(change);
  bubbles.roster(change);
};
multiplayer.onChange = (client) => {
  renderLobby?.(client);
  tintPicker.render();
  chat.setAvailable(!!client.room);
};
window.addEventListener('pagehide', () => multiplayer.leave(false));
window.addEventListener('pageshow', (event) => { if (event.persisted) multiplayer.leave(); });
// Arrows, spears and javelins in flight or lying where they landed.
const projectiles = new Projectiles();
debug.projectiles = projectiles;
// How many arrows are left, or of the weapon being thrown.
const ammoNote = document.createElement('div');
hud.attachNote(ammoNote);
const weaponKeyOf = (stack) => stack ? `${stack.id}:${stack.material ?? ''}` : '';
let lastWeapon = weaponKeyOf(inventory.equipment.mainHand);
// The pointer over the scene and the last frame drawn, for aiming.
let pointer = null;
let lastFrame = null;
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch') pointer = { x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointerleave', () => { pointer = null; });

const carriedCount = (id) => inventory.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0)
  + (inventory.equipment.mainHand?.id === id ? 1 : 0);

// How many rows the ground under the player is raised.
const playerLift = () => world.relief ? world.liftAt(player.x, player.y) : 0;
// The ground cell under the cursor, or null when it is off the scene. On
// raised ground it is read on the player's own height.
function cursorCell() {
  const cell = pointer && lastFrame ? screenToWorld(pointer, lastFrame, canvas.getBoundingClientRect()) : null;
  if (cell && world.relief) cell.y += playerLift();
  return cell;
}

// The way the cursor points from the player, or null without one. Close
// swings are aimed from the hips on screen rather than the feet, so a click
// beside the body cuts that way rather than off up the screen.
function cursorHeading(fromHips = false) {
  const cursor = cursorCell();
  if (!cursor) return null;
  const mx = (cursor.x - player.x) * ASPECT / SCALE;
  const mz = (cursor.y - player.y + (fromHips ? 0.9 * SCALE : 0)) / (SCALE * TILT);
  return Math.hypot(mx, mz) > 0.05 ? Math.atan2(mx, mz) : null;
}

// Where a shot or throw would land: the foe touch aim assist picked, the
// cursor, or a point straight ahead within the weapon's range when aiming
// from the keyboard.
function aimPoint(weapon, draw, foe = null) {
  const range = (weapon.projectileRange ?? 8) * (0.4 + 0.6 * draw);
  const cursor = foe ?? cursorCell();
  let mx = cursor ? (cursor.x - player.x) * ASPECT / SCALE : Math.sin(player.heading) * range;
  let mz = cursor ? (cursor.y - player.y) / (SCALE * TILT) : Math.cos(player.heading) * range;
  const distance = Math.hypot(mx, mz);
  if (distance > range) {
    mx *= range / distance;
    mz *= range / distance;
  }
  return { x: player.x + mx * SCALE / ASPECT, y: player.y + mz * SCALE * TILT };
}

// Lets fly an arrow, or throws the spear or javelin in hand.
function fireRanged(release, weapon, foe = null) {
  const kind = isBow(weapon) ? 'arrow' : weapon.type;
  const arrows = inventory.slots.findIndex((stack) => stack?.id === 'arrow');
  if (kind === 'arrow' && arrows < 0) {
    hud.notify('Out of arrows.', 'info');
    return;
  }
  const shot = projectiles.launch({
    x: player.x, y: player.y, h: SCALE * 1.1, aimTarget: aimPoint(weapon, release.draw, foe),
    projectile: { kind }, weapon: weapon.id, material: weapon.material,
    strength: release.draw, damage: weapon.damage,
  });
  if (!shot) return;
  if (kind === 'arrow') inventory.remove(arrows, 1);
  else {
    // The thrown weapon leaves the hand; another of the same is taken up.
    const thrown = inventory.equipment.mainHand;
    inventory.equipment.mainHand = null;
    const next = inventory.slots.findIndex((stack) => stack?.id === thrown.id);
    if (next >= 0) inventory.equip(next);
  }
  sound.play({ type: 'swing', move: 'thrust', speed: 1.2, x: player.x, y: player.y });
}

// Choosing a quick slot that holds gear puts it on.
function selectHotbar(index) {
  if (!inventory.selectHotbar(index)) return;
  const selected = inventory.getHotbar();
  if (selected?.item.equipmentSlot && selected.source === 'inventory') {
    if (inventory.equip(selected.index)) hud.notify(`Equipped ${selected.item.name}`, 'equipment');
    else hud.notify('Make room in your bag to equip this item.', 'info');
  }
}

function useHotbar() {
  const selected = inventory.getHotbar();
  if (!selected) return;
  if (selected.item.use) {
    if (inventory.useSelected(player.vitals)) hud.notify(`Used ${selected.item.name}`, 'use');
    else hud.notify('That item is not needed yet.', 'info');
  } else if (selected.item.equipmentSlot) {
    selectHotbar(inventory.selectedHotbar);
  }
}
const fireMessages = {
  lit: 'Campfire lit. Press C nearby to put it out.',
  out: 'Fire extinguished.',
  water: 'Find dry ground to build a campfire.',
  air: 'Land before building a campfire.',
  blocked: 'Find an open patch of dry ground.',
  limit: 'Put out a fire before building another.',
};
const torchMessages = {
  drawn: 'Fire torch drawn. G to throw it, T to stow it.',
  stowed: 'Torch stowed. Press T to draw a lit torch.',
  thrown: 'Torch thrown. Press T to draw another.',
  empty: 'Press T to draw a torch before throwing.',
  busy: 'Wait for a thrown torch to land.',
  lit: 'The torch started a fire. Press C nearby to put it out.',
  fed: 'The torch landed in a fire that was already burning.',
  water: 'The water put out the torch.',
  blocked: 'The torch went out. Find open ground or put out a fire with C.',
  hands: 'Both hands are on your weapon. Unequip it to carry a torch.',
};
let fireNoticeUntil = 0;

function fireNotice(message) {
  fireStatus.textContent = message;
  fireStatus.classList.add('visible');
  fireNoticeUntil = time + 3;
}

// A click on the scene swings the sword towards the cursor.
// Holding it down charges a spin. A right click casts the chosen spell
// at the cursor.
let clicked = false;
let mouseHeld = false;
let rightClicked = false;
// Who started drawing the bow or spear: the release comes on the frame the
// finger lifts, when STRIKE no longer reads as held.
let rangedSource = null;
// Losing control of the scene cancels a charge; it is not a weapon release.
function cancelActions() {
  clearInput();
  clicked = false;
  rightClicked = false;
  mouseHeld = false;
  player.ranged.reset();
  rangedSource = null;
  player.aimTarget = null;
  player.combat.charge = 0;
  player.combat.queued = null;
}
// Touches use the on-screen buttons instead.
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' || builder.enabled || isGameplayBlocked()) return;
  if (e.pointerType === 'mouse' || e.pointerType === 'pen') pointer = { x: e.clientX, y: e.clientY };
  if (e.button === 2) rightClicked = true;
  if (e.button !== 0) return;
  clicked = true;
  mouseHeld = true;
});
canvas.addEventListener('contextmenu', (e) => {
  if (!builder.enabled) e.preventDefault();
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 0) mouseHeld = false;
  wakeLock.gesture();
});
window.addEventListener('blur', cancelActions);
window.addEventListener('pointercancel', cancelActions);
window.addEventListener('focusin', (event) => {
  if (isControlTarget(event.target)) cancelActions();
});

let hitStop = 0;

const builder = new SceneryBuilder({ world, player, camera, renderer,
  allowed: () => !device.phone,
  onModeChange: () => {
    cancelActions();
    updateWakeLock();
    hitStop = 0;
    player.vx = 0;
    player.vz = 0;
    player.surge = 0;
    player.skid = 0;
    player.wasMoving = false;
  },
  onReset: () => {
    dust.list.length = 0;
    footprints.list.length = 0;
    fireflies.list.length = 0;
  },
});
debug.builder = builder;
if (params.has('builder') && !device.phone) builder.setEnabled(true);

const SCENE_LABEL = canvas.getAttribute('aria-label');
// A device can become a phone or stop being one while playing, for example
// when a mouse is plugged in; the layout follows in CSS at once. The zoom
// and framing follow only on a real change, never at start-up, which has
// already chosen them.
let lastPhone;
function onPhoneChange(phone) {
  if (phone && builder.enabled) {
    builder.forceExit();
    builder.panel.open = false;
  }
  if (!phone && phoneMenu.open) phoneMenu.setOpen(false);
  chat.close({ keepDraft: true });
  // Off a phone the pacing's 30 and smaller cell ceiling no longer apply.
  if (!phone) {
    pacer.reset();
    clock.setRate(pacer.rate);
  }
  updateWakeLock();
  canvas.setAttribute('aria-label', phone ? 'Game scene.' : SCENE_LABEL);
  const changed = lastPhone !== undefined && phone !== lastPhone;
  lastPhone = phone;
  if (!changed) return;
  if (creator.isOpen) creator.refit();
  else if (!ruinPreview) {
    pinched = false;
    if (phone) cellH = zoomTarget = phoneDefault(layout.orientation);
    else zoomTarget = 8;
  }
  applyFraming();
  resize();
}
if (creator.isOpen) blockGameplay();
else if (gated()) gate.show('start');
onPhoneChange(device.phone);

// Skeletons rise from the ground around the player, goblins come running,
// now and then a troll lumbers in and an elf takes aim from afar, all to
// hunt them down. ?skeletons=N, ?goblins=N, ?trolls=N and ?elves=N set how
// many of each may be about at once; 0 leaves the world free of them.
const countOf = (name, fallback) => {
  // The hill scene is left quiet unless asked: its wildlife is not raised yet.
  const n = Number(params.get(name) ?? (hillScene ? 0 : fallback));
  return Number.isFinite(n) ? Math.max(0, Math.min(8, Math.floor(n))) : fallback;
};
const monsters = new Monsters({ seed,
  counts: { skeleton: countOf('skeletons', 2), goblin: countOf('goblins', 1), troll: countOf('trolls', 1),
    elf: countOf('elves', 1) } });
// Deer herds, rabbits and wolf packs live on the land round the player.
// ?deer=N, ?rabbits=N and ?wolves=N cap how many of each may be about;
// ?animals=0 leaves the land without them.
const animals = new Animals({ seed,
  counts: { deer: countOf('deer', 8), rabbit: countOf('rabbits', 6), wolf: countOf('wolves', 4) },
  enabled: params.get('animals') !== '0' });
debug.animals = animals;
// Flocks of pigeons and schools of fish, ?birds=N and ?fish=N at most of
// each; ?animals=0 leaves them out too.
const birds = new Birds({ seed, cap: countOf('birds', 8), enabled: animals.enabled });
const fishes = new Fishes({ seed, cap: countOf('fish', 8), enabled: animals.enabled });
// Their debug handles place groups on the game's own world.
const onWorld = (manager) => new Proxy(manager, {
  get: (m, key) => (key === 'spawn' ? (options = {}) => m.spawn({ world, ...options }) : Reflect.get(m, key)),
});
debug.birds = onWorld(birds);
debug.fish = onWorld(fishes);
// Saddled horses with a rider sitting them, standing idle: ?horse=N stands
// N of them by the spawn. Their figures are set up only once one exists.
const horses = Horses.fromParams(params, { world, seed, spawn });
debug.horses = onWorld(horses);
let horseFigures = null;
let horseLoad = null;
// Every noise reaches the animals, the birds and the fish alike.
const hearWild = (e) => {
  animals.hear(e);
  birds.hear(e);
  fishes.hear(e);
};
// What hunted animals leave lying, and the collection that picks it up.
const huntDrops = new HuntDrops();
const huntCollection = new Collection(world, inventory, huntDrops.items, null, wallet);
debug.huntDrops = huntDrops;
debug.collection ??= huntCollection;
// Monster loot lies in the same drop store as the hunt's, so one collection
// picks up both; the oldest stacks of either go first when it is full.
const lootCredit = new LootCredit();
const lootRandom = mulberry32((seed * 104729) ^ 0x1007);
// What a slain monster leaves beside its body, rolled once.
const dropLoot = (monster, items = rollLoot(monster.kind.id, lootRandom)) => layLoot(huntDrops, world,
  { x: monster.x, y: monster.y, killer: { x: player.x, y: player.y }, items }, (a, b) => huntCollection.pathClear(a, b));
debug.loot = { credit: lootCredit, roll: (kind) => rollLoot(kind, lootRandom), drop: dropLoot };
// Ore veins break a blow at a time; what they drop lies with the loot.
const mining = new Mining(world, { reachable: (p, block) => harvesting.reachable(p, block), random: lootRandom,
  drop: (items, block) => layLoot(huntDrops, world, { x: block.x, y: block.y, killer: { x: player.x, y: player.y }, items },
    (a, b) => huntCollection.pathClear(a, b)) });
debug.mining = mining;
// Felling a tree now and then turns up a few coins beside the stump.
function payGather(tree) {
  const items = rollPay('tree', logsOf(tree), lootRandom);
  if (items.length) layLoot(huntDrops, world, { x: tree.x, y: tree.y, killer: { x: player.x, y: player.y }, items },
    (a, b) => huntCollection.pathClear(a, b));
}
// Rows a lying stack is drawn ahead of its own, over the grass in front.
const HUNT_DROP_LIFT = 3;
// Rows a bird on the ground is drawn ahead of its own.
const BIRD_LIFT = 3;
// Touch aim assist turns toward monsters and animals alike.
const assistFoes = () => [...monsters.list, ...animals.list];
// The creature the player last landed a blow on, for the HUD's target frame;
// `strikeFoe` is the one the aim assist last turned a cut toward, and
// `spellHits` gathers what the player's runes struck this frame, one batch per
// impact (the hits sharing one spell context), marked in landing order before
// any later blow so the last to land wins.
const target = new TargetTracker();
debug.target = target;
let strikeFoe = null;
const spellHits = [];
const markSpellHits = () => {
  for (const { hits } of spellHits.splice(0)) target.mark(pickStruck(hits, player), time);
};
const markTarget = (hits, preferred = null) => {
  markSpellHits();
  target.mark(pickStruck(hits, player, preferred), time);
};
const targetPresent = (id) => monsters.list.some((e) => targetId(e) === id) || animals.list.some((e) => targetId(e) === id);
// Short vibrations on touch screens when a blow lands and when hurt.
const haptics = createHaptics({ nav: navigator, enabled: () => coarse.matches && !document.hidden });
debug.haptics = haptics;
const spellPeers = new Map();
const syncSpellPeers = () => {
  player.spellId = multiplayer.id ?? 'self';
  for (const member of multiplayer.players) {
    if (member.id === multiplayer.id) continue;
    const peer = spellPeers.get(member.id) ?? { spellPlayer: true, spellId: member.id };
    Object.assign(peer, member.state, { maxHealth: 100 });
    spellPeers.set(member.id, peer);
  }
  for (const id of spellPeers.keys()) if (!multiplayer.players.some(m => m.id === id)) spellPeers.delete(id);
};
const casting = new Spellcasting({ player, world, monsters, peers: () => [...spellPeers.values()],
  notify: message => hud.notify(message), onCast: e => multiplayer.sendCast(e),
  onSound: e => {
    sound.play(e);
    hearWild(e);
  },
  // Rune lightning (e.g. Mitlan's Lightning) answers with the storm's own thunder.
  onLightning: ({ x, y, strength }) => {
    sound.play({ type: 'lightning', x, y, strength });
    hearWild({ type: 'lightning', x, y, strength });
  },
  onDamage: (struck, amount, ctx) => {
    if (struck.takeHit) lootCredit.observe(struck, ctx?.caster === player);
    if (ctx?.caster !== player || struck === player || !(amount > 0)) return;
    haptics.hit();
    if (!struck.kind?.name) return;
    if (spellHits.at(-1)?.ctx === ctx) spellHits.at(-1).hits.push(struck);
    else spellHits.push({ ctx, hits: [struck] });
  } });
debug.casting = casting;
debug.monsters = monsters;

// Who wades into the river debris and shoves it: the player and every
// monster that has climbed out of the ground.
const debrisBodies = () => [player, ...monsters.living.filter(m => m.state !== 'rise')];

hud.attachMana(casting);
document.addEventListener('visibilitychange', () => casting.setPresentationPaused(document.hidden || debug.freeze || builder.enabled));
window.addEventListener('pagehide', () => casting.clearPresentation());
// Holding the middle mouse button, or CAST on touch screens, opens the rune
// wheel; the chosen rune is bound to R, or to the CAST button on touch
// screens. ?spell=ID binds one up front instead of the last one chosen.
const castKey = () => coarse.matches ? 'CAST' : 'R';
const spellControls = new SpellControls(casting, { surface: canvas,
  canOpen: () => !builder.enabled && !debug.freeze && !isGameplayBlocked(),
  onBind: spell => hud.notify(castKey() === 'R' ? `${spell.name} bound to R` : `${spell.name} ready: tap ${castKey()}`, 'spell'),
  onFocus: () => canvas.focus({ preventScroll: true }), restore: !params.has('spell'), castKey,
  isPhone: () => device.phone });
debug.spellControls = spellControls;

// An instrument in the off hand plays on keys 1-8, Shift+1-8 for its second
// layer, and on clicks on its note slots. Phones keep their quick slots and
// play nothing until they get an on-screen keyboard.
const musicNotes = new MusicNotes();
debug.musicNotes = musicNotes;
function heldInstrument() {
  const id = inventory.equipment.offHand?.id;
  return !device.phone && secondLayer(id) ? id : null;
}
// Typing in a field, as in the chat, keeps the number keys for the text.
function typing() {
  const active = document.activeElement;
  return Boolean(active?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName?.toUpperCase?.()));
}
// The one check for every way of playing a note. Blocked gameplay covers an
// open inventory, chat or phone menu.
function canPlay() {
  return Boolean(heldInstrument()) && !builder.enabled && !typing() && !isGameplayBlocked()
    && !spellControls.menu?.isOpen && !gate.waiting && !debug.freeze && player.vitals.health > 0;
}
// The figure's top row in the last frame, where the note glyph starts from.
let lastOwnTop = NaN;
let preparedInstrument = null;
// Where every local note is born: the sound, the glyph over the head, the
// selection back on slot 9 (shown only, equipping nothing) and the flash.
function playSlot(slot, shifted) {
  const id = heldInstrument();
  const note = layerNote(id, slot, shifted);
  const event = { type: 'instrument', instrument: id, ...note, x: player.x, y: player.y };
  // A claimed key never reaches the page's own unlock listener, so resume
  // sound here, inside the key press, before the note is scheduled.
  const unlocking = sound.engine.unlock();
  if (sound.engine.context?.state === 'running') sound.play(event);
  else void unlocking.then((running) => { if (running) sound.play(event); });
  musicNotes.add({ x: player.x, y: player.y, top: lastOwnTop, midi: noteMidi(id, note.degree, note.octave, note.chord)[0] });
  // Friends in a lobby hear it too; solo, nothing is sent.
  multiplayer.sendNote({ instrument: id, ...note });
  inventory.selectHotbar(8);
  hud.flashSlot(slot - 1);
}
// A friend's note: heard from where their figure stands, fading to silence at
// the instrument's range, with the note over their head. Its loudness and pan
// are set as it starts and stay while it rings.
function playRemoteNote(from, note) {
  const peer = remotePlayers.peers.get(from);
  if (!peer) return;
  const { x, y } = peer.player;
  const level = instrumentFalloff(note.instrument, Math.hypot(...toMetres(x - player.x, y - player.y)));
  if (level <= 0) return;
  sound.play({ type: 'instrument', ...note, x, y, level });
  // A background tab's glyphs would all appear at once on its return.
  if (document.hidden) return;
  const top = peer.figure ? Math.floor(y + figureTop(peer.figure)) : NaN;
  musicNotes.add({ x, y, top, midi: noteMidi(note.instrument, note.degree, note.octave, note.chord)[0] });
}
multiplayer.onNote = ({ from, note }) => playRemoteNote(from, note);
debug.playRemoteNote = playRemoteNote;
const instrumentKeys = new InstrumentKeys(window, {
  instrument: () => isGameplayBlocked() ? null : heldInstrument(),
  canPlay,
  isControl: isControlTarget,
  onNote: playSlot,
});
debug.instrumentKeys = instrumentKeys;
touch.setCastHold((pointerId, isTap) => spellControls.openTouch(pointerId, isTap),
  (pointerId) => spellControls.dropTouch(pointerId));
// What the contextual touch button can reach. Ground items appear once the
// game keeps a collection of them.
const interactables = () => ({ player, mushrooms, fires, world, collection: debug.collection ?? null });
loadSpells().then(spells => {
  void prepareSpellSounds(sound.engine, spells);
  casting.spells = new Map(spells.map(s => [s.id, s]));
  casting.selected = casting.spells.has(params.get('spell')) ? params.get('spell') : spells[0]?.id ?? '';
  spellControls.populate();
}).catch(error => { console.error('Could not load rune spells', error); hud.notify('Could not load rune spells. Refresh to try again.'); });
multiplayer.onCast = message => {
  syncSpellPeers();
  const caster = spellPeers.get(message.casterId);
  const target = player.spellId === message.targetId ? player : spellPeers.get(message.targetId);
  if (!caster || (target === player && playerShielded())) return;
  casting.cast(message.id, { caster, target, heading: message.heading, aim: message.aim, remote: true });
};
let monsterFigures = null;
debug.monsters = monsters;
// When the player last took a wound; they heal after a breather.
let lastHurt = -Infinity;

// The player's 3D character; until it has loaded the shape-built figure
// stands in. The monsters are drawn from the same animation library.
let model = null;
ModelFigure.library('assets/ual1.glb').then((gltf) => {
  monsterFigures = new MonsterFigures(gltf);
  debug.monsterFigures = monsterFigures;
}).catch((e) => console.error('Could not set up the monsters', e));
// The animals' own models; they live unseen until these arrive.
let animalFigures = null;
if (animals.enabled) {
  AnimalFigures.load({ phone: () => device.phone }).then((f) => {
    animalFigures = f;
    debug.animalFigures = f;
  }).catch((e) => console.error('Could not set up the animals', e));
}
ModelFigure.load('assets/ual1.glb')
  .then((m) => {
    model = m;
    debug.model = m;
    player.modelTrail = true;
    // Walk and run a little quicker than the clips' own ground speeds; the
    // cadence rises to match, so the feet still keep pace.
    const gait = Object.fromEntries(m.gaits.map((g) => [g.key, g]));
    player.walkSpeed = gait.walk.speed * 1.3 * 1.2;
    player.runSpeed = gait.jog.speed * 1.2;
  })
  .catch((e) => console.error('Could not load the character model', e));

// The name floating above the character's head; `top` is the highest row
// the character covers.
// Everyone who stirs the ground fog: the player first, then friends, then
// spells in flight, then the living monsters nearest the player, as many as
// the fog follows.
function fogWalkers(view, missiles) {
  const walkers = [{ id: 'self', x: player.x, y: player.y },
    ...remotePlayers.visible(view).map((peer) => ({ id: peer, x: peer.player.x, y: peer.player.y })), ...missiles];
  const near = (m) => Math.hypot((m.x - player.x) * ASPECT, m.y - player.y);
  const foes = monsters.living.sort((a, b) => near(a) - near(b)).slice(0, Math.max(0, MAX_WALKERS - walkers.length));
  for (const m of foes) walkers.push({ id: m, x: m.x, y: m.y, size: figureScale(m.kind.id) });
  const wild = animals.list.filter((a) => a.alive).sort((a, b) => near(a) - near(b)).slice(0, Math.max(0, MAX_WALKERS - walkers.length));
  for (const a of wild) walkers.push({ id: a, x: a.x, y: a.y, size: a.kind.height / 1.8 });
  const ridden = [...horses.list].sort((a, b) => near(a) - near(b)).slice(0, Math.max(0, MAX_WALKERS - walkers.length));
  // Horse and rider stand 2.45 m; a horse alone, to the top of its head, 2 m.
  for (const h of ridden) walkers.push({ id: h, x: h.x, y: h.y, size: (h.rider ? 2.45 : 2) / 1.8 });
  return walkers;
}

// Where each speaker's bubble hangs this frame: their feet, the row of their
// nameplate (two over the figure's top) and whether scenery was drawn over
// their head. `ownTop` is null while the 3D character shows nothing.
function bubbleAnchors(view, ownTop, peers) {
  const anchor = (state, top) => {
    const known = Number.isFinite(top);
    return { x: state.x, feetY: state.y, depth: state.y, nameRow: known ? top - 2 : Infinity,
      covered: known && [1, 2].some((dy) => renderer.fineInFront(Math.floor(state.x) - view.x0, top + dy - view.y0)) };
  };
  const anchors = new Map([['self', anchor(player, ownTop)]]);
  for (const [id, peer] of remotePlayers.peers) {
    if (peers.includes(peer)) anchors.set(id, anchor(peer.player, Math.floor(peer.player.y + figureTop(peer.figure))));
  }
  return anchors;
}

// A blow on the player from a monster or a wolf: if it lands, the screen
// shakes and the ground thuds under them.
function hurtPlayer(e, shake, strength) {
  if (player.takeDamage(e.amount) <= 0) return;
  lastHurt = time;
  camera.shake(shake);
  sound.play({ type: 'slam', x: player.x, y: player.y, strength });
  dust.burst(world, player.x, player.y, 4, 4);
}

// What the monsters do: their blows on the player, the player's on them,
// and their coming and falling. Each kind has its own voice.
function monsterEvent(e) {
  hearWild(e);
  // An arrow can outlive the archer who loosed it.
  const kind = e.monster?.kind;
  const voice = kind?.sounds[e.type];
  switch (e.type) {
    case 'hit-player':
      hurtPlayer(e, e.arrow ? 0.15 : 0.35, e.arrow ? 0.25 : 0.45);
      break;
    case 'shoot':
      sound.play({ ...e, type: voice });
      break;
    case 'arrow-land':
      sound.play({ type: 'land', x: e.x, y: e.y, strength: 0.2 });
      splashes.react(world, { type: 'land', x: e.x, y: e.y, strength: 0.15 });
      break;
    case 'swing':
      sound.play(e);
      break;
    case 'step':
      // Wading kicks up a splash; on land the bones barely make a sound.
      if (world.typeAt(e.x, e.y) === WATER) {
        splashes.react(world, e);
        sound.play(e);
      } else sound.play({ ...e, strength: e.strength * 0.4 });
      break;
    case 'hurt':
      sound.play({ ...e, type: voice });
      hud.damage(e.amount, e.x, e.y);
      // Bone chips off a skeleton; a goblin just reels.
      if (kind === KINDS.skeleton) dust.sparks(e.x, e.y - 12, 6);
      break;
    case 'death':
      sound.play({ ...e, type: voice });
      dust.burst(world, e.x, e.y, 14, 8);
      // A troll comes down like a felled tree.
      if (kind === KINDS.troll) {
        camera.shake(0.5);
        dust.burst(world, e.x, e.y, 26, 10);
      }
      hud.notify(`${kind.name} ${kind === KINDS.skeleton ? 'destroyed' : 'slain'} (${monsters.kills} slain)`, 'pickup');
      if (lootCredit.claim(e.monster)) dropLoot(e.monster);
      break;
    case 'rise':
      sound.play({ ...e, type: voice });
      dust.burst(world, e.x, e.y, 12, 6);
      break;
    case 'spot':
      sound.play({ ...e, type: voice });
      break;
    case 'enrage':
      sound.play({ ...e, type: voice });
      hud.notify(`The ${kind.name.toLowerCase()} is enraged!`, 'info');
      break;
    case 'slam': {
      // A club smashing into the ground: dust, grit, and a jolt felt more
      // the closer the player stands.
      sound.play({ type: 'slam', x: e.x, y: e.y, strength: e.strength });
      dust.burst(world, e.x, e.y, 20, 11);
      const surface = world.typeAt(e.x, e.y);
      if (surface !== GRASS && surface !== WATER) dust.sparks(e.x, e.y, 10);
      splashes.react(world, { type: 'land', x: e.x, y: e.y, strength: 1 });
      const near = Math.hypot((e.x - player.x) * ASPECT / SCALE, (e.y - player.y) / (SCALE * TILT));
      camera.shake(0.8 * Math.max(0, 1 - near / 14));
      break;
    }
  }
}

// Struck down, the player wakes back where they began, whole again, and the
// dead go back into the ground for a while.
function fallInBattle() {
  casting.reset();
  player.respawn(spawn.x, spawn.y);
  model?.resetPose(player);
  clearInput();
  clicked = false;
  rightClicked = false;
  mouseHeld = false;
  hitStop = 0;
  camera.x = player.x;
  camera.y = player.y - 11 - playerLift();
  monsters.clear();
  animals.disengage();
  target.clear();
  hud.notify('You were struck down. You wake where you began.', 'info');
}

// A health bar over each monster's head once it has been cut.
function woundedFoes(figures) {
  return figures.filter(({ monster: m, top }) => m.alive && m.health < m.maxHealth && top !== null)
    .map(({ monster: m, top }) => ({ id: m.id, name: m.kind.name, health: m.health, maxHealth: m.maxHealth,
      x: m.x, y: top - 1, target: m === target.entity }));
}

let time = 0;
let animation = null;
let contextLost = false;

function schedule() {
  if (animation === null && !document.hidden && !contextLost) animation = requestAnimationFrame(frame);
}

// Trees and rocks are baked in small letters for the fine grid by workers,
// or, where they cannot run, here while the browser is idle, a few rows at
// a time, so one coming near the view never stalls a frame. Until then it
// is drawn in ordinary cells.
startFineWorkers();
let baking = false;
function bakeWhenIdle() {
  if (baking || !fineBakesPending()) return;
  baking = true;
  const idle = window.requestIdleCallback ?? ((run) => setTimeout(() => run({ timeRemaining: () => 4 }), 0));
  idle((deadline) => {
    baking = false;
    bakeFine(Math.max(2, deadline.timeRemaining() - 1));
  }, { timeout: 120 });
}

function suspend() {
  if (animation !== null) cancelAnimationFrame(animation);
  animation = null;
  clock.reset();
  cancelActions();
}

// Phones come back paused behind the resume card, so nothing strikes the
// player while they unlock the phone, and the sound waits for the tap too.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    suspend();
    if (gated() && !creator.isOpen) gate.show('resume');
  } else {
    if (gate.waiting) void sound.engine.suspend();
    schedule();
  }
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted && gated() && !creator.isOpen) gate.show('resume');
});
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  suspend();
  status.textContent = 'Restoring the scene…';
  status.hidden = false;
});
canvas.addEventListener('webglcontextrestored', () => {
  renderer.restore();
  resize();
  contextLost = false;
  status.hidden = true;
  schedule();
});

function frame(now) {
  animation = null;
  if (document.hidden || contextLost) return;
  const step = clock.step(now);
  if (step === null) { schedule(); return; }
  const started = performance.now();
  // Behind the play card the whole world holds still: every system below
  // steps by zero, so time of day, fires, weather, fog, particles, monsters
  // and the player all wait, while the scene is still drawn.
  const dt = gate.waiting || debug.pinTime !== null ? 0 : step;
  time = debug.pinTime ?? time + dt;
  updateZoom(debug.pinTime === null ? dt : step);
  glideFraming(step);
  if (debug.freeze || isGameplayBlocked() || player.magicStunned || gate.waiting) cancelActions();
  updateWakeLock();

  // Keys 1-8 are notes while an instrument is carried; a tap that slipped
  // past the note keys is dropped rather than equipping slot gear.
  const instrument = heldInstrument();
  for (let index = 0; index < 9; index++) {
    if (wasTapped(`Digit${index + 1}`, `Numpad${index + 1}`) && !(index < 8 && instrument)) selectHotbar(index);
  }
  hud.setInstrument(instrument ? { id: instrument, shifted: isDown('ShiftLeft', 'ShiftRight') } : null);
  // Render the instrument's string buffers once per audio context, ahead of its first note.
  const audioContext = sound.engine.context;
  if (instrument && audioContext?.state === 'running'
    && (preparedInstrument?.id !== instrument || preparedInstrument.context !== audioContext)) {
    preparedInstrument = { id: instrument, context: audioContext };
    void prepareInstrument(sound.engine, instrument);
  }
  if (wasTapped('KeyQ')) useHotbar();
  // Changing or taking off the weapon puts the last one away at once.
  const weapon = player.weapon;
  const hand = inventory.equipment.mainHand;
  const weaponKey = weaponKeyOf(hand);
  if (weaponKey !== lastWeapon) {
    player.cancelWeapon();
    player.ranged.reset();
    lastWeapon = weaponKey;
  }
  const armed = Boolean(weapon);
  const ranged = isBow(weapon) || isThrown(weapon);
  canvas.classList.toggle('projectile-aiming', !builder.enabled);
  const ammo = isBow(weapon) ? `Arrows ${carriedCount('arrow')}` : isThrown(weapon) ? `${ITEMS[hand.id].name} ×${carriedCount(hand.id)}` : '';
  if (ammoNote.textContent !== ammo) ammoNote.textContent = ammo;
  ammoNote.hidden = !ammo;
  const move = isControlTarget(document.activeElement) ? { x: 0, y: 0 } : moveAxis();
  const jump = wasTapped('Space');
  const keyAttack = wasTapped('KeyJ');
  // The touch buttons press codes no keyboard sends; only they get aim assist.
  const touchStrike = wasTapped('TouchStrike');
  const touchCast = wasTapped('TouchCast');
  const touchInteract = wasTapped('TouchInteract');
  const attack = keyAttack || clicked || touchStrike;
  const sword = wasTapped('KeyF');
  const torchKey = wasTapped('KeyT');
  const toss = wasTapped('KeyG');
  const campfire = wasTapped('KeyC');
  const interact = wasTapped('KeyE');
  const keyCast = wasTapped('KeyR') || rightClicked;
  const cast = keyCast || touchCast;
  rightClicked = false;
  if (!builder.enabled && !debug.freeze) {
    if (jump) player.jump();
    // A click swings at the cursor; J swings the way the body faces; STRIKE
    // turns to the nearest foe ahead.
    if (attack && armed && !ranged) {
      const aim = keyAttack || clicked ? null : strikeAssist(player, assistFoes());
      if (player.attack(keyAttack ? null : clicked ? cursorHeading(true) : aim?.heading ?? null)) strikeFoe = aim?.foe ?? null;
    }
    if (sword && armed) player.toggleSword();
    if (torchKey) fireNotice(torchMessages[torches.toggle(player)]);
    if (toss) fireNotice(torchMessages[torches.throw(player, model?.torchPose())]);
    if (campfire) fireNotice(fireMessages[fires.toggle(world, player)]);
    // E and TAKE do the same nearest thing, a ground item before a glowcap;
    // only TAKE puts out a fire, which the keyboard leaves to C.
    if ((interact || touchInteract) && !isGameplayBlocked() && !player.magicStunned) {
      const done = performInteraction(interactables(), { douse: touchInteract });
      if (done?.kind === 'fire') fireNotice(fireMessages[done.result]);
      // What the drop store's collection takes is told once, with its sound,
      // as its pickup events are spent below.
      const told = done?.result?.ok && debug.collection === huntCollection;
      if (done?.kind === 'pickup' && done.result.message && !told) hud.notify(done.result.message, 'pickup');
    }
    if (cast && !isGameplayBlocked() && !player.magicStunned) {
      syncSpellPeers();
      // A tap on CAST sends an attack spell at the nearest foe ahead.
      const foe = touchCast && !keyCast ? castAssist(player, monsters.list, casting.spells.get(casting.selected))?.foe : null;
      const aim = foe ? { x: foe.x, y: foe.y } : aimPoint({ projectileRange: 40 }, 1);
      const heading = Math.atan2((aim.x - player.x) * ASPECT / SCALE, (aim.y - player.y) / (SCALE * TILT));
      const result = casting.cast(casting.selected, { aim, heading });
      if (!result.ok) hud.notify(result.reason);
      // The caster turns to send the spell the way it was aimed.
      else if (foe || cursorCell()) player.face(heading, 0.35);
    }
  }
  if (time > fireNoticeUntil) fireStatus.classList.remove('visible');
  clicked = false;
  const stoppedDt = Math.min(dt, hitStop);
  hitStop -= stoppedDt;
  const playerDt = dt - stoppedDt + stoppedDt * 0.05;
  const held = isDown('KeyJ', 'TouchStrike') || mouseHeld;
  const fromX = player.x, fromY = player.y, fromAir = player.air;
  const paused = debug.freeze || builder.enabled || playerDt === 0;
  const foeDt = creator.isOpen ? 0 : playerDt;
  casting.setPresentationPaused(paused || document.hidden);
  // A bow draws while the attack is held and shoots on release; a spear or
  // javelin jabs on a tap and is thrown after a longer hold.
  const rangedBlocked = paused || isGameplayBlocked() || player.magicStunned;
  if (rangedBlocked) player.ranged.reset();
  const release = rangedBlocked ? null : player.ranged.update(dt, ranged && held, weapon);
  if (player.ranged.held > 0) rangedSource ??= isDown('TouchStrike') ? 'touch' : 'other';
  // A draw from STRIKE aims at the nearest foe ahead, checked again on release.
  const touchAim = rangedSource === 'touch';
  const rangedFoe = touchAim && (player.ranged.aiming || release)
    ? assistTarget(player, assistFoes(), { range: weapon.projectileRange ?? 8 })?.foe ?? null : null;
  player.aimTarget = player.ranged.aiming ? aimPoint(weapon, player.ranged.draw, rangedFoe) : null;
  if (release?.action === 'jab') {
    const aim = touchAim ? strikeAssist(player, assistFoes()) : null;
    if (player.attack(touchAim ? aim?.heading ?? null : cursorHeading(true))) strikeFoe = aim?.foe ?? null;
  }
  else if (release) fireRanged(release, weapon, rangedFoe);
  if (player.ranged.held === 0) rangedSource = null;
  if (!paused) player.update(playerDt, world, move, isDown('ShiftLeft', 'ShiftRight'), held);
  if (model) {
    // Paused, the pose holds but a new skin or gear still shows at once.
    if (!paused) model.update(playerDt, player);
    else model.gear.apply(player.equipment, player.skin);
    model.renderPose(player.x, player.y);
    // The sword's trail follows the blade of the 3D character.
    player.trail = player.trail.filter((t) => player.time - t.t < 0.16);
    const blade = !paused && player.combat.trailing ? model.swordLine() : null;
    if (blade) {
      const cut = { t: player.time, hx: player.x + blade.base[0], hy: player.y + blade.base[1],
        tx: player.x + blade.tip[0], ty: player.y + blade.tip[1] };
      player.trail.push(cut);
      // The real blade, not the stand-in skeleton's, parts the grass.
      player.swordSweep = cut;
    }
  }
  if (!paused) grass.update(world, player, time);
  if (!paused) mushrooms.update(playerDt, player, fromX, fromY);
  if (!paused) musicNotes.update(dt);
  if (!gate.waiting) remotePlayers.update(dt, now);
  if (!paused) fires.pass(world, player, fromX, fromY, fromAir);
  for (const e of player.events) {
    if (e.type === 'damage') {
      lastHurt = time;
      hud.damage(e.amount, e.x, e.y);
      haptics.hurt();
    }
    // Each cut can fell a tree a blow at a time or mow tall grass.
    if (e.type === 'strike' && !paused) {
      for (const result of harvesting.react(e, player)) {
        if (result.message) hud.notify(result.message, 'pickup');
        if (result.status === 'harvested' && result.node?.kind === 'tree') payGather(result.node);
      }
      for (const result of mining.react(e, player, toolOf(inventory.equipment))) {
        hud.notify(result.message, 'pickup');
        dust.sparks(result.block.x, result.block.y - 1, 4);
      }
      const damage = Math.max(0, (player.weapon?.damage ?? 20) + (player.magicDamage ?? 0));
      const hit = monsters.strike(e, player, damage);
      for (const m of hit) lootCredit.observe(m, true);
      const prey = animals.strike(e, player, damage);
      if (hit.length || prey.length) {
        hitStop = Math.max(hitStop, 0.06);
        haptics.hit();
        markTarget([...hit, ...prey], strikeFoe);
      }
    }
    if (!debug.freeze) fires.react(world, e, player);
    hearWild(e);
    sound.play(e);
    splashes.react(world, e);
    if (e.type === 'step') {
      dust.burst(world, e.x, e.y, Math.round(1 + e.strength * 3), 2 + e.strength * 4);
      footprints.add(world, e.x, e.y, time, player.heading);
    }
    if (e.type === 'land') dust.burst(world, e.x, e.y, Math.round(6 + e.strength * 10), 5 + e.strength * 6);
    if (e.type === 'breath') dust.breath(e.x, e.y, e.h, e.dx, e.dy);
    if (e.type === 'skid') dust.burst(world, e.x, e.y, 2, 3 + e.strength * 5);
    if (e.type === 'whirl') dust.burst(world, e.x, e.y, 18, 14);
    if (e.type === 'slam') {
      dust.burst(world, e.x, e.y, Math.round(22 * e.strength), 12 * e.strength);
      const surface = world.typeAt(e.x, e.y);
      if (surface !== GRASS && surface !== WATER) dust.sparks(e.x, e.y, Math.round(14 * e.strength));
      camera.shake(0.7 * e.strength);
      // Freeze the warrior for a heartbeat as the blow lands, to sell its
      // weight.
      hitStop = 0.08;
    }
  }
  player.events.length = 0;
  if (!paused) {
    syncSpellPeers();
    casting.update(playerDt);
    // Foes hold still while the creator is open.
    monsters.update(foeDt, world, player);
    monsterFigures?.update(foeDt, monsters.list);
  }
  for (const e of monsters.events) monsterEvent(e);
  monsters.events.length = 0;
  // Spells and monster updates can hurt the player after the event pass above.
  if (player.events.some(event => event.type === 'damage')) lastHurt = time;
  const respawned = !paused && player.vitals.health <= 0;
  if (respawned) fallInBattle();
  else if (!paused && time - lastHurt > 6) player.heal(5 * playerDt);
  if (!paused) {
    // Where each shaft was, so its path this frame can be tested against
    // the animals' bodies; one that strikes makes no sound of landing, and
    // one that misses startles those it lands near.
    const shafts = new Map(projectiles.list.map((p) => [p, { x: p.x, y: p.y, h: p.h }]));
    projectiles.update(dt, world);
    const unhurt = shafts.size ? new Map(animals.list.map((a) => [a, a.health])) : null;
    const struck = animals.shots(projectiles, shafts, player);
    if (struck.size) markTarget(animals.list.filter((a) => a.health < unhurt.get(a)));
    for (const impact of projectiles.events) {
      if (struck.has(impact.id)) continue;
      sound.play({ type: 'land', x: impact.x, y: impact.y, strength: 0.25 });
      animals.landed(impact.x, impact.y);
      birds.landed(impact.x, impact.y);
      fishes.landed(impact.x, impact.y);
    }
    projectiles.events.length = 0;
    // Walking over a landed arrow or spear picks it up again.
    if (player.air === 0 && !respawned) {
      for (const shaft of projectiles.collectNear(player.x, player.y, 0.75, { x: fromX, y: fromY })) {
        const id = shaft.kind === 'arrow' ? 'arrow' : shaft.kind;
        if (!inventory.add(id, 1, { material: shaft.material })) {
          projectiles.landed.push(shaft);
          continue;
        }
        if (id !== 'arrow' && !inventory.equipment.mainHand) {
          inventory.equip(inventory.slots.findIndex((stack) => stack?.id === id));
        }
      }
    }
  }
  // Hide, meat and bone are drawn in from close by.
  huntCollection.update(paused ? 0 : dt, player, { blocked: paused || isGameplayBlocked() || respawned });
  for (const ev of huntCollection.events) {
    sound.play({ ...ev, type: 'pickup' });
    if (ev.type === 'coin') hud.earned(ev.cents);
    else hud.notify(`Picked up ${ITEMS[ev.id].name}${ev.count > 1 ? ` x${ev.count}` : ''}.`, 'pickup');
  }
  huntCollection.events.length = 0;
  huntDrops.expire(huntCollection.currentTime);
  dust.update(dt);
  splashes.update(dt);
  if (!debug.freeze) {
    for (const impact of torches.update(dt, world, fires)) {
      fireNotice(torchMessages[impact.type]);
      if (impact.type === 'water') {
        const splash = { type: 'land', x: impact.x, y: impact.y, strength: 0.3 };
        splashes.react(world, splash);
        sound.play(splash);
      }
    }
  }
  // Aim at the wanderer's middle rather than their feet.
  const pLift = playerLift();
  if (builder.enabled) builder.updateCamera(dt, move, isDown('ShiftLeft', 'ShiftRight'));
  else camera.follow(player.x, player.y - 11 - pLift, dt);

  const view = camera.view(renderer);
  // Whatever stands on raised ground is drawn through a view lifted with it.
  const lv = (x, y) => world.relief ? liftView(view, world.liftAt(x, y)) : view;
  const pv = pLift ? liftView(view, pLift) : view;
  // Each light or glow shines from as high as its source stands.
  const liftedPass = (sources, pass) => {
    if (!world.relief) pass(view, sources);
    else for (const s of sources) pass(s.carried ? pv : lv(s.x, s.y), [s]);
  };
  // Sprites as far as the deepest lift below the view can rise into it.
  const below = world.relief ? world.maxLift : 0;
  weather.update(dt, time, world, view, sound.weather);
  if (!paused) {
    debris.update(dt, world, view, player, weather, splashes, debrisBodies());
    for (const e of debris.events) sound.play(e);
    debris.events.length = 0;
  }
  const spellFog = fogSpells.collect(casting);
  fog.update(dt, weather, fogWalkers(view, spellFog.walkers), spellFog, view);
  if (wasTapped('KeyL') || summonLightning) {
    const bolt = weather.summon(world, view, player);
    if (bolt) {
      sound.play({ type: 'lightning', x: bolt.x, y: bolt.y, strength: bolt.strength });
      hearWild({ type: 'lightning', x: bolt.x, y: bolt.y, strength: bolt.strength });
    }
    summonLightning = false;
  }
  const blownOut = debug.freeze ? [] : fires.update(dt, time, world, weather.wind);
  for (const reaction of fires.events) {
    sound.play(reaction);
    if (reaction.extinguished) fireNotice('The impact smothered the fire.');
  }
  fires.events.length = 0;
  if (blownOut.some(fire => fire.outReason === 'wind' && Math.hypot((fire.x - player.x) * ASPECT, fire.y - player.y) < 35)) {
    fireNotice('Strong wind put out the fire.');
  } else if (blownOut.some(fire => fire.outReason === 'fuel' && Math.hypot((fire.x - player.x) * ASPECT, fire.y - player.y) < 35)) {
    fireNotice('The fire ran out of fuel.');
  }
  const wide = view.cols * view.rows > WIDE_VIEW;
  // A wide view generates its missing chunks a little each frame.
  if (wide) world.load(view.x0, view.y0, view.x0 + view.cols, view.y0 + view.rows, 6);
  drawGround(renderer, world, view, time, player, weather.wind, wide);
  grass.drawTracks(renderer, view, time, world);
  drawSkyReflection(renderer, view, time);
  footprints.draw(renderer, view, time);
  if (!pLift) drawShadow(renderer, view, player.x, player.y, player.air);
  const peers = remotePlayers.visible(view);
  for (const peer of peers) {
    drawShadow(renderer, view, peer.player.x, peer.player.y, peer.player.air);
    peer.figure = dressFigure(peer.player);
  }
  // Wildlife shies from the player, friends and monsters alike.
  if (!paused) {
    animals.update(foeDt, world, { player, peers, monsters: monsters.living, view });
    birds.update(playerDt, world, { player, peers, monsters: monsters.living,
      predators: animals.list.filter((a) => a.alive && a.predator), view });
    fishes.update(playerDt, world, { player, peers, view });
    animalFigures?.update(foeDt, animals.list, [...birds.list, ...fishes.list]);
    if (horses.list.length && !horseLoad) {
      horseLoad = HorseFigures.load({ phone: () => device.phone }).then((f) => {
        horseFigures = f;
        debug.horseFigures = f;
      }).catch((e) => console.error('Could not set up the horses', e));
    }
    horses.update(playerDt);
    horseFigures?.update(playerDt, horses.list);
  }
  // A darting fish now and then breaks the surface in a small ring.
  for (const e of fishes.events) if (e.ring) splashes.ring(e.x, e.y, 0.35, 0, true);
  fishes.events.length = 0;
  // Take-offs are kept for a wing-clatter sound to listen for.
  birds.events.length = 0;
  for (const e of animals.events) {
    if (e.type === 'hurt') {
      hud.damage(e.amount, e.x, e.y);
      sound.play({ type: 'slam', x: e.x, y: e.y, strength: 0.25 });
    } else if (e.type === 'death') {
      dust.burst(world, e.x, e.y, 10, 6);
      sound.play({ type: 'land', x: e.x, y: e.y, strength: 0.5 });
      // A wolf is a foe brought down, like a monster.
      if (e.animal.predator) hud.notify(`${e.animal.kind.name} slain`, 'pickup');
    } else if (e.type === 'hit-player') hurtPlayer(e, 0.3, 0.4);
    else if (e.type === 'swing') sound.play({ type: 'swing', x: e.x, y: e.y, strength: 0.5 });
    else if (e.type === 'bite') sound.play({ type: 'slam', x: e.x, y: e.y, strength: 0.2 });
    hearWild(e);
  }
  animals.events.length = 0;
  for (const drop of animals.drops) huntDrops.lay(drop, world, (a, b) => huntCollection.pathClear(a, b));
  animals.drops.length = 0;

  // Props up to a screen above the view can still be reflected into it, and
  // the tallest trees reach into it from far below.
  const marginX = Math.max(world.propRenderW, MAX_TREE_HALF_WIDTH + MAX_LEAF_DRIFT) + 2;
  const tall = Math.max(world.propRenderH, MAX_TREE_HEIGHT);
  const props = world.propsIn(view.x0 - marginX, view.y0 - Math.max(view.rows, tall + 1) - 1,
    view.x0 + view.cols + marginX, view.y0 + view.rows + tall + below, wide);
  // Trees' shadows darken the ground drawn so far, and the grass and rocks'
  // ground cells as they are drawn, and moonbeams light them; warm light is
  // added over them later.
  const nightStart = performance.now();
  nightLight.prepare(view, props, { weather, seed: world.seed, world,
    tier: shaftTier({ phone: device.phone, reduced: pacer.reduced }) });
  nightLight.shadeGround(renderer, view);
  renderer.night = nightLight.active ? nightLight : null;
  debug.metrics.nightMs = performance.now() - nightStart;
  const mirror = reflector(time, view);
  const deep = below ? { ...view, rows: view.rows + below } : view;
  const visibleMushrooms = mushrooms.prepare(deep, wide);
  const visibleFires = fires.prepare(deep, time);
  const visibleTorches = torches.prepare(deep, time, player, model?.torchPose());
  ambience.update(dt, time, world, view, { lights: lightsOf(visibleFires, visibleTorches), wind: weather.wind });
  // Once the 3D character has loaded it replaces the shape-built figure.
  let figure = null;
  if (model) model.rasterise(pv, player.x, player.y);
  else figure = dressFigure(player);
  const monsterCells = monsterFigures ? monsterFigures.rasterise(view, monsters.list, player) : [];
  for (const { monster } of monsterCells) {
    if (monster.alive) drawShadow(renderer, view, monster.x, monster.y, 0);
  }
  const wildCells = animalFigures ? animalFigures.rasterise(view, animals.list, player, [...birds.list, ...fishes.list]) : [];
  const animalCells = wildCells.filter((f) => !f.small);
  const fishCells = wildCells.filter((f) => f.submerged);
  const birdCells = wildCells.filter((f) => f.small && !f.submerged);
  for (const figure of [...animalCells, ...birdCells]) AnimalFigures.drawShadow(renderer, view, figure);
  const horseCells = horseFigures ? horseFigures.rasterise(view, horses.list, player) : [];
  for (const figure of horseCells) AnimalFigures.drawShadow(renderer, view, figure);

  // Match the reveal region to this pose, including a jump or sword swing.
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  if (model) {
    for (const cell of model.cells) {
      left = Math.min(left, cell.sx + view.x0 - player.x);
      right = Math.max(right, cell.sx + view.x0 - player.x);
      top = Math.min(top, cell.sy + pv.y0 - player.y);
      bottom = Math.max(bottom, cell.sy + pv.y0 - player.y);
    }
  } else {
    for (const part of figure) {
      left = Math.min(left, part.x0 / ASPECT);
      right = Math.max(right, part.x1 / ASPECT);
      top = Math.min(top, part.y0);
      bottom = Math.max(bottom, part.y1);
    }
  }
  player.foliageBounds = left === Infinity ? null : { x: player.x + (left + right) / 2,
    y: player.y + (top + bottom) / 2,
    rx: Math.max(6, (right - left) / 2 + 4), ry: Math.max(10, (bottom - top) / 2 + 4) };

  // Painter's order: whatever stands further down the screen is in front.
  // Reflections first, each prop measured about its own base.
  const reflections = props.filter((p) => propInView(view, p, true)).map((p) => ({ y: p.y,
    draw: () => drawProp(renderer, view, p, mirror, time, null, seed, true) }));
  // While the creator is open, whatever would hide the outlaw is left out.
  const hides = (p, y) => creator.isOpen && hidesPreview(p, y, player);
  const drawables = props.filter((p) => propInView(lv(p.x, p.y), p, false, MAX_LEAF_DRIFT)).flatMap((p) => {
    const at = lv(p.x, p.y);
    // A turned arch spans several ground rows. Interleave its stone surfaces
    // with actors and grass instead of drawing both piers at one anchor depth.
    const slices = propDepthSlices(p);
    if (slices) return slices.filter(({ depth }) => !hides(p, p.y + depth)).map(({ depth, cells }) => ({ y: p.y + depth,
      draw: () => drawProp(renderer, at, p, undefined, time, player, seed, false, cells) }));
    if (hides(p, p.y)) return [];
    return [{ y: p.y, draw: () => {
      drawProp(renderer, at, p, undefined, time, player, seed);
      drawLeaves(renderer, at, p, time, seed);
    } }];
  });
  for (const fire of visibleFires) {
    reflections.push({ y: fire.y, draw: () => fires.draw(renderer, view, fire, time, mirror) });
    drawables.push({ y: fire.y, draw: () => fires.draw(renderer, lv(fire.x, fire.y), fire, time) });
  }
  for (const torch of visibleTorches) {
    if (torch.carried) continue;
    reflections.push({ y: torch.y, draw: () => torches.draw(renderer, view, torch, mirror) });
    drawables.push({ y: torch.y, draw: () => torches.draw(renderer, lv(torch.x, torch.y), torch) });
  }
  // Bushes can reach in from below the view or reflect from above it.
  const plants = harvesting.resourcesIn(view.x0 - 9, view.y0 - 12, view.x0 + view.cols + 9,
    view.y0 + view.rows + 12 + below, wide);
  for (const node of plants) {
    reflections.push({ y: node.y, draw: () => drawResource(renderer, view, node, time, mirror) });
    drawables.push({ y: node.y, draw: () => drawResource(renderer, lv(node.x, node.y), node, time) });
  }
  for (const node of visibleMushrooms) {
    reflections.push({ y: node.y, draw: () => mushrooms.draw(renderer, view, node, mirror) });
    drawables.push({ y: node.y, draw: () => mushrooms.draw(renderer, lv(node.x, node.y), node) });
  }
  for (const spore of [...mushrooms.ambient, ...mushrooms.spores]) {
    drawables.push({ y: spore.y, draw: () => mushrooms.drawSpore(renderer, view, spore) });
  }
  // A note glyph is kept below the panels over the top of the screen.
  const noteCover = musicNotes.list.length ? hud.topCover({ ...view, cellW: renderer.cellW, cellH: renderer.cellH }) : null;
  for (const note of musicNotes.list) {
    drawables.push({ y: note.y + 0.001, draw: () => musicNotes.draw(renderer, view, note, noteCover) });
  }
  for (const shaft of [...projectiles.landedDrawables(), ...monsters.arrows.landedDrawables()]) {
    drawables.push({ y: shaft.depth, draw: () => shaft.draw(renderer, view) });
  }
  for (const item of huntDrops.in(view.x0 - 2, view.y0 - view.rows, view.x0 + view.cols + 2, view.y0 + view.rows + 2 + below)) {
    reflections.push({ y: item.y, draw: () => drawItem(renderer, view, item, time, mirror) });
    // Drawn after the grass a few rows in front, so tall blades never hide it.
    drawables.push({ y: item.y + HUNT_DROP_LIFT, draw: () => drawItem(renderer, lv(item.x, item.y), item, time) });
  }
  for (const piece of debris.visible(view)) {
    reflections.push({ y: piece.y, draw: () => debris.reflect(renderer, view, piece, mirror) });
    drawables.push({ y: piece.y, draw: () => debris.draw(renderer, lv(piece.x, piece.y), piece) });
  }
  const carried = visibleTorches.filter((torch) => torch.carried);
  reflections.push({ y: player.y, draw: () => {
    if (model) model.draw(renderer, mirror);
    else drawFigure(renderer, view, player, figure, mirror);
    for (const torch of carried) torches.draw(renderer, view, torch, mirror);
  } });
  drawables.push({ y: player.y, draw: () => {
    if (pLift) drawShadow(renderer, pv, player.x, player.y, player.air);
    if (model) model.draw(renderer, putOutlinedCell);
    else drawFigure(renderer, pv, player, figure, putOutlinedCell);
    for (const torch of carried) torches.draw(renderer, pv, torch);
  } });
  for (const figure of monsterCells) {
    reflections.push({ y: figure.monster.y, draw: () => MonsterFigures.draw(renderer, figure, mirror) });
    drawables.push({ y: figure.depth, draw: () => MonsterFigures.draw(renderer, figure, putOutlinedCell) });
  }
  for (const figure of animalCells) {
    reflections.push({ y: figure.animal.y, draw: () => AnimalFigures.draw(renderer, figure, mirror) });
    drawables.push({ y: figure.depth, draw: () => AnimalFigures.draw(renderer, figure, putOutlinedCell) });
  }
  // A horse is drawn band by band among the grass rows, each band at the
  // ground row under it.
  for (const figure of horseCells) {
    reflections.push({ y: figure.horse.y, draw: () => HorseFigures.draw(renderer, figure, mirror) });
    for (const band of figure.bands) drawables.push({ y: band.y, draw: () => HorseFigures.draw(renderer, band, putOutlinedCell) });
  }
  // A bird on the ground is shorter than the grass, so like a lying stack
  // it is drawn a few rows ahead of its own, over the blades in front; one
  // in the air is drawn over everything below it. Both are mirrored in the
  // lakes they stand by or cross.
  for (const figure of birdCells) {
    reflections.push({ y: figure.animal.y, draw: () => AnimalFigures.draw(renderer, figure, mirror) });
    if (!figure.air) drawables.push({ y: figure.depth + BIRD_LIFT, draw: () => AnimalFigures.draw(renderer, figure, putOutlinedCell) });
  }
  // Friends are drawn as the shape-built outlaw in their own gear.
  for (const peer of peers) {
    reflections.push({ y: peer.player.y, draw: () => drawFigure(renderer, view, peer.player, peer.figure, mirror) });
    drawables.push({ y: peer.player.y, draw: () => drawFigure(renderer, view, peer.player, peer.figure) });
  }
  reflections.sort((a, b) => a.y - b.y);
  // Raised ground rows go first, under whatever stands on the same row.
  if (world.relief) drawables.unshift(...raisedRows(renderer, world, view));
  drawables.sort((a, b) => a.y - b.y);
  // Fish swim under the water: everything on its surface draws over them.
  for (const figure of fishCells) AnimalFigures.drawSubmerged(renderer, figure);
  grass.drawReflections(renderer, world, view, time, mirror, reflections);

  const contacts = model ? model.waterContacts().map((p) => ({ x: player.x + p.x, y: player.y + p.y })) : [];
  for (const figure of monsterCells) contacts.push(...figure.contacts);
  for (const figure of animalCells) contacts.push(...figure.contacts);
  splashes.drawSurface(renderer, view, time);
  debris.drawSurface(renderer, view, time);
  weather.drawSurface(renderer, view, time);
  ambience.drawMist(renderer, view, time);
  grass.drawLayered(renderer, world, view, time, drawables);
  liftedPass(visibleMushrooms, (v, list) => mushrooms.drawGlow(renderer, v, list));
  splashes.drawContacts(renderer, view, time, contacts);
  // The moonbeams' columns of lit air, under the warm light.
  const shaftStart = performance.now();
  nightLight.drawShafts(renderer, view, time);
  debug.metrics.shaftMs = performance.now() - shaftStart;
  debug.metrics.nightMs += debug.metrics.shaftMs;
  liftedPass(visibleFires, (v, list) => fires.light(renderer, v, time, list));
  liftedPass(visibleTorches, (v, list) => torches.light(renderer, v, time, list));
  weather.drawAtmosphere(renderer, view, time);

  for (const figure of birdCells) if (figure.air) AnimalFigures.draw(renderer, figure, putOutlinedCell);
  projectiles.drawFlying(renderer, view);
  monsters.arrows.drawFlying(renderer, view);
  casting.effects.draw(renderer, view, casting.projectiles);
  drawTrail(renderer, view, player.trail, player.time);
  for (const peer of peers) drawTrail(renderer, view, peer.player.trail, peer.trailTime);
  // Nameplates and speech bubbles are placed before this frame's HUD
  // writes, so reading the screen's layout for them costs no extra style
  // pass. A nameplate sits two rows over its figure's top; the 3D
  // character's top is unknown while it shows nothing, and so is its name.
  const hudView = { ...view, cellW: renderer.cellW, cellH: renderer.cellH };
  const projection = hud.projector(hudView);
  let ownTop = model ? model.top : Math.floor(player.y + figureTop(figure));
  if (pLift && ownTop !== null) ownTop -= pLift;
  lastOwnTop = ownTop;
  const self = selfMember();
  const plates = Number.isFinite(ownTop) && !creator.isOpen ? [{ key: 'self', x: player.x, row: ownTop - 2, depth: player.y,
    name: self ? self.name : name, tag: self?.tag ?? null,
    colour: self ? memberColour(self) : chosenTint ? hexRgb(chosenTint) : SOLO_COLOR }] : [];
  for (const peer of peers) {
    plates.push({ key: peer.id, x: peer.player.x, row: Math.floor(peer.player.y + figureTop(peer.figure)) - 2,
      depth: peer.player.y, name: peer.name, tag: peer.tag ?? null, colour: memberColour(peer) });
  }
  nameplates.update(plates, projection);
  const bubblesStarted = performance.now();
  if (bubbles.size) {
    bubbles.update(bubbleAnchors(view, ownTop, peers), projection, device.phone ? layout.orientation : 'desktop');
  }
  const bubblesMs = performance.now() - bubblesStarted;
  dust.draw(renderer, view);
  splashes.drawSpray(renderer, view);
  fires.drawParticles(renderer, view, world.relief ? (x, y) => world.liftAt(x, y) : null);
  fireflies.update(dt, time, world, camera.x, camera.centreY(view), view.cols / 2, view.rows / 2);
  fireflies.draw(renderer, view, time);
  ambience.draw(renderer, view, time);
  weather.draw(renderer, view);
  builder.drawPreview(view);
  // Props near the view queue their fine bakes after those in view.
  let bakes = 4; // Asking bakes an ore block's cells (`unbaked`), so a few of those a frame.
  for (const p of props) if (!p.unbaked || bakes-- > 0) fineOf(p);
  bakeWhenIdle();
  if (debug.freeze || gate.waiting) sound.pause();
  else sound.update(dt, time, player, camera, fireflies.list, fires.list);
  unbindAudio.updateSong();
  const atmosphere = fog.uniforms(view);
  if (ruinPreview) atmosphere.density *= 0.55;
  renderer.draw(view.offX, view.offY, atmosphere);
  lastFrame = { width: canvas.width, height: canvas.height, cellW: renderer.cellW, cellH: renderer.cellH, view };
  hud.setParty(multiplayer.room ? multiplayer.players.filter((member) => member.id !== multiplayer.id)
    .map((member) => ({ id: member.id, name: member.name, tag: member.tag, colour: memberColour(member), health: member.state.health,
      maxHealth: player.vitals.maxHealth,
      note: `${Math.round(metresBetween(member.state, player))}m` })) : []);
  markSpellHits();
  hud.setTarget(target.update(time, player, targetPresent));
  hud.setFoes(woundedFoes(monsterCells));
  hud.setLoot(huntDrops.in(view.x0 - 2, view.y0 - 2, view.x0 + view.cols + 2, view.y0 + view.rows + 4), player, inventory);
  const nearbyMushroom = !paused && !isGameplayBlocked() && !player.magicStunned ? mushrooms.nearby(player) : null;
  const nearbyOre = !nearbyMushroom && !paused && !isGameplayBlocked() ? mining.nearby(player, toolOf(inventory.equipment)) : null;
  hud.setPrompt(nearbyMushroom ? (nearbyMushroom.cooldown > mushrooms.time
    ? 'Glowcap · spores settling…' : '[E] Disturb glowcap · release spores') : nearbyOre?.prompt ?? '');
  touch.interact.update(!paused && !isGameplayBlocked() && !player.magicStunned ? interaction(interactables()) : null, time);
  hud.update(dt, hudView);
  chat.update(dt);
  inventoryScreen.update();
  spellControls.update();
  const workMs = performance.now() - started;
  // Frames are measured by the real time between them, never the clamped
  // simulation step, so long frames are not hidden.
  // A GPU still late at the lowest backing resolution is starved.
  const starved = quality.scale <= quality.minimum && quality.average > 0.7;
  const paced = pacer.sample(workMs, clock.rawMs, starved);
  if (paced.rate) clock.setRate(pacer.rate);
  if (quality.sample(workMs, clock.rawMs / 1000, clock.period) || paced.cells) resize();
  debug.metrics.frames++;
  debug.metrics.workMs = workMs;
  debug.metrics.bubblesMs = bubblesMs;
  debug.metrics.intervalMs = clock.rawMs;
  debug.metrics.rate = pacer.rate;
  schedule();
}

schedule();
