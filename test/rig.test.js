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

test('walking, a foot is always down, and both at each change of step', () => {
  let both = false;
  for (let phase = 0; phase < Math.PI * 2; phase += 0.05) {
    const rig = buildRig(pose({ phase, walk: 1 }));
    assert.ok(rig.grounded >= 1, `phase=${phase.toFixed(2)} airborne`);
    both ||= rig.grounded === 2;
    // Whatever part of a planted foot bears the weight is on the ground.
    for (const l of rig.legs) if (l.contact) assert.ok(Math.abs(l.contact[1]) < 0.02, `contact at ${l.contact[1]}`);
  }
  assert.ok(both, 'never in double support');
});

test('running, the feet take turns and both leave the ground between steps', () => {
  let flight = false;
  for (let phase = 0; phase < Math.PI * 2; phase += 0.05) {
    const rig = buildRig(pose({ phase, walk: 1, run: 1 }));
    assert.ok(rig.grounded <= 1, `phase=${phase.toFixed(2)} both feet down`);
    flight ||= rig.grounded === 0;
  }
  assert.ok(flight, 'never airborne');
});

test('a walking foot lands heel first and pushes off from its toes', () => {
  // Just after touching down the toes are still up; just before lifting
  // off the heel is well clear of the ground.
  const at = (phase) => buildRig(pose({ phase, walk: 1 })).legs.find((l) => l.s > 0);
  const land = at(Math.PI / 2 + 0.05);
  assert.ok(land.toe[1] > land.ankle[1] - 0.015 + 0.02, 'toes not raised on landing');
  const lift = at(Math.PI / 2 + 0.6 * Math.PI * 2 - 0.05);
  assert.ok(lift.ankle[1] > 0.12, `heel not raised at push-off: ${lift.ankle[1]}`);
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
