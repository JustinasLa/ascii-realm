import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots of the stroke-blade meadow, captured before its
// culling and contact-field optimizations, re-captured once the meadow was
// merged with the outlaw, wading, fires and weather, and again after the
// layered detail pass (terrain, water, flora, trees, props and effects), and
// again once everything but the grass became plain characters.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['4d58b015d435419679036a5bbeb631b08f895e993cf93c3d67846a6eb5d2d6b7',
    '6ba86821fda4927d7db29a1592c485fd0d680a4c76fb473dcda6a1b01cdfd44a',
    'd524246b0e61dea318d94b912402c81051e798ef257f589fdc5dfa676c09a0f4',
    'bccb9b2a8ed80770c663ca40ba8fb818f1bbf3d57b707927fbcbeadb3bdf31b5'],
  ['7ae731eb1ce7fcfc05c9779251ddb3116133be10e309594cb9f50492c2395d73',
    '231b4860ec829866e3e88f2dc4f12d2f4ac9b69cc283c38229e27dd5d701d48c',
    '48bbcf66405b45561cc09ea52373816de7e3db67af34171a38016aa987347967',
    '06cf3b6319dbb36501b8f72c29f02483e1ddae49106f9bd95bc843f9bfe8f7ff'],
  ['6a3db581db7ef0f5a4b59ac8ca9ee56b6f04804d8275d3ae33766e64c5f70f36',
    'c3d4fee2327bb1ea25eb40146328edd1193cafaf229d01981d57115995894c35',
    'a46654507ecc2c64ea970ae0ae75255588817cc808632e3dfe8c71a4926f4b2e',
    '77cc9452eaccc57583b8a3db6a817636f0f9b0c1de9438d07d6f7987831a92bd'],
  ['106b33c77a06b01399cea67236447c06e700dbdacc49aa443c8c0b985b3a3abd',
    'c76caef1600ed5add424a3e12c854a6c5940cc2231c1b96937d3c07ba33b3d91',
    'f15dff70b81093fe5826f15537236cc01dc44c9c33232563886ffeba7d7de5dc',
    '059eceb53ee0c618d802465edf4644f8ef3bd218fbcc62599d35fd6f6a48e2b2'],
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
  test(`optimized ${scenarios[index].name} preserves the original rendered cells`, async (t) => {
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
