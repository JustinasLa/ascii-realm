import { screenToWorld } from './core/aim.js';
import { clearInput, isControlTarget, isDown, isGameplayBlocked, moveAxis, setGameplayBlocked, wasTapped } from './core/input.js';
import { SceneryBuilder } from './editor/builder.js';
import { GameAudio } from './audio/audio.js';
import { bindAudioControls } from './audio/controls.js';
import { installTouchControls } from './core/touch.js';
import { dressFigure, drawFigure, drawNameTag, drawShadow, drawTrail } from './entities/figure.js';
import { ModelFigure } from './entities/model.js';
import { Skeletons } from './entities/skeleton.js';
import { SkeletonFigures } from './entities/skeleton-figure.js';
import { isBow, isThrown } from './entities/loadout.js';
import { Player } from './entities/player.js';
import { SCALE, TILT } from './entities/rig.js';
import { Inventory } from './inventory/inventory.js';
import { ITEMS } from './inventory/items.js';
import { MultiplayerClient } from './multiplayer/client.js';
import { bindMultiplayerControls } from './multiplayer/controls.js';
import { cleanName, PLAYER_COLORS, playerState } from './multiplayer/protocol.js';
import { RemotePlayers } from './multiplayer/remote-players.js';
import { putCell } from './render/cells.js';
import { buildAtlas, glyph } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
import { Hud } from './ui/hud.js';
import { InventoryScreen } from './ui/inventory.js';
import { FrameClock, FrameQuality, renderSize } from './render/budget.js';
import { Camera } from './world/camera.js';
import { Ambience, lightsOf } from './world/ambience-fx.js';
import { Dust } from './world/dust.js';
import { Fires } from './world/fire.js';
import { Fireflies } from './world/fireflies.js';
import { Footprints } from './world/footprints.js';
import { drawGround } from './world/ground.js';
import { Grass } from './world/grass.js';
import { Harvesting } from './world/harvesting.js';
import { drawResource } from './world/item-draw.js';
import { drawLeaves, MAX_LEAF_DRIFT } from './world/leaves.js';
import { Projectiles } from './world/projectiles.js';
import { drawProp, propInView } from './world/props.js';
import { reflector } from './world/reflection.js';
import { drawSkyReflection } from './world/sky.js';
import { Splashes } from './world/splashes.js';
import { Torches } from './world/torch.js';
import { MAX_TREE_HALF_WIDTH, MAX_TREE_HEIGHT } from './world/trees.js';
import { WeatherEffects } from './world/weather.js';
import { ASPECT, CHUNK_SIZE, GRASS, WATER, World } from './world/world.js';

const FONT = '"Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace';
// Cell height in CSS px; width follows from ASPECT so the world keeps its shape.
// Zooming sets a target and the cell size glides toward it every frame.
let cellH = 8;
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
const mobile = matchMedia('(any-pointer: coarse)').matches || Math.min(innerWidth, innerHeight) <= 600;
const quality = new FrameQuality();

const baseChunks = mobile ? 64 : 128;

function resize() {
  const { dpr, cell } = renderSize(window.innerWidth, window.innerHeight,
    window.devicePixelRatio, cellH, mobile, quality.scale);
  renderer.resize(window.innerWidth, window.innerHeight, dpr, cell * ASPECT, cell);
  fitChunks?.();
}
// Set once the world exists: sizes its chunk cache to the view.
let fitChunks = null;
window.addEventListener('resize', resize);
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
installTouchControls(zoomBy);

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

