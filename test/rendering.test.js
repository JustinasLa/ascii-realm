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
// scattered stones gave way to big boulders.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['2c4120f68539b7662e0b73a1e965bc7084bda3012fddbcdd46178e7bf400c201',
    '9cf1b6f5c0541dc5bb0b99d96831900b1d1242717415d2c7dbfe88088ddbb8b7',
    '972745552f204a3b0fb58a12484c28972940781e6f0fa7656f84993140a663dd',
    'f7b0251a173261befcb8082703f915a8b0b524559aac43e9415d0878ae359c94'],
  ['136f58dab568eee425b285eb9f4dabeac81b4d1c823d29ebea3e702fba4d5640',
    '06a87a7a94113258672bca77564f898f96c922c876f475bd2052986559785fed',
    '109a1dff601d5881d02c6dd352a6da508957de350f848b76cfe6e7b89ee45221',
    '303201acff2fb0eb073372dfc94b0850ceb3b52283b4af57d9ed54d7d4f9d42f'],
  ['28607cbd6f917a349134fb5643b652d5a1bb0f61820116e577049bd47503611f',
    'bcf26ce851fe1e9129c2da525f410190fed1377fdcb6e4e7113dea7a07205f16',
    '0a22f221602606bc5dbb70d9dce84b922aa0418ad2ab0166270a33b50e5edbb8',
    'b49f9c733e09a750fe68f279f99c7529cd4e0e58e5e21d98365612a49ffc2f53'],
  ['601b28f6392ccb24211c176158bcde88d9d47ec970d3487b4c735c2f08b3e64a',
    '2f11ffea31723e6aaf6990e88ae6f17f9c2df0b0c8fb115ef330e2625ac608a1',
    'cb5c684f0af0361b45508a785b2c9b0bcca165ecdb025856c616cbfb0f5fdd5e',
    '9be288d3d2bb36b3c63e3158254c069f4097b320af07917ed04cdc59b6517fcb'],
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
