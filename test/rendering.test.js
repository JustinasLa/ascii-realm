import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots of the stroke-blade meadow, captured before its
// culling and contact-field optimizations.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['4a8e7ac067a2a4d3379614179f47489ed37c4cf2da1ca01e04721b278befe4f3',
    '3f72187f49042e36cac17d168e70860bd4122fa798da59b07c88f881cb748ca9',
    '231f87be6336bbac6f87d9dd81feb57f43f00dade06b9af3a1e3b642ba550b49',
    'fdd4ce7396b432da01041fd644d0f58ecdc9aa1193e1cd0274203b2f48801cf0'],
  ['f974a07def3bb77b8f991898575a84168e431078eb14f5c9aa8c11343aa8d0be',
    '83fb483c359f3a092dd833a5209ebec13531bfdc7cb242abb6ba0de1fb98cf31',
    'd728c65a9124e6a03ec6b310e189b5cd2e086e92c72662711cc68309ddca00b9',
    '8cf3cd449683f6aa64c0b8e90a943836cdc2bbd281094294b75446f37f6e499d'],
  ['26337bdae0b551750106bcf2b6e7db243885a8ee4e62ce1371bae7dde8bad2d6',
    '079e2146dbc66ccbfa9d8ce9a16ba96dbfcdccc3fd8351ce05e8d95b6508ebb1',
    'e771dc5a14d5519441e74b697d59cdde4137bad9ec4a202d230f357f9b54795b',
    '533a252b4749d4e5c5415af7e10474b09e46a6957c87a2a5fd0772bc3c020feb'],
  ['9376064361b3911eb96a10cfc0c28170581bfe9a6572ffb58f2dbc4cfa4a9721',
    'c50ca243d878ec38cb658d2cfdb770acd229c6bbc1022199d2882806a5c16d48',
    'ec80a9eb98d7b3244137b85e3ca2b6d1f79949dac16f54184138f28b8578e2e6',
    '669c28d059eec4a68bbecb944ddec042daca4cf6e8b5e3f037d6040ab252b331'],
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
