import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/temp-glacial-fan.js';
import spell from '../../src/spells/definitions/temp-glacial-fan.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { runeScene } from '../../test-support/spells.js';

function points(stage, progress = 0.4, heading = 0) {
  const output = [];
  profile.draw({ stage, progress, age: progress * profile.duration, life: profile.duration, radius: 1, heading },
    (...p) => output.push(p));
  return output;
}

test('Glacial Fan unfolds five separate triangular tips along a symmetric bowed contour', () => {
  assert.equal(spell.presentation, profile);
  const cast = points('cast'), tips = cast.filter(p => p[2] === '^');
  assert.equal(tips.length, 5, 'five outlined frost blades match the staggered gameplay fan');
  assert.ok(cast.filter(p => p[2] === '/').length > 5 && cast.filter(p => p[2] === '\\').length > 5);
  assert.ok(tips.every(p => p[1] > 0), 'the fan opens forward');
  const radii = tips.map(p => Math.hypot(p[0], p[1]));
  assert.ok(radii.every(r => Math.abs(r - radii[2]) < 1e-9), 'all tips follow one bowed rim');
  assert.ok(tips[2][1] > tips[0][1] && tips[2][1] > tips[4][1], 'centre bows beyond the outer tips');
  assert.ok(Math.abs(tips[0][0] + tips[4][0]) < 1e-9);
  assert.ok(tips.slice(1).every((p, i) => p[0] - tips[i][0] > 0.4), 'blades remain separated');
  const earlyWidth = Math.max(...points('cast', 0.05).map(p => Math.abs(p[0])));
  const lateWidth = Math.max(...points('cast', 0.65).map(p => Math.abs(p[0])));
  assert.ok(lateWidth > earlyWidth * 2, 'the fan visibly unfolds with time');
});

test('Glacial Fan fragments on impact and carries a compact triangular projectile with a frost trail', () => {
  const impact = points('impact'), projectile = points('projectile');
  assert.equal(impact.filter(p => p[2] === '*').length, 5);
  assert.equal(impact.filter(p => p[2] === 'x').length, 5, 'each detached blade sheds a fracture');
  assert.equal(impact.filter(p => p[2] === '^').length, 0);
  const radius = progress => Math.max(...points('impact', progress).map(p => Math.hypot(p[0], p[1])));
  assert.ok(radius(0.75) > radius(0.1) * 2, 'shatter chips travel outward');
  assert.equal(projectile.filter(p => p[2] === '^').length, 1);
  assert.ok(projectile.some(p => p[2] === ':' && p[1] < -0.6));
  assert.ok(Math.max(...projectile.map(p => Math.abs(p[0]))) < 0.3, 'individual shots remain slender');
  assert.notDeepEqual(projectile, points('projectile', 0.65), 'frost dust changes in flight');
});

test('all Glacial Fan stages stay deterministic, bounded, atlas compatible, and fade away', () => {
  for (const stage of ['cast', 'impact', 'projectile', 'pulse', 'aura', 'zone']) {
    for (const progress of [0, 0.1, 0.5, 0.9, 1]) {
      const frame = points(stage, progress);
      assert.ok(frame.length > 10 && frame.length <= 96, `${stage} respects the draw budget`);
      assert.ok(frame.every(p => p.length === 5 && Number.isFinite(p[0]) && Number.isFinite(p[1])
        && Math.abs(p[0]) < 5 && Math.abs(p[1]) < 5 && /^[\x20-\x7e]$/.test(p[2])
        && p[3].length === 3 && p[3].every(c => Number.isFinite(c) && c >= 0 && c <= 255)
        && Number.isFinite(p[4]) && p[4] >= 0 && p[4] <= 1));
      if (progress === 1) assert.ok(frame.every(p => p[4] === 0), `${stage} fades completely`);
      assert.deepEqual(frame, points(stage, progress), 'no random geometry or persistent state');
      assert.deepEqual(frame, points(stage, progress, 1.7), 'the runtime owns heading rotation');
    }
  }
});

test('Glacial Fan sound is three accelerating air cuts followed by a wide shatter chord', () => {
  const swishes = profile.sounds.cast.filter(v => v.kind === 'noise');
  assert.equal(swishes.length, 3);
  assert.ok(swishes[2].delay - swishes[1].delay < swishes[1].delay - swishes[0].delay);
  assert.ok(swishes[0].duration > swishes[1].duration && swishes[1].duration > swishes[2].duration);
  assert.ok(swishes[0].cutoff < swishes[1].cutoff && swishes[1].cutoff < swishes[2].cutoff);
  const chord = profile.sounds.impact.filter(v => v.kind === 'tone');
  assert.equal(chord.length, 3);
  assert.ok(chord[2].frequency / chord[0].frequency > 2, 'the shatter chord spans more than an octave');
  assert.ok(chord.every(v => v.endFrequency < v.frequency));
  for (const recipe of Object.values(profile.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    assert.ok(recipe.every(v => v.gain > 0 && v.gain <= 0.25 && v.duration > 0 && v.duration <= 2.5
      && (v.delay ?? 0) >= 0 && (v.delay ?? 0) <= 2));
  }
  assert.ok(profile.sounds.pulse.every(v => v.gain <= 0.025 && v.duration <= 0.08));
  const fake = fakeRecordedAudio();
  const handles = playSpellSound(fake.engine, { presentation: profile, stage: 'cast', x: -8, y: 5 });
  assert.equal(handles.length, profile.sounds.cast.length);
  assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === -8 && r.y === 5), 'swishes use event-location spatial routing');
  const cuts = fake.nodes.filter(n => n.kind === 'source');
  assert.ok(cuts[2].starts[0] - cuts[1].starts[0] < cuts[1].starts[0] - cuts[0].starts[0]);
  assert.deepEqual(fake.invalid, []);
  handles.forEach(h => h.stop());
});

test('a real Glacial Fan cast renders this profile and emits typed cast/impact cues without sword sounds', () => {
  const scene = runeScene(spell, { range: 6 }), events = [];
  scene.casting.onSound = event => events.push(event);
  const mana = scene.casting.state(scene.player).mana;
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.casting.state(scene.player).mana, mana - 8);
  assert.equal(scene.cast().ok, false, 'existing cooldown rejects repeat casts');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  const castEffect = scene.casting.effects.list.find(e => e.stage === 'cast');
  assert.equal(castEffect.presentation, profile);
  const actual = [], expected = [];
  scene.casting.effects.paint((...p) => actual.push(p));
  paintPresentation(profile, castEffect, (...p) => expected.push(p));
  assert.deepEqual(actual.slice(-expected.length), expected, 'the runtime paints authored fan geometry after the source summon cue');
  scene.advance(0.1);
  assert.ok(scene.casting.projectiles.length > 0);
  const inFlight = [];
  scene.casting.effects.paint((...p) => inFlight.push(p), scene.casting.projectiles);
  assert.ok(inFlight.some(p => p[2] === ':'), 'real shots render the authored frost trail');
  scene.advance(1.25);
  assert.ok(scene.monsters.events.some(e => e.type === 'hurt' && e.amount === 16), 'TF damage is preserved');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === profile && e.spellId === spell.id));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
});
