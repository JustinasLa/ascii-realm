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

// The renderer rounds the canvas to device pixels, which can add up to half
// a CSS pixel on each side; the budget check allows for it.
const ROUNDING = 0.5;
const STEP = 0.05;

export function phoneDefaultCell(orientation, width, height) {
  const fits = (cell) => {
    const { cols, rows } = gridSize(width + ROUNDING, height + ROUNDING, cell);
    return cols * rows <= PHONE_CELL_BUDGET;
  };
  let cell = Math.max(PHONE_ZOOM[orientation], Math.sqrt(width * height / (ASPECT * PHONE_CELL_BUDGET)));
  while (!fits(cell)) cell += STEP;
  return Math.round(cell * 100) / 100;
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
