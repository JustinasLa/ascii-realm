const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
// Optional browser tooling: npm install --no-save --package-lock=false puppeteer
const puppeteer = require(process.env.PUPPETEER_MODULE || 'puppeteer');
const output = process.env.BENCH_OUTPUT || join(tmpdir(), 'ascii-realm-browser-check');
fs.mkdirSync(output, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));
// The frame-rate floor for the phone layouts at full CPU speed, and the
// renderers that draw in software (no GPU), where it cannot apply.
const MIN_FPS = 50;
const FPS_SIZES = new Set(['393x852', '852x393']);
const SOFTWARE_GL = /SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic Render/i;

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // Vibrations are recorded rather than felt.
    await page.evaluateOnNewDocument(() => {
      window.vibrations = [];
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: ms => { window.vibrations.push(ms); return true; } });
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const client = await page.createCDPSession();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const url = new URL(process.env.GAME_URL || 'http://localhost:8000/');
    url.searchParams.set('debug', '');
    await page.goto(url.href, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.game?.metrics.frames > 30);
    const results = { browser: await browser.version(), samples: [], checks: [] };
    // Every phone check below depends on touch emulation reporting a phone.
    assert.deepEqual(await page.evaluate(() => [matchMedia('(hover: none)').matches,
      matchMedia('(pointer: coarse)').matches, game.device.phone]), [true, true, true]);
    results.gpu = await page.evaluate(() => {
      const gl = game.renderer.gl;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    for (const [width, height] of [[320,568], [375,667], [390,844], [844,390]]) {
      await page.setViewport({ width, height, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
      await wait(150);
      const layout = await page.evaluate(() => {
        const shown = e => e.checkVisibility?.() ?? e.offsetParent !== null;
        const controls = [...document.querySelectorAll('#touch-controls button, #move-pad, #phone-menu')].filter(shown);
        const display = s => getComputedStyle(document.querySelector(s)).display;
        return { width: innerWidth, height: innerHeight,
          hidden: ['#panel-dock', '.hud-hotbar-wrap', '.hud-party', '.zoom-controls', '.hud-prompt', '#fire-status'].map(display),
          menu: shown(document.getElementById('phone-menu')),
          strip: document.querySelector('.hud-status').getBoundingClientRect().toJSON(),
          overflow: document.documentElement.scrollWidth > innerWidth,
          controls: controls.map(e => ({ name: e.getAttribute('aria-label'), ...e.getBoundingClientRect().toJSON() })),
          interact: document.getElementById('touch-interact').hidden,
          canvas: [game.renderer.canvas.width, game.renderer.canvas.height], cells: game.renderer.cols * game.renderer.rows,
          glError: game.renderer.gl.getError() };
      });
      assert.equal(layout.overflow, false);
      assert.equal(layout.glError, 0);
      assert.deepEqual(layout.hidden, Array(6).fill('none'));
      assert.ok(layout.menu);
      assert.ok(layout.strip.height <= (width > height ? 22 : 34), `strip ${layout.strip.height}px`);
      const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      // The gap between two rectangles, edge to edge.
      const gap = (a, b) => Math.hypot(Math.max(0, a.left - b.right, b.left - a.right), Math.max(0, a.top - b.bottom, b.top - a.bottom));
      const named = n => layout.controls.find(c => c.name === n);
      const cluster = ['Strike', 'Jump', 'Cast the bound rune. Hold to choose a rune.'].map(named);
      assert.ok(cluster.every(Boolean), 'STRIKE, JUMP and CAST are shown');
      assert.ok(cluster[0].width >= 72 && cluster[0].height >= 72, `STRIKE ${cluster[0].width}px`);
      for (const c of layout.controls) {
        assert.ok(c.width >= 44 && c.height >= 44, c.name);
        assert.ok(c.left >= 0 && c.top >= 0 && c.right <= width && c.bottom <= height, c.name);
        assert.ok(!overlap(c, layout.strip), `${c.name} covers the vitals`);
        for (const other of layout.controls) if (other !== c) assert.ok(!overlap(c, other), `${c.name} / ${other.name}`);
      }
      for (const c of cluster) {
        assert.ok(c.width >= 48 && c.height >= 48, c.name);
        assert.ok(c.left >= width / 2, `${c.name} sits in the right half`);
        for (const other of cluster) if (other !== c) assert.ok(gap(c, other) >= 16, `${c.name} / ${other.name} ${gap(c, other)}px apart`);
      }
      assert.ok(layout.controls.find(c => c.name?.startsWith('Drag')).right <= width / 2, 'the stick sits in the left half');
      assert.equal(layout.interact, true, 'INTERACT is hidden with nothing in reach');
      results.checks.push({ layout });
      if (width === 844) await page.screenshot({ path: join(output, 'landscape.png') });
    }
    // Portrait and landscape on three phones, with their safe-area insets:
    // the controls sit in the thumb zones, inside the safe rect, and the
    // default zoom keeps the view within the phone cell budget.
    const phones = [
      { name: 'se', width: 375, height: 667, dpr: 2, insets: { portrait: {}, landscape: {} } },
      { name: 'iphone15', width: 393, height: 852, dpr: 3,
        insets: { portrait: { top: 59, bottom: 34 }, landscape: { left: 59, right: 59, bottom: 21 } } },
      { name: 'pixel8', width: 412, height: 915, dpr: 2.625, insets: { portrait: { top: 24 }, landscape: { left: 24 } } },
    ];
    const orient = async (phone, orientation, shrink = 0) => {
      const [w, h] = orientation === 'landscape' ? [phone.height, phone.width] : [phone.width, phone.height];
      const insets = { top: 0, left: 0, bottom: 0, right: 0, ...phone.insets[orientation] };
      await client.send('Emulation.setSafeAreaInsetsOverride', { insets });
      await page.setViewport({ width: w, height: h - shrink, deviceScaleFactor: phone.dpr, isMobile: true, hasTouch: true,
        isLandscape: orientation === 'landscape' });
      return { w, h: h - shrink, insets };
    };
    const placement = () => page.evaluate(() => {
      const rect = s => document.querySelector(s).getBoundingClientRect().toJSON();
      const r = game.renderer, v = game.camera.view(r);
      return { w: innerWidth, h: innerHeight, stick: rect('#move-pad'), cluster: rect('.actions'), strip: rect('.hud-status'),
        buttons: [...document.querySelectorAll('#touch-controls .actions > button, #phone-menu')]
          .filter(e => e.checkVisibility()).map(e => e.getBoundingClientRect().toJSON()),
        cells: r.cols * r.rows, cell: r.cellH / r.dpr, orientation: game.layout.orientation, bias: game.layout.bias,
        expected: game.layout.phoneDefaultCell(game.layout.orientation, innerWidth, innerHeight, devicePixelRatio),
        targetY: (game.camera.y - v.y0 - v.offY / r.cellH) * r.cellH / r.canvas.height };
    });
    const inside = (c, { w, h, insets }, name) => assert.ok(c.left >= insets.left && c.top >= insets.top
      && c.right <= w - insets.right && c.bottom <= h - insets.bottom, `${name} leaves the safe area`);
    for (const phone of phones) {
      for (const orientation of ['portrait', 'landscape']) {
        const screen = await orient(phone, orientation);
        await wait(300);
        const at = await placement();
        const label = `${phone.name} ${orientation}`;
        assert.equal(at.orientation, orientation, label);
        for (const [name, c] of [['stick', at.stick], ['cluster', at.cluster], ['strip', at.strip], ...at.buttons.map(b => ['button', b])]) {
          inside(c, screen, `${label} ${name}`);
        }
        const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        assert.ok(!overlap(at.stick, at.cluster), `${label} stick / cluster`);
        const { insets, w, h } = screen;
        if (orientation === 'portrait') {
          assert.ok(at.stick.right <= w / 2 && at.cluster.left >= w / 2, `${label} stick left, cluster right`);
          for (const c of [at.stick, at.cluster]) assert.ok(h - c.bottom <= insets.bottom + 24, `${label} low in the thumb zone`);
        } else {
          assert.ok(at.stick.left <= insets.left + 24 && w - at.cluster.right <= insets.right + 24, `${label} at the edges`);
          for (const c of [at.stick, at.cluster]) {
            const mid = (c.top + c.bottom) / 2 / h;
            assert.ok(mid >= 0.5 && mid <= 0.85, `${label} mid-to-low (${mid.toFixed(2)})`);
            assert.ok(c.right <= w / 2 - 120 || c.left >= w / 2 + 120, `${label} keeps the middle clear`);
          }
        }
        assert.ok(at.cells <= 16000, `${label} ${at.cells} cells`);
        assert.ok(Math.abs(at.cell - at.expected) < 0.01, `${label} cell ${at.cell} vs ${at.expected}`);
        assert.ok(Math.abs(at.targetY - (orientation === 'portrait' ? 0.6 : 0.5)) < 0.02, `${label} framing ${at.targetY}`);
        results.checks.push({ orientation: { label, ...at } });
      }
    }
    // Turning the phone while the stick and STRIKE are held keeps both, and
    // the controls re-lay out within a frame.
    {
      const phone = phones[1];
      await orient(phone, 'portrait');
      await wait(300);
      const point = (id, p) => ({ id, x: Math.round(p.x), y: Math.round(p.y), radiusX: 5, radiusY: 5, force: 1 });
      const centre = s => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, s);
      const pad = await centre('#move-pad'), strike = await centre('.strike');
      let finger = { x: pad.x + 30, y: pad.y };
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, pad)] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, finger)] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(1, finger), point(2, strike)] });
      await wait(200);
      const held = () => page.evaluate(async () => {
        const { input } = await import('./src/core/input.js');
        return { move: input.moveAxis(), strike: input.isDown('TouchStrike'), x: game.player.x };
      });
      for (const orientation of ['landscape', 'portrait']) {
        await orient(phone, orientation);
        const relaid = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() =>
          resolve(document.getElementById('move-pad').getBoundingClientRect().right / innerWidth))));
        assert.ok(relaid <= (orientation === 'landscape' ? 0.25 : 0.5), `${orientation} re-laid out (${relaid})`);
        finger = { x: finger.x + 2, y: finger.y };
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(1, finger), point(2, strike)] });
        const start = await held();
        await wait(500);
        const end = await held();
        assert.ok(start.move.x > 0.5 && end.strike, `${orientation}: still walking and striking`);
        assert.ok(end.x > start.x, `${orientation}: the outlaw keeps walking`);
        results.checks.push({ rotation: { orientation, relaid, start, end } });
      }
      // A browser bar sliding in shortens the view; the stick keeps going.
      await orient(phone, 'portrait', 56);
      await wait(200);
      const short = { ...(await held()), ...(await placement()) };
      assert.ok(short.move.x > 0.5);
      for (const c of [short.stick, short.cluster]) assert.ok(c.bottom <= short.h);
      await orient(phone, 'portrait');
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point(1, finger), point(2, strike)] });
      await wait(100);
      const released = await held();
      assert.deepEqual([released.move, released.strike], [{ x: 0, y: 0 }, false]);
      // A wheel held on CAST follows the turn to the new centre.
      const cast = await centre('#touch-cast');
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(3, cast)] });
      await page.waitForFunction(() => !document.getElementById('spell-wheel').hidden, { timeout: 5000 });
      await orient(phone, 'landscape');
      await wait(200);
      const ring = await page.evaluate(() => {
        const r = document.querySelector('.spell-wheel-ring').getBoundingClientRect();
        return { open: !document.getElementById('spell-wheel').hidden, dx: r.x + r.width / 2 - innerWidth / 2, dy: r.y + r.height / 2 - innerHeight / 2 };
      });
      assert.ok(ring.open && Math.abs(ring.dx) <= 2 && Math.abs(ring.dy) <= 2, `wheel ${JSON.stringify(ring)}`);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [point(3, cast)] });
      await wait(200);
      // A pinch belongs to its orientation; the other keeps its default.
      await orient(phone, 'portrait');
      await wait(200);
      const mid = { x: 196, y: 400 };
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(5, { x: mid.x - 40, y: mid.y }), point(6, { x: mid.x + 40, y: mid.y })] });
      for (let step = 1; step <= 6; step++) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(5, { x: mid.x - 40 - step * 6, y: mid.y }), point(6, { x: mid.x + 40 + step * 6, y: mid.y })] });
        await wait(30);
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(700);
      const pinched = (await placement()).cell;
      assert.ok(pinched > 7, `pinched to ${pinched}`);
      await orient(phone, 'landscape');
      await wait(200);
      assert.equal((await placement()).cell, 6);
      await orient(phone, 'portrait');
      await wait(200);
      assert.ok(Math.abs((await placement()).cell - pinched) < 0.05, 'portrait gets its pinch back');
      // Nothing is saved: a reload starts from the defaults again.
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.game?.metrics.frames > 30, { timeout: 180000 });
      assert.equal((await placement()).cell, 6.5, 'a reload forgets the pinch');
      results.checks.push({ orientationHold: { short, released, ring, pinched } });
      await client.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, bottom: 0, right: 0 } });
    }
    const runs = [[390, 844, 1], [390, 844, 4], [390, 844, 6], [393, 852, 1], [393, 852, 4], [852, 393, 1], [852, 393, 4]];
    for (const [width, height, rate] of runs) {
      await page.setViewport({ width, height, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: width > height });
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
      results.samples.push({ width, height, rate, ...sample });
      console.log(JSON.stringify({ width, height, rate, ...sample }));
      // The phone layouts must hold 50 FPS at full CPU speed. A software
      // renderer measures the CPU drawing pixels, not the game, so it is
      // exempt, and says so.
      if (rate === 1 && FPS_SIZES.has(`${width}x${height}`)) {
        if (SOFTWARE_GL.test(results.gpu)) {
          const exemption = { width, height, fps: sample.fps, exempt: `software renderer: ${results.gpu}` };
          results.checks.push({ fpsExemption: exemption });
          console.log(JSON.stringify({ fpsExemption: exemption }));
        } else {
          assert.ok(sample.fps >= MIN_FPS, `${width}x${height} at 1x CPU: ${sample.fps.toFixed(1)} FPS, below ${MIN_FPS}`);
        }
      }
    }
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await wait(300);
    const centers = await page.evaluate(() => {
      const center = e => { const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; };
      return { pad: center(document.getElementById('move-pad')), jump: center(document.querySelector('[data-key="Space"]')),
        strike: center(document.querySelector('[data-key="TouchStrike"]')), cast: center(document.getElementById('touch-cast')) };
    });
    const touch = (id,p) => ({ id, x:Math.round(p.x), y:Math.round(p.y), radiusX:5, radiusY:5, force:1 });
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
    // Still walking: lift JUMP and STRIKE, then tap CAST. Touch events name
    // only the finger that changes. The lift is sent without waiting for the
    // press to be handled, so a slow renderer can't turn the tap into a hold.
    await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[touch(2,centers.jump),touch(3,centers.strike)] });
    const manaBefore = await page.evaluate(() => game.casting.mana);
    const tapDown = client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[touch(4,centers.cast)] });
    await wait(80);
    await Promise.all([tapDown, client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[touch(4,centers.cast)] })]);
    await wait(300);
    const cast = await page.evaluate(async () => {
      const {input} = await import('./src/core/input.js');
      return { mana: game.casting.mana, move: input.moveAxis(),
        wheel: !document.getElementById('spell-wheel').hidden };
    });
    assert.ok(cast.mana < manaBefore, `the tap cast (mana ${manaBefore} -> ${cast.mana})`);
    assert.notEqual(cast.move.x, 0);
    assert.equal(cast.wheel, false);
    // Holding CAST opens the wheel on that finger while the stick keeps steering.
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[touch(5,centers.cast)] });
    await wait(400);
    await page.waitForFunction(() => !document.getElementById('spell-wheel').hidden, { timeout: 5000 });
    const wheel = await page.evaluate(async () => {
      const {input} = await import('./src/core/input.js');
      return { open: !document.getElementById('spell-wheel').hidden, move: input.moveAxis(), mana: game.casting.mana };
    });
    assert.equal(wheel.open, true);
    assert.notEqual(wheel.move.x, 0);
    await page.screenshot({ path: join(output, 'cast-hold-wheel.png') });
    await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[touch(5,centers.cast)] });
    await wait(300);
    const lifted = await page.evaluate(() => ({ open: !document.getElementById('spell-wheel').hidden, mana: game.casting.mana }));
    assert.equal(lifted.open, false, 'lifting in the hub puts the wheel away');
    assert.ok(lifted.mana >= wheel.mana, 'a hold never casts');
    results.checks.push({ cast, wheel, lifted });
    await client.send('Input.dispatchTouchEvent', { type:'touchCancel', touchPoints:[] });
    const cancelled = await page.evaluate(async () => {
      const {input} = await import('./src/core/input.js');
      return {move:input.moveAxis(),pointers:input.pointers.size,pressed:document.querySelectorAll('.pressed').length};
    });
    assert.deepEqual(cancelled,{move:{x:0,y:0},pointers:0,pressed:0});
    results.checks.push({ multiTouch: { moved, actions, cancelled } });
    // Aim assist: a skeleton 1.5 m away, 20 degrees off the facing, is turned
    // to; one 45 degrees off is not.
    for (const [angle, turns] of [[20, true], [45, false]]) {
      await wait(1200);
      const placed = await page.evaluate(async angle => {
        const { Monster, toCells } = await import('./src/entities/monsters.js');
        const p = game.player, bearing = p.heading + angle * Math.PI / 180;
        const [dx, dy] = toCells(Math.sin(bearing) * 1.5, Math.cos(bearing) * 1.5);
        game.monsters.list.length = 0;
        const foe = new Monster(p.x + dx, p.y + dy, { risen: true });
        foe.update = () => {};
        game.monsters.list.push(foe);
        window.foe = foe;
        window.vibrations.length = 0;
        return { heading: p.heading, bearing, health: foe.health };
      }, angle);
      await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[touch(6,centers.strike)] });
      await wait(60);
      await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
      await wait(700);
      const after = await page.evaluate(() => ({ heading: game.player.heading, health: window.foe.health, vibrations: [...window.vibrations] }));
      const off = d => Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180 / Math.PI;
      if (turns) {
        assert.ok(off(after.heading - placed.bearing) < 3, `turned ${off(after.heading - placed.bearing)} degrees short`);
        assert.ok(after.health < placed.health, 'the assisted cut lands');
        assert.deepEqual(after.vibrations.slice(0, 1), [12], 'a landed cut buzzes');
      } else assert.ok(off(after.heading - placed.heading) < 3, 'a foe outside the cone is ignored');
      results.checks.push({ assist: { angle, placed, after } });
    }
    await page.evaluate(() => { game.monsters.list.length = 0; window.vibrations.length = 0; game.player.takeDamage(5); });
    await wait(100);
    assert.deepEqual(await page.evaluate(() => window.vibrations), [30], 'a wound buzzes');
    // The contextual button: idle, it touches the page not at all.
    const writes = await page.evaluate(() => new Promise(resolve => {
      let count = 0;
      const observer = new MutationObserver(list => { count += list.length; });
      observer.observe(document.getElementById('touch-interact'), { attributes: true, childList: true, characterData: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(count); }, 2000);
    }));
    assert.equal(writes, 0);
    // By a campfire it offers DOUSE, and its tap puts that fire out.
    const lit = await page.evaluate(() => {
      const p = game.player;
      for (const [dx, dy] of [[0, 6], [8, 0], [-8, 0], [0, -6], [0, 9]]) if (game.fires.add(game.world, p.x + dx, p.y + dy)) break;
      return game.fires.list.length;
    });
    assert.ok(lit > 0);
    await wait(200);
    const douse = await page.evaluate(() => { const b = document.getElementById('touch-interact'); const r = b.getBoundingClientRect();
      return { hidden: b.hidden, text: b.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    assert.equal(douse.hidden, false);
    assert.equal(douse.text, 'DOUSE');
    await page.screenshot({ path: join(output, 'interact-douse.png') });
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[touch(7,douse)] });
    await wait(60);
    await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    await wait(150);
    assert.equal(await page.evaluate(() => game.fires.list.length), lit - 1);
    results.checks.push({ interact: { writes, douse } });
    // Phones pinch the scene instead of using the zoom buttons.
    const cellBefore = await page.evaluate(()=>game.renderer.cellH/game.renderer.dpr);
    const mid = { x: 195, y: 360 };
    const spread = d => [touch(1,{x:mid.x-d,y:mid.y}),touch(2,{x:mid.x+d,y:mid.y})];
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:spread(40) });
    for (let step = 1; step <= 10; step++) {
      await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:spread(40 + step * 4) });
      await wait(16);
    }
    await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    await wait(650);
    const zoomed = await page.evaluate(()=>({cell:game.renderer.cellH/game.renderer.dpr,error:game.renderer.gl.getError()}));
    assert.ok(zoomed.cell>cellBefore);
    assert.equal(zoomed.error,0);
    results.checks.push({pinch:zoomed});
    // The corner menu: a full-screen sheet with Inventory, Multiplayer and Audio only.
    await page.tap('#phone-menu');
    await wait(200);
    const sheet = await page.evaluate(() => {
      const r = document.getElementById('panel-dock').getBoundingClientRect();
      const display = id => getComputedStyle(document.getElementById(id)).display;
      return { full: r.width === innerWidth && r.height === innerHeight,
        controls: getComputedStyle(document.getElementById('touch-controls')).visibility,
        panels: ['scenery-builder', 'weather-panel', 'help-controls'].map(display) };
    });
    assert.deepEqual(sheet, { full: true, controls: 'hidden', panels: ['none', 'none', 'none'] });
    await page.tap('#phone-menu-inventory');
    await wait(200);
    assert.deepEqual(await page.evaluate(() => [game.inventoryScreen.isOpen, game.phoneMenu.open]), [true, false]);
    await page.keyboard.press('Escape');
    await page.tap('#phone-menu');
    await wait(100);
    await page.tap('#phone-menu-close');
    await wait(100);
    assert.deepEqual(await page.evaluate(async () => {
      const { isGameplayBlocked } = await import('./src/core/input.js');
      return [game.inventoryScreen.isOpen, game.phoneMenu.open, isGameplayBlocked(), document.body.className];
    }), [false, false, false, '']);
    const start = await page.evaluate(() => ({ x:game.player.x, y:game.player.y }));
    await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[touch(1,centers.pad)] });
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[touch(1,{x:centers.pad.x+35,y:centers.pad.y})] });
    await wait(400);
    await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    const walked = await page.evaluate(s => Math.hypot(game.player.x-s.x, game.player.y-s.y), start);
    assert.ok(walked > 1, 'the joystick walks again after the menu');
    // Phones can't build scenery.
    assert.equal(await page.evaluate(() => game.builder.setEnabled(true)), false);
    results.checks.push({ phoneMenu: sheet, walked });
    // Tablets keep the zoom buttons and the full layout.
    await page.setViewport({ width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await wait(300);
    assert.equal(await page.evaluate(() => game.device.phone), false);
    assert.equal(await page.evaluate(() => game.layout.bias), 0, 'tablets keep the camera centred');
    const tabletBefore = await page.evaluate(()=>game.renderer.cellH/game.renderer.dpr);
    await page.tap('[aria-label="Zoom in"]');
    await wait(650);
    const tabletZoom = await page.evaluate(()=>({cell:game.renderer.cellH/game.renderer.dpr,error:game.renderer.gl.getError()}));
    assert.ok(tabletZoom.cell>tabletBefore);
    assert.equal(tabletZoom.error,0);
    results.checks.push({tabletZoom});
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    await wait(300);
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
