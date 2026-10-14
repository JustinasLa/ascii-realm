import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots of the stroke-blade meadow, captured before its
// culling and contact-field optimizations, re-captured once the meadow was
// merged with the outlaw, wading, fires and weather.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['c69e237de7cdb7d71a845ab0491c6f4efa246a8061ade078604d8628261776c9',
    'bc68ef3b7e880988f4b5221cfacec4768a4ff6e4670061861d490a1fab536a18',
    '47524cc0ca65a60a24322bf4db386ed2997a17213d5f82b266d07bd3a960720b',
    '98bc2559eae7ae5bde1d77920cf0ae16b89080acb9613d1967ebaac44276278f'],
  ['ebd20311422c3b6a5e75e88a6aa1b060ce7dd161dbaaf6d40ab8e49bb25961b9',
    '24e138d3fc88d572c8659b632ccfca2e1e3970a83db2ede4509c56777a94c0d8',
    '8c8b82cc6dc3875dd910553576114361db3d0166d92c8f6d0e361356f91da86d',
    '007723e7520f323f127d1887ec7aecad0283553dbc9a71a4b53182545d84c6f6'],
  ['27d0092015fe5111e195e653bfe9e2caf77e7903960d6f3bb7ac8b88aa976f4e',
    '46b4a7c3dd26717383e099db2cf622cd491bbcac5612a4be86e408f62efce00e',
    '1e6dc170305d5fefe02251c2851f6691689cf2156d9ce452d4c12af23ec229de',
    '205a0c46063ec2c3c2c5e58fe54a070f0fb03679364c25e7a20184394db08323'],
  ['68941a7406c503ce877f52ebbe875c4e50fb381b572d990ac925602d7b7e2a32',
    '89349c5ed01732ee7136fb352a20c132a0d1cf60cecde0125ebdeca7e8561a2e',
    '10bf7bb55342d15fb699f0811fad5106bbb7c3a968fde2e247512114a8aa1237',
    'f5044511bfea8a72d826f199317bde547b937315d41ed6a70fe59411c2c112b1'],
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
      const hash = createHash('sha256').update(r.fg).update(r.bg).update(r.mask).digest('hex');
      assert.equal(hash, reference[index][sample++], `frame ${frame}`);
    }
  });
}
