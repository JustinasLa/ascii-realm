// CPU frame work with trees' shadows, two checkouts side by side:
//   node bench/night-cpu.mjs <before-checkout> [after-checkout] [width] [height] [rounds] [frames]
// Both are loaded in one Node process at the lakeside scene (bench/lakeside.js)
// and stepped a frame each in turn (before, after, then after, before ...),
// so whatever else the machine is doing falls on both alike. Prints, per
// build, the median over the rounds of each round's median frame work (and
// of its p95), the paired after - before difference with its quartiles, and
// the difference per scene stage; `night` is the after build's shadow stage.
// Then the stalls: each round both builds walk into a fresh part of the
// world (a new scene, nothing baked), at the default zoom and zoomed right
// out, and every frame's work and night stage counts, not just the medians.
import os from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLAYER, SEED } from './lakeside.js';

const [beforeRoot, afterRoot = '.', width = 1280, height = 720, rounds = 25, frames = 240] = process.argv.slice(2);
if (!beforeRoot) throw new Error('usage: node bench/night-cpu.mjs <before-checkout> [after-checkout] [width] [height] [rounds] [frames]');
// The game's widest zoom draws cells this small (MIN_CELL in main.js).
const WIDEST = 4.5;
const SPIKE_ROUNDS = Math.max(4, Math.round(+rounds / 3));
const SPIKE_FRAMES = 40;

const roots = { before: pathToFileURL(`${resolve(beforeRoot)}/`), after: pathToFileURL(`${resolve(afterRoot)}/`) };
const scenes = {};
for (const [name, root] of Object.entries(roots)) {
  const { createScene } = await import(new URL('bench/scene.js', root));
  scenes[name] = (options) => createScene(root, { width: +width, height: +height, seed: SEED, ...options });
}

const quantile = (a, p) => { const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const ms = (v) => +v.toFixed(3);
const loadStart = os.loadavg()[0];
const builds = { before: await scenes.before(PLAYER), after: await scenes.after(PLAYER) };
for (let k = 0; k < 120; k++) { builds.before.frame(); builds.after.frame(); }

// Per build and measure, one median (p95 for the whole frame) per round.
const rows = { before: {}, after: {} };
const push = (name, key, v) => (rows[name][key] ??= []).push(v);
for (let round = 0; round < +rounds; round++) {
  const run = { before: {}, after: {} };
  for (let k = 0; k < +frames; k++) {
    for (const name of (round + k) % 2 ? ['after', 'before'] : ['before', 'after']) {
      const stages = builds[name].frame();
      const total = Object.values(stages).reduce((a, b) => a + b, 0);
      for (const [key, v] of Object.entries({ ...stages, total })) (run[name][key] ??= []).push(v);
    }
  }
  for (const name of ['before', 'after']) {
    for (const [key, list] of Object.entries(run[name])) push(name, key, quantile(list, 0.5));
    push(name, 'p95', quantile(run[name].total, 0.95));
  }
}

const night = builds.after.night;
const MAIN = ['total', 'p95'];
const paired = (key) => rows.after[key].map((v, i) => v - rows.before[key][i]);
const out = {
  size: `${width}x${height}`, grid: `${builds.after.renderer.cols}x${builds.after.renderer.rows}`,
  rounds: +rounds, frames: +frames, shaded: night?.active ?? false,
};
for (const name of ['before', 'after']) out[name] = Object.fromEntries(MAIN.map((k) => [k, ms(quantile(rows[name][k], 0.5))]));
out.night = rows.after.night ? ms(quantile(rows.after.night, 0.5)) : null;
out.diff = Object.fromEntries(MAIN.map((k) => [k, ms(quantile(paired(k), 0.5))]));
out.diffQuartiles = Object.fromEntries(MAIN.map((k) => [k, [ms(quantile(paired(k), 0.25)), ms(quantile(paired(k), 0.75))]]));
out.stageDiff = Object.fromEntries(Object.keys(rows.before).filter((k) => !MAIN.includes(k))
  .map((k) => [k, ms(quantile(paired(k), 0.5))]));

// Stalls: a fresh scene per round and build, a little further east each
// round, so every tree in it is new; both builds see the same spots.
const spikes = {};
for (const [label, cell] of [['entry', 8], ['widest', WIDEST]]) {
  const frame = { before: [], after: [] }, stage = [];
  let bakes = 0;
  for (let round = 0; round < SPIKE_ROUNDS; round++) {
    const at = { x: PLAYER.x + 700 * (round + 1), y: PLAYER.y + 211 * round, cell };
    const fresh = {};
    for (const name of round % 2 ? ['after', 'before'] : ['before', 'after']) fresh[name] = await scenes[name](at);
    for (let k = 0; k < SPIKE_FRAMES; k++) {
      for (const name of k % 2 ? ['after', 'before'] : ['before', 'after']) {
        const stages = fresh[name].frame();
        frame[name].push(Object.values(stages).reduce((a, b) => a + b, 0));
        if (name === 'after' && stages.night !== undefined) {
          stage.push(stages.night);
          bakes += fresh.after.night.bakes;
        }
      }
    }
  }
  const tail = (list) => ({ p50: ms(quantile(list, 0.5)), p95: ms(quantile(list, 0.95)), p99: ms(quantile(list, 0.99)),
    max: ms(Math.max(...list)) });
  spikes[label] = { cell, frames: SPIKE_ROUNDS * SPIKE_FRAMES, bakes, before: tail(frame.before), after: tail(frame.after),
    night: stage.length ? tail(stage) : null };
}
out.spikes = spikes;
out.load = [ms(loadStart), ms(os.loadavg()[0])];
console.log(JSON.stringify(out));
