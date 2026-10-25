import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CELL_CEILING, FrameClock, FramePacer, FrameQuality, PHONE_PACING, renderSize } from '../src/render/budget.js';
import { gridSize } from '../src/core/layout.js';

test('DPR-3 phones retain their world scale with one quarter of the pixels', () => {
  for (const [w, h] of [[390, 844], [844, 390], [360, 640]]) {
    const size = renderSize(w, h, 3, 8, true);
    assert.equal(size.dpr, 1.5);
    assert.equal(size.cell, 8);
    assert.ok(Math.round(w * size.dpr) * Math.round(h * size.dpr) <= 1_200_000);
  }
});

test('the requested zoom is kept on ordinary screens at every zoom level', () => {
  const cases = [[1920, 1080, false, 4.5], [1366, 768, false, 4.5], [390, 844, true, 6], [2560, 1440, false, 4.5]];
  for (const [w, h, mobile, smallest] of cases) {
    for (const cell of [smallest, 8, 12, 24]) {
      assert.equal(renderSize(w, h, 1, cell, mobile).cell, cell, `${w}x${h} at ${cell}px`);
      assert.equal(renderSize(w, h, 1, cell, mobile, 0.3).cell, cell, 'load lowers resolution, not zoom');
    }
  }
});

test('lowered resolution never shrinks glyphs below what the renderer can draw', () => {
  for (const [w, h] of [[3840, 2160], [2560, 1440], [1920, 1080]]) {
    const size = renderSize(w, h, 2, 8, false, 0.3);
    assert.ok(size.cell * 0.6 * size.dpr >= 2 - 1e-9 && size.cell * size.dpr >= 3 - 1e-9);
  }
});

test('the furthest zoom keeps legible glyphs under load', () => {
  const size = renderSize(1600, 900, 1, 4.5, false, 0.3);
  assert.equal(size.cell, 4.5);
  assert.ok(size.cell * 0.6 * size.dpr >= 2 - 1e-9 && size.cell * size.dpr >= 3 - 1e-9);
});

test('huge screens respect the hard cell ceiling and the pixel budget', () => {
  for (const [w, h] of [[3840, 2160], [7680, 4320], [800, 1280], [12000, 200]]) {
    for (const mobile of [true, false]) {
      const size = renderSize(w, h, 3, 6, mobile, 0.5);
      const cells = (Math.ceil(w / (size.cell * 0.6)) + 1) * (Math.ceil(h / size.cell) + 1);
      assert.ok(cells <= (mobile ? CELL_CEILING.mobile : CELL_CEILING.desktop), `${cells} cells`);
      // Within the pixel budget, unless that would make readable glyphs
      // smaller than the renderer can draw them.
      const budget = Math.sqrt((mobile ? 1_200_000 : 2_500_000) * 0.5 / (w * h));
      const legible = Math.max(2 / (size.cell * 0.6), 3 / size.cell);
      assert.ok(size.dpr <= Math.max(budget, legible) + 1e-9);
    }
  }
});

test('only a sustained GPU bottleneck lowers resolution; spikes and CPU-heavy frames do not', () => {
  const quality = new FrameQuality();
  // Quick frames with one hitch.
  for (let i = 0; i < 60; i++) quality.sample(i === 20 ? 100 : 4, i === 20 ? 0.1 : 1 / 60);
  assert.equal(quality.scale, 1);
  // Many cells: frames are late because their own work is slow. Fewer
  // pixels would not help, so every character stays sharp.
  for (let i = 0; i < 600; i++) quality.sample(30, 1 / 30);
  assert.equal(quality.scale, 1);
  // Late frames whose work was quick are waiting on the GPU.
  for (let i = 0; i < 240; i++) quality.sample(5, 1 / 30);
  const reduced = quality.scale;
  assert.ok(reduced < 1);
  for (let i = 0; i < 30; i++) quality.sample(5, 1 / 60);
  assert.equal(quality.scale, reduced, 'recovery waits for frames to keep pace for a while');
  for (let i = 0; i < 600; i++) quality.sample(5, 1 / 60);
  assert.ok(quality.scale > reduced);
  for (let i = 0; i < 6000; i++) quality.sample(5, 1 / 20);
  assert.equal(quality.scale, 0.3);
});

test('60/90/120/144Hz screens run about 60 frames and preserve simulation time', () => {
  for (const hz of [60, 90, 120, 144]) {
    const clock = new FrameClock();
    let frames = 0;
    let time = 0;
    for (let i = 0; i < hz * 10; i++) {
      const dt = clock.step(i * 1000 / hz);
      if (dt !== null) { frames++; time += dt; }
    }
    assert.ok(Math.abs(frames - 600) <= 1, `${hz}Hz: ${frames} frames`);
    assert.ok(Math.abs(time - 10) < 0.025, `${hz}Hz: ${time}s`);
    clock.reset();
    assert.equal(clock.step(90_000), 1 / 60);
  }
});

