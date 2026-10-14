// Optional browser tooling, as in browser.cjs. CPU throttling simulates a
// slower CPU; it does not emulate an older GPU or guarantee hardware FPS.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const output = process.env.BENCH_OUTPUT || join(tmpdir(), 'ascii-realm-low-end');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const client = await page.createCDPSession();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    const builds = process.env.GAME_BASELINE_URL ? [
      ['before', process.env.GAME_BASELINE_URL],
      ['after', process.env.GAME_URL || 'http://localhost:8000/'],
    ] : [['after', process.env.GAME_URL || 'http://localhost:8000/']];
    const results = { browser: await browser.version(), samples: [], checks: [] };
    for (const rate of [1, 2, 4, 6]) {
      for (const [build, base] of builds) {
        await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        const url = new URL(base);
        url.searchParams.set('debug', '');
        url.searchParams.set('name', 'Robin');
        await page.goto(url.href, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => window.game?.model && game.metrics.frames > 60);
        await page.evaluate(() => {
          // Compare the complete scene at the same zoom and full backing
          // resolution, even under load. No detail or effects are removed.
          game.quality.minimum = game.quality.maximum = game.quality.scale = 1;
          dispatchEvent(new Event('resize'));
        });
        await client.send('Emulation.setCPUThrottlingRate', { rate });
        const sample = await page.evaluate(() => new Promise(resolve => {
          const times = [], intervals = [];
          let previous = game.metrics.frames, last = performance.now(), warmup = 30;
          function collect(now) {
            if (game.metrics.frames !== previous) {
              if (warmup > 0) warmup--;
              else { times.push(game.metrics.workMs); intervals.push(now - last); }
              previous = game.metrics.frames;
              last = now;
            }
            if (times.length < 120) return requestAnimationFrame(collect);
            times.sort((a, b) => a - b);
            const gl = game.renderer.gl;
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            resolve({ cpuMedian: times[60], cpuP95: times[114],
              fps: 1000 / (intervals.reduce((a, b) => a + b, 0) / intervals.length),
              cells: game.renderer.cols * game.renderer.rows,
              canvas: [game.renderer.canvas.width, game.renderer.canvas.height],
              pixelScale: game.quality.scale, glError: gl.getError(),
              gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) });
          }
          requestAnimationFrame(collect);
        }));
        assert.equal(sample.glError, 0);
        assert.equal(sample.pixelScale, 1);
        assert.deepEqual(sample.canvas, [1280, 800]);
        results.samples.push({ build, rate, ...sample });
        console.log(JSON.stringify({ build, rate, ...sample }));
      }
    }
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    results.checks.push(await page.evaluate(async () => {
      const { GLYPH_COUNT } = await import('./src/render/glyphs.js');
      const r = game.renderer, gl = r.gl, atlas = r.atlas.canvas;
      const rgba = atlas.getContext('2d').getImageData(0, 0, atlas.width, atlas.height).data;
      const red = new Uint8Array(atlas.width * atlas.height);
      for (let i = 0; i < red.length; i++) red[i] = rgba[i * 4];
      const differences = [];
      for (const cell of [6, 8, 24]) {
        r.resize(1280, 800, 1, cell * 0.6, cell);
        for (let i = 0; i < r.cols * r.rows; i++) {
          r.putAt(i, i % GLYPH_COUNT, 180, 210, 240);
          r.layerAt(i, (i * 7) % GLYPH_COUNT, 240, 180, 90);
          r.bg[i * 4] = 10; r.bg[i * 4 + 1] = 20; r.bg[i * 4 + 2] = 30;
        }
        const images = [];
        for (const singleChannel of [true, false]) {
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, r.atlasTex);
          if (singleChannel) {
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, atlas.width, atlas.height, 0, gl.RED, gl.UNSIGNED_BYTE, red);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
          } else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
          gl.generateMipmap(gl.TEXTURE_2D);
          r.draw();
          const pixels = new Uint8Array(1280 * 800 * 4);
          gl.readPixels(0, 0, 1280, 800, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          images.push(pixels);
        }
        let changed = 0;
        for (let i = 0; i < images[0].length; i++) if (images[0][i] !== images[1][i]) changed++;
        differences.push({ cell, changed });
      }
      return { atlas: { width: atlas.width, height: atlas.height,
        rgbaBytes: rgba.length, coverageBytes: red.length, differences, glError: gl.getError() } };
    }));
    assert.equal(results.checks[0].atlas.glError, 0);
    assert.ok(results.checks[0].atlas.differences.every(result => result.changed === 0), 'R8 atlas must render identical pixels');
    // Reload after the synthetic atlas comparison to inspect the real game.
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.game?.model && game.metrics.frames > 15);
    const poseMatches = await page.evaluate(() => {
      game.freeze = true;
      const m = game.model, p = game.player, view = game.camera.view(game.renderer);
      const buffered = JSON.stringify(m.rasterise(view, p.x, p.y));
      m.renderPose(p.x, p.y);
      const pipelined = JSON.stringify(m.rasterise(view, p.x, p.y));
      const gl = m.renderer.getContext();
      const getBufferSubData = gl.getBufferSubData;
      let direct;
      try {
        gl.getBufferSubData = undefined;
        direct = JSON.stringify(m.rasterise(view, p.x, p.y));
      } finally { gl.getBufferSubData = getBufferSubData; }
      game.freeze = false;
      return direct === buffered && direct === pipelined && m.cells.length > 0;
    });
    assert.ok(poseMatches, 'same-frame GPU pipeline must preserve character cells');
    results.checks.push({ sameFramePose: poseMatches });
    await page.focus('#screen');
    const before = await page.evaluate(() => ({ x: game.player.x, y: game.player.y, torch: Boolean(game.player.torch) }));
    await page.keyboard.down('w');
    await new Promise(resolve => setTimeout(resolve, 600));
    await page.keyboard.up('w');
    const moved = await page.evaluate(() => ({ x: game.player.x, y: game.player.y }));
    assert.ok(Math.hypot(moved.x - before.x, moved.y - before.y) > 0.1);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => game.player.air > 0);
    await page.keyboard.press('t');
    await page.waitForFunction(torch => Boolean(game.player.torch) !== torch, {}, before.torch);
    await page.keyboard.press('i');
    await page.waitForFunction(() => game.inventoryScreen.isOpen);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !game.inventoryScreen.isOpen);
    results.checks.push({ movement: true, jump: true, torch: true, inventory: true });
    await page.screenshot({ path: join(output, 'game.png') });
    assert.deepEqual(errors, []);
    results.errors = errors;
    fs.writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ output, checks: results.checks }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
