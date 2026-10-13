import { isDown, isGameplayBlocked, moveAxis, wasTapped } from './core/input.js';
import { PickupAudio } from './audio/pickup.js';
import { dressFigure, drawFigure, drawNameTag, drawShadow, drawTrail } from './entities/figure.js';
import { Player } from './entities/player.js';
import { Collection } from './inventory/collection.js';
import { Inventory } from './inventory/inventory.js';
import { ITEMS } from './inventory/items.js';
import { buildAtlas } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
import { CollectionUI } from './ui/collection.js';
import { Camera } from './world/camera.js';
import { Dust } from './world/dust.js';
import { Fireflies } from './world/fireflies.js';
import { Footprints } from './world/footprints.js';
import { drawGround } from './world/ground.js';
import { Harvesting } from './world/harvesting.js';
import { drawItem, drawResource } from './world/item-draw.js';
import { GroundItems } from './world/items.js';
import { drawProp } from './world/props.js';
import { reflector } from './world/reflection.js';
import { drawSkyReflection } from './world/sky.js';
import { ASPECT, GRASS, World } from './world/world.js';

const FONT = '"Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace';
// Cell height in CSS px; width follows from ASPECT so the world keeps its shape.
// Zooming sets a target and the cell size glides toward it every frame.
let cellH = 8;
let zoomTarget = cellH;
const MIN_CELL = 6;
const MAX_CELL = 24;

const canvas = document.getElementById('screen');
const renderer = new AsciiRenderer(canvas, buildAtlas(FONT));

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, cellH * ASPECT,
    cellH);
}
window.addEventListener('resize', resize);
resize();

// Zoom is multiplicative so each notch feels the same at any scale.
function zoomBy(factor) {
  zoomTarget = Math.max(MIN_CELL, Math.min(MAX_CELL, zoomTarget * factor));
}

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
  if (isGameplayBlocked() || e.target.closest?.('#collection-ui')) return;
  e.preventDefault();
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  zoomBy(Math.exp(-Math.max(-200, Math.min(200, px)) * 0.0012));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (isGameplayBlocked() || e.defaultPrevented || e.target.closest?.('#collection-ui')) return;
  if (e.key === '+' || e.key === '=') zoomBy(1.15);
  if (e.key === '-' || e.key === '_') zoomBy(1 / 1.15);
});

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 1;
// Shown above the warrior's head; ?name=... picks another.
const name = (params.get('name') || 'Kael').slice(0, 24);
const world = new World(seed);
const { spawn } = world;
const player = new Player(spawn.x, spawn.y);
const camera = new Camera(spawn.x, spawn.y - 11);
const fireflies = new Fireflies();
const dust = new Dust();
const footprints = new Footprints();
const inventory = new Inventory({ starter: false });
const items = new GroundItems(world);
const harvesting = new Harvesting(world, items);
const collection = new Collection(world, inventory, items, harvesting);
const sound = new PickupAudio();
// Capture before the bag's shortcuts consume the event, while activation is live.
const unlockSound = () => { void sound.unlock(); };
window.addEventListener('pointerdown', unlockSound);
window.addEventListener('keydown', unlockSound, true);
const ui = new CollectionUI(inventory, {
  onDrop: (index) => {
    if (!debug.freeze) showResult(collection.drop(player, index));
  },
  onMute: () => sound.setMuted(!sound.muted),
  isMuted: () => sound.muted,
});

window.addEventListener('blur', () => sound.pause());
window.addEventListener('pagehide', (event) => {
  sound.pause();
  if (!event.persisted) void sound.dispose();
});

function showResult(result) {
  if (result?.message && result.status !== 'picked') ui.toast(result.message);
}

// With ?debug in the URL the game state is reachable from the console, and
// setting `freeze` stops the wanderer updating so a pose can be inspected.
const debug = { player, camera, world, inventory, items, harvesting, collection, ui, sound, renderer, freeze: false };
if (params.has('debug')) window.game = debug;

// Fade the controls hint once the player has started walking about.
const hint = document.getElementById('hint');
let walked = 0;

// A click on the scene swings the sword.
let clicked = false;
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && !isGameplayBlocked() && !debug.freeze) clicked = true;
});
window.addEventListener('blur', () => { clicked = false; });

let hitStop = 0;
let last = performance.now();
let time = 0;

