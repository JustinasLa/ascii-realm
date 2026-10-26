// Frame work with warm light on stones: a held torch and two fires beside
// the nearest river, on two builds.
//   BEFORE_URL=http://127.0.0.1:8124/ AFTER_URL=http://127.0.0.1:8123/... node bench/lights.cjs
// Each build is opened once per size in one browser, lit and unlit (the
// control: the same spot with no torch or fire). Only one page runs at a
// time, in front, with the others frozen, and short timing windows take
// turns in an order that rotates and reverses every round, so a load that
// drifts on a busy machine falls on every page alike. Prints the median over the rounds
// of each page's window median and p95, the paired after - before
// difference, and the light's own cost: (after lit - after unlit) -
// (before lit - before unlit), round by round.
// Optional: ROUNDS (default 20), FRAMES per window (default 120), WARM
// frames before each window (default 30), LIGHTS=1 or LIGHTS=0 for the lit
// or unlit pages only, THROTTLE=<n> to slow the CPU n times,
// SIZES=1280x720,393x852 to pick the sizes, SHOTS=<dir> for a screenshot of
// each page after its last window.
const fs = require('node:fs');
const os = require('node:os');
const { join } = require('node:path');
// Optional browser tooling: npm install --no-save --package-lock=false puppeteer
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

const builds = { before: process.env.BEFORE_URL, after: process.env.AFTER_URL || 'http://localhost:8000/' };
const ROUNDS = Number(process.env.ROUNDS) || 20;
const FRAMES = Number(process.env.FRAMES) || 120;
const WARM = Number(process.env.WARM) || 30;
const LIT = process.env.LIGHTS === '0' ? [false] : process.env.LIGHTS === '1' ? [true] : [true, false];
const THROTTLE = Number(process.env.THROTTLE) || 1;
const SIZES = [
  { name: '1280x720', width: 1280, height: 720, deviceScaleFactor: 1 },
  { name: '393x852', width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
].filter((s) => !process.env.SIZES || process.env.SIZES.split(',').includes(s.name));
const quantile = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const median = (a) => quantile(a, 0.5);
const load = () => os.loadavg()[0].toFixed(2);

// Opens one build at the river bank, settles it and freezes it.
async function open(browser, base, size, lit) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await page.setViewport(size);
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const url = new URL(base);
  url.searchParams.set('seed', '1');
  url.searchParams.set('debug', '');
  url.searchParams.set('nogate', '');
  await page.goto(url.href, { waitUntil: 'load', timeout: 300000 });
  await page.waitForFunction(() => window.game?.metrics.frames > 30, { timeout: 300000 });
  // Stand on the bank of the nearest river, torch drawn, with two fires.
  await page.evaluate((lights) => {
    const { player, world, fires, torches, quality } = game;
    // Both builds draw the same grid at the same backing resolution: the
    // quality scaler and phone pacing would otherwise follow the load.
    quality.sample = () => false;
    game.native.pacer.sample = () => ({});
    quality.scale = quality.minimum;
    window.dispatchEvent(new Event('resize'));
    const at = world.nearestRiver(player.x, player.y, 2000);
    if (!at) throw new Error('no river near the start');
    // Where it runs most nearly east to west, nearest its middle, a few
    // steps out on its south bank, so it crosses the screen.
    const { river } = at, n = river.s.length;
    let i = n >> 1;
    for (let k = 0; k < n; k++) {
      const a = (n >> 1) + (k % 2 ? -1 : 1) * ((k + 1) >> 1);
      if (a >= 0 && a < n - 1 && Math.abs(river.dir[2 * a + 1]) < 0.35) { i = a; break; }
    }
    const mid = world.rivers.pointAt(river, river.s[i]);
    let ox = -river.dir[2 * i + 1], oy = river.dir[2 * i];
    if (oy < 0) { ox = -ox; oy = -oy; }
    const off = mid.halfWidth + 3;
    const x = Math.floor(mid.x + ox * off / 0.6) + 0.5, y = Math.floor(mid.y + oy * off) + 0.5;
    player.x = x; player.y = y;
    game.camera.x = x; game.camera.y = y - 11;
    game.monsters?.clear();
    if (lights) {
      if (!player.torch) torches.toggle(player);
      for (const [dx, dy] of [[-6, 2], [7, 3], [-9, -3], [10, -2]]) if (fires.list.length < 2) fires.add(world, x + dx, y + dy);
    } else if (player.torch) torches.toggle(player);
    // Nothing may cut the run short: no monster, no wound.
    const guard = () => { game.monsters?.clear(); player.heal(1e6); requestAnimationFrame(guard); };
    guard();
  }, lit);
  await new Promise((r) => setTimeout(r, 3000));
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  return { page, cdp, windows: [] };
}

