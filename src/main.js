import { isDown, moveAxis } from './core/input.js';
import { drawFigure, drawShadow } from './entities/figure.js';
import { Player } from './entities/player.js';
import { buildAtlas } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
import { Camera } from './world/camera.js';
import { drawGround } from './world/ground.js';
import { World } from './world/world.js';

const FONT = '"Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace';
const CELL_W = 6;
const CELL_H = 10;

const canvas = document.getElementById('screen');
const renderer = new AsciiRenderer(canvas, buildAtlas(FONT));

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, CELL_W,
    CELL_H);
}
window.addEventListener('resize', resize);
resize();

const seed = Number(new URLSearchParams(location.search).get('seed')) || 1;
const world = new World(seed);
const spawn = world.findSpawn();
const player = new Player(spawn.x, spawn.y);
const camera = new Camera(spawn.x, spawn.y - 6);

let last = performance.now();
let time = 0;

function frame(now) {
  // Clamp dt so a backgrounded tab does not produce one enormous step.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time += dt;

  player.update(dt, world, moveAxis(), isDown('ShiftLeft', 'ShiftRight'));
  // Aim at the wanderer's middle rather than their feet.
  camera.follow(player.x, player.y - 6, dt);

  const view = camera.view(renderer);
  drawGround(renderer, world, view, time, player);
  drawShadow(renderer, view, player.x, player.y);
  drawFigure(renderer, view, player);
  renderer.draw(view.offX, view.offY);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
