const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
// Optional browser tooling: npm install --no-save --package-lock=false puppeteer
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const output = process.env.BENCH_OUTPUT || join(tmpdir(), 'ascii-realm-browser-check');
fs.mkdirSync(output, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const client = await page.createCDPSession();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const url = new URL(process.env.GAME_URL || 'http://localhost:8000/');
    url.searchParams.set('debug', '');
    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.game?.metrics.frames > 30);
    const results = { browser: await browser.version(), samples: [], checks: [] };
    results.gpu = await page.evaluate(() => {
      const gl = game.renderer.gl;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    for (const [width, height] of [[320,568], [375,667], [390,844], [844,390]]) {
      await page.setViewport({ width, height, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await wait(150);
      const layout = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('#touch-controls button, #move-pad')];
        return { width: innerWidth, height: innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
          controls: controls.map(e => ({ name: e.getAttribute('aria-label'), ...e.getBoundingClientRect().toJSON() })),
          canvas: [game.renderer.canvas.width, game.renderer.canvas.height], cells: game.renderer.cols * game.renderer.rows,
          glError: game.renderer.gl.getError() };
      });
      assert.equal(layout.overflow, false);
      assert.equal(layout.glError, 0);
      for (const c of layout.controls) {
        assert.ok(c.width >= 44 && c.height >= 44, c.name);
        assert.ok(c.left >= 0 && c.top >= 0 && c.right <= width && c.bottom <= height, c.name);
      }
      results.checks.push({ layout });
      if (width === 844) await page.screenshot({ path: join(output, 'landscape.png') });
    }
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    for (const rate of [1, 4, 6]) {
      await client.send('Emulation.setCPUThrottlingRate', { rate });
      await wait(rate === 6 ? 10000 : 2000);
      const sample = await page.evaluate(() => new Promise(resolve => {
        let previous = game.metrics.frames;
        let last = performance.now();
        const times = [], work = [];
        function collect(now) {
          if (game.metrics.frames !== previous) {
            if (previous > 0) { times.push(now - last); work.push(game.metrics.workMs); }
            last = now;
            previous = game.metrics.frames;
          }
          if (times.length < 180) return requestAnimationFrame(collect);
          times.shift(); work.shift();
          times.sort((a,b)=>a-b); work.sort((a,b)=>a-b);
          resolve({ fps: 1000 / (times.reduce((a,b)=>a+b,0) / times.length),
            intervalP95: times[Math.floor(times.length*.95)],
            cpuMedian: work[Math.floor(work.length*.5)], cpuP95: work[Math.floor(work.length*.95)],
            pixelScale: game.quality.scale, cells: game.renderer.cols * game.renderer.rows });
        }
        requestAnimationFrame(collect);
      }));
      results.samples.push({ rate, ...sample });
      console.log(JSON.stringify({ rate, ...sample }));
    }
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const centers = await page.evaluate(() => {
      const center = e => { const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; };
      return { pad: center(document.getElementById('move-pad')), jump: center(document.querySelector('[data-key="Space"]')),
        strike: center(document.querySelector('[data-key="KeyJ"]')) };
    });
    const touch = (id,p) => ({ id, x:p.x, y:p.y, radiusX:5, radiusY:5, force:1 });
    const before = await page.evaluate(() => ({ x:game.player.x, y:game.player.y }));
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[touch(1,centers.pad)] });
    const held = touch(1,{x:centers.pad.x+35,y:centers.pad.y-20});
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[held] });
    await wait(500);
    const moved = await page.evaluate(() => ({ x:game.player.x,y:game.player.y,run:game.player.run }));
    assert.ok(Math.hypot(moved.x-before.x,moved.y-before.y)>1);
    assert.ok(moved.run > .5);
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[held,touch(2,centers.jump),touch(3,centers.strike)] });
    await wait(160);
    const actions = await page.evaluate(async () => {
      const {input} = await import('./src/core/input.js');
      return { air:game.player.air,combat:game.player.combat.move,held:input.pointers.size,move:input.moveAxis() };
    });
    assert.ok(actions.air>0);
    assert.ok(actions.combat);
    assert.equal(actions.held,2);
    assert.notEqual(actions.move.x,0);
    await client.send('Input.dispatchTouchEvent', { type:'touchCancel', touchPoints:[] });
    const cancelled = await page.evaluate(async () => {
      const {input} = await import('./src/core/input.js');
      return {move:input.moveAxis(),pointers:input.pointers.size,pressed:document.querySelectorAll('.pressed').length};
    });
    assert.deepEqual(cancelled,{move:{x:0,y:0},pointers:0,pressed:0});
    results.checks.push({ multiTouch: { moved, actions, cancelled } });
    const cellBefore = await page.evaluate(()=>game.renderer.cellH/game.renderer.dpr);
    await page.tap('[aria-label="Zoom in"]');
    await wait(650);
    const zoomed = await page.evaluate(()=>({cell:game.renderer.cellH/game.renderer.dpr,error:game.renderer.gl.getError()}));
    assert.ok(zoomed.cell>cellBefore);
    assert.equal(zoomed.error,0);
    results.checks.push({zoom:zoomed});
    const foreground = await browser.newPage();
    await foreground.bringToFront();
    await wait(100);
    const paused = await page.evaluate(()=>({hidden:document.hidden,frames:game.metrics.frames,time:game.player.time}));
    await wait(250);
    const pausedAfter = await page.evaluate(()=>({frames:game.metrics.frames,time:game.player.time}));
    assert.ok(paused.hidden);
    assert.equal(pausedAfter.frames,paused.frames);
    assert.equal(pausedAfter.time,paused.time);
    await foreground.close();
    await page.bringToFront();
    await wait(100);
    assert.ok(await page.evaluate(n=>game.metrics.frames>n,paused.frames));
    results.checks.push({backgroundPause:true});
    await page.evaluate(()=>{window.lose=game.renderer.gl.getExtension('WEBGL_lose_context');window.lose.loseContext();});
    await page.waitForFunction(()=>!document.getElementById('status').hidden);
    const lost = await page.evaluate(()=>game.metrics.frames);
    await wait(150);
    assert.equal(await page.evaluate(()=>game.metrics.frames),lost);
    await page.evaluate(()=>window.lose.restoreContext());
    await page.waitForFunction(()=>document.getElementById('status').hidden);
    await page.waitForFunction(n=>game.metrics.frames>n,{},lost);
    const restored = await page.evaluate(()=>({error:game.renderer.gl.getError(),fg:game.renderer.fg.some(v=>v>0)}));
    assert.equal(restored.error,0); assert.ok(restored.fg);
    results.checks.push({contextRestored:true});
    await page.screenshot({path:join(output, 'restored.png')});
    assert.deepEqual(errors,[]);
    results.errors=errors;
    fs.writeFileSync(join(output, 'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({ checks: results.checks.length, errors, output }, null, 2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
