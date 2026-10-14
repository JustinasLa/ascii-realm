import { isControlTarget, isDown, moveAxis, wasTapped } from './core/input.js';
import { SceneryBuilder } from './editor/builder.js';
import { GameAudio } from './audio/audio.js';
import { bindAudioControls } from './audio/controls.js';
import { installTouchControls } from './core/touch.js';
import { dressFigure, drawFigure, drawNameTag, drawShadow, drawTrail } from './entities/figure.js';
import { ModelFigure } from './entities/model.js';
import { Player } from './entities/player.js';
import { putCell } from './render/cells.js';
import { buildAtlas, glyph } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
import { FrameClock, FrameQuality, renderSize } from './render/budget.js';
import { Camera } from './world/camera.js';
import { Dust } from './world/dust.js';
import { Fires } from './world/fire.js';
import { Fireflies } from './world/fireflies.js';
import { Footprints } from './world/footprints.js';
import { drawGround } from './world/ground.js';
import { Grass } from './world/grass.js';
import { drawLeaves, MAX_LEAF_DRIFT } from './world/leaves.js';
import { drawProp, propInView } from './world/props.js';
import { reflector } from './world/reflection.js';
import { drawSkyReflection } from './world/sky.js';
import { Splashes } from './world/splashes.js';
import { Torches } from './world/torch.js';
import { MAX_TREE_HALF_WIDTH, MAX_TREE_HEIGHT } from './world/trees.js';
import { WeatherEffects } from './world/weather.js';
import { ASPECT, GRASS, WATER, World } from './world/world.js';

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
const quality = new FrameQuality();

function resize() {
  const { dpr, cell } = renderSize(window.innerWidth, window.innerHeight,
    window.devicePixelRatio, cellH, mobile, quality.scale);
  renderer.resize(window.innerWidth, window.innerHeight, dpr, cell * ASPECT, cell);
}
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
const name = (params.get('name') || 'Kael').slice(0, 24);
const world = new World(seed, { season: params.get('season') ?? undefined, maxChunks: mobile ? 64 : 128 });
const { spawn } = world;
const player = new Player(spawn.x, spawn.y);
const camera = new Camera(spawn.x, spawn.y - 11);
const fireflies = new Fireflies();
const dust = new Dust();
const footprints = new Footprints();
const grass = new Grass();
const splashes = new Splashes();
const fires = new Fires();
fires.addStarter(world);
const torches = new Torches();
const weather = new WeatherEffects({ onImpact: (world, bolt) => fires.ignite(world, bolt.x, bolt.y) });
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
const debug = { player, camera, world, grass, splashes, weather, fires, torches, renderer, quality,
  audio: sound.engine, sound, freeze: false, metrics: { frames: 0, workMs: 0, intervalMs: 0 } };
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
  fed: 'The torch landed in a fire that was already burning.',
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
// Touches use the on-screen buttons instead.
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.pointerType === 'touch' || builder.enabled) return;
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

