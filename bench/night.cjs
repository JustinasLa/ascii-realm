// Frame work with trees' shadows at the lakeside scene (bench/lakeside.js),
// on two builds:
//   BEFORE_URL=http://127.0.0.1:8124/ AFTER_URL=http://127.0.0.1:8123/... node bench/night.cjs
// Each size opens the before build once and the after build twice: with
// shadows on and off (the control, game.nightLight.enabled = false). Only
// one page runs at a time, in front, with the others frozen, and short
// timing windows take turns in an order that rotates and reverses every
// round, so a load that drifts on a busy machine falls on every page alike.
// Prints the median over the rounds of each page's window median and p95,
// the paired after - before difference, the shadows' own cost (on - off)
// and the median of the after build's metrics.nightMs.
// SPIKES=1 measures stalls instead: every round each build is loaded
// afresh a little further east (every tree in view new), its first frames
// timed one by one, then zoomed right out (the newly seen trees new too);
// prints each build's per-frame p50, p95, p99 and max and the largest
// nightMs of a frame.
// Optional: ROUNDS (default 20, 6 with SPIKES), FRAMES per window (default
// 120), WARM frames before each window (default 30), THROTTLE=<n> to slow
// the CPU n times, SIZES=1280x720,393x852,852x393 to pick the sizes,
// REDUCED=1 for a phone's reduced cell budget, SHOTS=<dir> for a
// screenshot of each page after its last window.
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
// Frames timed one by one after walking in, and while zooming out.
const ENTRY = 60;
const ZOOM = 90;
const SIZES = [
  { name: '1280x720', width: 1280, height: 720, deviceScaleFactor: 1 },
  { name: '393x852', width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { name: '852x393', width: 852, height: 393, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
].filter((s) => !process.env.SIZES || process.env.SIZES.split(',').includes(s.name));
const quantile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const median = (a) => quantile(a, 0.5);
const load = () => os.loadavg()[0].toFixed(2);
const fixed = (v) => (v === undefined ? '-' : v.toFixed(2));

// Loads a build at `at` by the lake and holds its grid (see bench/lakeside.js).
async function goto(entry, at) {
  const { page } = entry;
  const url = `${entry.base}${entry.base.includes('?') ? '&' : '?'}${lakeside.LAKESIDE_QUERY}`;
  await page.goto(url, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.game?.metrics.frames > 30, { timeout: 300000 });
  await page.evaluate(`(${lakeside.placeAtLakeside})(game, ${JSON.stringify(at)})`);
  await page.evaluate((shadows, reduced) => {
    const { quality } = game;
    quality.scale = quality.minimum;
    if (reduced) game.native.pacer.cellCeiling = 12000;
    window.dispatchEvent(new Event('resize'));
    if (game.nightLight) game.nightLight.enabled = shadows;
    // Nothing may cut the run short: no monster, no wound.
    const guard = () => { game.monsters?.clear(); game.player.heal(1e6); requestAnimationFrame(guard); };
    guard();
  }, entry.shadows, REDUCED);
}

async function open(browser, name, size, shadows) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await page.setViewport(size);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const entry = { name, shadows, key: `${name}${name === 'after' ? (shadows ? ' on' : ' off') : ''}`,
    base: builds[name], page, cdp, windows: [], frames: [], zoom: [], night: [] };
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
  const work = [], night = [];
  let last = game.metrics.frames;
  const tick = () => {
    if (game.metrics.frames !== last) {
      last = game.metrics.frames;
      if (skip > 0) skip--;
      else {
        work.push(game.metrics.workMs);
        night.push(game.metrics.nightMs ?? 0);
      }
    }
    if (work.length >= n) resolve({ work, night }); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}), skip, n);

// Wakes a page, lets it warm up, times one window of frames, freezes it.
async function time(entry) {
  await entry.cdp.send('Page.setWebLifecycleState', { state: 'active' });
  // Headless Chrome only animates the tab in front.
  await entry.page.bringToFront();
  const { work, night } = await record(entry.page, WARM, FRAMES);
  await entry.cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  entry.windows.push({ median: median(work), p95: quantile(work, 0.95), night: median(night) });
}

// Walks a fresh page into a new spot and times its first frames, then zooms
// it right out and times those.
async function stall(entry, round) {
  await entry.page.bringToFront();
  await goto(entry, { x: lakeside.PLAYER.x + 700 * (round + 1), y: lakeside.PLAYER.y + 211 * round });
  const first = await record(entry.page, 0, ENTRY);
  for (let i = 0; i < 10; i++) await entry.page.keyboard.press('Minus');
  const zoom = await record(entry.page, 0, ZOOM);
  entry.frames.push(...first.work);
  entry.zoom.push(...zoom.work);
  entry.night.push(...first.night, ...zoom.night);
}

const drawn = (page) => page.evaluate(() => {
  const r = game.renderer, n = game.nightLight;
  return `${r.cols}x${r.rows} scale ${game.quality.scale.toFixed(2)}${n ? ` shaded ${n.active}` : ''}`;
});

let lakeside;
(async () => {
  lakeside = await import('./lakeside.js');
  const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900000 });
  console.log(`${SPIKES ? 'stalls' : 'steady'}, CPU throttle ${THROTTLE}x${REDUCED ? ', reduced cells' : ''},`,
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
          console.log(size.name, entry.key, `entry ${tails(entry.frames)}; zoom ${tails(entry.zoom)};`,
            `largest nightMs ${fixed(Math.max(...entry.night))}`, grid);
        } else {
          console.log(size.name, entry.key, `median ${median(entry.windows.map((w) => w.median)).toFixed(2)} ms`,
            `p95 ${median(entry.windows.map((w) => w.p95)).toFixed(2)} ms`,
            `nightMs ${fixed(median(entry.windows.map((w) => w.night)))}`, grid);
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
          console.log(size.name, `shadows' own cost (on - off): median ${paired(on, off, 'median').toFixed(2)} ms`,
            `(${share.toFixed(1)} %), p95 ${paired(on, off, 'p95').toFixed(2)} ms`);
        }
      }
      console.log(size.name, `load ${load()}`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
