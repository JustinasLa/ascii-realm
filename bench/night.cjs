// Frame work with trees' shadows and moonbeams at the lakeside scene
// (bench/lakeside.js), on two builds:
//   BEFORE_URL=http://127.0.0.1:8124/ AFTER_URL=http://127.0.0.1:8123/... node bench/night.cjs
// Each size opens the before build once and the after build twice: with
// the night's light on and with the control off. CONTROL=shafts (the
// default) turns only the moonbeams off (game.nightLight.shafts = false),
// CONTROL=shadows the whole night light (game.nightLight.enabled = false). Only
// one page runs at a time, in front, with the others frozen, and short
// timing windows take turns in an order that rotates and reverses every
// round, so a load that drifts on a busy machine falls on every page alike.
// Prints the median over the rounds of each page's window median and p95,
// the paired after - before difference, the shadows' own cost (on - off)
// and the median of the after build's metrics.nightMs and shaftMs (the
// beams' columns, part of nightMs).
// SPIKES=1 measures stalls instead: every round each build is loaded
// afresh, then stepped a little further east (every tree in view new) and
// zoomed right out (the newly seen trees new too). Every frame from the step
// on is recorded inside the page, armed before the step, so no frame and no
// shadow bake goes untimed, and the bench stops if one did; then it walks
// east for WALK frames, beams coming and going. Prints each build's
// per-frame p50, p95, p99 and max for the walk-in, the zoom-out and the walk,
// the same for its shadow stage (nightMs) and for the baking alone in the
// frames that baked, the stamps baked in each and the slowest shadow stages.
// Optional: ROUNDS (default 20, 6 with SPIKES), FRAMES per window (default
// 120), WARM frames before each window (default 30), THROTTLE=<n> to slow
// the CPU n times, SIZES=1280x720,393x852,852x393 to pick the sizes,
// REDUCED=1 for a phone's reduced cell budget, TIER=desktop|phone|reduced
// to hold the beams' tier, SHOTS=<dir> for a screenshot of each page after
// its last window.
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
// Optional browser tooling: npm install --no-save --package-lock=false puppeteer
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

const builds = { before: process.env.BEFORE_URL, after: process.env.AFTER_URL || 'http://localhost:8000/' };
const SPIKES = process.env.SPIKES === '1';
const ROUNDS = Number(process.env.ROUNDS) || (SPIKES ? 6 : 20);
const FRAMES = Number(process.env.FRAMES) || 120;
const WARM = Number(process.env.WARM) || 30;
const THROTTLE = Number(process.env.THROTTLE) || 1;
const REDUCED = process.env.REDUCED === '1';
const CONTROL = process.env.CONTROL || 'shafts';
const TIER = process.env.TIER || null;
// Frames timed one by one after walking in, and while zooming out.
const ENTRY = 60;
const ZOOM = 90;
const WALK = 120;
const SIZES = [
  { name: '1280x720', width: 1280, height: 720, deviceScaleFactor: 1 },
  { name: '393x852', width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: '852x393', width: 852, height: 393, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
].filter((s) => !process.env.SIZES || process.env.SIZES.split(',').includes(s.name));
const quantile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const median = (a) => quantile(a, 0.5);
const load = () => os.loadavg()[0].toFixed(2);
const fixed = (v) => (v === undefined ? '-' : v.toFixed(2));

// Records every frame from now on, from inside the page. The game sets
// metrics.workMs once at the end of each frame, so a setter on it sees each
// one with its shadow stage and the stamps it baked. The frame and bake
// counts taken now let the bench check that none went unrecorded (see
// checked). Self-contained, so it can be sent to a page as source.
function arm() {
  const { metrics } = game, night = game.nightLight;
  let workMs = metrics.workMs;
  const rec = window.recorded = { frames: metrics.frames, baked: night?.baked ?? 0, list: [] };
  Object.defineProperty(metrics, 'workMs', {
    configurable: true, enumerable: true, get: () => workMs,
    set(v) {
      workMs = v;
      rec.list.push({ frame: metrics.frames, work: v, night: metrics.nightMs ?? 0,
        shaft: metrics.shaftMs ?? 0, bakes: night?.bakes ?? 0, baked: night?.baked ?? 0, bakeWork: night?.work ?? 0,
        bakeMs: night?.bakeMs ?? 0 });
    },
  });
}

// Loads a build by the lake, holds its grid where it starts, then stands it
// at `at` (see bench/lakeside.js). With `armed`, frames are recorded from
// just before that step, once the start's own shadows are baked.
async function goto(entry, at, armed = false) {
  const { page } = entry;
  const url = `${entry.base}${entry.base.includes('?') ? '&' : '?'}${lakeside.LAKESIDE_QUERY}`;
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.game?.metrics.frames > 30, { timeout: 300000 });
  await page.evaluate(`(${lakeside.placeAtLakeside})(game, { x: game.player.x, y: game.player.y })`);
  await page.evaluate((shadows, reduced, control, tier) => {
    const { quality } = game;
    quality.scale = quality.minimum;
    if (reduced) game.native.pacer.cellCeiling = 12000;
    window.dispatchEvent(new Event('resize'));
    const night = game.nightLight;
    if (night && control === 'shadows') night.enabled = shadows;
    else if (night && 'shafts' in night) night.shafts = shadows;
    if (night && tier) night.tier = tier;
    // Nothing may cut the run short: no monster, no wound.
    const guard = () => { game.monsters?.clear(); game.player.heal(1e6); requestAnimationFrame(guard); };
    guard();
  }, entry.shadows, REDUCED, CONTROL, TIER);
  if (armed) await page.waitForFunction(() => !(game.nightLight?.bakes > 0), { polling: 'raf', timeout: 300000 });
  await page.evaluate(`${armed ? `(${arm})(); ` : ''}(${lakeside.placeAtLakeside})(game, ${JSON.stringify(at)})`);
}

