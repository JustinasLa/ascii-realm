import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots captured from 97c6d72, before the optimizations.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['1bfe653a88aee1588a6f987990699b3a4e9a2d6869d69358736ca4aa6b61b93b',
    'ff70c0dba2aaa06faa5cf3b70002dff54a12b7a44d585f0a5364e8cea6bc3949',
    '90a9976495816ae1a250ba97bf20865fcbefb30025939440b989060361b37a61',
    '87bab6cef00dc52bfb01c3db211b1dbfd5782d99d7b49dd182c98d17619055d7'],
  ['dd2455abd26ef23eb12496e813cb4b29d6c9dcdfaa165ac97ab8978fd0eca37d',
    '28cf1934d9781a484e01efca3ad564c3e489f80223f4c8454f20621b7510d44f',
    '13ca3038224a226cf6578f047b510ee45ccb20337d8b7742346bc1d8c118aba3',
    '939fc7e4c9260b902fa28435858c1d1778aaa7259cde18a09ea5b91bffa39e9e'],
  ['99dde8c9a13e45ac2e7058c8c9aab875af8cb7a9a666cc5334456908dcc14bb8',
    'e18e6a4eee46786440c8b7ff2a360b839dcf2e84db5d9b553bb3af4b7ea6bb11',
    'e78a0ff8f2bde39c854644c6c0964c18e53d133737d6649221c80ff3b480e184',
    'd82f38371dff07448a0c15b9a7ebaa7767e325ead3e7ebab438cb58f3ac91081'],
  ['566a1b6839279d39aebd1ac94104d18466444c152b4d48a6eeda9eedc7b37220',
    'ea1320cd3f2674cdaadd34b987feff7e8c5ed1a2d94d3424fbdf25b5e8b27759',
    'be7025df88b242ce751429826c8ba6a2a6c064ebc734dd36c9eeedd518118f6d',
    'edb1360782c1f4671230c628decc0006df59e9eebe20d8c240bfd1a84195df99'],
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