const params = new URLSearchParams(location.search);
const requestedSeed = Number(params.get('seed'));
const seed = Number.isSafeInteger(requestedSeed) && requestedSeed !== 0 ? requestedSeed : 1;
// Shown above the warrior's head; ?name=... picks another.
let name = cleanName(params.get('name') || 'Kael');
const world = new World(seed, { season: params.get('season') ?? undefined, maxChunks: baseChunks });
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
// For now the outlaw carries only the sword at the hip (and the torch, which
// is not an item); the bag starts empty and nothing can be gathered.
const inventory = new Inventory({ starter: false });
inventory.add('shortSword');
inventory.equip(0);
inventory.assignHotbar(0, 'shortSword');
inventory.events.length = 0;
// Plants in the world: they burn and the sword cuts them, but drop nothing.
const harvesting = new Harvesting(world, null);
player.equipment = inventory.equipment;
const camera = new Camera(spawn.x, spawn.y - 11);
const fireflies = new Fireflies();
const ambience = new Ambience();
const dust = new Dust();
const footprints = new Footprints();
const grass = new Grass();
const splashes = new Splashes();
const fires = new Fires({ resourcesIn: (...bounds) => harvesting.resourcesIn(...bounds) });
fires.addStarter(world);
const torches = new Torches();
const weather = new WeatherEffects({ onImpact: (world, bolt) => fires.ignite(world, bolt.x, bolt.y, { source: 'lightning' }) });
const sound = new GameAudio(world);
sound.weather.onLightning = event => weather.strike(world, camera.view(renderer), event);
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
  if (event.persisted && sound.engine.context) void sound.engine.unlock();
});

// With ?debug in the URL the game state is reachable from the console, and
// setting `freeze` stops the wanderer updating so a pose can be inspected.
const debug = { player, camera, world, grass, splashes, weather, fires, torches, renderer, quality, inventory,
  ambience, fireflies, dust, footprints,
  harvesting,
  audio: sound.engine, sound, freeze: false, metrics: { frames: 0, workMs: 0, intervalMs: 0 } };
if (params.has('debug')) window.game = debug;

// Fade the controls hint once the player has started walking about.
const hint = document.getElementById('hint');
const fireStatus = document.getElementById('fire-status');
const carriedItem = document.getElementById('carried-item');

// The status frames, quick slots and the inventory screen.
const hud = new Hud({
  player, inventory, name, debug: params.has('debug'),
  onSelect: (index) => { selectHotbar(index); canvas.focus({ preventScroll: true }); },
  onInventory: () => inventoryScreen.toggle(),
});
hud.attachNote(carriedItem);
const inventoryScreen = new InventoryScreen({
  inventory, player, name,
  onToggle: (open) => {
    setGameplayBlocked(open);
    clearInput();
    clicked = false;
    mouseHeld = false;
    if (!open) canvas.focus({ preventScroll: true });
  },
  onNotify: (message, kind = 'info') => hud.notify(message, kind),
});
debug.hud = hud;
debug.inventoryScreen = inventoryScreen;

