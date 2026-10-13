import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameClock, FrameQuality, renderSize } from '../src/render/budget.js';

test('DPR-3 phones retain their world scale with one quarter of the pixels', () => {
  for (const [w, h] of [[390, 844], [844, 390], [360, 640]]) {
    const size = renderSize(w, h, 3, 8, true);
    assert.equal(size.dpr, 1.5);
    assert.equal(size.cell, 8);
    assert.ok(Math.round(w * size.dpr) * Math.round(h * size.dpr) <= 1_200_000);
  }
});

test('large screens and zoom-out respect both CPU and GPU budgets', () => {
  for (const [w, h] of [[3840, 2160], [7680, 4320], [800, 1280], [12000, 200]]) {
    const size = renderSize(w, h, 3, 6, true, 3500);
    const cells = (Math.ceil(w / (size.cell * 0.6)) + 1) * (Math.ceil(h / size.cell) + 1);
    assert.ok(cells <= 3500, `${cells} cells`);
    assert.ok(w * h * size.dpr ** 2 <= 1_200_001);
  }
});

test('sustained overload reduces detail, isolated spikes do not, recovery is slow', () => {
  const quality = new FrameQuality(true);
  for (let i = 0; i < 60; i++) quality.sample(i === 20 ? 100 : 4, 1 / 60);
  assert.equal(quality.limit, 14000);
  for (let i = 0; i < 240; i++) quality.sample(25, 1 / 60);
  const reduced = quality.limit;
  assert.ok(reduced < 14000);
  for (let i = 0; i < 30; i++) quality.sample(2, 1 / 60);
  assert.equal(quality.limit, reduced);
  for (let i = 0; i < 600; i++) quality.sample(2, 1 / 60);
  assert.ok(quality.limit > reduced);
  for (let i = 0; i < 6000; i++) quality.sample(50, 1 / 60);
  assert.equal(quality.limit, 3500);
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