test('a phone cell limit enlarges cells to fit it; without one nothing changes', () => {
  const limited = renderSize(393, 852, 3, 6.5, true, 1, PHONE_PACING.reducedCells);
  const { cols, rows } = gridSize(393, 852, limited.cell);
  assert.ok(cols * rows <= PHONE_PACING.reducedCells, `${cols * rows} cells`);
  assert.ok(limited.cell > 6.5);
  for (const args of [[393, 852, 3, 6.5, true], [1920, 1080, 1, 8, false], [7680, 4320, 2, 4.5, false]]) {
    assert.deepEqual(renderSize(...args, 1, undefined), renderSize(...args));
  }
  assert.deepEqual(renderSize(393, 852, 3, 6.5, true, 1, CELL_CEILING.mobile), renderSize(393, 852, 3, 6.5, true));
});

test('a GPU check at an even 30 fps judges lateness against the 30 fps period', () => {
  const steady = new FrameQuality();
  for (let i = 0; i < 1200; i++) steady.sample(15, 1 / 30, 1000 / 30);
  assert.equal(steady.scale, 1, 'an intentional 30 Hz cadence is not a GPU bottleneck');
  const bound = new FrameQuality();
  for (let i = 0; i < 600; i++) bound.sample(8, 0.06, 1000 / 30);
  assert.ok(bound.scale < 1, 'frames far later than 30 Hz with quick work still are');
  const stalls = new FrameQuality();
  for (let i = 0; i < 100; i++) assert.equal(stalls.sample(2, 5), false, 'a stall says nothing');
  assert.equal(stalls.average, 0);
});

test('a 30 Hz clock fires every other 60 Hz frame and keeps its phase at 120 Hz', () => {
  const clock = new FrameClock(30);
  assert.equal(clock.period, 1000 / 30);
  const steps = [];
  for (let i = 0; i < 60; i++) steps.push(clock.step(i * 1000 / 60));
  assert.equal(steps[0], 1 / 30);
  for (let i = 1; i < 60; i++) {
    if (i % 2) assert.equal(steps[i], null, `frame ${i}`);
    else assert.ok(Math.abs(steps[i] - 1 / 30) < 1e-9, `frame ${i}: ${steps[i]}`);
  }
  assert.ok(Math.abs(clock.rawMs - 1000 / 30) < 1e-9, 'rawMs is the real interval');
  const fast = new FrameClock();
  fast.setRate(30);
  let frames = 0;
  for (let i = 0; i < 1200; i++) if (fast.step(i * 1000 / 120) !== null) frames++;
  assert.ok(Math.abs(frames - 300) <= 1, `${frames} frames in 10 s at 120 Hz`);
});

test('switching rates mid-stream never steps backwards, too far, or loses time', () => {
  const clock = new FrameClock();
  let time = 0;
  let max = 0;
  for (let i = 0; i < 1200; i++) {
    if (i === 300) clock.setRate(30);
    if (i === 700) clock.setRate(60);
    if (i === 900) clock.setRate(30);
    const dt = clock.step(i * 1000 / 120);
    if (dt === null) continue;
    assert.ok(dt >= 0);
    max = Math.max(max, dt);
    time += dt;
  }
  assert.ok(max <= 0.05 + 1e-9, `largest step ${max}`);
  assert.ok(Math.abs(time - (1199 / 120 + 1 / 60)) < 0.001 + 1 / 30, `${time}s`);
});

test('the simulation step is clamped but rawMs keeps a long frame visible', () => {
  const clock = new FrameClock();
  clock.step(0);
  assert.equal(clock.step(400), 0.05);
  assert.equal(clock.rawMs, 400);
  clock.setRate(30);
  clock.step(800);
  assert.equal(clock.step(800 + 45), 0.045, '30 Hz frames are not clamped at 50 ms');
  assert.equal(clock.step(1000), 0.05);
  clock.reset();
  assert.ok(Math.abs(clock.rawMs - 1000 / 30) < 1e-9);
});

// Feeds the pacer `seconds` of frames at its current rate with this work.
function run(pacer, seconds, work, onChange = () => {}) {
  const changes = [];
  let t = 0;
  while (t < seconds) {
    const ms = 1000 / pacer.rate;
    t += ms / 1000;
    const change = pacer.sample(typeof work === 'function' ? work(t) : work, ms);
    if (change.rate || change.cells) {
      changes.push({ t, ...change, rate: pacer.rate, cells: pacer.cellCeiling });
      onChange(t);
    }
  }
  return changes;
}