// Friends in a lobby share the world's seed and see one another walk about.
// Joining a lobby on another seed reloads the page into that world.
const remotePlayers = new RemotePlayers();
const multiplayer = new MultiplayerClient({
  getState: () => playerState(player),
  onJoin: (lobby) => {
    if (lobby.seed !== seed) {
      const url = new URL(location.href);
      url.searchParams.set('seed', lobby.seed);
      url.searchParams.set('room', lobby.code);
      try { sessionStorage.setItem('ascii-realm-rejoin', lobby.code); } catch {}
      multiplayer.leave(false);
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
bindMultiplayerControls(multiplayer, {
  name, seed: () => seed,
  onName: (value) => { name = value; hud.setName(value); },
  onDone: () => canvas.focus({ preventScroll: true }),
});
window.addEventListener('pagehide', () => multiplayer.leave(false));
window.addEventListener('pageshow', (event) => { if (event.persisted) multiplayer.leave(); });
const colorOf = (index) => PLAYER_COLORS[index % PLAYER_COLORS.length];
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

// Where a shot or throw would land: the cursor, or a point straight ahead
// within the weapon's range when aiming from the keyboard.
function aimPoint(weapon, draw) {
  const range = (weapon.projectileRange ?? 8) * (0.4 + 0.6 * draw);
  const cursor = pointer && lastFrame ? screenToWorld(pointer, lastFrame, canvas.getBoundingClientRect()) : null;
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
function fireRanged(release, weapon) {
  const kind = isBow(weapon) ? 'arrow' : weapon.type;
  const arrows = inventory.slots.findIndex((stack) => stack?.id === 'arrow');
  if (kind === 'arrow' && arrows < 0) {
    hud.notify('Out of arrows.', 'info');
    return;
  }
  const shot = projectiles.launch({
    x: player.x, y: player.y, h: SCALE * 1.1, aimTarget: aimPoint(weapon, release.draw),
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
let walked = 0;

function fireNotice(message) {
  fireStatus.textContent = message;
  fireStatus.classList.add('visible');
  fireNoticeUntil = time + 3;
}

// A click on the scene swings the sword.
// Holding it down charges a spin.
let clicked = false;
let mouseHeld = false;
// Touches use the on-screen buttons instead.
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.pointerType === 'touch' || builder.enabled || isGameplayBlocked()) return;
  clicked = true;
  mouseHeld = true;
});
window.addEventListener('pointerup', (e) => {
  if (e.button === 0) mouseHeld = false;
});
window.addEventListener('blur', () => {
  mouseHeld = false;
});

let hitStop = 0;

const builder = new SceneryBuilder({ world, player, camera, renderer,
  onModeChange: () => {
    clicked = false;
    mouseHeld = false;
    hitStop = 0;
    player.combat.charge = 0;
    player.combat.queued = null;
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
if (params.has('builder')) builder.setEnabled(true);

// Skeletons rise from the ground around the player and hunt them down.
// ?skeletons=N sets how many may be about at once; 0 leaves the world quiet.
const skeletonCount = Number(params.get('skeletons') ?? 3);
const skeletons = new Skeletons({ seed,
  max: Number.isFinite(skeletonCount) ? Math.max(0, Math.min(8, Math.floor(skeletonCount))) : 3 });
let skeletonFigures = null;
debug.skeletons = skeletons;
// When the player last took a wound; they heal after a breather.
let lastHurt = -Infinity;

// The player's 3D character; until it has loaded the shape-built figure
// stands in. The skeletons are drawn from the same animation library.
let model = null;
ModelFigure.library('assets/ual1.glb').then((gltf) => {
  skeletonFigures = new SkeletonFigures(gltf);
  debug.skeletonFigures = skeletonFigures;
}).catch((e) => console.error('Could not set up the skeletons', e));
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
function drawName(top, color = [212, 218, 228]) {
  if (top === null || top === undefined) return;
  const view = camera.view(renderer);
  const sy = top - 2 - view.y0;
  const sx = Math.floor(player.x - name.length / 2) - view.x0;
  for (let i = 0; i < name.length; i++) {
    renderer.put(sx + i, sy, glyph(name[i]), ...color);
    renderer.putBg(sx + i, sy, 8, 10, 14);
  }
}
// What the skeletons do: their blows on the player, the player's on them,
// and their rising and falling.
function skeletonEvent(e) {
  switch (e.type) {
    case 'hit-player':
      if (player.takeDamage(e.amount) > 0) {
        lastHurt = time;
        camera.shake(0.35);
        sound.play({ type: 'slam', x: player.x, y: player.y, strength: 0.45 });
        dust.burst(world, player.x, player.y, 4, 4);
      }
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
    case 'bone-hit':
      sound.play(e);
      hud.damage(e.amount, e.x, e.y);
      dust.sparks(e.x, e.y - 12, 6);
      break;
    case 'bone-collapse':
      sound.play(e);
      dust.burst(world, e.x, e.y, 14, 8);
      hud.notify(`Skeleton destroyed (${skeletons.kills} slain)`, 'pickup');
      break;
    case 'bone-rise':
      sound.play(e);
      dust.burst(world, e.x, e.y, 12, 6);
      break;
  }
}

// Struck down, the player wakes back where they began, whole again, and the
// dead go back into the ground for a while.
function fallInBattle() {
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vz = 0;
  player.vitals.health = player.vitals.maxHealth;
  camera.x = player.x;
  camera.y = player.y - 11;
  skeletons.clear();
  hud.notify('You were struck down. You wake where you began.', 'info');
}

// A health bar over each skeleton's skull once it has been cut.
function woundedFoes(figures) {
  return figures.filter(({ skeleton: s, top }) => s.alive && s.health < s.maxHealth && top !== null)
    .map(({ skeleton: s, top }) => ({ id: s.id, name: 'Skeleton', health: s.health, maxHealth: s.maxHealth,
      x: s.x, y: top - 1 }));
}

let time = 0;
const clock = new FrameClock();
let animation = null;
let contextLost = false;

function schedule() {
  if (animation === null && !document.hidden && !contextLost) animation = requestAnimationFrame(frame);
}

function suspend() {
  if (animation !== null) cancelAnimationFrame(animation);
  animation = null;
  clock.reset();
  clicked = false;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspend();
  else schedule();
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
  const dt = clock.step(now);
  if (dt === null) { schedule(); return; }
  const started = performance.now();
  time += dt;
  updateZoom(dt);

  for (let index = 0; index < 9; index++) {
    if (wasTapped(`Digit${index + 1}`, `Numpad${index + 1}`)) selectHotbar(index);
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
  canvas.classList.toggle('projectile-aiming', ranged);
  const ammo = isBow(weapon) ? `Arrows ${carriedCount('arrow')}` : isThrown(weapon) ? `${ITEMS[hand.id].name} ×${carriedCount(hand.id)}` : '';
  if (ammoNote.textContent !== ammo) ammoNote.textContent = ammo;
  ammoNote.hidden = !ammo;
  const move = isControlTarget(document.activeElement) ? { x: 0, y: 0 } : moveAxis();
  const jump = wasTapped('Space');
  const attack = wasTapped('KeyJ') || clicked;
  const sword = wasTapped('KeyF');
  const torchKey = wasTapped('KeyT');
  const toss = wasTapped('KeyG');
  const campfire = wasTapped('KeyC');
  if (!builder.enabled && !debug.freeze) {
    if (jump) player.jump();
    if (attack && armed && !ranged) player.attack();
    if (sword && armed) player.toggleSword();
    if (torchKey) fireNotice(torchMessages[torches.toggle(player)]);
    if (toss) fireNotice(torchMessages[torches.throw(player, model?.torchPose())]);
    if (campfire) fireNotice(fireMessages[fires.toggle(world, player)]);
  }
  const itemHint = player.handsFull ? 'Two-handed · torch tucked away'
    : player.torch ? 'Fire torch · G throw · T stow' : 'Empty hand · T draw a fire torch';
  if (carriedItem.textContent !== itemHint) carriedItem.textContent = itemHint;
  if (time > fireNoticeUntil) fireStatus.classList.remove('visible');
  clicked = false;
  const stoppedDt = Math.min(dt, hitStop);
  hitStop -= stoppedDt;
  const playerDt = dt - stoppedDt + stoppedDt * 0.05;
  const held = isDown('KeyJ') || mouseHeld;
  const fromX = player.x, fromY = player.y, fromAir = player.air;
  const paused = debug.freeze || builder.enabled || playerDt === 0;
  // A bow draws while the attack is held and shoots on release; a spear or
  // javelin jabs on a tap and is thrown after a longer hold.
  const release = player.ranged.update(dt, ranged && held && !builder.enabled && !debug.freeze, weapon);
  player.aimTarget = player.ranged.aiming ? aimPoint(weapon, player.ranged.draw) : null;
  if (release?.action === 'jab') player.attack();
  else if (release) fireRanged(release, weapon);
  if (!paused) player.update(playerDt, world, move, isDown('ShiftLeft', 'ShiftRight'), held);
  if (model) {
    if (!paused) model.update(playerDt, player);
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
  remotePlayers.update(dt, now);
  if (!paused) fires.pass(world, player, fromX, fromY, fromAir);
  for (const e of player.events) {
    if (e.type === 'damage') hud.damage(e.amount, e.x, e.y);
    // Each cut can fell a tree a blow at a time or mow tall grass.
    if (e.type === 'strike' && !paused) {
      for (const result of harvesting.react(e, player)) if (result.message) hud.notify(result.message, 'pickup');
      if (skeletons.strike(e, player, player.weapon?.damage ?? 20).length) hitStop = Math.max(hitStop, 0.06);
    }
    if (!debug.freeze) fires.react(world, e, player);
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
    skeletons.update(playerDt, world, player);
    skeletonFigures?.update(playerDt, skeletons.list);
  }
  for (const e of skeletons.events) skeletonEvent(e);
  skeletons.events.length = 0;
  if (!paused && player.vitals.health <= 0) fallInBattle();
  else if (!paused && time - lastHurt > 6) player.heal(5 * playerDt);
  if (!paused) {
    projectiles.update(dt, world);
    for (const impact of projectiles.events) sound.play({ type: 'land', x: impact.x, y: impact.y, strength: 0.25 });
    projectiles.events.length = 0;
    // Walking over a landed arrow or spear picks it up again.
    if (player.air === 0) {
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
  if (move.x || move.y) walked += dt;
  if (walked > 2 || time > 15) hint.classList.add('hidden');
  // Aim at the wanderer's middle rather than their feet.
  if (builder.enabled) builder.updateCamera(dt, move, isDown('ShiftLeft', 'ShiftRight'));
  else camera.follow(player.x, player.y - 11, dt);

  const view = camera.view(renderer);
  weather.update(dt, time, world, view, sound.weather);
  if (wasTapped('KeyL') || summonLightning) {
    const bolt = weather.summon(world, view, player);
    if (bolt) sound.play({ type: 'lightning', x: bolt.x, y: bolt.y, strength: bolt.strength });
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
  drawShadow(renderer, view, player.x, player.y, player.air);
  const peers = remotePlayers.visible(view);
  for (const peer of peers) {
    drawShadow(renderer, view, peer.player.x, peer.player.y, peer.player.air);
    peer.figure = dressFigure(peer.player);
  }

  // Props up to a screen above the view can still be reflected into it, and
  // the tallest trees reach into it from far below.
  const marginX = Math.max(world.propRenderW, MAX_TREE_HALF_WIDTH + MAX_LEAF_DRIFT) + 2;
  const tall = Math.max(world.propRenderH, MAX_TREE_HEIGHT);
  const props = world.propsIn(view.x0 - marginX, view.y0 - Math.max(view.rows, tall + 1) - 1,
    view.x0 + view.cols + marginX, view.y0 + view.rows + tall, wide);
  const mirror = reflector(time, view);
  const visibleFires = fires.prepare(view, time);
  const visibleTorches = torches.prepare(view, time, player, model?.torchPose());
  ambience.update(dt, time, world, view, { lights: lightsOf(visibleFires, visibleTorches), wind: weather.wind });
  // Once the 3D character has loaded it replaces the shape-built figure.
  let figure = null;
  if (model) model.rasterise(view, player.x, player.y);
  else figure = dressFigure(player);
  const boneFigures = skeletonFigures ? skeletonFigures.rasterise(view, skeletons.list, player) : [];
  for (const bones of boneFigures) {
    if (bones.skeleton.alive) drawShadow(renderer, view, bones.skeleton.x, bones.skeleton.y, 0);
  }

  // Match the reveal region to this pose, including a jump or sword swing.
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  if (model) {
    for (const cell of model.cells) {
      left = Math.min(left, cell.sx + view.x0 - player.x);
      right = Math.max(right, cell.sx + view.x0 - player.x);
      top = Math.min(top, cell.sy + view.y0 - player.y);
      bottom = Math.max(bottom, cell.sy + view.y0 - player.y);
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
  const drawables = props.filter((p) => propInView(view, p, false, MAX_LEAF_DRIFT)).map((p) => ({ y: p.y,
    draw: () => {
      drawProp(renderer, view, p, undefined, time, player, seed);
      drawLeaves(renderer, view, p, time, seed);
    } }));
  for (const fire of visibleFires) {
    reflections.push({ y: fire.y, draw: () => fires.draw(renderer, view, fire, time, mirror) });
    drawables.push({ y: fire.y, draw: () => fires.draw(renderer, view, fire, time) });
  }
  for (const torch of visibleTorches) {
    if (torch.carried) continue;
    reflections.push({ y: torch.y, draw: () => torches.draw(renderer, view, torch, mirror) });
    drawables.push({ y: torch.y, draw: () => torches.draw(renderer, view, torch) });
  }
  // Bushes can reach in from below the view or reflect from above it.
  const plants = harvesting.resourcesIn(view.x0 - 9, view.y0 - 12, view.x0 + view.cols + 9,
    view.y0 + view.rows + 12, wide);
  for (const node of plants) {
    reflections.push({ y: node.y, draw: () => drawResource(renderer, view, node, time, mirror) });
    drawables.push({ y: node.y, draw: () => drawResource(renderer, view, node, time) });
  }
  for (const shaft of projectiles.landedDrawables()) {
    drawables.push({ y: shaft.depth, draw: () => shaft.draw(renderer, view) });
  }
  const carried = visibleTorches.filter((torch) => torch.carried);
  reflections.push({ y: player.y, draw: () => {
    if (model) model.draw(renderer, mirror);
    else drawFigure(renderer, view, player, figure, mirror);
    for (const torch of carried) torches.draw(renderer, view, torch, mirror);
  } });
  drawables.push({ y: player.y, draw: () => {
    if (model) model.draw(renderer, putCell);
    else drawFigure(renderer, view, player, figure);
    for (const torch of carried) torches.draw(renderer, view, torch);
  } });
  for (const bones of boneFigures) {
    reflections.push({ y: bones.skeleton.y, draw: () => SkeletonFigures.draw(renderer, bones, mirror) });
    drawables.push({ y: bones.skeleton.y, draw: () => SkeletonFigures.draw(renderer, bones, putCell) });
  }
  // Friends are drawn as the shape-built outlaw in their own gear.
  for (const peer of peers) {
    reflections.push({ y: peer.player.y, draw: () => drawFigure(renderer, view, peer.player, peer.figure, mirror) });
    drawables.push({ y: peer.player.y, draw: () => drawFigure(renderer, view, peer.player, peer.figure) });
  }
  reflections.sort((a, b) => a.y - b.y);
  drawables.sort((a, b) => a.y - b.y);
  grass.drawReflections(renderer, world, view, time, mirror, reflections);

  const contacts = model ? model.waterContacts().map((p) => ({ x: player.x + p.x, y: player.y + p.y })) : [];
  for (const bones of boneFigures) contacts.push(...bones.contacts);
  splashes.drawSurface(renderer, view, time);
  weather.drawSurface(renderer, view, time);
  ambience.drawMist(renderer, view, time);
  grass.drawLayered(renderer, world, view, time, drawables);
  splashes.drawContacts(renderer, view, time, contacts);
  fires.light(renderer, view, time, visibleFires);
  torches.light(renderer, view, time, visibleTorches);
  weather.drawAtmosphere(renderer, view, time);

  projectiles.drawFlying(renderer, view);
  drawTrail(renderer, view, player.trail, player.time);
  const self = multiplayer.room ? multiplayer.players.find((member) => member.id === multiplayer.id) : null;
  const ownColor = self ? colorOf(self.color) : undefined;
  if (model) drawName(model.top, ownColor);
  else drawNameTag(renderer, view, player, figure, name, ownColor);
  for (const peer of peers) {
    drawTrail(renderer, view, peer.player.trail, peer.trailTime);
    drawNameTag(renderer, view, peer.player, peer.figure, peer.name, colorOf(peer.color));
  }
  dust.draw(renderer, view);
  splashes.drawSpray(renderer, view);
  fires.drawParticles(renderer, view);
  fireflies.update(dt, time, world, camera.x, camera.y, view.cols / 2, view.rows / 2);
  fireflies.draw(renderer, view, time);
  ambience.draw(renderer, view, time);
  weather.draw(renderer, view);
  builder.drawPreview(view);
  if (debug.freeze) sound.pause();
  else sound.update(dt, time, player, camera, fireflies.list, fires.list);
  unbindAudio.updateSong();
  renderer.draw(view.offX, view.offY);
  lastFrame = { width: canvas.width, height: canvas.height, cellW: renderer.cellW, cellH: renderer.cellH, view };
  hud.setParty(multiplayer.room ? multiplayer.players.filter((member) => member.id !== multiplayer.id)
    .map((member) => ({ id: member.id, name: member.name, health: member.state.health,
      maxHealth: player.vitals.maxHealth,
      note: `${Math.round(Math.hypot((member.state.x - player.x) * ASPECT / SCALE,
        (member.state.y - player.y) / (SCALE * TILT)))}m` })) : []);
  hud.setFoes(woundedFoes(boneFigures));
  hud.update(dt, { ...view, cellW: renderer.cellW, cellH: renderer.cellH });
  inventoryScreen.update();
  const workMs = performance.now() - started;
  if (quality.sample(workMs, dt)) resize();
  debug.metrics.frames++;
  debug.metrics.workMs = workMs;
  debug.metrics.intervalMs = dt * 1000;
  schedule();
}

schedule();
