import { isDown, moveAxis, wasTapped } from './core/input.js';
import { GameAudio } from './audio/audio.js';
import { bindAudioControls } from './audio/controls.js';
import { dressFigure, drawFigure, drawNameTag, drawShadow, drawTrail } from './entities/figure.js';
import { ModelFigure } from './entities/model.js';
import { Player } from './entities/player.js';
import { putCell } from './render/cells.js';
import { buildAtlas, glyph } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
import { Camera } from './world/camera.js';
import { Dust } from './world/dust.js';
import { Fires } from './world/fire.js';
import { Fireflies } from './world/fireflies.js';
import { Footprints } from './world/footprints.js';
import { drawGround } from './world/ground.js';
import { drawProp } from './world/props.js';
import { reflector } from './world/reflection.js';
import { drawSkyReflection } from './world/sky.js';
import { Splashes } from './world/splashes.js';
import { Torches } from './world/torch.js';
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
  if (e.target.closest?.('#audio-controls')) return;
  e.preventDefault();
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  zoomBy(Math.exp(-Math.max(-200, Math.min(200, px)) * 0.0012));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('#audio-controls')) return;
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
const splashes = new Splashes();
const fires = new Fires();
fires.addStarter(world);
const torches = new Torches();
const sound = new GameAudio(world);
sound.music.update({ night: 1 });
const unbindAudio = bindAudioControls(sound.engine, sound.music, sound.weather, () => sound.pause());
sound.engine.setListener(camera.x, camera.y);
window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    sound.pause();
    void sound.engine.suspend();
  } else {
    unbindAudio();
    void sound.dispose();
  }
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted && sound.engine.context) void sound.engine.unlock();
});

// With ?debug in the URL the game state is reachable from the console, and
// setting `freeze` stops the wanderer updating so a pose can be inspected.
const debug = { player, camera, world, fires, torches, splashes, renderer, audio: sound.engine, sound, freeze: false };
if (params.has('debug')) window.game = debug;

// Fade the controls hint once the player has started walking about.
const hint = document.getElementById('hint');
const fireStatus = document.getElementById('fire-status');
const carriedItem = document.getElementById('carried-item');
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
  water: 'The water put out the torch.',
  blocked: 'The torch went out. Find open ground or put out a fire with C.',
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
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  clicked = true;
  mouseHeld = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseHeld = false;
});
window.addEventListener('blur', () => {
  mouseHeld = false;
});

let hitStop = 0;

// The player's 3D character; until it has loaded the shape-built figure
// stands in.
let model = null;
ModelFigure.load('assets/ual1.glb')
  .then((m) => {
    model = m;
    debug.model = m;
    player.modelTrail = true;
    // Walk a touch quicker than the walking clip, and run at exactly the
    // jog's own ground speed so the feet never slide.
    const gait = Object.fromEntries(m.gaits.map((g) => [g.key, g]));
    player.walkSpeed = gait.walk.speed * 1.3;
    player.runSpeed = gait.jog.speed;
  })
  .catch((e) => console.error('Could not load the character model', e));

// The name floating above the character's head; `top` is the highest row
// the character covers.
function drawName(top) {
  if (top === null || top === undefined) return;
  const view = camera.view(renderer);
  const sy = top - 2 - view.y0;
  const sx = Math.floor(player.x - name.length / 2) - view.x0;
  for (let i = 0; i < name.length; i++) {
    renderer.put(sx + i, sy, glyph(name[i]), 212, 218, 228);
    renderer.putBg(sx + i, sy, 8, 10, 14);
  }
}
let last = performance.now();
let time = 0;

