import { buildAtlas, glyph } from './render/glyphs.js';
import { AsciiRenderer } from './render/renderer.js';

const FONT = '"Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace';
const CELL_W = 7;
const CELL_H = 12;

const canvas = document.getElementById('screen');
const renderer = new AsciiRenderer(canvas, buildAtlas(FONT));

function resize() {
  renderer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1, CELL_W,
    CELL_H);
}
window.addEventListener('resize', resize);
resize();

// Temporary test card until the world exists: a scrolling plasma of glyphs.
const RAMP = ' .:-=+*#%@';

function drawTestCard(t) {
  renderer.clear(4, 5, 9);
  for (let y = 0; y < renderer.rows; y++) {
    for (let x = 0; x < renderer.cols; x++) {
      const v = Math.sin(x * 0.08 + t) + Math.sin(y * 0.13 - t * 0.7) +
        Math.sin((x + y) * 0.05 + t * 0.4);
      const n = (v + 3) / 6;
      const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(n * RAMP.length))];
      renderer.put(x, y, glyph(ch), 60 + n * 120, 140 + n * 100, 90 + n * 60);
    }
  }
}

let last = performance.now();
let time = 0;

function frame(now) {
  // Clamp dt so a backgrounded tab does not produce one enormous step.
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time += dt;
  drawTestCard(time);
  renderer.draw();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
