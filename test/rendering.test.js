import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots of the stroke-blade meadow, captured before its
// culling and contact-field optimizations, re-captured once the meadow was
// merged with the outlaw, wading, fires and weather, and again after the
// layered detail pass (terrain, water, flora, trees, props and effects), and
// again once everything but the grass became plain characters, and after
// the sparse water and grass-patch density pass, then the fine leaf sprays
// and branch-grown crowns reviewed against the tree video, and once more
// when the ground was dimmed and rocks and the player brightened for clarity,
// and after trees and monsters were thinned out to declutter the screen and
// scattered stones gave way to big boulders, and once more when the wild
// was pared down to grass, trees, rocks and a few lakes.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['31f3eed696e49ed69ffdb84e640ead44be1b9554e7c6c425824a11f03f035c65',
    '506d87cfb81a647c06b7784f7e08be99d6041fd3e00a86806836ee16c281ab70',
    '43dc4cc0f518ec5f20254af9853223291730624d5897e973957a951db3568fba',
    'fad97ba0a60a9789731d3bc83fef12e7ee88bae4b7df527b69dee050b804d899'],
  ['93115575ec85a5b2becdc28874d579d821a11e7ffd36fdebda749f76c4fe98c2',
    '8a119ba2b6cc0ffad8432fb5e10e73428463e43c07a6c0ce17454009c3191f63',
    '3f9e815d5586d85026cd2f1dc54fc4bec821f6573aef1d7a7b60270e5d63790a',
    'd5131c63bce038267446b678590a5949f78a5fe7c7f871767e47074ecb8fe997'],
  ['c1d9814cd5e9ead91ee070028aab2d4845db3bed3d5633fca23f260757575257',
    'cb97772f6b3752dd421434b0414a28ab92a64b5c89eb2d3fb5b52a3b1e7a22e5',
    'e74dab6c163acd094b949d507c0cd384a90f04175876e86cef457a722393ec8c',
    'e63ca64bf2777538bbec555090c082e3c727c5446670c0135f98380deff9c1d0'],
  ['90e24f76d954c35a7bc919aea77b579bf7c4294ed5bd5e5a14515a239f6e6964',
    '04ad72133bfba3c87011f83c9cf66c3616c8f6e89a634b14b14821852db80d0d',
    '0088e5f5e54ed87112ec5b2a6a88bee5944e626148339d7ec0f3a0a881ffc446',
    'ff9defad2d4f77a367a57c8300dacffb8328afde971a682b19ef7aa593c6251d'],
];

// Attack variations and idle blinks roll Math.random; replay a fixed sequence.
function seeded(seed = 1) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (let index = 0; index < scenarios.length; index++) {
  test(`${scenarios[index].name} matches the sparse terrain and layered tree snapshots`, async (t) => {
    t.mock.method(Math, 'random', seeded());
    const scene = await createScene(undefined, scenarios[index]);
    let sample = 0;
    for (let frame = 0; frame < 90; frame++) {
      if (frame === 20 || frame === 55) scene.player.attack();
      if (frame === 45) scene.player.jump();
      scene.move.x = frame < 30 ? 1 : 0;
      scene.frame();
      if (![0, 29, 59, 89].includes(frame)) continue;
      const r = scene.renderer;
      const hash = createHash('sha256').update(r.fg).update(r.ov).update(r.bg).update(r.mask).digest('hex');
      assert.equal(hash, reference[index][sample++], `frame ${frame}`);
    }
  });
}
