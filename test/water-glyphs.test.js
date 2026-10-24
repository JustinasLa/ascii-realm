import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RIVER, WATER } from '../src/render/glyph-packs/water.js';
import { ruleFor } from '../src/render/ascii-rules.js';

// A 2D context that records what is drawn instead of drawing it.
function recorder() {
  const calls = [];
  return { calls, ctx: new Proxy({}, {
    get: (target, name) => name in target ? target[name] : (...args) => { calls.push(name); },
    set: (target, name, value) => { target[name] = value; return true; },
  }) };
}

test('every water and river glyph draws something', () => {
  for (const entry of [...WATER, ...RIVER]) {
    const { calls, ctx } = recorder();
    entry.draw(ctx, 30, 50);
    assert.ok(calls.some(c => c === 'stroke' || c === 'fill' || c === 'fillRect'), entry.name);
  }
});

test('the river current shows as ordinary characters lying along the flow', () => {
  const chars = (prefix, count) => Array.from({ length: count }, (_, k) => ruleFor(`${prefix}${k}`)).join('');
  assert.equal(chars('water.streak.0.', 3), '-~=');
  assert.equal(chars('water.streak.1.', 3), '///');
  assert.equal(chars('water.streak.2.', 3), "'!|");
  assert.equal(chars('water.streak.3.', 3), '\\\\\\');
  assert.equal(chars('water.vee.', 4), '-/|\\');
  assert.equal(chars('water.eddy.', 3), 'c()');
  assert.equal(chars('water.riffle.', 4), '~^,~');
  assert.equal(RIVER.length, 23);
});
