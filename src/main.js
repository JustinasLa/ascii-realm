import { clearInput, isDown, isGameplayBlocked, moveAxis, setGameplayBlocked, wasTapped } from './core/input.js';
import { dressFigure, drawFigure, drawNameTag, drawShadow, drawTrail } from './entities/figure.js';
import { Player } from './entities/player.js';
import { Inventory } from './inventory/inventory.js';
import { ITEMS } from './inventory/items.js';
import { buildAtlas } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
import { Hud } from './ui/hud.js';
import { InventoryScreen } from './ui/inventory.js';
import { Camera } from './world/camera.js';
import { Dust } from './world/dust.js';
import { Fireflies } from './world/fireflies.js';
import { Footprints } from './world/footprints.js';
import { drawGround } from './world/ground.js';
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
canvas.tabIndex = 0;
canvas.setAttribute('aria-label', 'ASCII world. Press I or Tab to open your inventory.');
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

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 1;
// Shown above the warrior's head; ?name=... picks another.
const name = (params.get('name') || 'Kael').slice(0, 24);
const world = new World(seed);
const { spawn } = world;
const player = new Player(spawn.x, spawn.y);
const inventory = new Inventory();
player.equipment = inventory.equipment;
const camera = new Camera(spawn.x, spawn.y - 11);
const fireflies = new Fireflies();
const dust = new Dust();
const footprints = new Footprints();

let clicked = false;
let wheelAt = -Infinity;
let swordEquipped = inventory.equipment.mainHand?.id === 'greatsword';
const hud = new Hud({
  player, inventory, name, debug: params.has('debug'),
  onSelect: (index) => { selectHotbar(index); canvas.focus({ preventScroll: true }); },
  onInventory: () => inventoryScreen.toggle(),
});
const inventoryScreen = new InventoryScreen({
  inventory, player, name,
  onToggle: (open) => {
    setGameplayBlocked(open);
    clearInput();
    clicked = false;
    wheelAt = -Infinity;
    if (!open) canvas.focus({ preventScroll: true });
  },
  onNotify: (message, kind = 'info') => hud.notify(message, kind),
});

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

function hasSelectedSword() {
  return inventory.equipment.mainHand?.id === 'greatsword'
    && inventory.getHotbar()?.item.id === 'greatsword';
}

function isGameEvent(event) {
  const target = event.target;
  return !event.defaultPrevented && !isGameplayBlocked()
    && !target?.isContentEditable
    && !target?.closest?.('input, textarea, select, button, a[href], [contenteditable="true"], [role="button"]');
}

// Scroll selects a quick slot; Ctrl-scroll keeps the world's smooth zoom.
// A short debounce turns a trackpad gesture into deliberate slot changes.
window.addEventListener('wheel', (e) => {
  if (!isGameEvent(e) || !e.deltaY || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  e.preventDefault();
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  if (e.ctrlKey) {
    zoomBy(Math.exp(-Math.max(-200, Math.min(200, px)) * 0.0012));
  } else if (performance.now() - wheelAt >= 100) {
    wheelAt = performance.now();
    inventory.cycleHotbar(Math.sign(px));
    selectHotbar(inventory.selectedHotbar);
  }
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (!isGameEvent(e)) return;
  if (e.key === '+' || e.key === '=') zoomBy(1.15);
  if (e.key === '-' || e.key === '_') zoomBy(1 / 1.15);
});

// With ?debug in the URL the game state is reachable from the console, and
// setting `freeze` stops the wanderer updating so a pose can be inspected.
const debug = {
  player, camera, world, inventory, hud, inventoryScreen, freeze: false,
  pickup: (id, count = 1) => inventory.add(id, count),
};
if (params.has('debug')) window.game = debug;

// Fade the controls hint once the player has started walking about.
const hint = document.getElementById('hint');
let walked = 0;

// A click on the scene swings the sword.
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || isGameplayBlocked()) return;
  canvas.focus({ preventScroll: true });
  clicked = true;
});
window.addEventListener('blur', () => { clicked = false; });
document.addEventListener('visibilitychange', () => { if (document.hidden) clicked = false; });

let hitStop = 0;
let last = performance.now();
let time = 0;

function frame(now) {
  // Clamp dt so a backgrounded tab does not produce one enormous step.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time += dt;
  updateZoom(dt);

  for (let index = 0; index < 9; index++) {
    if (wasTapped(`Digit${index + 1}`, `Numpad${index + 1}`)) selectHotbar(index);
  }
  if (wasTapped('KeyQ', 'Enter', 'NumpadEnter')) useHotbar();
  // Hotbar selection can replace equipment. Cancel the previous weapon
  // before its queued swing updates, while the world keeps running.
  const equipped = inventory.equipment.mainHand?.id === 'greatsword';
  if (swordEquipped && !equipped) player.cancelWeapon();
  swordEquipped = equipped;
  const move = moveAxis();
  if (wasTapped('Space')) player.jump();
  if ((wasTapped('KeyJ') || clicked) && hasSelectedSword() && !isGameplayBlocked()) player.attack();
  if (wasTapped('KeyF') && hasSelectedSword()) player.toggleSword();
  clicked = false;
  hitStop = Math.max(0, hitStop - dt);
  const playerDt = hitStop > 0 ? dt * 0.05 : dt;
  if (!debug.freeze) player.update(playerDt, world, move, isDown('ShiftLeft', 'ShiftRight'), dt);
  for (const e of player.events) {
    if (e.type === 'step') {
      dust.burst(world, e.x, e.y, Math.round(1 + e.strength * 3), 2 + e.strength * 4);
      footprints.add(world, e.x, e.y, time);
    }
    if (e.type === 'land') dust.burst(world, e.x, e.y, Math.round(6 + e.strength * 10), 5 + e.strength * 6);
    if (e.type === 'breath') dust.breath(e.x, e.y, e.h, e.dx, e.dy);
    if (e.type === 'damage') hud.damage(e.amount, e.x, e.y);
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
  for (const event of inventory.events) {
    if (event.type === 'pickup') hud.notify(`+${event.count} ${ITEMS[event.id].name}`, 'pickup');
  }
  inventory.events.length = 0;
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

  const mirror = reflector(time, view);
  for (const p of props) drawProp(renderer, view, p, mirror);
  const figure = dressFigure(player);
  drawFigure(renderer, view, player, figure, mirror);

  // Painter's order: whatever stands further down the screen is in front.
  const drawables = props.map((p) => ({ y: p.y, draw: () => drawProp(renderer, view, p) }));
  drawables.push({ y: player.y, draw: () => drawFigure(renderer, view, player, figure) });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  drawTrail(renderer, view, player.trail, player.time);
  drawNameTag(renderer, view, player, figure, name);
  dust.draw(renderer, view);
  fireflies.update(dt, time, world, camera.x, camera.y, view.cols / 2, view.rows / 2);
  fireflies.draw(renderer, view, time);
  renderer.draw(view.offX, view.offY);
  hud.update(dt, { ...view, cellW: renderer.cellW, cellH: renderer.cellH });
  inventoryScreen.update();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