test('a phone whose frames fit stays at 60 with no changes', () => {
  const pacer = new FramePacer();
  assert.deepEqual(run(pacer, 30, 10), []);
  assert.equal(pacer.rate, 60);
  assert.equal(pacer.cellCeiling, CELL_CEILING.mobile);
});

test('frames that no longer fit drop to a steady 30 after about two seconds, and recover', () => {
  const pacer = new FramePacer();
  const down = run(pacer, 10, 15);
  assert.equal(down.length, 1);
  assert.equal(down[0].rate, 30);
  // Three settling seconds after loading, then two above 13 ms.
  assert.ok(down[0].t >= 4.9 && down[0].t <= 5.6, `dropped after ${down[0].t}s`);
  const up = run(pacer, 30, 6);
  assert.equal(up.length, 1);
  assert.equal(up[0].rate, 60);
  assert.ok(up[0].t >= 8 && up[0].t <= 11, `back after ${up[0].t}s`);
});

test('work between the two thresholds never flips the rate', () => {
  const pacer = new FramePacer();
  run(pacer, 5, 15);
  assert.equal(pacer.rate, 30);
  assert.deepEqual(run(pacer, 60, t => (Math.floor(t) % 2 ? 11 : 12)), [], 'hysteresis band 9-13 ms');
  const fast = new FramePacer();
  assert.deepEqual(run(fast, 60, t => (Math.floor(t) % 2 ? 11 : 12)), []);
  assert.equal(fast.rate, 60);
});

test('a phone that cannot hold 30 draws fewer cells, and gets them back before the rate', () => {
  const pacer = new FramePacer();
  const changes = run(pacer, 20, 35);
  assert.deepEqual(changes.map(c => [c.rate, c.cells]), [[30, CELL_CEILING.mobile], [30, PHONE_PACING.reducedCells]]);
  assert.ok(changes[1].t - changes[0].t >= 6 && changes[1].t - changes[0].t < 7.5);
  assert.deepEqual(run(pacer, 20, 35), [], 'reduced once only');
  const recovery = run(pacer, 30, 5);
  assert.deepEqual(recovery.map(c => [c.rate, c.cells]), [[30, CELL_CEILING.mobile], [60, CELL_CEILING.mobile]]);
});

test('heavy frames while the page loads never set the pacing', () => {
  const pacer = new FramePacer();
  assert.deepEqual(run(pacer, 30, t => (t < PHONE_PACING.settleAfter ? 60 : 8)), []);
  assert.equal(pacer.rate, 60);
});

test('a GPU starved at the lowest resolution gets a steady 30 that holds; cells still follow the work', () => {
  const pacer = new FramePacer();
  let t = 0;
  const feed = (seconds, work, starved) => {
    const changes = [];
    for (const end = t + seconds; t < end;) {
      const ms = 1000 / pacer.rate;
      t += ms / 1000;
      const change = pacer.sample(work, ms, starved);
      if (change.rate || change.cells) changes.push({ rate: pacer.rate, cells: pacer.cellCeiling });
    }
    return changes;
  };
  assert.deepEqual(feed(10, 6, false), []);
  assert.deepEqual(feed(10, 6, true), [{ rate: 30, cells: CELL_CEILING.mobile }]);
  assert.equal(pacer.held, true);
  assert.deepEqual(feed(60, 4, false), [], 'quick work alone cannot prove the GPU would keep up');
  assert.deepEqual(feed(10, 40, false), [{ rate: 30, cells: PHONE_PACING.reducedCells }]);
  assert.deepEqual(feed(20, 4, false), [{ rate: 30, cells: CELL_CEILING.mobile }]);
  pacer.reset();
  assert.equal(pacer.held, false);
  const cpu = new FramePacer();
  run(cpu, 10, 20);
  assert.equal(cpu.held, false, 'a CPU-bound drop is not held');
});

test('single long stalls never change the pacing; a disabled pacer never acts; reset restores it', () => {
  const pacer = new FramePacer();
  let t = 0;
  for (let i = 0; i < 3600; i++) {
    t += 1 / 60;
    const stall = i % 300 === 299;
    const change = pacer.sample(stall ? 400 : 8, stall ? 400 : 1000 / 60);
    assert.ok(!change.rate && !change.cells);
  }
  assert.equal(pacer.sample(8, 0).rate, false);
  assert.equal(pacer.sample(8, NaN).rate, false);
  let on = false;
  const gated = new FramePacer({ enabled: () => on, fitMs: 1 });
  assert.deepEqual(run(gated, 10, 20), []);
  on = true;
  assert.equal(run(gated, 10, 20).length, 1, 'tuning can be overridden');
  run(gated, 20, 40);
  gated.reset();
  assert.equal(gated.rate, 60);
  assert.equal(gated.cellCeiling, CELL_CEILING.mobile);
  assert.equal(gated.work, null);
});
