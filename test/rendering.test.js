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
// The scene fetches the same props as the game's frame since, so phone
// landscape also draws a tall willow that stands below the view and reaches up into it.
// Trees' moon shadows now darken the meadow's ground and grass around them.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['2d34e5cc6a5220a370476775079a8f553ea50c14f65f3a45ab274600f92fab2d',
    '599d496a1ea58c30b90f10d31b77f6cdc95b6fb4b253a6aeeed8124c757d4a3e',
    'a1060edf4271a91027cf85b5ada49bc1ca7c9549affead4814f77d5a5031da0f',
    '0512f375fca07e2385f4e8306aaebe24ff81c18b5c83ce66b38ce2a16dde25d7'],
  ['4d7784eeab053fce4096e6cecfb1b293c62145b49a6b5c29db41ef37918ab07b',
    '155f5be106872ee5ac00b3633141c7425d3c3f4dad49de1324321fbb2bd8e037',
    'b8b67b6458c4b310e99d5626101b35e31121b9ad25d4ae76d0cfd4ded7e8f3fa',
    '6ad0b65311e6485207baea36a6458d2e0b55bd6a08825dd7adf1dffbf98bd0ab'],
  ['ed160d9edddd86795fa84b9f2f28a7401379718b3123401e3551ea129ab4d01e',
    '0c80d07348afa392ed20f8794bcfae12060297a896363ba580240b20b7481ad6',
    'cfecddabb13bf67e477e40650417b0c40d4daddb5ea5308dcb2cd22b548de990',
    'c86f14006ec20cbba16e261e563c8859f3cc3dfdfb3d8380b41ba698e99161e1'],
  ['4e99c69de306dbd477403bb93e86defbee151bf6315b38011768fa9e2d412867',
    'f42655430f2c4d6aa8e8faf7bbd1ca5cdfe67a08a35a41f08f0f241c94391a22',
    '27337a62c4fde635cf7d801fd400321c7d9c04a7bea017100ffc9bb85b676ee3',
    'e6c44863f4deed91e1deacecdc0c16390bc742ff1b10ac34ea1a3dbc2609d760'],
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
