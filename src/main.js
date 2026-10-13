import { isDown, isUiTarget, moveAxis, wasTapped } from './core/input.js';
import { dressFigure, drawFigure, drawNameTag, drawShadow, drawTrail } from './entities/figure.js';
import { Player } from './entities/player.js';
import { MultiplayerClient } from './multiplayer/client.js';
import { bindMultiplayerControls } from './multiplayer/controls.js';
import { cleanName, cleanSeed, playerState, PLAYER_COLORS } from './multiplayer/protocol.js';
import { RemotePlayers } from './multiplayer/remote-players.js';
import { buildAtlas } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
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
  if (isUiTarget(e.target)) return;
  e.preventDefault();
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  zoomBy(Math.exp(-Math.max(-200, Math.min(200, px)) * 0.0012));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (isUiTarget(e.target)) return;
  if (e.key === '+' || e.key === '=') zoomBy(1.15);
  if (e.key === '-' || e.key === '_') zoomBy(1 / 1.15);
});

const params = new URLSearchParams(location.search);
const seed = cleanSeed(params.has('seed') ? Number(params.get('seed')) : 1);
// Shown above the warrior's head; ?name=... picks another.
let name = cleanName(params.get('name') || 'Kael');
let world = new World(seed);
const { spawn } = world;
let player = new Player(spawn.x, spawn.y);
const camera = new Camera(spawn.x, spawn.y - 11);
const fireflies = new Fireflies();
const dust = new Dust();
const footprints = new Footprints();

// With ?debug in the URL the game state is reachable from the console, and
// setting `freeze` stops the wanderer updating so a pose can be inspected.
const debug = { player, camera, world, freeze: false };
if (params.has('debug')) window.game = debug;

const remotePlayers = new RemotePlayers();
const multiplayer = new MultiplayerClient({
  getState: () => playerState(player),
  onJoin: (lobby) => {
    if (!lobby.resumed) {
      world = new World(lobby.seed);
      player = new Player(lobby.self.state.x, lobby.self.state.y);
      camera.x = player.x;
      camera.y = player.y - 11;
      dust.list.length = 0;
      footprints.list.length = 0;
      hitStop = 0;
      debug.world = world;
      debug.player = player;
    }
    name = lobby.self.name;
  },
  onSnapshot: (members, selfId) => remotePlayers.sync(members, selfId),
});
debug.multiplayer = multiplayer;
debug.remotePlayers = remotePlayers;
bindMultiplayerControls(multiplayer, { name, seed: () => world.seed, onName: (value) => { name = value; } });
window.addEventListener('pagehide', () => multiplayer.leave(false));
window.addEventListener('pageshow', (event) => { if (event.persisted) multiplayer.leave(); });

// Fade the controls hint once the player has started walking about.
const hint = document.getElementById('hint');
let walked = 0;

// A click on the scene swings the sword.
let clicked = false;
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0) clicked = true;
});

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
  if (wasTapped('Space')) player.jump();
  if (wasTapped('KeyJ') || clicked) player.attack();
  if (wasTapped('KeyF')) player.toggleSword();
  clicked = false;
  hitStop = Math.max(0, hitStop - dt);
  const playerDt = hitStop > 0 ? dt * 0.05 : dt;
  if (!debug.freeze) player.update(playerDt, world, move, isDown('ShiftLeft', 'ShiftRight'));
  remotePlayers.update(dt, now);
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
  const worldTime = multiplayer.worldTime(time);
  const peers = remotePlayers.visible(view);
  drawGround(renderer, world, view, worldTime, [player, ...peers.map((peer) => peer.player)]);
  drawSkyReflection(renderer, view, worldTime);
  footprints.draw(renderer, view, time);
  drawShadow(renderer, view, player.x, player.y, player.air);
  for (const peer of peers) drawShadow(renderer, view, peer.player.x, peer.player.y, peer.player.air);

  // Props up to a screen above the view can still be reflected into it.
  const props = world.propsIn(view.x0 - 30, view.y0 - view.rows, view.x0 + view.cols + 30,
    view.y0 + view.rows + 50);

  const mirror = reflector(worldTime, view);
  for (const p of props) drawProp(renderer, view, p, mirror);
  const figure = dressFigure(player);
  drawFigure(renderer, view, player, figure, mirror);
  for (const peer of peers) {
    peer.figure = dressFigure(peer.player);
    drawFigure(renderer, view, peer.player, peer.figure, mirror);
  }

  // Painter's order: whatever stands further down the screen is in front.
  const drawables = props.map((p) => ({ y: p.y, draw: () => drawProp(renderer, view, p) }));
  drawables.push({ y: player.y, draw: () => drawFigure(renderer, view, player, figure) });
  for (const peer of peers) {
    drawables.push({ y: peer.player.y, draw: () => drawFigure(renderer, view, peer.player, peer.figure) });
  }
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();

  drawTrail(renderer, view, player.trail, player.time);
  const ownColor = multiplayer.players.find((member) => member.id === multiplayer.id)?.color;
  drawNameTag(renderer, view, player, figure, name, PLAYER_COLORS[ownColor]);
  for (const peer of peers) {
    drawTrail(renderer, view, peer.player.trail, peer.trailTime);
    drawNameTag(renderer, view, peer.player, peer.figure, peer.name, PLAYER_COLORS[peer.color]);
  }
  dust.draw(renderer, view);
  fireflies.update(dt, worldTime, world, camera.x, camera.y, view.cols / 2, view.rows / 2);
  fireflies.draw(renderer, view, worldTime);
  renderer.draw(view.offX, view.offY);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
