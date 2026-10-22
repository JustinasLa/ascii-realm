import { FINE } from '../render/cells.js';
import { LAYER } from '../render/glyphs.js';
import { fineRecipe, fineSource } from './prop-art.js';

// Trees and rocks are drawn in small letters on the renderer's fine grid
// (see drawProp). Their fine bakes are long (a big tree takes a few hundred
// thousand samples), so they are queued and made off the main thread by
// workers (fine-worker.js), which rebuild the prop from its source and bake
// it there. Without workers (in tests, or where they cannot start) the
// bakes run here a few rows at a time instead (bakeFine). Until its bake
// is done, a prop is drawn from its ordinary cells.

const baked = new WeakMap();
// Queued bakes, oldest first: waiting, sent to a worker, or left to be
// baked here (no source to rebuild the prop from, or the worker failed).
const queue = new Map();
const workers = [];
const sent = new Map();
let nextJob = 1;

// How far a row of foliage can sway either way, in small cells per unit of
// flex (a cell's sway is under 1.5 cells).
const SWAY_PAD = 1.5 * FINE;

// Every cell of a fine bake, packed into typed arrays (one entry per cell,
// three per colour) sorted by row, keeping painter order within a row, and
// where each row starts and ends: [start, end, y, left, right] per row.
export function packFine(cells) {
  const order = cells.map((_, i) => i).sort((a, b) => cells[a].dy - cells[b].dy);
  const n = cells.length;
  const out = {
    n, dx: new Int16Array(n), dy: new Int16Array(n), g: new Uint16Array(n), rustle: new Uint16Array(n),
    color: new Uint8ClampedArray(n * 3), back: new Uint8ClampedArray(n * 3), solid: new Uint8Array(n),
    foliage: new Uint8Array(n), flex: new Float32Array(n), phaseSin: new Float32Array(n),
    phaseCos: new Float32Array(n), rows: null,
  };
  const rows = [];
  for (let k = 0; k < n; k++) {
    const c = cells[order[k]];
    out.dx[k] = c.dx;
    out.dy[k] = c.dy;
    out.g[k] = c.g;
    out.rustle[k] = c.rustle ?? c.g;
    out.color[k * 3] = Math.round(c.r);
    out.color[k * 3 + 1] = Math.round(c.gg);
    out.color[k * 3 + 2] = Math.round(c.b);
    if (c.br !== undefined) {
      out.solid[k] = 1;
      out.back[k * 3] = Math.round(c.br);
      out.back[k * 3 + 1] = Math.round(c.bgG);
      out.back[k * 3 + 2] = Math.round(c.bb);
    }
    out.foliage[k] = c.foliage ? 1 : 0;
    out.flex[k] = c.flex ?? 0;
    out.phaseSin[k] = c.phaseSin ?? 0;
    out.phaseCos[k] = c.phaseCos ?? 1;
    const pad = c.foliage ? Math.ceil(Math.abs(c.flex) * SWAY_PAD) : 0;
    const last = rows[rows.length - 1];
    if (last && last.y === c.dy) {
      last.end = k + 1;
      last.left = Math.min(last.left, c.dx - pad);
      last.right = Math.max(last.right, c.dx + pad);
    } else rows.push({ start: k, end: k + 1, y: c.dy, left: c.dx - pad, right: c.dx + pad });
  }
  out.rows = Int32Array.from(rows.flatMap((r) => [r.start, r.end, r.y, r.left, r.right]));
  return out;
}

// The buffers of a packed bake, to hand to postMessage without copying.
export const fineBuffers = (p) => [p.dx, p.dy, p.g, p.rustle, p.color, p.back, p.solid, p.foliage,
  p.flex, p.phaseSin, p.phaseCos, p.rows].map((a) => a.buffer);

