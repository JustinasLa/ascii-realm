import assert from 'node:assert/strict';
import test from 'node:test';
import { footPlants } from '../src/entities/footfalls.js';

test('model footfalls follow alternating measured heel plants, including wraparound', () => {
  assert.deepEqual(footPlants(0.1, 0.49), []);
  assert.deepEqual(footPlants(0.49, 0.5), [1]);
  assert.deepEqual(footPlants(0.5, 0.51), []);
  assert.deepEqual(footPlants(0.9, 1.1), [0]);
  assert.deepEqual(footPlants(0.49, 1.51), [1, 0, 1]);
});

test('a full gait cycle retains both contacts; stopping emits none', () => {
  assert.deepEqual(footPlants(0.1, 1.1), [1, 0]);
  assert.deepEqual(footPlants(0.7, 0.7), []);
  assert.deepEqual(footPlants(0.7, 0.5), []);
  assert.deepEqual(footPlants(NaN, 1), []);
});
