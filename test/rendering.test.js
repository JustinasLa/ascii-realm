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
// and moonbeams light patches of it, with faint columns of air above; the
// beams leave the overlay buffer's unshown colours alone. Desktop and meadow
// were re-captured when ore veins came into view.
// Cover terrain, shoreline reflections, trampled grass, painter order and the
// supersampled warrior while moving, attacking and jumping. No GPU/font dependency.
const reference = [
  ['2d34e5cc6a5220a370476775079a8f553ea50c14f65f3a45ab274600f92fab2d',
    'ad267647d1b2173107d1b865eb70274ace8861f88edf7179f40c829bd7dbffdc',
    '82308dda251a2b914b691e0895407adbc5b9a410357b1f804df4bc2cec4ab00c',
    'c40ccba3eefcec6d37f4f0b348c46d20c0bf50da89ce17048cf100f3dd8fcfbb'],
  ['4d7784eeab053fce4096e6cecfb1b293c62145b49a6b5c29db41ef37918ab07b',
    'efc0e36e4521b633e98af1a4c99011a7d2dfd3079ca686267af88b362a7b4ce9',
    'f15987a448750736f539822af374586f29f4d91259b2792bdfb336b98e5c3765',
    '1051c6022d53054462fa5d503195491f7c55ad50ce4e1e2d72626b17b4ba64d1'],
  ['382750eedd7b37c310c12c2bc8fdc05d1530e06b18d294095260a34bdc2e037b',
    '8efc6fbf91462c9299c70950bf159bb5a25ce6d218297cafec672479adf87ae7',
    'd7242b83ea2c8e098e6b3ce0bc7a4bf0181e5598f2cd07c0e657167d1a099c87',
    'b13ce6cfb9967bd7eeae0b61d3901b10dea0f45521d73cf03140ca1e4f024423'],
  ['de0e87336c013d5e0f571aca198e904a5cefd119bc20bc34edbc9c549f8a5a07',
    '9d8eaac3d8b112868a0f4f2c92c5ddbfbc401f21e0276c4bc4e8b98836f8ccc1',
    'bd4be8e54e21f408ee1dbe37a2a95e5e9a7db52ad72df3f79d99db8cca25233f',
    '517091f66ffcbd94392a7f800aaff50c6996d347f351048f90399c18df0743c8'],
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
