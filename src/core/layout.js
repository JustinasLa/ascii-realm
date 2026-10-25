import { ASPECT } from '../world/world.js';

// Phones lay out for portrait or landscape. CSS and script read the same
// media feature, so a turned phone re-lays out its controls and re-fits its
// camera in the same frame. style.css holds this string; a test checks it.
export const LANDSCAPE_QUERY = '(orientation: landscape)';

// Default cell height (CSS px) per orientation on phones. Portrait shows a
// narrow, deep view; landscape a wide, shallow one.
export const PHONE_ZOOM = { portrait: 6.5, landscape: 6 };
// The most cells a phone's default view may cost; large phones get slightly
// bigger cells instead. A pinch can still zoom out further.
export const PHONE_CELL_BUDGET = 16_000;
// How far below the screen centre the camera target sits, as a fraction of
// the view height: portrait shows more of the world ahead (up the screen).
export const FRAME_BIAS = { portrait: 0.1, landscape: 0 };

// The renderer's grid for a screen and a cell size: whole cells plus one
// spare row and column for sub-cell scrolling. The renderer and the budgets
// use this one formula, so they can never disagree.
export function gridSize(width, height, cellH, cellW = cellH * ASPECT) {
  return { cols: Math.ceil(width / cellW) + 1, rows: Math.ceil(height / cellH) + 1 };
}

// The grid the renderer actually allocates for a CSS size, a device pixel
// ratio and a CSS cell size: it rounds the canvas to whole device pixels and
// enlarges cells below the smallest legible glyph (2x3 device pixels).
export function deviceGrid(cssW, cssH, dpr, cellW, cellH) {
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  const deviceW = cellW * dpr;
  const deviceH = cellH * dpr;
  // Browser zoom can lower DPR below one. Enlarge both dimensions together
  // when enforcing the minimum so the world keeps its aspect ratio.
  const scale = Math.max(1, 2 / deviceW, 3 / deviceH);
  const cell = { cellW: deviceW * scale, cellH: deviceH * scale };
  return { width: w, height: h, ...cell, ...gridSize(w, h, cell.cellH, cell.cellW) };
}

// The lowest pixel ratio the render budget may pick for a cell size on a
// screen of this ratio: its frame budget can lower the ratio until glyphs
// reach the legible minimum, never further (renderSize in budget.js).
function lowestRatio(dpr, cell) {
  return Math.min(dpr, Math.max(2 / (cell * ASPECT), 3 / cell));
}

// Hundredths of a CSS pixel: the default is checked at the value returned.
const STEP = 0.01;
const hundredths = (cell) => Math.round(cell * 100) / 100;

// The default cell for a phone screen, at the orientation's zoom unless the
// grid would cost more than the budget. The check is on the renderer's
// device-pixel grid at any pixel ratio the render budget may choose: rounding
// the canvas adds at most half a device pixel, so the worst case is half a
// device pixel at the lowest ratio, plus a hair for floating point.
export function phoneDefaultCell(orientation, width, height, dpr = 1) {
  const fits = (cell) => {
    const slack = 0.5 / lowestRatio(dpr || 1, cell) + 1e-6;
    const { cols, rows } = gridSize(width + slack, height + slack, cell);
    return cols * rows <= PHONE_CELL_BUDGET;
  };
  let cell = Math.ceil(Math.max(PHONE_ZOOM[orientation],
    Math.sqrt(width * height / (ASPECT * PHONE_CELL_BUDGET))) * 100 - 1e-9) / 100;
  while (!fits(cell)) cell = hundredths(cell + STEP);
  return cell;
}

// Square counts as portrait, as the media feature does.
export function orientationOf({ width, height }) {
  return width > height ? 'landscape' : 'portrait';
}

// A pinched zoom per orientation, for this session only; `null` means the
// orientation's default.
export class ZoomSlots {
  constructor(defaults) { this.slots = { ...defaults }; }
  get(orientation) { return this.slots[orientation]; }
  set(orientation, cell) { this.slots[orientation] = cell; }
}

// Reports each change of orientation once, with the one it replaces. iOS can
// report stale sizes on the first event, so every event is checked again on
// the next animation frame; checking twice is harmless.
export function watchLayout(win, onChange = () => {}) {
  const query = win.matchMedia?.(LANDSCAPE_QUERY) ?? null;
  const read = () => (query
    ? (query.matches ? 'landscape' : 'portrait')
    : orientationOf({ width: win.innerWidth, height: win.innerHeight }));
  let orientation = read();
  let frame = null;
  const check = () => {
    const next = read();
    if (next === orientation) return;
    const previous = orientation;
    orientation = next;
    onChange(next, previous);
  };
  const changed = () => {
    check();
    if (frame === null && win.requestAnimationFrame) {
      frame = win.requestAnimationFrame(() => { frame = null; check(); });
    }
  };
  const screenOrientation = win.screen?.orientation;
  query?.addEventListener?.('change', changed);
  screenOrientation?.addEventListener?.('change', changed);
  win.addEventListener?.('resize', changed);
  return {
    get orientation() { return orientation; },
    dispose() {
      query?.removeEventListener?.('change', changed);
      screenOrientation?.removeEventListener?.('change', changed);
      win.removeEventListener?.('resize', changed);
      if (frame !== null) win.cancelAnimationFrame?.(frame);
      frame = null;
    },
  };
}