// The player's 3D character; until it has loaded the shape-built figure
// stands in.
let model = null;
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

  const move = isControlTarget(document.activeElement) ? { x: 0, y: 0 } : moveAxis();
  const jump = wasTapped('Space');
  const attack = wasTapped('KeyJ') || clicked;
  const sword = wasTapped('KeyF');
  const torchKey = wasTapped('KeyT');
  const toss = wasTapped('KeyG');
  const campfire = wasTapped('KeyC');
  if (!builder.enabled && !debug.freeze) {
    if (jump) player.jump();
    if (attack) player.attack();
    if (sword) player.toggleSword();
    if (torchKey) fireNotice(torchMessages[torches.toggle(player)]);
    if (toss) fireNotice(torchMessages[torches.throw(player, model?.torchPose())]);
    if (campfire) fireNotice(fireMessages[fires.toggle(world, player)]);
  }
  const itemHint = player.torch ? 'Fire torch · G throw · T stow' : 'Empty hand · T draw a fire torch';
  if (carriedItem.textContent !== itemHint) carriedItem.textContent = itemHint;
  if (time > fireNoticeUntil) fireStatus.classList.remove('visible');
  clicked = false;
  const stoppedDt = Math.min(dt, hitStop);
  hitStop -= stoppedDt;
  const playerDt = dt - stoppedDt + stoppedDt * 0.05;
  const held = isDown('KeyJ') || mouseHeld;
  const fromX = player.x, fromY = player.y, fromAir = player.air;
  const paused = debug.freeze || builder.enabled || playerDt === 0;
  if (!paused) player.update(playerDt, world, move, isDown('ShiftLeft', 'ShiftRight'), held);
  if (model) {
    if (!paused) model.update(playerDt, player);
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
  if (!paused) fires.pass(world, player, fromX, fromY, fromAir);
  for (const e of player.events) {
    if (!debug.freeze) fires.react(world, e, player);
    sound.play(e);
    splashes.react(world, e);
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
      const surface = world.typeAt(e.x, e.y);
      if (surface !== GRASS && surface !== WATER) dust.sparks(e.x, e.y, Math.round(14 * e.strength));
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
  if (blownOut.some(fire => Math.hypot((fire.x - player.x) * ASPECT, fire.y - player.y) < 35)) {
    fireNotice('Strong wind put out the fire.');
  }
  drawGround(renderer, world, view, time, player, weather.wind);
  grass.drawTracks(renderer, view, time);
  drawSkyReflection(renderer, view, time);
  footprints.draw(renderer, view, time);
  drawShadow(renderer, view, player.x, player.y, player.air);

  // Props up to a screen above the view can still be reflected into it, and
  // the tallest trees reach into it from far below.
  const marginX = Math.max(world.propRenderW, MAX_TREE_HALF_WIDTH + MAX_LEAF_DRIFT) + 2;
  const tall = Math.max(world.propRenderH, MAX_TREE_HEIGHT);
  const props = world.propsIn(view.x0 - marginX, view.y0 - Math.max(view.rows, tall + 1) - 1,
    view.x0 + view.cols + marginX, view.y0 + view.rows + tall);
  const mirror = reflector(time, view);
  const visibleFires = fires.prepare(view, time);
  const visibleTorches = torches.prepare(view, time, player, model?.torchPose());
  // Once the 3D character has loaded it replaces the shape-built figure.
  let figure = null;
  if (model) model.rasterise(view, player.x, player.y);
  else figure = dressFigure(player);

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
  reflections.sort((a, b) => a.y - b.y);
  drawables.sort((a, b) => a.y - b.y);
  grass.drawReflections(renderer, world, view, time, mirror, reflections);

  const contacts = model ? model.waterContacts().map((p) => ({ x: player.x + p.x, y: player.y + p.y })) : [];
  splashes.drawSurface(renderer, view, time);
  weather.drawSurface(renderer, view, time);
  grass.drawLayered(renderer, world, view, time, drawables);
  splashes.drawContacts(renderer, view, time, contacts);
  fires.light(renderer, view, time, visibleFires);
  torches.light(renderer, view, time, visibleTorches);
  weather.drawAtmosphere(renderer, view, time);

  drawTrail(renderer, view, player.trail, player.time);
  if (model) drawName(model.top);
  else drawNameTag(renderer, view, player, figure, name);
  dust.draw(renderer, view);
  splashes.drawSpray(renderer, view);
  fires.drawParticles(renderer, view);
  fireflies.update(dt, time, world, camera.x, camera.y, view.cols / 2, view.rows / 2);
  fireflies.draw(renderer, view, time);
  weather.draw(renderer, view);
  builder.drawPreview(view);
  if (debug.freeze) sound.pause();
  else sound.update(dt, time, player, camera, fireflies.list, fires.list);
  unbindAudio.updateSong();
  renderer.draw(view.offX, view.offY);
  const workMs = performance.now() - started;
  if (quality.sample(workMs, dt)) resize();
  debug.metrics.frames++;
  debug.metrics.workMs = workMs;
  debug.metrics.intervalMs = dt * 1000;
  schedule();
}

schedule();
