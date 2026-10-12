import { isDown, moveAxis } from './core/input.js';
import { drawFigure, drawShadow } from './entities/figure.js';
import { Player } from './entities/player.js';
import { buildAtlas } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';
import { Camera } from './world/camera.js';
import { drawGround } from './world/ground.js';
import { drawProp } from './world/props.js';
import { drawSkyReflection } from './world/sky.js';
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
const { spawn } = world;
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
  drawSkyReflection(renderer, time);
  drawShadow(renderer, view, player.x, player.y);

  // Painter's order: whatever stands further down the screen is in front.
  const props = world.propsIn(view.x0 - 16, view.y0 - 4, view.x0 + view.cols + 16, view.y0 + view.rows + 30);
  const drawables = props.map((p) => ({ y: p.y, draw: () => drawProp(renderer, view, p) }));
  drawables.push({ y: player.y, draw: () => drawFigure(renderer, view, player) });
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.draw();
  renderer.draw(view.offX, view.offY);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
