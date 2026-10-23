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
// stone characters beneath blank ridge accents. Lunar snapshots now include
// the real north-up lunar near side from NASA LROC and continuous water ripples.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['2d34e5cc6a5220a370476775079a8f553ea50c14f65f3a45ab274600f92fab2d',
    '599d496a1ea58c30b90f10d31b77f6cdc95b6fb4b253a6aeeed8124c757d4a3e',
    'a1060edf4271a91027cf85b5ada49bc1ca7c9549affead4814f77d5a5031da0f',
    '0512f375fca07e2385f4e8306aaebe24ff81c18b5c83ce66b38ce2a16dde25d7'],
  ['15796d8c69c8c96bcdcb53feee15ac7d4cf083260693c651f4659523ab430fa7',
    '8be91b8cbf5f4daa2b108148c52d75ca5016a84852ffa11a9cd76f3a9789bded',
    'b4e71eaf4eb14af8361bd36ce5d2c7422a8e47a2fb4d667818b285d03dd3e449',
    'd6d4ae917067f38cb0899046aad165cea47baa5e25c845cbd3d86041713a5776'],
  ['ed160d9edddd86795fa84b9f2f28a7401379718b3123401e3551ea129ab4d01e',
    '0c80d07348afa392ed20f8794bcfae12060297a896363ba580240b20b7481ad6',
    'cfecddabb13bf67e477e40650417b0c40d4daddb5ea5308dcb2cd22b548de990',
    'c86f14006ec20cbba16e261e563c8859f3cc3dfdfb3d8380b41ba698e99161e1'],
  ['234103e016982ad25cc0aaf67bdb0ffe3f5e736a8a1e5f7542dbfdbb2c302683',
    'ad1f5e5812d170036b061ed50e8f9b8e41f1c8955298ad3e33700c4920e171df',
    '85597c4586bb5b3f83f98083c0d3cdacfb40203a5c5b725bcd361a070d61dd03',
    'e2af9f72d608451910dae7b6ca28f207e7ae0240ed4f4104956ba095fa8fdb0a'],
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