function frame(now) {
  // Clamp dt so a backgrounded tab does not produce one enormous step.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time += dt;
  updateZoom(dt);

  const move = moveAxis();
  if (wasTapped('Space')) player.jump();
  if (wasTapped('KeyJ') || clicked) player.attack();
  if (wasTapped('KeyF')) player.toggleSword();
  if (wasTapped('KeyT') && !debug.freeze) fireNotice(torchMessages[torches.toggle(player)]);
  if (wasTapped('KeyG') && !debug.freeze) fireNotice(torchMessages[torches.throw(player, model?.torchPose())]);
  if (wasTapped('KeyC') && !debug.freeze) fireNotice(fireMessages[fires.toggle(world, player)]);
  const itemHint = player.torch ? 'Fire torch · G throw · T stow' : 'Empty hand · T draw a fire torch';
  if (carriedItem.textContent !== itemHint) carriedItem.textContent = itemHint;
  if (time > fireNoticeUntil) fireStatus.classList.remove('visible');
  clicked = false;
  hitStop = Math.max(0, hitStop - dt);
  const playerDt = hitStop > 0 ? dt * 0.05 : dt;
  const held = isDown('KeyJ') || mouseHeld;
  if (!debug.freeze) player.update(playerDt, world, move, isDown('ShiftLeft', 'ShiftRight'), held);
  if (model) {
    if (!debug.freeze) model.update(playerDt, player);
    // The sword's trail follows the blade of the 3D character.
    player.trail = player.trail.filter((t) => player.time - t.t < 0.16);
    const blade = player.combat.trailing ? model.swordLine() : null;
    if (blade) {
      player.trail.push({ t: player.time, hx: player.x + blade.base[0], hy: player.y + blade.base[1],
        tx: player.x + blade.tip[0], ty: player.y + blade.tip[1] });
    }
  }
  for (const e of player.events) {
    sound.play(e);
    if (e.type === 'step') {
      dust.burst(world, e.x, e.y, Math.round(1 + e.strength * 3), 2 + e.strength * 4);
      footprints.add(world, e.x, e.y, time);
    }
    if (e.type === 'land') dust.burst(world, e.x, e.y, Math.round(6 + e.strength * 10), 5 + e.strength * 6);
    if (e.type === 'breath') dust.breath(e.x, e.y, e.h, e.dx, e.dy);
    if (e.type === 'skid') dust.burst(world, e.x, e.y, 2, 3 + e.strength * 5);
    if (e.type === 'whirl') dust.burst(world, e.x, e.y, 18, 14);
    if (e.type === 'slam') {
      dust.burst(world, e.x, e.y, Math.round(22 * e.strength), 12 * e.strength);
      if (world.typeAt(e.x, e.y) !== GRASS) dust.sparks(e.x, e.y, Math.round(14 * e.strength));
      camera.shake(0.7 * e.strength);
      // Freeze the warrior for a heartbeat as the blow lands, to sell its
      // weight.
      hitStop = 0.08;
    }
  }
  player.events.length = 0;
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
    const blownOut = fires.update(dt, time, world);
    if (blownOut.some(fire => Math.hypot((fire.x - player.x) * ASPECT, fire.y - player.y) < 35)) {
      fireNotice('Strong wind put out the fire.');
    }
  }
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
  const visibleFires = fires.prepare(view, time);
  for (const fire of visibleFires) fires.draw(renderer, view, fire, time, mirror);
  const visibleTorches = torches.prepare(view, time, player, model?.torchPose());
  for (const torch of visibleTorches) torches.draw(renderer, view, torch, mirror);
  // Once the 3D character has loaded it replaces the shape-built figure.
  let figure = null;
  if (model) {
    model.rasterise(view, player.x, player.y);
    model.draw(renderer, mirror);
  } else {
    figure = dressFigure(player);
    drawFigure(renderer, view, player, figure, mirror);
  }

  // Painter's order: whatever stands further down the screen is in front.
  const drawables = props.map((p) => ({ y: p.y, draw: () => drawProp(renderer, view, p) }));
  for (const fire of visibleFires) {
    drawables.push({ y: fire.y, draw: () => fires.draw(renderer, view, fire, time) });
  }
  for (const torch of visibleTorches) {
    if (!torch.carried) drawables.push({ y: torch.y, draw: () => torches.draw(renderer, view, torch) });
  }
  drawables.push({
    y: player.y,
    draw: () => {
      if (model) model.draw(renderer, putCell);
      else drawFigure(renderer, view, player, figure);
      for (const torch of visibleTorches) if (torch.carried) torches.draw(renderer, view, torch);
    },
  });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();
  splashes.drawSurface(renderer, view, time);
  fires.light(renderer, view, time, visibleFires);
  torches.light(renderer, view, time, visibleTorches);

  drawTrail(renderer, view, player.trail, player.time);
  if (model) drawName(model.top);
  else drawNameTag(renderer, view, player, figure, name);
  dust.draw(renderer, view);
  splashes.drawSpray(renderer, view);
  fireflies.update(dt, time, world, camera.x, camera.y, view.cols / 2, view.rows / 2);
  fireflies.draw(renderer, view, time);
  if (debug.freeze) sound.pause();
  else sound.update(dt, time, player, camera, fireflies.list, fires.list);
  unbindAudio.updateSong();
  renderer.draw(view.offX, view.offY);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
