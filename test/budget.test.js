import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CELL_CEILING, FrameClock, FrameQuality, renderSize } from '../src/render/budget.js';

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
