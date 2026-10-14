import { ASPECT } from '../world/world.js';

// Pointer coordinates are CSS pixels; camera offsets and cells use backing pixels.
export function screenToWorld(clientX, clientY, rect, renderer, view) {
  return {
    x: view.x0 + ((clientX - rect.left) * renderer.canvas.width / rect.width + view.offX) / renderer.cellW,
    y: view.y0 + ((clientY - rect.top) * renderer.canvas.height / rect.height + view.offY) / renderer.cellH,
  };
}

// Return client coordinates so callers can position an overlay or round-trip a pointer.
export function worldToScreen(x, y, rect, renderer, view) {
  return {
    x: rect.left + ((x - view.x0) * renderer.cellW - view.offX) * rect.width / renderer.canvas.width,
    y: rect.top + ((y - view.y0) * renderer.cellH - view.offY) * rect.height / renderer.canvas.height,
  };
}

// A world-space disk spans more columns than rows because ASCII cells are narrow.
export function brushSize(radius, rect, renderer) {
  return {
    width: radius * 2 / ASPECT * renderer.cellW * rect.width / renderer.canvas.width,
    height: radius * 2 * renderer.cellH * rect.height / renderer.canvas.height,
  };
}
