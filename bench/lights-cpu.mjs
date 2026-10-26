// CPU frame work with warm light on stones, two checkouts side by side:
//   node bench/lights-cpu.mjs <before-checkout> [after-checkout] [width] [height] [rounds] [frames]
// Both are loaded in one Node process at the river bank bench/lights.cjs
// uses and stepped a frame each in turn (before, after, then after,
// before ...), so whatever else the machine is doing falls on both alike.
// Each frame is timed in two parts: the bench/scene.js work with no light
// (the control: every stone drawn with its normals stored) and the light
// pass alone (a held torch, radius 27 and height 10, and two fires, radius
// 18 and height 2). Prints, per build, the median over the rounds of each
// round's median (and the whole frame's p95), the paired after - before
// difference with its quartiles, and the difference per scene stage.
import os from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [beforeRoot, afterRoot = '.', width = 1280, height = 720, rounds = 25, frames = 240] = process.argv.slice(2);
if (!beforeRoot) throw new Error('usage: node bench/lights-cpu.mjs <before-checkout> [after-checkout] [width] [height] [rounds] [frames]');

async function build(dir) {
  const root = pathToFileURL(`${resolve(dir)}/`);
  const { createScene } = await import(new URL('bench/scene.js', root));
  const { World } = await import(new URL('src/world/world.js', root));
  const { drawFireLight } = await import(new URL('src/world/fire.js', root));
  // Where the nearest river runs most nearly east to west, nearest its
  // middle, a few steps out on its south bank.
  const probe = new World(1);
  const { river } = probe.nearestRiver(probe.spawn.x, probe.spawn.y, 2000);
  const n = river.s.length;
  let i = n >> 1;
  for (let k = 0; k < n; k++) {
    const a = (n >> 1) + (k % 2 ? -1 : 1) * ((k + 1) >> 1);
    if (a >= 0 && a < n - 1 && Math.abs(river.dir[2 * a + 1]) < 0.35) { i = a; break; }
  }
  const mid = probe.rivers.pointAt(river, river.s[i]);
  let ox = -river.dir[2 * i + 1], oy = river.dir[2 * i];
  if (oy < 0) { ox = -ox; oy = -oy; }
  const off = mid.halfWidth + 3;
  const x = Math.floor(mid.x + ox * off / 0.6) + 0.5, y = Math.floor(mid.y + oy * off) + 0.5;
  const scene = await createScene(root, { width: +width, height: +height, x, y });
  const lights = [
    [{ x, y, intensity: 1, seed: 3 }, 27, 10],
    [{ x: x - 6, y: y + 2, intensity: 1, seed: 5 }, 18, 2],
    [{ x: x + 7, y: y + 3, intensity: 1, seed: 7 }, 18, 2],
  ];
  let t = 0;
  return {
    renderer: scene.renderer,
    // The stage timings of one frame, plus its light pass as `lights`.
    frame() {
      const stages = scene.frame();
      const view = scene.camera.view(scene.renderer);
      t += 1 / 60;
      const start = performance.now();
      for (const [source, radius, h] of lights) drawFireLight(scene.renderer, view, t, source, radius, h);
      stages.lights = performance.now() - start;
      return stages;
    },
  };
}

const quantile = (a, p) => { const s = [...a].sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const ms = (v) => +v.toFixed(3);
const loadStart = os.loadavg()[0];
const builds = { before: await build(beforeRoot), after: await build(afterRoot) };
for (let k = 0; k < 120; k++) { builds.before.frame(); builds.after.frame(); }

// Per build and measure, one median (p95 for the whole frame) per round.
const rows = { before: {}, after: {} };
const push = (name, key, v) => (rows[name][key] ??= []).push(v);
for (let round = 0; round < +rounds; round++) {
  const run = { before: {}, after: {} };
  for (let k = 0; k < +frames; k++) {
    for (const name of (round + k) % 2 ? ['after', 'before'] : ['before', 'after']) {
      const stages = builds[name].frame();
      const { lights, ...rest } = stages;
      const work = Object.values(rest).reduce((a, b) => a + b, 0);
      for (const [key, v] of Object.entries({ ...stages, unlit: work, total: work + lights })) (run[name][key] ??= []).push(v);
    }
  }
  for (const name of ['before', 'after']) {
    for (const [key, list] of Object.entries(run[name])) push(name, key, quantile(list, 0.5));
    push(name, 'p95', quantile(run[name].total, 0.95));
  }
}

const r = builds.after.renderer;
const count = (b) => { let c = 0; for (let j = 2; j < (b?.length ?? 0); j += 4) if (b[j]) c++; return c; };
const MAIN = ['unlit', 'lights', 'total', 'p95'];
const paired = (key) => rows.after[key].map((v, i) => v - rows.before[key][i]);
const out = {
  size: `${width}x${height}`, grid: `${r.cols}x${r.rows}`, rounds: +rounds, frames: +frames,
  load: [ms(loadStart), ms(os.loadavg()[0])], stones: [count(r.cellLit), count(r.fineLit)],
};
for (const name of ['before', 'after']) out[name] = Object.fromEntries(MAIN.map((k) => [k, ms(quantile(rows[name][k], 0.5))]));
out.diff = Object.fromEntries(MAIN.map((k) => [k, ms(quantile(paired(k), 0.5))]));
out.diffQuartiles = Object.fromEntries(MAIN.map((k) => [k, [ms(quantile(paired(k), 0.25)), ms(quantile(paired(k), 0.75))]]));
out.stageDiff = Object.fromEntries(Object.keys(rows.after).filter((k) => !MAIN.includes(k)).map((k) => [k, ms(quantile(paired(k), 0.5))]));
console.log(JSON.stringify(out));
