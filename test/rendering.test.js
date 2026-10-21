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
// and after trees and monsters were thinned out to declutter the screen.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['ebb4de31445ae88f481d23d1161f03fc5c3bf8a69bd6c6a940a3a4589bfbd27e',
    'bac5f5336971f09caca25aa83918b7d196cac3d8a71cb9ce35e11d82023d736b',
    '68e966c2deccf3cf0b9903aef568bed58ed41e1a4b2eea7c5fd76bd3d9f41f93',
    '871350899edf589090bc6d844f2d263205f76ebc1401c8736db6ac41183ca722'],
  ['2b6243423b1229bad58c7cfe99127a2ca48e0217778efa8d5a16c86dc2e96fdb',
    '84db7d2379bc21e6d3c0315af40f822c30b1deab66c0c8b9c2af3b0d8df60f95',
    '23f1af3ded62a63dc6dfe5c384e4206fa29329b9989685b852b3e4a8049fa759',
    'cee594c7b1edf26146712163f2497677a8488f28aeb1b97e85be4ce3e45ccdb8'],
  ['9bf4e3b8edac2f48a2502c54b8d5828f4aeff9280e49ad9ef8152c066fad46f6',
    '1a06882e45ba1b969a6c135c6c7be567ce386af06991769a11dd1d4ba0fc7cf6',
    '8cccb8b8526588f6e59c445277cf5c6fc1a8a1ac5294ee40020af1e036ce546d',
    '01a08a274083e5912363738390b06e2ffc8d5f82932dc53ec30104a5a5c4b453'],
  ['5af0382609f07fa57387d48d9286228523da6ecb450b63ebb2d25720c6b80b87',
    '38e2a5dc656ef176ea6d0f195f43419b436cb267aaa0effbd5b58d161c083c4d',
    'f2d48ab4ad3e2caa4f090605cae14bf2230c970dfa67170f4312f3b55d544754',
    '7c67e17cbce1ca12a8e21452cb1be72aafaabe5b3e541854e23be6c353290c5e'],
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
