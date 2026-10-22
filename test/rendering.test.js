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
// grew five times rarer, and when trees and rocks moved to the fine grid of
// small letters (the fine buffers are part of the snapshot since), and when
// trunks became round, rooted and shadowed, then outlined like the trees
// drawn in ordinary cells, and once more when the trunk's foot and roots
// became one solid, modelled in 3D, and when trees and rocks were ringed by
// an outline of nothing. Meadow fine-boulder snapshots also preserve their
// stone characters beneath blank ridge accents.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['f1b6ad4187ea57ff5c49f23bfe30f25ab7c15616270114899bd1244a78124d8d',
    '0b2281c8bdded2d8be27edb0a515cc13f906bc6ed276c814d326190e0d19d7c7',
    '7ff7d11c4a6f43c8137b15e3b64060cfd69a309a28b4275cd48994b9a08cebc5',
    '40e2e25ed15b4c2bc8492648d219594e1c2949372f965e85953f57f9e94ff574'],
  ['5e54c48f2a966a143127a22348711e20a67be2436c0a0974196fc5a9f762968d',
    'adef3dd61d38e1c49ff82ad01161e0668ef0eb223a390e8d551f44265e8fb7e2',
    'b4e71eaf4eb14af8361bd36ce5d2c7422a8e47a2fb4d667818b285d03dd3e449',
    '33dcfb247c51d4b81952dc7b2f0797088485f74128fa0f70a8343a509e14411c'],
  ['2b0e86d77d8aecacf67dd17b1c78e25cf4858d3e454fa8a07cae5ee24b7361a5',
    '5c058034fd275183790614d4aab134febee7cf1e9bbcd080c11c5dc74bd4faf5',
    'a456c48aedf5ba56492ff48cebb35091ef5f5171caa5a08fe7bb9826a6af0611',
    '947fbdd4da537502a8d9f3558d91db617e4accbc988b5ff7e01d20c4b27b40e7'],
  ['c77bba0992b36ed1990a4947ffe3856a719691c3b29f5d1bb0eeb5fb4035140a',
    'eda0221495764aa0f6e2c70cc1bcfec58a66207b91c7640da634a7431d925f8f',
    'c6a73ead604d60f0870b9efce99f72e7aca30125cc6c9247c18696b55705da61',
    'fa976eb8f8d40daf2a055568d2d23ed2d5e17031fa2084c9e8dce52502818acd'],
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
      const hash = createHash('sha256').update(r.fg).update(r.ov).update(r.bg).update(r.mask)
        .update(r.fine).update(r.fineBg).digest('hex');
      assert.equal(hash, reference[index][sample++], `frame ${frame}`);
    }
  });
}
