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
// was pared down to grass, trees, rocks and a few lakes, then when trees
// grew five times rarer.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['31f3eed696e49ed69ffdb84e640ead44be1b9554e7c6c425824a11f03f035c65',
    '506d87cfb81a647c06b7784f7e08be99d6041fd3e00a86806836ee16c281ab70',
    '43dc4cc0f518ec5f20254af9853223291730624d5897e973957a951db3568fba',
    'fad97ba0a60a9789731d3bc83fef12e7ee88bae4b7df527b69dee050b804d899'],
  ['a128b6a9665c74cd7fd0a62ed631ac873a802dbb28b55a1d0cbbf395618fa209',
    '89409934cf159e239bef6875426b84a4f26603db97bb1954b9214897b448c71a',
    'f9bf2a54bacdc3a2e31107d09ab3aa40bffad433ec6d13238cd377798e2c9b65',
    'd69dfe5329889fb5ad10f7ff145fa12b6b7435777367b3a582d1df4aec8dfb64'],
  ['52a428682e2ccb026347f8e0742ba9286c51d5cad43085c87173718d7bd3052e',
    '8503f8d288e0b3e82fb922cdce6055b92bc8233d3920f518066bc38894c30c42',
    'cbe2604d8d358a22e26d8f5e93d644c488105df4ab0c5942e662dedbb7ab911b',
    '58af74de929929b130a52e90e5f0fc360695ca310663ad40ab8707fb64c29318'],
  ['7f9232efc65c4f68a8d2e7e871419eee72762dd0165616a0057e32a579d3d7a8',
    '9a6485baf8fc962e649e5a811cc6ca3a9365274a50ef36b0e7f081071b361a54',
    '249dc41bfc8b284f41fc7b53fcb9b0afc5d9d2fb716aceb2fb0c3d1037c512b8',
    '51657d46d891460257f2af2c4d95e3b96eef337f1dae1b0ba12b3e0411699b62'],
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
