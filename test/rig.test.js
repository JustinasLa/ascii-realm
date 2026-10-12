import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRig, project, rotY, strideCycle } from '../src/entities/rig.js';

const pose = (over = {}) => ({ heading: 0, phase: 0, walk: 0, run: 0, time: 0, ...over });

// How far below the ground the lowest point of the feet (or a kneeling knee)
// sits; planting should keep this at zero.
function groundGap(rig) {
  let low = Infinity;
  for (const l of rig.legs) low = Math.min(low, l.ankle[1] - 0.065, l.toe[1] - 0.05, l.knee[1] - 0.07);
  return low;
}

test('yaw turns forward towards +x', () => {
  const p = rotY([0, 0, 1], Math.PI / 2);
  assert.ok(Math.abs(p[0] - 1) < 1e-9 && Math.abs(p[2]) < 1e-9);
});

test('points towards the camera are drawn lower on screen', () => {
  assert.ok(project([0, 0, 1])[1] > project([0, 0, 0])[1]);
  assert.ok(project([0, 1, 0])[1] < 0);
});

test('a longer stride when running', () => {
  assert.ok(strideCycle(1) > strideCycle(0));
});

test('feet rest on the ground through the whole walk and run cycle', () => {
  for (const run of [0, 1]) {
    for (let phase = 0; phase < Math.PI * 2; phase += 0.1) {
      const rig = buildRig(pose({ phase, walk: 1, run }));
      assert.ok(Math.abs(groundGap(rig)) < 1e-9, `run=${run} phase=${phase.toFixed(1)}`);
    }
  }
});

test('the knee touches down when kneeling', () => {
  const rig = buildRig(pose({ kneel: 1 }));
  assert.ok(Math.abs(groundGap(rig)) < 1e-9);
  const knee = Math.min(...rig.legs.map((l) => l.knee[1]));
  assert.ok(knee < 0.15, `knee at ${knee}`);
});

test('a jump lifts the whole body', () => {
  const ground = buildRig(pose());
  const air = buildRig(pose({ air: 0.4 }));
  assert.ok(Math.abs(air.head[1] - ground.head[1] - 0.4) < 1e-9);
});

test('the head faces the heading', () => {
  for (const heading of [0, Math.PI / 2, Math.PI]) {
    const rig = buildRig(pose({ heading }));
    const nose = rig.headAt([0, 0, 0.2]);
    const dir = [nose[0] - rig.head[0], nose[2] - rig.head[2]];
    assert.ok(Math.abs(dir[0] - Math.sin(heading) * 0.2) < 0.02, `heading ${heading}`);
    assert.ok(Math.abs(dir[1] - Math.cos(heading) * 0.2) < 0.02, `heading ${heading}`);
  }
});
