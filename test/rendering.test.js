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
// and branch-grown crowns reviewed against the tree video.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['b909e4c34ba5733a590fd66c277eac94cb512c759b12a4eb5eeb3f54683647cc',
    'a799399284bd07a6728281cfa09822d58e9e1abbd375fd8d18107df0b23bd41b',
    '327f5f0fc4a7efd9d0b117732afc058ffe73b17fc0e8a69a54914891ba3d4cd1',
    '5a22ed5b9965ca9ebebdd0353fd2004f0e379d74bfd47e59bf95c5d7e3a875e2'],
  ['2fb63108f2dca13b67ff468fb87655c2a1d9cfd586c2533f4529c65ff372db5c',
    '301b1e154b1f35f152eeb7d29c174bb93bcb028507269921ad62a1a2ef41a973',
    '3c68517acb315181358e5cfc8feff125c5c7b10fbe5700382a4f503b4714df69',
    '49c70d5920d259b5687a648f407854b3b9d8c33edd1efcfb225d9b20c54247c3'],
  ['34350a1d74259f281d66f73a9176424d49f3316f1e0a027b5af7068837e5d4fd',
    'da0313354a24d107f3d6767297be41b63d7f39265e6e011cc38186c7c85fd06e',
    '61db4bcb99109636d885b5468ab4df6ff8a1d76d1428ee78d617def6c557f14f',
    'ccd22e45215548c05428daf2ec3e86ab6af8229deadb4c9b2a916944ff679d65'],
  ['bbd22424d4e6aa2bd441fa5956633c0fbbd300fa588be7c5a7f3fb972549760b',
    '06951954939a4883cf8b252fb7396bf87b477407c2d5d403ab7e0bc0af98389a',
    '522e1e996abbd1547e643254764fc1f993974db07b6b984825e765ecea9beab7',
    'ffb5c819b4feaad87239c1565c1ad0bb23a42dcc4c44e0018eec9599d83255db'],
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