// The cells of a prop's ordinary bake that lie on the ground beside it (a
// shadow, pebbles, leaf litter: glyphs layered where the prop itself has no
// cell). They are still drawn on the ordinary grid, with the ground.
function groundOf(cells) {
  const body = new Set();
  for (const c of cells) if (c.g < LAYER) body.add(c.dy * 4096 + c.dx);
  return cells.filter((c) => c.g >= LAYER && !body.has(c.dy * 4096 + c.dx));
}

function finish(prop, job, cells) {
  baked.set(prop, { from: job.from, cells, ground: groundOf(job.from) });
  queue.delete(prop);
}

// The finished fine bake of a prop, or null, queueing the bake if needed.
// A prop whose cells were replaced is baked again. Props asked for while in
// view (`seen`) are baked before those merely near it.
export function fineOf(prop, seen = false) {
  const found = baked.get(prop);
  if (found?.from === prop.cells) return found;
  const queued = queue.get(prop);
  if (queued?.from === prop.cells) {
    queued.seen ||= seen;
    return null;
  }
  const recipe = fineRecipe(prop);
  if (!recipe) return null;
  const source = fineSource(prop);
  queue.set(prop, { from: prop.cells, recipe, source, state: source && workers.length ? 'waiting' : 'here',
    steps: null, seen });
  dispatch();
  return null;
}

// Whether any bake is left to the main thread.
export function fineBakesPending() {
  for (const job of queue.values()) if (job.state === 'here') return true;
  return false;
}

// Works through the bakes left to the main thread, oldest first, until
// `budgetMs` has been spent (a step is never cut short). Without a budget
// it finishes them all.
export function bakeFine(budgetMs = Infinity) {
  const start = performance.now();
  for (const [prop, job] of [...queue].sort((a, b) => b[1].seen - a[1].seen)) {
    if (job.state !== 'here') continue;
    job.steps ??= job.recipe();
    for (;;) {
      const step = job.steps.next();
      if (step.done) {
        finish(prop, job, packFine(step.value));
        break;
      }
      if (performance.now() - start >= budgetMs) return;
    }
  }
}

// Starts `count` workers (fine-worker.js), by default all but two of the
// machine's cores, from one to four. Each bakes one prop at a time.
const spareCores = () => Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 4) - 2));
export function startFineWorkers(count = spareCores(), url = new URL('./fine-worker.js', import.meta.url)) {
  if (workers.length || typeof Worker === 'undefined') return;
  for (let i = 0; i < count; i++) {
    let worker;
    try {
      worker = new Worker(url, { type: 'module' });
    } catch {
      break;
    }
    const slot = { worker, prop: null };
    worker.onmessage = ({ data }) => {
      const prop = sent.get(data.id);
      sent.delete(data.id);
      slot.prop = null;
      const job = prop && queue.get(prop);
      if (job?.id === data.id) {
        if (data.cells) finish(prop, job, data.cells);
        else job.state = 'here';
      }
      dispatch();
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      // A worker that cannot run leaves its bakes to the main thread.
      workers.splice(workers.indexOf(slot), 1);
      worker.terminate();
      for (const job of queue.values()) {
        if (job.state === 'waiting' && !workers.length) job.state = 'here';
      }
      const job = slot.prop && queue.get(slot.prop);
      if (job) job.state = 'here';
      dispatch();
    };
    workers.push(slot);
  }
  if (!workers.length) return;
  for (const job of queue.values()) if (job.state === 'here' && job.source && !job.steps) job.state = 'waiting';
  dispatch();
}

function dispatch() {
  for (const slot of workers) {
    if (slot.prop) continue;
    let next = null;
    for (const entry of queue) {
      if (entry[1].state !== 'waiting') continue;
      if (entry[1].seen) {
        next = entry;
        break;
      }
      next ??= entry;
    }
    if (!next) return;
    const [prop, job] = next;
    job.state = 'sent';
    job.id = nextJob++;
    sent.set(job.id, prop);
    slot.prop = prop;
    slot.worker.postMessage({ id: job.id, source: job.source });
  }
}
