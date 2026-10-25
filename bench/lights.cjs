// Frame work with warm light on stones: a held torch and two fires beside
// the nearest river, timed on two builds in alternating order (A B A B).
//   BEFORE_URL=http://127.0.0.1:8124/ AFTER_URL=http://127.0.0.1:8123/... node bench/lights.cjs
// Optional: PAIRS (default 2), FRAMES (default 600), SHOTS=<dir> for one
// screenshot of each run's last frame, LIGHTS=0 for the same spot with no
// torch or fire (the control), THROTTLE=<n> to slow the CPU n times,
// SIZES=1280x720,393x852 to pick the sizes.
const fs = require('node:fs');
const { join } = require('node:path');
// Optional browser tooling: npm install --no-save --package-lock=false puppeteer
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');

const builds = { before: process.env.BEFORE_URL, after: process.env.AFTER_URL || 'http://localhost:8000/' };
const PAIRS = Number(process.env.PAIRS) || 2;
const FRAMES = Number(process.env.FRAMES) || 600;
const LIGHTS = process.env.LIGHTS !== '0';
const THROTTLE = Number(process.env.THROTTLE) || 1;
const SIZES = [
  { name: '1280x720', width: 1280, height: 720, deviceScaleFactor: 1 },
  { name: '393x852', width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
].filter((s) => !process.env.SIZES || process.env.SIZES.split(',').includes(s.name));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.95)]; };

async function run(browser, base, size, shot) {
  const page = await browser.newPage();
  await page.setViewport(size);
  if (THROTTLE > 1) await (await page.createCDPSession()).send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const url = new URL(base);
  url.searchParams.set('seed', '1');
  url.searchParams.set('debug', '');
  url.searchParams.set('nogate', '');
  await page.goto(url.href, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.game?.metrics.frames > 30, { timeout: 180000 });
  // Stand on the bank of the nearest river, torch drawn, with two fires.
  await page.evaluate((lights) => {
    const { player, world, fires, torches } = game;
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
  }, LIGHTS);
  await new Promise((r) => setTimeout(r, 3000));
  const work = await page.evaluate((n) => new Promise((resolve) => {
    const out = [];
    let last = game.metrics.frames;
    const tick = () => {
      if (game.metrics.frames !== last) { last = game.metrics.frames; out.push(game.metrics.workMs); }
      if (out.length >= n) resolve(out); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), FRAMES);
  if (shot) await page.screenshot({ path: shot });
  // The grid both builds drew (the quality scaler may shrink it) and how
  // many stone cells and small cells carried a normal.
  const grid = await page.evaluate(() => {
    const r = game.renderer, lit = (buf) => { let n = 0; for (let i = 2; i < (buf?.length ?? 0); i += 4) if (buf[i]) n++; return n; };
    return `${r.cols}x${r.rows} scale ${game.quality.scale.toFixed(2)} fires ${game.fires.list.length} stones ${lit(r.cellLit)}/${lit(r.fineLit)}`;
  });
  await page.close();
  return { median: median(work), p95: p95(work), grid };
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  console.log(`lights ${LIGHTS ? 'on' : 'off'}, CPU throttle ${THROTTLE}x, ${PAIRS} pairs of ${FRAMES} frames`);
  const results = {};
  try {
    for (const size of SIZES) {
      results[size.name] = { before: [], after: [] };
      for (let pair = 0; pair < PAIRS; pair++) {
        for (const name of ['before', 'after']) {
          if (!builds[name]) continue;
          const shot = process.env.SHOTS && join(process.env.SHOTS, `lights-${name}-${size.name}-${pair}.png`);
          if (shot) fs.mkdirSync(process.env.SHOTS, { recursive: true });
          const r = await run(browser, builds[name], size, shot);
          results[size.name][name].push(r);
          console.log(size.name, name, pair, `median ${r.median.toFixed(2)} ms`, `p95 ${r.p95.toFixed(2)} ms`, r.grid);
        }
      }
    }
  } finally {
    await browser.close();
  }
  for (const [size, r] of Object.entries(results)) {
    const sum = (list, key) => list.length ? median(list.map((x) => x[key])).toFixed(2) : '-';
    console.log(`${size}: before median ${sum(r.before, 'median')} p95 ${sum(r.before, 'p95')} | after median ${sum(r.after, 'median')} p95 ${sum(r.after, 'p95')}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
