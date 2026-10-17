import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/mitlan-glyph.js';
import spell from '../../src/spells/definitions/mitlan-glyph.js';
import { SpellEffects } from '../../src/spells/effects.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress = 0.35, overrides = {}) {
  const points = [];
  const effect = Object.freeze({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius: 1, heading: 0, ...overrides });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}

test('Mitlan Glyph forms three curling prongs, orbiting droplets and opposing offset currents', () => {
  assert.equal(spell.presentation, presentation);
  const points = draw('zone'), tips = points.filter(p => p.char === '+');
  assert.equal(tips.length, 3);
  const radii = tips.map(p => Math.hypot(p.x, p.z));
  assert.ok(radii.every(r => Math.abs(r - radii[0]) < 1e-9));
  for (let i = 0; i < tips.length; i++) {
    const a = tips[i], b = tips[(i + 1) % tips.length];
    assert.ok(Math.abs((a.x * b.x + a.z * b.z) / radii[i] ** 2 + 0.5) < 1e-9,
      'the three water prongs are evenly spaced around the seal');
  }
  const droplets = points.filter(p => p.char === 'o' && Math.hypot(p.x, p.z) > 0.1);
  assert.equal(droplets.length, 3);
  assert.ok(droplets.every(p => Math.hypot(p.x, p.z) > radii[0]));
  const currents = points.filter(p => p.color[0] < 40);
  const centers = ['.', ':'].map(char => {
    const ring = currents.filter(p => p.char === char);
    return { x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
      z: ring.reduce((sum, p) => sum + p.z, 0) / ring.length };
  });
  assert.ok(centers[0].x < 0 && centers[1].x > 0);
  assert.ok(centers[0].z > 0 && centers[1].z < 0, 'the two circular tracks are offset across the seal');
  assert.notDeepEqual(draw('cast', 0.05), draw('cast', 0.55), 'casting unfurls the seal');
  assert.notDeepEqual(draw('zone', 0.3), draw('zone', 0.3, { age: 2 }), 'currents and beads keep rotating');
  assert.deepEqual(draw('zone'), draw('zone', 0.35, { heading: 2 }), 'the runtime alone rotates the local geometry');
  const projectile = draw('projectile');
  assert.equal(projectile.filter(p => p.char === 'o').length, 3);
  assert.equal(projectile.filter(p => p.char === '.').length, 3, 'the compact spiral leaves three bead trails');
  assert.ok(projectile.every(p => Math.hypot(p.x, p.z) < 1.1));
  const impact = draw('impact');
  assert.ok(impact.some(p => p.char === '<') && impact.some(p => p.char === '>'));
  assert.equal(impact.filter(p => p.char === '+').length, 0, 'impact opens the prongs into detached ripples');
});

test('all stages remain deterministic, finite and bounded, then fade cleanly', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const progress of [0, 0.25, 0.7, 0.99, 1]) {
      const points = draw(stage, progress, { radius: 4 });
      assert.ok(points.length > 0 && points.length <= 96);
      assert.deepEqual(points, draw(stage, progress, { radius: 4 }));
      for (const point of points) {
        assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
        assert.ok(Math.abs(point.x) < 6 && Math.abs(point.z) < 6);
        assert.match(point.char, /^[\x20-\x7e]$/);
        assert.ok(point.color.every(channel => channel >= 0 && channel <= 255));
        assert.ok(point.brightness >= 0 && point.brightness <= 1);
      }
      if (progress === 1) assert.ok(points.every(point => point.brightness === 0));
    }
  }
});

test('sound phrase has three timed liquid glides over a submerged hum and a separate droplet seal', () => {
  const cast = presentation.sounds.cast;
  const hum = cast.find(v => v.kind === 'tone' && v.frequency < 200);
  assert.ok(hum.duration > 0.8 && hum.attack > 0.1 && hum.cutoff < 500);
  const notes = cast.filter(v => v.kind === 'tone' && v !== hum);
  assert.equal(notes.length, 3);
  assert.ok(notes.every(v => v.type === 'sine' && v.endFrequency < v.frequency && v.attack < 0.01));
  assert.ok(notes[0].frequency < notes[1].frequency && notes[1].frequency < notes[2].frequency);
  assert.ok(Math.abs((notes[1].delay - notes[0].delay) - (notes[2].delay - notes[1].delay)) < 1e-9);
  assert.ok(presentation.sounds.impact.some(v => v.kind === 'tone' && v.frequency > 1000 && v.attack < 0.005));
  assert.notDeepEqual(presentation.sounds.impact, cast);
  assert.ok(presentation.sounds.pulse.every(v => v.gain < 0.025 && v.duration < 0.15));
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
      assert.ok(Object.values(voice).filter(v => typeof v === 'number').every(Number.isFinite));
    }
  }
});

test('authored liquid layers schedule their delays through the spatial effects bus', () => {
  const fake = fakeRecordedAudio();
  for (const stage of ['cast', 'impact']) {
    const before = fake.nodes.length;
    const handles = playSpellSound(fake.engine, { type: 'spell', stage, presentation, x: 3, y: 9 });
    const sources = fake.nodes.slice(before).filter(n => n.kind === 'oscillator' || n.kind === 'source');
    assert.equal(handles.length, presentation.sounds[stage].length);
    assert.deepEqual(sources.map(n => n.starts[0]),
      presentation.sounds[stage].map(voice => fake.context.currentTime + (voice.delay ?? 0)));
    handles.forEach(handle => handle.stop());
  }
  assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 3 && route.y === 9 && route.disposals === 1));
  assert.deepEqual(fake.invalid, []);
});

test('real Mitlan Glyph cast renders the profile and emits typed cast/impact cues with unchanged rune behavior', () => {
  const scene = runeScene(spell, { range: 1 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.casting.mana, 92);
  assert.equal(scene.cast().ok, false);
  assert.equal(events.filter(e => e.stage === 'cast').length, 1, 'rejected recasts stay silent');
  assert.ok(scene.casting.effects.list.some(e => e.presentation === presentation && e.stage === 'cast'));
  const moving = [];
  new SpellEffects().paint((...point) => moving.push(point), scene.casting.projectiles);
  assert.ok(moving.some(p => p[2] === '~') && moving.some(p => p[2] === 'o'), 'the real launched projectile uses the small spiral');
  scene.advance(0.8);
  assert.equal(scene.foe.health, 100, 'the configured arming delay remains intact');
  assert.ok(scene.casting.effects.list.some(e => e.presentation === presentation && e.stage === 'zone'));
  for (let i = 0; i < 40 && scene.foe.health === 100; i++) scene.advance(0.05);
  assert.equal(scene.foe.health, 86);
  assert.ok(scene.aura(scene.foe, 'Slowed'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  const rendered = [];
  scene.casting.effects.paint((...point) => rendered.push(point), scene.casting.projectiles);
  assert.ok(rendered.some(p => p[2] === '+'), 'the zone retains the three pronged glyph');
  assert.ok(rendered.some(p => p[2] === '<'), 'contact uses the separate opening seal');
});
