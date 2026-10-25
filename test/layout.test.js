import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FRAME_BIAS, gridSize, LANDSCAPE_QUERY, orientationOf, PHONE_CELL_BUDGET, PHONE_ZOOM, phoneDefaultCell,
  watchLayout, ZoomSlots } from '../src/core/layout.js';
import { Camera } from '../src/world/camera.js';
import { PHONE_QUERY } from '../src/core/phone.js';

test('wider than tall is landscape; square counts as portrait', () => {
  assert.equal(orientationOf({ width: 852, height: 393 }), 'landscape');
  assert.equal(orientationOf({ width: 393, height: 852 }), 'portrait');
  assert.equal(orientationOf({ width: 500, height: 500 }), 'portrait');
});

test('the grid holds whole cells plus a spare row and column', () => {
  assert.deepEqual(gridSize(393, 852, 6.5), { cols: 102, rows: 133 });
  assert.deepEqual(gridSize(100, 60, 10, 5), { cols: 21, rows: 7 });
});

test('phones default to their orientation zoom, raised only to stay within the cell budget', () => {
  assert.equal(phoneDefaultCell('portrait', 393, 852), PHONE_ZOOM.portrait);
  assert.equal(phoneDefaultCell('landscape', 852, 393), PHONE_ZOOM.landscape);
  assert.equal(phoneDefaultCell('landscape', 667, 375), 6);
  const big = phoneDefaultCell('landscape', 915, 412);
  assert.ok(big > 6 && big < 6.5, `Pixel 8 landscape ${big}`);
  for (const [w, h] of [[915, 412], [932, 430], [412, 915], [852, 393]]) {
    const o = orientationOf({ width: w, height: h });
    const cell = phoneDefaultCell(o, w, h);
    // The renderer's own grid, with the device-pixel rounding it may add.
    const { cols, rows } = gridSize(w + 0.5, h + 0.5, cell);
    assert.ok(cols * rows <= PHONE_CELL_BUDGET, `${w}x${h}: ${cols * rows}`);
    const { cols: c2, rows: r2 } = gridSize(w + 0.5, h + 0.5, cell - 0.05);
    assert.ok(cell === PHONE_ZOOM[o] || c2 * r2 > PHONE_CELL_BUDGET, `${w}x${h} is raised no further than needed`);
  }
});

test('zoom slots remember a value per orientation', () => {
  const slots = new ZoomSlots({ portrait: null, landscape: null });
  assert.equal(slots.get('portrait'), null);
  slots.set('portrait', 9);
  assert.equal(slots.get('portrait'), 9);
  assert.equal(slots.get('landscape'), null);
});

function fakeWindow({ width = 393, height = 852, query = true, screen = true } = {}) {
  const frames = [];
  const landscape = Object.assign(new EventTarget(), { matches: width > height });
  const orientation = new EventTarget();
  const win = Object.assign(new EventTarget(), { innerWidth: width, innerHeight: height,
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
    cancelAnimationFrame: id => { frames[id - 1] = null; } });
  if (query) win.matchMedia = text => { assert.equal(text, LANDSCAPE_QUERY); return landscape; };
  if (screen) win.screen = { orientation };
  const flush = () => { for (const cb of frames.splice(0)) cb?.(); };
  return { win, landscape, orientation, flush, frames };
}

test('watchLayout reports each real turn once, with the orientation it left', () => {
  const { win, landscape, orientation, flush } = fakeWindow();
  const changes = [];
  const layout = watchLayout(win, (next, previous) => changes.push([next, previous]));
  assert.equal(layout.orientation, 'portrait');
  win.dispatchEvent(new Event('resize'));
  flush();
  assert.deepEqual(changes, [], 'a resize without a turn (a browser bar) is not a change');
  landscape.matches = true;
  landscape.dispatchEvent(new Event('change'));
  orientation.dispatchEvent(new Event('change'));
  win.dispatchEvent(new Event('resize'));
  flush();
  assert.deepEqual(changes, [['landscape', 'portrait']]);
  assert.equal(layout.orientation, 'landscape');
  // iOS: the first event still reports the old size; the frame after it is right.
  win.dispatchEvent(new Event('resize'));
  landscape.matches = false;
  assert.deepEqual(changes.length, 1);
  flush();
  assert.deepEqual(changes, [['landscape', 'portrait'], ['portrait', 'landscape']]);
  layout.dispose();
  landscape.matches = true;
  landscape.dispatchEvent(new Event('change'));
  win.dispatchEvent(new Event('resize'));
  assert.equal(changes.length, 2, 'disposed watchers stay quiet');
});

test('watchLayout falls back to the window size and cancels a pending check', () => {
  const { win, flush, frames } = fakeWindow({ query: false, screen: false });
  const changes = [];
  const layout = watchLayout(win, next => changes.push(next));
  assert.equal(layout.orientation, 'portrait');
  win.dispatchEvent(new Event('resize'));
  assert.equal(frames.length, 1);
  layout.dispose();
  [win.innerWidth, win.innerHeight] = [852, 393];
  flush();
  assert.deepEqual(changes, [], 'the cancelled frame never checks');
  const bare = watchLayout({ innerWidth: 852, innerHeight: 393 });
  assert.equal(bare.orientation, 'landscape');
  bare.dispose();
});

test('style.css lays phones out in landscape with the same orientation query', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const landscape = `(pointer: coarse) and (hover: none) and (max-height: 600px) and ${LANDSCAPE_QUERY} {`;
  assert.ok(PHONE_QUERY.includes('(pointer: coarse) and (hover: none) and (max-height: 600px)'));
  const block = css.split(`@media ${landscape}`);
  assert.equal(block.length, 2, 'exactly one landscape phone block');
  assert.match(block[1].split('\n}')[0], /#move-pad/);
});

test('the camera frames its target below centre by its bias, applied at once', () => {
  const renderer = { canvas: { width: 400, height: 600 }, cellW: 4, cellH: 6, cols: 101, rows: 101 };
  const camera = new Camera(50, 80);
  const plain = camera.view(renderer);
  assert.equal(camera.centreY(plain), 80);
  camera.bias = FRAME_BIAS.portrait;
  const biased = camera.view(renderer);
  const halfH = 600 / 6 / 2;
  const top = v => v.y0 + v.offY / renderer.cellH;
  assert.ok(Math.abs(top(plain) - top(biased) - 0.2 * halfH) < 1e-9, 'the view moves up by a tenth of its height');
  assert.equal(biased.x0, plain.x0);
  assert.ok(Math.abs(camera.centreY(biased) - (80 - 0.1 * 101)) < 1e-9);
  assert.equal(FRAME_BIAS.landscape, 0);
});

test('a shaken camera wobbles around its target and settles', () => {
  const renderer = { canvas: { width: 400, height: 600 }, cellW: 4, cellH: 6, cols: 101, rows: 101 };
  const camera = new Camera(0, 0);
  camera.shake(0.5);
  camera.shake(0.2);
  assert.equal(camera.quake, 0.5, 'a smaller jolt never cuts a bigger one short');
  camera.follow(0, 0, 0.05);
  assert.notDeepEqual(camera.view(renderer), new Camera(0, 0).view(renderer));
  for (let i = 0; i < 200; i++) camera.follow(10, 0, 0.05);
  assert.ok(camera.quake < 1e-6 && Math.abs(camera.x - 10) < 1e-6);
});
