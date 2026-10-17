import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/bubble-shard.js';
import spell from '../../src/spells/definitions/bubble-shard.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress) {
  const points = [];
  presentation.draw({ stage, progress, age: presentation.duration * progress,
    life: presentation.duration, radius: 1, heading: 0 }, (...p) => points.push(p));
  return points;
}

test('Bubble Shard opts into three hollow bubbles and rising, swelling film highlights', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const early = draw('cast', 0), later = draw('cast', 0.5);
  assert.equal(early.filter(p => p[2] === 'o').length, 3, 'three separate bubble highlights');
  assert.ok(['(', ')', '-', "'"].every(char => early.some(p => p[2] === char)), 'rims stay hollow with curved film highlights');
  const left = early.filter(p => p[2] === '('), right = early.filter(p => p[2] === ')');
  const diameters = left.map((point, i) => right[i][0] - point[0]);
  assert.ok(diameters[0] > diameters[1] && diameters[1] > diameters[2], 'bubble cluster has distinctly different sizes');
  const earlyGlints = early.filter(p => p[2] === 'o'), laterGlints = later.filter(p => p[2] === 'o');
  assert.ok(laterGlints.every((p, i) => p[1] > earlyGlints[i][1]), 'all three bubbles rise');
  assert.ok(later.filter(p => p[2] === ')')[0][0] - later.filter(p => p[2] === '(')[0][0] > diameters[0], 'film swells before release');
});

test('Bubble Shard has small trailing projectiles and distinct staggered open pop crownlets', () => {
  const projectile = draw('projectile', 0.2), impact = draw('impact', 0.2);
  assert.ok(projectile.some(p => p[1] < -1.4 && p[2] === '.'), 'bubble trail extends behind the head');
  assert.ok(Math.max(...projectile.map(p => Math.abs(p[0]))) < 0.5, 'travelling silhouette stays compact');
  assert.ok(impact.some(p => p[2] === '^') && impact.some(p => p[2] === 'u'), 'impact has raised crown teeth and open cups');
  assert.ok(!impact.some(p => p[2] === '(' || p[2] === ')'), 'popped films no longer form intact circles');
  const first = draw('impact', 0);
  assert.ok(first.some(p => p[4] < first[0][4]), 'later films wait for their staggered pop');
  assert.notDeepEqual(impact, draw('impact', 0.65), 'crownlets expand and throw droplets over time');
});

test('all Bubble Shard stages use finite ASCII geometry, bounded light, and a complete fade', () => {
  const signatures = [];
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const p of [0, 0.15, 0.5, 0.9, 1]) {
      const points = draw(stage, p);
      assert.ok(points.length > 0 && points.length <= 96);
      assert.ok(points.every(([x, z, char, color, brightness]) =>
        Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < 4 && Math.abs(z) < 4
        && /^[\x20-\x7e]$/.test(char) && color.length === 3
        && color.every(c => Number.isFinite(c) && c >= 0 && c <= 255)
        && Number.isFinite(brightness) && brightness >= 0 && brightness <= 1));
      if (p === 1) assert.ok(points.every(point => point[4] === 0), `${stage} fades fully`);
    }
    assert.notDeepEqual(draw(stage, 0.15), draw(stage, 0.5));
    signatures.push(JSON.stringify(draw(stage, 0.3)));
  }
  assert.equal(new Set(signatures.slice(0, 4)).size, 4, 'launch, flight, pop and small tick bubbles have separate forms');
});

test('bubbly sound uses three unevenly spaced falling plops and a softer rounded pop cluster', () => {
  for (const stage of ['cast', 'impact']) {
    const voices = presentation.sounds[stage], tones = voices.filter(v => v.kind === 'tone');
    assert.equal(tones.length, 3);
    assert.ok(tones.every(v => v.type === 'sine' && v.endFrequency < v.frequency && v.release > v.attack));
    assert.notEqual(tones[1].delay - tones[0].delay, tones[2].delay - tones[1].delay, 'irregular rhythm');
    assert.equal(new Set(tones.map(v => v.frequency)).size, 3, 'each bubble has a different pitch');
    assert.ok(voices.some(v => v.kind === 'noise' && v.gain < 0.025), 'soft film texture under the rounded tones');
    assert.ok(voices.length <= 8 && voices.every(v => v.gain <= 0.1 && v.duration <= 2.5 && (v.delay ?? 0) <= 2));
    const fake = fakeRecordedAudio();
    assert.equal(playSpellSound(fake.engine, { stage, presentation, x: 3, y: 7 }).length, voices.length);
    assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 3 && route.y === 7));
    const oscillators = fake.nodes.filter(node => node.kind === 'oscillator');
    assert.deepEqual(oscillators.map(node => node.starts[0] - fake.context.currentTime), tones.map(v => v.delay).map(delay => fake.context.currentTime + delay - fake.context.currentTime));
    assert.deepEqual(fake.invalid, []);
  }
  assert.notDeepEqual(presentation.sounds.cast, presentation.sounds.impact);
  assert.ok(presentation.sounds.pulse.every(v => v.gain < 0.02 && v.duration < 0.06), 'repeated projectile ticks stay quiet');
});

test('real Bubble Shard cast renders the profile, emits typed cues, and preserves damage and slowing', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.casting.mana, 96);
  assert.equal(scene.cast().ok, false);
  assert.equal(events.filter(e => e.stage === 'cast').length, 1, 'cooldown rejection is silent');
  const dots = [];
  scene.casting.effects.paint((...p) => dots.push(p), scene.casting.projectiles);
  assert.ok(dots.some(p => p[2] === '(') && dots.some(p => p[2] === 'o'), 'runtime paints authored film and bubbles');
  const projectile = scene.casting.projectiles[0], expected = [];
  paintPresentation(presentation, { x: projectile.x, y: projectile.y - projectile.h * 5,
    stage: 'projectile', age: projectile.age, life: projectile.life, radius: 0.65,
    heading: Math.atan2(projectile.dx, projectile.dz) }, (...p) => expected.push(p));
  assert.deepEqual(dots.slice(-expected.length), expected, 'runtime uses this profile for moving projectiles');
  scene.advance(0.15);
  assert.equal(scene.foe.health, 94);
  assert.ok(scene.aura(scene.foe, 'Slowed'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id && e.presentation === presentation));
  assert.ok(!events.some(e => ['draw', 'slam'].includes(e.type)));
});
