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
// when the ground was dimmed and rocks and the player brightened for clarity.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['f8aa1ccd0d788d5f2148d6d9037938aa96a201e4452f4225df27d0ca7c9576a2',
    '53726995be00063e2df215ddf218959ae7331bcfc6255024df75325f4a98e3fe',
    '3ac17106a8d151bbf1f4fb8fccd1f905f5cf15dc1fad8ecd016b65f1d1bf9bb2',
    '7662002d24b5642d1cd2680b8b11f6b176d2daf8363d1892e2295affd6c2f6fb'],
  ['22c8a331dd2039fe21e725cb8437468ed480082522aebd9250d9c52be02f2de8',
    '3e0f8ef5ac4ac4626ca56a07e188827ec3e80b40a005a8957889b86e6555f7dd',
    'f756bce3210a94164ed3c53021b1f5bfca65a4052c4bc416b2c5a351a2b5d4bb',
    '7415efc2fbc7985cc53a5dd14faecd39f020b9494761d4a8cdda18d088c6abc8'],
  ['f76a9ee2cc593d11ba5c03e86d6567c5c9613ba6597502afe5f5d3d4a9540b4c',
    '0fd7951ebafadccd327adfae38653faa6e7b0cc4d90d26cd1c1147aa9bec7aed',
    '6f56aababbe1d49bd7ab129fd67993a8016a92721612adb20b97a426297e523a',
    '898cf8c36848a1a06f602d2cda5e79dda37f86560c0732941005911faff04d84'],
  ['6db8fd8639b35d4b5e0708bf473dba8929ece4992ac3d0b5fc8551af8e6523e8',
    'f73b24d24257ec96289828e518e4da01317f300602685036fd3b0422a70c5203',
    'd491faf053f842cea68cc981ab9d0056aea41985ddd9cd659c8e4dbe1dc132be',
    '27484eb2f625dcf23cd7eff484f4c0895009b07b18ffad8eee3853b2d4a55d75'],
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
