import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots of the stroke-blade meadow, captured before its
// culling and contact-field optimizations.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['c722273d4c3c36fb3f57b4d25a7e560e31163549e3d1fc9d1d7b50014e5c66e9',
    '2bc94be4948460ccf2314425df306ce34bdc5be3be8d282593f2bb629559f90d',
    '03607057c70acbaebb18b3b49721753d3770ecb8104877da340f03950d266b1d',
    'f587c09d07ced5986d3e4a23be064a0d374e6382fa16570f01c5f139a5488fbe'],
  ['1eb419e39307346cf896ddbef890fdd1a73c9255413519b5083e3cc67c3bc176',
    'fb68267e65d5525fb4795b0426f237c24c576b7eca0f6dd3cd385e4a67a8ccf2',
    'eac9250f7d2c7022b119bb8e46188a9d9816776fb33ac4bd4bea0fb849ddbebd',
    '76989f1ddb743847abf04b43a17b615623492ff224c8db682888411a2248de98'],
  ['b43c92e04674c4adaaff090c34cff74c0e221fa5db280775a037b9062b4444af',
    'ecedd056d9d9b29f1a8b22ff5f538c991be49aea612e92c0a72e3bf46527959b',
    '6c6f74a07abb3d95a3f00426a5f4d7f0191464fb6a937d6d4bcd66b183f37a6e',
    '5b2ad596f5068fe06b744f61678efe8b207d5e181c71c779ebfd56425e33a277'],
  ['806c1dd8d4d8ace0037fbc39bf64f3da00be06f2c190b1a4a6afc2395a132b65',
    '1cfd8d21238e1ccf0d553efe9ea725adfc45e36e4513a1251386153dbbaab209',
    '1f5c109defcfe5d793e3506c88f0f94b299ec80f3b900bf9101d33c854465c40',
    '8f0234b29df7f99073d135a909f0cc8cc0d3781694ce492cabe0dbbdf8ffa7fc'],
];

for (let index = 0; index < scenarios.length; index++) {
  test(`optimized ${scenarios[index].name} preserves the original rendered cells`, async () => {
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
