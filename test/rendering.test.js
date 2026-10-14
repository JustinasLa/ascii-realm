import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots of the stroke-blade meadow, captured before its
// culling and contact-field optimizations, re-captured once the meadow was
// merged with the outlaw, wading, fires and weather, and again after the
// layered detail pass (terrain, water, flora, trees, props and effects).
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['c81aace52b25dc88bf32de4d24c456e9583a2ef3cb9cedfc4bc573d6294615a8',
    'e6aed4b005bbbde4ee31100b706fb880fd5518c555a044eaf5335557416afeb2',
    '8272194cf63c413db706a8c596a37690c9b46bc8e1749ce2b547de9da3816a33',
    '9d7554e1ef824d949bdc4ab819ed6a90ef6721d7193efa59c1137818b6b0dd97'],
  ['8a7130c0cc81c25804a800070bf8223fa0dc857ad23d3a213a62149cf5d78df6',
    '0e03d9f14d1cb9f115d0bfb307a6a95c1875d9d59378c9aa051d850474562f1d',
    'c3561a1788f10f66ae3c189a65830ca6ba90760f02de4dc48c3696f9c4aadf6e',
    '9a0511754ec869b17ac016dff1a7ed17e6907bdb2e67595ca02d5e731cef972e'],
  ['a4f192517a12daabffd8fe6137b524e0cc0962f7fcf1a6b1b36248b1624c2602',
    '34d1b0058d30ab43ffd09720c7fcfd898ebe35811659b31c1771581ad32754ea',
    '706821e40bd5ecee3cce665eb4524127427223e5ec182323b1eee4f32b8018a5',
    '4d9d335546f6194de792f99064be2666fb14211c371eb75a84a8535e240db1f0'],
  ['275372f4882376ba0d312a83a859bdb2ec9f64c14817c805aa0def18931ce191',
    '01f03cab872dbdc372f0d6b11e1398e5dfd2236a8c5973af97dd939a0e2bdcd2',
    '0bdd49cc4287f0bbf2ca5c2a0cdbf8d3cc480a8e8f17ef709fdcd7414e0d128e',
    '9905271b5afdf1f1a581f93e19754bcc281650e8fa8a94ee8bbc0f63d31b5ed1'],
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
