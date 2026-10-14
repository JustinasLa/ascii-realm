import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots of the stroke-blade meadow, captured before its
// culling and contact-field optimizations, re-captured once the meadow was
// merged with the outlaw, wading, fires and weather, and again after the
// layered detail pass (terrain, water, flora, trees, props and effects), and
// again once everything but the grass became plain characters, and after
// the requested sparse water and grass-patch density pass.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['047242a97b63dc28858e774c384760efb271b6a797fd21f1a0dcb52c2e449119',
    '482845dc5d99298c7f3fcaf72c20fa5037abb8d0c43c16ad0ddb913aaf027fcb',
    '78bc65461f881abad3723cbaa05f4c578176b258f6bd7192266c24f44e57d0b8',
    '60263c24e803e35543bbdfca9145ea1c9b26aade53953ccd7bb62fe3ef368591'],
  ['880286aff36593e4036060004149c84347f9822f74a5457de738f3a1f6bdcd79',
    '0961c042b5ac59d310fbd4702a9cecdce3c2f4f755ba1989a0530b78c10c88c9',
    '102c57b2e468a23a2c89af5a95de2929c2e233f1092edb060e0b067abe3db497',
    '34bfa921fd3d7c59d51e391aad8c8563b8150b149f817c2bc9b056bb611b1dc2'],
  ['93e2af286971b4dc7903d46ae6dbeb2c659391008d70b5acba5a1b1f243ff90a',
    'c8ecf9a5adf8e4e98f8f6913dc24c47bade24c0fe456375e87749d68a100f09c',
    '4c18dd860824d64a1b6ff790563e166bc6156bf7fe1e9053032b80c46d1b9401',
    '135ad00e5d827152618024bc95ab4b4b38dec59c68051c2c3c83f925c32afeeb'],
  ['8b52de829711799c6da813efc56e8ff59ff211627cec6172cf96b6eb1befde50',
    '9a4457528ce3077b1958579ab1369266f33f5c9fa5d9defd5c85554aae6f3e58',
    '5e9e5c17b22865d1c75b31b783dc79376d01d4f97b993b1de2dcbd57a89d2956',
    '2ca0eec25798bf8be6d02e5f65bd53b8ad952788295df684458969dd7fbc51e2'],
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
  test(`${scenarios[index].name} matches the sparse-water and grass-patch scene snapshots`, async (t) => {
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