async function open(browser, name, size, shadows) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await page.setViewport(size);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const entry = { name, shadows, key: `${name}${name === 'after' ? (shadows ? ' on' : ' off') : ''}`,
    base: builds[name], page, cdp, windows: [], frames: [], zoom: [], walk: [], night: [], shaft: [],
    bakes: { entry: 0, zoom: 0 }, recorded: [], worst: [], bakeMs: [] };
  if (!SPIKES) {
    await goto(entry, lakeside.PLAYER);
    await new Promise((r) => setTimeout(r, 3000));
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  }
  return entry;
}

// Times `n` frames after `skip`, one value per frame: the frame's work and
// its shadow stage.
const record = (page, skip, n) => page.evaluate((skip, n) => new Promise((resolve) => {
  const work = [], night = [], shaft = [];
  let last = game.metrics.frames;
  const tick = () => {
    if (game.metrics.frames !== last) {
      last = game.metrics.frames;
      if (skip > 0) skip--;
      else {
        work.push(game.metrics.workMs);
        night.push(game.metrics.nightMs ?? 0);
        shaft.push(game.metrics.shaftMs ?? 0);
      }
    }
    if (work.length >= n) resolve({ work, night, shaft }); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), skip, n);

// Wakes a page, lets it warm up, times one window of frames, freezes it.
async function time(entry) {
  await entry.cdp.send('Page.setWebLifecycleState', { state: 'active' });
  // Headless Chrome only animates the tab in front.
  await entry.page.bringToFront();
  const { work, night, shaft } = await record(entry.page, WARM, FRAMES);
  await entry.cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  entry.windows.push({ median: median(work), p95: quantile(work, 0.95), night: median(night), shaft: median(shaft) });
}

// The recording so far, once it holds `n` frames.
const recorded = (page, n) => page.waitForFunction((n) => window.recorded.list.length >= n,
  { polling: 'raf', timeout: 900000 }, n).then(() => page.evaluate(() => window.recorded));

// Checks that the recording has every frame since it was armed, in order,
// and that every stamp baked since then was baked in one of them: its first
// frame came before the first bake.
function checked(entry, rec) {
  rec.list.forEach((f, i) => {
    if (f.frame !== rec.frames + 1 + i) throw new Error(`${entry.key}: frame ${rec.frames + 1 + i} went unrecorded`);
  });
  const bakes = rec.list.reduce((n, f) => n + f.bakes, 0);
  const [first] = rec.list, last = rec.list.at(-1);
  if (first.baked - first.bakes !== rec.baked || last.baked - rec.baked !== bakes) {
    throw new Error(`${entry.key}: ${last.baked - rec.baked} stamps baked since arming, ${bakes} in recorded frames`);
  }
  return rec.list;
}

// Steps a fresh page into a new spot and records its frames, then zooms it
// right out and records on, with no gap between.
async function stall(entry, round) {
  const { page } = entry;
  await page.bringToFront();
  await goto(entry, { x: lakeside.PLAYER.x + 700 * (round + 1), y: lakeside.PLAYER.y + 211 * round }, true);
  // The zoom's frames start with the first not yet recorded before its first key.
  const mark = (await recorded(page, ENTRY)).list.length;
  for (let i = 0; i < 10; i++) await page.keyboard.press('Minus');
  const end = (await page.evaluate(() => window.recorded.list.length)) + ZOOM;
  await recorded(page, end);
  // Then walk east, the camera following, with no gap either.
  await page.keyboard.down('KeyD');
  const stop = (await page.evaluate(() => window.recorded.list.length)) + WALK;
  await recorded(page, stop);
  await page.keyboard.up('KeyD');
  const list = checked(entry, await page.evaluate(() => window.recorded));
  const first = list.slice(0, mark), zoom = list.slice(mark, end), walk = list.slice(end, stop);
  const sum = (frames) => frames.reduce((n, f) => n + f.bakes, 0);
  for (const [phase, frames] of [['entry', first], ['zoom', zoom], ['walk', walk]]) {
    frames.forEach((f, i) => entry.worst.push({ ...f, at: `round ${round} ${phase} frame ${i + 1}` }));
  }
  entry.worst = entry.worst.sort((a, b) => b.night - a.night).slice(0, 3);
  entry.frames.push(...first.map((f) => f.work));
  entry.zoom.push(...zoom.map((f) => f.work));
  entry.walk.push(...walk.map((f) => f.work));
  entry.night.push(...[...first, ...zoom, ...walk].map((f) => f.night));
  entry.shaft.push(...[...first, ...zoom, ...walk].map((f) => f.shaft));
  entry.bakeMs.push(...[...first, ...zoom].filter((f) => f.bakes).map((f) => f.bakeMs));
  entry.bakes.entry += sum(first);
  entry.bakes.zoom += sum(zoom);
  entry.recorded.push(first.length, zoom.length, walk.length);
  const at = list.findIndex((f) => f.bakes > 0);
  if (at >= 0) entry.firstBake = Math.min(entry.firstBake ?? at, at);
}

const drawn = (page) => page.evaluate(() => {
  const r = game.renderer, n = game.nightLight;
  return `${r.cols}x${r.rows} scale ${game.quality.scale.toFixed(2)}${n ? ` shaded ${n.active}` : ''}${
    n?.visible ? ` beams ${n.visible.length} tier ${n.tierName}` : ''}`;
});

let lakeside;
(async () => {
  lakeside = await import('./lakeside.js');
  const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900000 });
  console.log(`${SPIKES ? 'stalls' : 'steady'}, CPU throttle ${THROTTLE}x${REDUCED ? ', reduced cells' : ''},`,
    `control ${CONTROL}${TIER ? `, tier ${TIER}` : ''},`,
    `${ROUNDS} rounds${SPIKES ? '' : ` of ${FRAMES} frames (${WARM} warm-up)`}, load ${load()}`);
  try {
    for (const size of SIZES) {
      const pages = [];
      for (const [name, shadows] of [['before', true], ['after', true], ['after', false]]) {
        if (SPIKES && !shadows) continue;
        if (builds[name]) pages.push(await open(browser, name, size, shadows));
      }
      for (let round = 0; round < ROUNDS; round++) {
        const order = pages.map((_, i) => pages[(i + round) % pages.length]);
        if (round % 2) order.reverse();
        for (const entry of order) await (SPIKES ? stall(entry, round) : time(entry));
        if (!SPIKES) {
          console.log(size.name, `round ${round}`, pages.map((p) => `${p.key} ${p.windows[round].median.toFixed(2)}/${p.windows[round].p95.toFixed(2)}`).join(', '), `load ${load()}`);
        } else console.log(size.name, `round ${round}`, `load ${load()}`);
      }
      const at = (key) => pages.find((p) => p.key === key);
      const paired = (a, b, field) => median(a.windows.map((w, i) => w[field] - b.windows[i][field]));
      const tails = (list) => ['p50', 'p95', 'p99'].map((p, i) => `${p} ${quantile(list, [0.5, 0.95, 0.99][i]).toFixed(2)}`)
        .concat(`max ${Math.max(...list).toFixed(2)} ms`).join(', ');
      for (const entry of pages) {
        await entry.cdp.send('Page.setWebLifecycleState', { state: 'active' });
        await entry.page.bringToFront();
        if (process.env.SHOTS) {
          fs.mkdirSync(process.env.SHOTS, { recursive: true });
          await entry.page.screenshot({ path: join(process.env.SHOTS, `night-${entry.key.replace(' ', '-')}-${size.name}.png`) });
        }
        const grid = await drawn(entry.page);
        if (SPIKES) {
          console.log(size.name, entry.key, `entry ${tails(entry.frames)}; zoom ${tails(entry.zoom)}; walk ${tails(entry.walk)};`,
            `nightMs ${tails(entry.night)}; shaftMs ${tails(entry.shaft)};${entry.bakeMs.length ? ` baking, in frames that baked, ${tails(entry.bakeMs)};` : ''} stamps baked ${entry.bakes.entry} walking in, ${entry.bakes.zoom} zooming out;`,
            `${entry.recorded.reduce((a, b) => a + b, 0)} frames recorded, none missed${entry.firstBake === undefined
              ? '' : `, the earliest first bake in recorded frame ${entry.firstBake + 1}`};`, grid);
          if (entry.name === 'after' && entry.shadows) {
            // The walk-ins and zooms, all rounds together, must bake, or there was no stall to time.
            if (!(entry.bakes.entry > 0 && entry.bakes.zoom > 0)) throw new Error(`${entry.key}: no stamps baked`);
            console.log(size.name, entry.key, 'largest nightMs:', entry.worst.map((f) =>
              `${f.night.toFixed(2)} ms (${f.at}, ${f.bakes} baked in ${f.bakeMs.toFixed(2)} ms, work ${f.bakeWork}, frame ${f.work.toFixed(1)} ms)`).join('; '));
          }
        } else {
          console.log(size.name, entry.key, `median ${median(entry.windows.map((w) => w.median)).toFixed(2)} ms`,
            `p95 ${median(entry.windows.map((w) => w.p95)).toFixed(2)} ms`,
            `nightMs ${fixed(median(entry.windows.map((w) => w.night)))}`,
            `shaftMs ${fixed(median(entry.windows.map((w) => w.shaft)))}`, grid);
        }
        await entry.page.close();
      }
      if (!SPIKES) {
        const [on, off, before] = ['after on', 'after off', 'before'].map(at);
        if (on && before) {
          const d = on.windows.map((w, i) => w.median - before.windows[i].median);
          console.log(size.name, `after - before: median ${paired(on, before, 'median').toFixed(2)} ms`,
            `(IQR ${quantile(d, 0.25).toFixed(2)}..${quantile(d, 0.75).toFixed(2)}), p95 ${paired(on, before, 'p95').toFixed(2)} ms`);
        }
        if (on && off) {
          const share = median(on.windows.map((w, i) => (w.median - off.windows[i].median) / off.windows[i].median * 100));
          console.log(size.name, `${CONTROL === 'shadows' ? 'night light' : 'moonbeams'}' own cost (on - off): median ${paired(on, off, 'median').toFixed(2)} ms`,
            `(${share.toFixed(1)} %), p95 ${paired(on, off, 'p95').toFixed(2)} ms`);
        }
      }
      console.log(size.name, `load ${load()}`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
