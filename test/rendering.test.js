import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots of the ASCII-blade meadow, captured before its
// culling and contact-field optimizations.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['d44b24761e8df6e24625239c53ce1eac6697dcb898b88dd0a149b225cd2e975b',
    '79ee56ceda7e684bb4fb3ddefbb6106db3472b9f8340b8c3cf7a845a17952a8d',
    'e3be720716b7f1a5335012de45fa32f7015c0d35a83162c51212ac1d2a712e79',
    '191ba19601c08b5ae39edcd2b5c0f79743e490012f01ff90a282dd74ae748c88'],
  ['2ee357f706044cf7c727e15562d1d1e800dfb5fc69b4676b920cbe79dd0e9147',
    '843fb36ebe5ad42c2fad24ee5bc693e93956b4e900a0fb9bc8a46f297f3789e4',
    '014edeefcc3412dae553722f5b8884753f67cc5913a559c7b155725ffd8e537f',
    '22f77dd989fc9a960793f5c38be5a1df6f1527435e393c6809a1360d037bc069'],
  ['e9a2b31c12851334d871a393c7e361365cec8c70a99d33d907a30e8f61da49d2',
    '3f1b616bae4a69ad63c39a4bbbcf87f46014c9d823d2bb22319deb73ed8b4805',
    'b5292d2a51f8cbe3f17402e0bc0d63e62c3179c9b5b7f54125bc7ffe2ea246a9',
    '182dcada0437efceb6edeb7ece175f2b5f8ee7cfb4d06ee509e9a76d12df8d69'],
  ['6e2d796330992ce581f504bf27c30746782f3b7bc3e7aa0169cda0118e7fc216',
    '7f8692396e2b09847ef2d7359d7dcb79c0253f197db5863529079e8ab3e28b1c',
    'ebbd61878d2b3d43cf5a4fadbeda6e6eacb751fb2c76e3f99abbdaddf2facf96',
    'be093ac86203d637e566b2f9f9f14ab56488a0430e58575b25c165b603cc9e5b'],
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
