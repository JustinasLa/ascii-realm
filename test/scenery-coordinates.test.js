import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brushSize, screenToWorld, worldToScreen } from '../src/editor/coordinates.js';

const rect = { left: 25, top: 40, width: 800, height: 600 };
const renderer = { canvas: { width: 1600, height: 1200 }, cellW: 12, cellH: 20 };
const view = { x0: -7, y0: 13, offX: 3, offY: 5 };

function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should equal ${expected}`);
}

test('pointer mapping accounts for canvas position, backing pixel scale, and fractional camera offsets', () => {
  assert.deepEqual(screenToWorld(85, 90, rect, renderer, view), { x: 3.25, y: 18.25 });
  assert.deepEqual(screenToWorld(rect.left, rect.top, rect, renderer, view), { x: -6.75, y: 13.25 });
});

test('world coordinates round-trip through client coordinates at fractional positions', () => {
  for (const point of [{ x: -11.3, y: -4.7 }, { x: 8.125, y: 29.75 }, { x: 127.9, y: 98.2 }]) {
    const screen = worldToScreen(point.x, point.y, rect, renderer, view);
    const world = screenToWorld(screen.x, screen.y, rect, renderer, view);
    near(world.x, point.x);
    near(world.y, point.y);
  }
});

test('mapping remains correct when horizontal and vertical CSS scales differ', () => {
  const stretched = { left: 10, top: 20, width: 400, height: 1200 };
  assert.deepEqual(screenToWorld(40, 120, stretched, renderer, view), { x: 3.25, y: 18.25 });
  assert.deepEqual(worldToScreen(3.25, 18.25, stretched, renderer, view), { x: 40, y: 120 });
});

test('brush dimensions use the same physical horizontal aspect as terrain painting', () => {
  assert.deepEqual(brushSize(3, rect, renderer), { width: 60, height: 60 });
  assert.deepEqual(brushSize(0, rect, renderer), { width: 0, height: 0 });
  assert.deepEqual(brushSize(3, { ...rect, width: 400, height: 1200 }, renderer), { width: 30, height: 120 });
});

test('changing device pixel ratio preserves CSS mapping and brush dimensions', () => {
  const standardDpr = { canvas: { width: 800, height: 600 }, cellW: 6, cellH: 10 };
  const standardView = { ...view, offX: view.offX / 2, offY: view.offY / 2 };
  assert.deepEqual(screenToWorld(85, 90, rect, standardDpr, standardView), screenToWorld(85, 90, rect, renderer, view));
  assert.deepEqual(brushSize(3, rect, standardDpr), brushSize(3, rect, renderer));
});
