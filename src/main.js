import { isDown, moveAxis, wasTapped } from './core/input.js';
import { installTouchControls } from './core/touch.js';
import { dressFigure, drawFigure, drawNameTag, drawShadow, drawTrail } from './entities/figure.js';
import { Player } from './entities/player.js';
import { buildAtlas } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
import { FrameClock, FrameQuality, renderSize } from './render/budget.js';
import { Camera } from './world/camera.js';
import { Dust } from './world/dust.js';
import { Fireflies } from './world/fireflies.js';
import { Footprints } from './world/footprints.js';
import { drawGround } from './world/ground.js';
import { Grass } from './world/grass.js';
import { drawProp, PROP_HEIGHT, PROP_WIDTH } from './world/props.js';
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
const quality = new FrameQuality(mobile);

function resize() {
  const { dpr, cell } = renderSize(window.innerWidth, window.innerHeight,
    window.devicePixelRatio, cellH, mobile, quality.limit);
  renderer.resize(window.innerWidth, window.innerHeight, dpr, cell * ASPECT, cell);
}
window.addEventListener('resize', resize);
resize();

// Zoom is multiplicative so each notch feels the same at any scale.
function zoomBy(factor) {
  // Start from the displayed scale when an automatic budget has enlarged
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
  e.preventDefault();
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  zoomBy(Math.exp(-Math.max(-200, Math.min(200, px)) * 0.0012));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') zoomBy(1.15);
  if (e.key === '-' || e.key === '_') zoomBy(1 / 1.15);
});

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 1;
// Shown above the warrior's head; ?name=... picks another.
const name = (params.get('name') || 'Kael').slice(0, 24);
const world = new World(seed, mobile ? 64 : 128);
const { spawn } = world;
const player = new Player(spawn.x, spawn.y);
const camera = new Camera(spawn.x, spawn.y - 11);
const fireflies = new Fireflies();
const dust = new Dust();
const footprints = new Footprints();
const grass = new Grass();

// With ?debug in the URL the game state is reachable from the console, and
// setting `freeze` stops the wanderer updating so a pose can be inspected.
const debug = { player, camera, world, grass, renderer, quality, freeze: false,
  metrics: { frames: 0, workMs: 0, intervalMs: 0 } };
if (params.has('debug')) window.game = debug;

// Fade the controls hint once the player has started walking about.
const hint = document.getElementById('hint');
let walked = 0;

// A click on the scene swings the sword.
let clicked = false;
canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 0 && e.pointerType !== 'touch') clicked = true;
});

let hitStop = 0;
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

  const move = moveAxis();
  const jump = wasTapped('Space');
  const strike = wasTapped('KeyJ');
  const draw = wasTapped('KeyF');
  if (!debug.freeze) {
    if (jump) player.jump();
    if (strike || clicked) player.attack();
    if (draw) player.toggleSword();
  }
  clicked = false;
  hitStop = Math.max(0, hitStop - dt);
  const playerDt = hitStop > 0 ? dt * 0.05 : dt;
  if (!debug.freeze) player.update(playerDt, world, move, isDown('ShiftLeft', 'ShiftRight'));
  if (!debug.freeze) grass.update(world, player, time);
  for (const e of player.events) {
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
  dust.update(dt);
  if (move.x || move.y) walked += dt;
  if (walked > 2 || time > 15) hint.classList.add('hidden');
  // Aim at the wanderer's middle rather than their feet.
  camera.follow(player.x, player.y - 11, dt);

  const view = camera.view(renderer);
  drawGround(renderer, world, view, time);
  grass.drawTracks(renderer, view, time);
  drawSkyReflection(renderer, view, time);
  footprints.draw(renderer, view, time);
  drawShadow(renderer, view, player.x, player.y, player.air);

  // Only props within their maximum reach can paint or reflect into the view.
  const props = world.propsIn(view.x0 - PROP_WIDTH, view.y0 - PROP_HEIGHT - 1,
    view.x0 + view.cols + PROP_WIDTH, view.y0 + view.rows + PROP_HEIGHT);

  const mirror = reflector(time, view);
  const figure = dressFigure(player);

  // Painter's order: whatever stands further down the screen is in front.
  const drawables = props.map((p) => ({ y: p.y,
    draw: () => drawProp(renderer, view, p),
    reflect: () => drawProp(renderer, view, p, mirror) }));
  drawables.push({ y: player.y,
    draw: () => drawFigure(renderer, view, player, figure),
    reflect: () => drawFigure(renderer, view, player, figure, mirror) });
  drawables.sort((a, b) => a.y - b.y);
  grass.drawReflections(renderer, world, view, time, mirror,
    drawables.map((d) => ({ y: d.y, draw: d.reflect })));
  grass.drawLayered(renderer, world, view, time, drawables);

  drawTrail(renderer, view, player.trail, player.time);
  drawNameTag(renderer, view, player, figure, name);
  dust.draw(renderer, view);
  fireflies.update(dt, time, world, camera.x, camera.y, view.cols / 2, view.rows / 2);
  fireflies.draw(renderer, view, time);
  renderer.draw(view.offX, view.offY);
  const workMs = performance.now() - started;
  if (quality.sample(workMs, dt)) resize();
  debug.metrics.frames++;
  debug.metrics.workMs = workMs;
  debug.metrics.intervalMs = dt * 1000;
  schedule();
}

schedule();
