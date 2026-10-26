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
// Trees' moon shadows now darken the meadow's ground and grass around them,
// and moonbeams light patches of it, with faint columns of air above.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['2d34e5cc6a5220a370476775079a8f553ea50c14f65f3a45ab274600f92fab2d',
    '6f14aeb02e8caab34f8b41ab411bdb2adaf91093bc90a020ad9a75e98e09628a',
    '4456bebf9d2e6225621063bdbbf8379e634fccccaf8e1b22c6b5a04a3a34fc1d',
    'ea4fd23eb611f36f0b0df3d7ff5bc10128d7fcd880ef3fc126988d5106c61897'],
  ['4d7784eeab053fce4096e6cecfb1b293c62145b49a6b5c29db41ef37918ab07b',
    '41156ff07eecb9c927a33f10916832ae67a52446f2c6337dd8bc2aae6ba1eec2',
    'fce0bcfd66138e2b8c598fb8faf5fd41a89985d79f5986593a6b49176f2d0ef5',
    '785a8f1f3b4e2fbdd5790b43efe0a5462a715f17247a7e1d4379139b97b7c90c'],
  ['ed160d9edddd86795fa84b9f2f28a7401379718b3123401e3551ea129ab4d01e',
    '5d20fd0c78bd96aef1324ad583ac1a49771e4e1c1bcd8e1a47b9c0c30816e023',
    'fbe02fbd95cecd2a46de959d7bc30f12410f7013ee4eb260eeea2416628f6f2c',
    '032586b3b1bf68c1e64e4aa777d42380bbf01667ec938ba55d90db932ab80321'],
  ['4e99c69de306dbd477403bb93e86defbee151bf6315b38011768fa9e2d412867',
    'd6dcc324d3bbec494b6e2914056023feb34081dfe2fbde95683483e911fbba46',
    '4c3b85ca94f0c3203f54df6a2eba8e99b13929d0b4b6ea050d16ba1540209943',
    'c9913c817cbfc9b612ebc0d882af3a9a2e6dbdfbb54d06754213f27a648f1b96'],
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
