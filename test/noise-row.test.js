import assert from 'node:assert/strict';
import { test } from 'node:test';
import { valueNoise, valueNoiseRow } from '../src/core/noise.js';

test('row sampling exactly preserves noise across lattice boundaries, reversals and negative coordinates', () => {
  for (const seed of [0, 1, -900, 2147483647]) {
    for (const y of [-91.7, -1, -0.0001, 0, 0.5, 43.71]) {
      const row = valueNoiseRow(y, seed);
      for (let i = -500; i <= 500; i++) {
        const x = i * 0.015 - 0.037;
        assert.equal(row(x), valueNoise(x, y, seed));
        assert.equal(row(x - 0.004), valueNoise(x - 0.004, y, seed));
      }
      for (const x of [1e6, -1e6, 0, 3.99, -0.01, -1, 1, 1]) {
        assert.equal(row(x), valueNoise(x, y, seed));
      }
    }
  }
});
