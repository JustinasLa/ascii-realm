import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createScene, scenarios } from '../bench/scene.js';

// Cell-buffer snapshots of the ASCII-blade meadow, captured before its
// culling and contact-field optimizations.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['4eae4a6c4489ad377561092b4d71bdbb64319c7be85154d5ff615c716572343f',
    '42b00d17a94e0eca80cc6e205a34a06ffe21a4dce7aa6a869528565a9bc18540',
    '6fe91a7d9b68180b9d6499a4a467b8d0fb11aa95fc30b4c57104185a59e92ff4',
    '0142ff3c3b7db9500d8153f5488a747bd0ec5c7c1d3b034f47d3f526f75d4ddb'],
  ['8aead5070b2128ea6f09a11dfd0748c80264faaa166cccd5126d2366baa63aa3',
    '661add2071cd4fc96e1df2181b0e029f6aaf108df325afb34a8f5cda3810ad66',
    '5b67f1ef98a9cc72f91266fd115b73965bf71a1f2cd1a16f0414a631550d9313',
    '38a6f388c812e1eeb8e6df3fe0c82efecb3e0b6c2dbaa0ce18793e75465b8450'],
  ['80d10dfbde302b2294432833ddba45b9a7261dd1c545be15e5e27321b7fdc6dd',
    '733465e195036b99960080e30b26f2daeb3c368102b7daabaedc91f67f0817c3',
    'b8608a28e0eabb899888a613c585c74adbc0697b0f4b1f2e8df176b25cc74631',
    '1906c287b1dd1f13cab4ff08f94497c8593af9576d7c8ec5724a9210316d18fb'],
  ['1f2451c00d8c01737fef8437b6e98526ba696de8b580c12819e5e13193004bc1',
    '90e23845470407e060bd6e31b72faccf2dbb9bcfa9ad2b07c8353bb7268dfd32',
    'c1e2f94d67cf420e730a4d904fb9a24a38cc10e391d308f54a45f8c66779211e',
    'f1ff96e9c048781dbd9fa0f4be7409bc240afd93bbc8386591c2532a8bdf7578'],
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