// Wakes a page, lets it warm up, times one window of frames, freezes it.
async function time(entry) {
  await entry.cdp.send('Page.setWebLifecycleState', { state: 'active' });
  // Headless Chrome only animates the tab in front.
  await entry.page.bringToFront();
  const work = await entry.page.evaluate((warm, n) => new Promise((resolve) => {
    const out = [];
    let last = game.metrics.frames, skip = warm;
    const tick = () => {
      if (game.metrics.frames !== last) {
        last = game.metrics.frames;
        if (skip > 0) skip--; else out.push(game.metrics.workMs);
      }
      if (out.length >= n) resolve(out); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), WARM, FRAMES);
  await entry.cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  entry.windows.push({ median: median(work), p95: quantile(work, 0.95) });
}

// What each page drew: the grid (both builds must match) and how many stone
// cells and small cells carried a normal.
const drawn = (page) => page.evaluate(() => {
  const r = game.renderer, lit = (buf) => { let n = 0; for (let i = 2; i < (buf?.length ?? 0); i += 4) if (buf[i]) n++; return n; };
  return `${r.cols}x${r.rows} scale ${game.quality.scale.toFixed(2)} fires ${game.fires.list.length} stones ${lit(r.cellLit)}/${lit(r.fineLit)}`;
});

(async () => {
  const browser = await puppeteer.launch({ headless: true, protocolTimeout: 900000 });
  console.log(`CPU throttle ${THROTTLE}x, ${ROUNDS} rounds of ${FRAMES} frames (${WARM} warm-up), load ${load()}`);
  try {
    for (const size of SIZES) {
      const pages = [];
      for (const lit of LIT) {
        for (const name of ['before', 'after']) {
          if (!builds[name]) continue;
          pages.push({ name, lit, key: `${name} ${lit ? 'lit' : 'unlit'}`, ...await open(browser, builds[name], size, lit) });
        }
      }
      for (let round = 0; round < ROUNDS; round++) {
        const order = pages.map((_, i) => pages[(i + round) % pages.length]);
        if (round % 2) order.reverse();
        for (const entry of order) await time(entry);
        // One line a round, so a run cut short still has its rounds.
        console.log(size.name, `round ${round}`, pages.map((p) => `${p.key} ${p.windows[round].median.toFixed(2)}/${p.windows[round].p95.toFixed(2)}`).join(', '), `load ${load()}`);
      }
      const at = (key) => pages.find((p) => p.key === key);
      const paired = (a, b, field) => median(a.windows.map((w, i) => w[field] - b.windows[i][field]));
      for (const entry of pages) {
        await entry.cdp.send('Page.setWebLifecycleState', { state: 'active' });
        await entry.page.bringToFront();
        if (process.env.SHOTS) {
          fs.mkdirSync(process.env.SHOTS, { recursive: true });
          await entry.page.screenshot({ path: join(process.env.SHOTS, `lights-${entry.name}-${entry.lit ? 'lit' : 'unlit'}-${size.name}.png`) });
        }
        const grid = await drawn(entry.page);
        console.log(size.name, entry.key, `median ${median(entry.windows.map((w) => w.median)).toFixed(2)} ms`,
          `p95 ${median(entry.windows.map((w) => w.p95)).toFixed(2)} ms`, grid);
        await entry.page.close();
      }
      for (const lit of LIT) {
        const kind = lit ? 'lit' : 'unlit', a = at(`after ${kind}`), b = at(`before ${kind}`);
        if (a && b) console.log(size.name, `${kind} after - before: median ${paired(a, b, 'median').toFixed(2)} ms, p95 ${paired(a, b, 'p95').toFixed(2)} ms`);
      }
      const parts = ['after lit', 'after unlit', 'before lit', 'before unlit'].map(at);
      if (parts.every(Boolean)) {
        const [al, au, bl, bu] = parts;
        const cost = (field) => median(al.windows.map((w, i) => (w[field] - au.windows[i][field]) - (bl.windows[i][field] - bu.windows[i][field])));
        console.log(size.name, `light cost after - before: median ${cost('median').toFixed(2)} ms, p95 ${cost('p95').toFixed(2)} ms`);
      }
      console.log(size.name, `load ${load()}`);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
