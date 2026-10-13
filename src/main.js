import { isDown, isGameplayTarget, moveAxis, wasCancelled, wasTapped } from './core/input.js';
import { dressFigure, drawFigure, drawNameTag, drawShadow, drawTrail } from './entities/figure.js';
import { Player } from './entities/player.js';
import { MATERIAL_IDS, WEAPON_IDS, WEAPON_MATERIALS, WEAPONS } from './entities/weapons.js';
import { buildAtlas } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
import { Camera } from './world/camera.js';
import { Dust } from './world/dust.js';
import { Fireflies } from './world/fireflies.js';
import { Footprints } from './world/footprints.js';
import { drawGround } from './world/ground.js';
import { drawProp } from './world/props.js';
import { Projectiles } from './world/projectiles.js';
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
  if (!isGameplayTarget(e.target)) return;
  e.preventDefault();
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  zoomBy(Math.exp(-Math.max(-200, Math.min(200, px)) * 0.0012));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (!isGameplayTarget(e.target)) return;
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
const projectiles = new Projectiles();

// Every weapon and tier is available here while crafting is developed.
const weaponSelect = document.getElementById('weapon-select');
const materialSelect = document.getElementById('material-select');
const staminaMeter = document.getElementById('stamina');
const staminaValue = document.getElementById('stamina-value');
const weaponStatus = document.getElementById('weapon-status');
const chargeMeter = document.getElementById('charge');
const weaponHelp = document.getElementById('weapon-help');
for (const [index, id] of WEAPON_IDS.entries()) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = `${index + 1}. ${WEAPONS[id].name}`;
  weaponSelect.append(option);
}
for (const id of MATERIAL_IDS) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = WEAPON_MATERIALS[id].name;
  materialSelect.append(option);
}

const HELP = {
  bow: 'Hold J / left click to draw. Release to shoot.',
  staff: 'Hold J / left click to charge. Release to cast.',
  javelin: 'Tap J / left click to thrust. Hold and release to throw.',
  'sword-shield': 'Tap J / left to strike; hold for heavy. Hold K / right to block; tap to parry.',
};
let currentHelp = '';
function updateLoadout() {
  const combat = player.combat;
  if (weaponSelect.value !== combat.weaponId) weaponSelect.value = combat.weaponId;
  if (materialSelect.value !== combat.material) materialSelect.value = combat.material;
  const stamina = Math.max(0, Math.min(combat.maxStamina, combat.stamina));
  staminaMeter.max = combat.maxStamina;
  staminaMeter.value = stamina;
  staminaMeter.textContent = `${Math.round(stamina)} / ${combat.maxStamina}`;
  staminaValue.value = Math.round(stamina);
  const status = combat.blocking ? 'Blocking' : combat.charging ? 'Charging'
    : combat.move === 'draw' ? 'Drawing' : combat.move === 'sheathe' ? 'Sheathing'
      : combat.busy ? 'Attacking' : combat.inHand ? 'Ready' : 'Sheathed';
  if (weaponStatus.textContent !== status) weaponStatus.textContent = status;
  chargeMeter.hidden = !combat.charging;
  chargeMeter.value = combat.charge || 0;
  if (currentHelp !== combat.weaponId) {
    currentHelp = combat.weaponId;
    weaponHelp.textContent = HELP[currentHelp] || 'Tap J / left click to strike. Hold and release for heavy.';
  }
}
weaponSelect.addEventListener('change', () => {
  player.equipWeapon(weaponSelect.value, player.combat.material);
  updateLoadout();
});
materialSelect.addEventListener('change', () => {
  player.equipWeapon(player.combat.weaponId, materialSelect.value);
  updateLoadout();
});
updateLoadout();

// With ?debug in the URL the game state is reachable from the console, and
// setting `freeze` stops the wanderer updating so a pose can be inspected.
const debug = { player, camera, world, projectiles, freeze: false };
if (params.has('debug')) window.game = debug;

// Fade the controls hint once the player has started walking about.
const hint = document.getElementById('hint');
let walked = 0;

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
  const running = isDown('ShiftLeft', 'ShiftRight');
  const held = isDown('KeyJ', 'MouseLeft');
  const blocking = isDown('KeyK', 'MouseRight');
  // Focus loss cancels a drawn bow rather than treating it as a shot release.
  if (wasCancelled()) player.cancelAction();
  for (const [index, id] of WEAPON_IDS.entries()) {
    if (wasTapped(`Digit${index + 1}`)) player.equipWeapon(id, player.combat.material);
  }
  if (wasTapped('BracketLeft')) player.cycleWeapon(-1);
  if (wasTapped('BracketRight')) player.cycleWeapon(1);
  if (wasTapped('KeyM')) player.cycleMaterial(1);
  if (wasTapped('Space')) player.jump();
  if (wasTapped('KeyJ', 'MouseLeft')) player.attack({ moving: !!(move.x || move.y), running, held });
  if (wasTapped('KeyF')) player.toggleSword();
  hitStop = Math.max(0, hitStop - dt);
  const playerDt = hitStop > 0 ? dt * 0.05 : dt;
  if (!debug.freeze) player.update(playerDt, world, move, running, { held, blocking });
  for (const e of player.events) {
    if (e.projectile) projectiles.launch(e);
    if (e.type === 'step') {
      dust.burst(world, e.x, e.y, Math.round(1 + e.strength * 3), 2 + e.strength * 4);
      footprints.add(world, e.x, e.y, time);
    }
    if (e.type === 'land') dust.burst(world, e.x, e.y, Math.round(6 + e.strength * 10), 5 + e.strength * 6);
    if (e.type === 'breath') dust.breath(e.x, e.y, e.h, e.dx, e.dy);
    if (e.type === 'chop') {
      const chopped = world.chopTree(e.x, e.y, e.strength, {
        x: e.originX ?? player.x,
        y: e.originY ?? player.y,
      });
      dust.burst(world, chopped?.x ?? e.x, chopped?.y ?? e.y, chopped ? 12 : 5, chopped ? 7 : 3);
      if (chopped) camera.shake(chopped.felled ? 0.45 : 0.2);
    }
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
  projectiles.update(dt, world);
  for (const e of projectiles.events) {
    if (e.type !== 'impact') continue;
    if (e.kind === 'magic') dust.sparks(e.x, e.y - (e.h || 0), 9);
    else dust.burst(world, e.x, e.y, 4, 3);
  }
  projectiles.events.length = 0;
  dust.update(dt);
  updateLoadout();
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
  projectiles.draw(renderer, view);
  drawNameTag(renderer, view, player, figure, name);
  dust.draw(renderer, view);
  fireflies.update(dt, time, world, camera.x, camera.y, view.cols / 2, view.rows / 2);
  fireflies.draw(renderer, view, time);
  renderer.draw(view.offX, view.offY);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