function frame(now) {
  // Clamp dt so a backgrounded tab does not produce one enormous step.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time += dt;
  updateZoom(dt);

  const move = moveAxis();
  const blocked = isGameplayBlocked();
  if (!debug.freeze && !blocked) {
    if (wasTapped('Space')) player.jump();
    if (wasTapped('KeyJ') || clicked) player.attack();
    if (wasTapped('KeyF')) player.toggleSword();
    if (wasTapped('KeyQ')) showResult(collection.drop(player, ui.selectedSlot));
  } else {
    // A press made during a debug freeze must not act after it ends.
    wasTapped('Space', 'KeyJ', 'KeyF', 'KeyQ', 'KeyE');
  }
  clicked = false;
  hitStop = Math.max(0, hitStop - dt);
  const playerDt = hitStop > 0 ? dt * 0.05 : dt;
  if (!debug.freeze) player.update(playerDt, world, move, isDown('ShiftLeft', 'ShiftRight'));
  for (const e of player.events) {
    if (e.type === 'strike' && !blocked) {
      for (const result of harvesting.react(e, player)) {
        if (result.message) ui.toast(result.message);
      }
    }
    if (e.type === 'step') {
      dust.burst(world, e.x, e.y, Math.round(1 + e.strength * 3), 2 + e.strength * 4);
      footprints.add(world, e.x, e.y, time);
    }
    if (e.type === 'land') dust.burst(world, e.x, e.y, Math.round(6 + e.strength * 10), 5 + e.strength * 6);
    if (e.type === 'breath') dust.breath(e.x, e.y, e.h, e.dx, e.dy);
    if (e.type === 'slam') {
      dust.burst(world, e.x, e.y, 22, 12);
      if (world.typeAt(e.x, e.y) !== GRASS) dust.sparks(e.x, e.y, 14);
      camera.shake(0.7);
      // Freeze the warrior for a heartbeat as the blow lands, to sell its
      // weight.
      hitStop = 0.08;
    }
  }
  player.events.length = 0;
  if (!debug.freeze) {
    collection.update(dt, player, { blocked });
    if (!blocked && wasTapped('KeyE')) showResult(collection.interact(player));
  }
  for (const event of collection.events) {
    if (event.type !== 'pickup') continue;
    player.animatePickup();
    sound.play(event);
    ui.toast(`+${event.count} ${ITEMS[event.id].name}`);
  }
  collection.events.length = 0;
  inventory.events.length = 0;
  ui.update({ prompt: blocked ? '' : collection.prompt(player), time });
  dust.update(dt);
  if (move.x || move.y) walked += dt;
  if (walked > 2 || time > 15) hint.classList.add('hidden');
  // Aim at the wanderer's middle rather than their feet.
  camera.follow(player.x, player.y - 11, dt);

  const view = camera.view(renderer);
  drawGround(renderer, world, view, time, player);
  drawSkyReflection(renderer, view, time);
  footprints.draw(renderer, view, time);
  drawShadow(renderer, view, player.x, player.y, player.air);

  // Props up to a screen above the view can still be reflected into it.
  const props = world.propsIn(view.x0 - 30, view.y0 - view.rows, view.x0 + view.cols + 30,
    view.y0 + view.rows + 50);
  const visibleItems = items.in(view.x0 - 3, view.y0 - 4, view.x0 + view.cols + 3,
    view.y0 + view.rows + 3);
  // Bushes can extend into the view from below or reflect from above it.
  const resources = harvesting.resourcesIn(view.x0 - 9, view.y0 - 12,
    view.x0 + view.cols + 9, view.y0 + view.rows + 12);

  const mirror = reflector(time, view);
  for (const p of props) drawProp(renderer, view, p, mirror);
  for (const item of visibleItems) drawItem(renderer, view, item, time, mirror);
  for (const node of resources) drawResource(renderer, view, node, time, mirror);
  const figure = dressFigure(player);
  drawFigure(renderer, view, player, figure, mirror);

  // Painter's order: whatever stands further down the screen is in front.
  const drawables = props.map((p) => ({ y: p.y, draw: () => drawProp(renderer, view, p) }));
  for (const item of visibleItems) {
    drawables.push({ y: item.y, draw: () => drawItem(renderer, view, item, time) });
  }
  for (const node of resources) {
    drawables.push({ y: node.y, draw: () => drawResource(renderer, view, node, time) });
  }
  drawables.push({ y: player.y, draw: () => drawFigure(renderer, view, player, figure) });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  drawTrail(renderer, view, player.trail, player.time);
  drawNameTag(renderer, view, player, figure, name);
  dust.draw(renderer, view);
  fireflies.update(dt, time, world, camera.x, camera.y, view.cols / 2, view.rows / 2);
  fireflies.draw(renderer, view, time);
  renderer.draw(view.offX, view.offY);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
