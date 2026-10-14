import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots of the stroke-blade meadow, captured before its
// culling and contact-field optimizations, re-captured once the meadow was
// merged with the outlaw, wading, fires and weather.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['6ebf0787248b9746b89b7cc6a38d332ff2203fc7c65bff8249cd766876f28721',
    'b2fc7ff3b14a126bdb2358ef31df54da15133a2ae018c2ab5c2b4c1fee34eb93',
    '67c95edb0e4b9d33c2431e5fe2842f8aa21c9decc871fb7bdedac0a057ebd8f4',
    '9e3f665b6c65884483ae613954bbb6ed0ac326387b988c0de34c255748bdf3ba'],
  ['e02f1984f3c5ba94a2a53749e83cd061bd8ffadc7da5c1af40b55f1b644b3d36',
    '8128928e97f5d5164ed10f2e7994c4ecaec15c49366ec01b95f55a4ec5a21ab0',
    'cde4b7df6c81894de8db6945e5e612e7033e6e8ae283901ec5f42ceaa4ea5d77',
    '6f04d1d79a4eceee56e8bdc9c130368ec55d67fe49519edd0b0d54358a4d76b6'],
  ['a4379beb16473f8ba92ac5f42146d773fcd1599002b4481684ea33c7a6cbc6d4',
    '02900fc178cd98be6b4b65a3c91086241ebd8b17add1c2342360830a2e70c9a7',
    'a2aef225b7a7a45544ff23a024a18cd579193fd0a8e4978f0b2011076a097092',
    '0084303a8ebee3f3d2b3bc9edecf949216f80547965bdde4bc78ef91e14a3112'],
  ['8455a3124d849020999dadb2cb34293f8539b22a0afe5449f7fcc67b806f3a2c',
    'a927ce44003fad6b8ba7363f11ce33569395f51fe7b2f3448909721af7289af8',
    '3b39ed78033b971612376ca29caaf85c922ccee029c5bdf0712ed599470953da',
    '8068408cf82308e973276b654665339211da50369c47b0ba9417989d51f4b49e'],
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
      const hash = createHash('sha256').update(r.fg).update(r.bg).update(r.mask).digest('hex');
      assert.equal(hash, reference[index][sample++], `frame ${frame}`);
    }
  });
}
