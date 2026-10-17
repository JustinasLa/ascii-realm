import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/shielding-orb.js';
import spell from '../../src/spells/definitions/shielding-orb.js';
import { SpellEffects } from '../../src/spells/effects.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress = 0.2, age = progress * profile.duration, radius = 1) {
  const points = [];
  const effect = Object.freeze({ stage, progress, age, life: profile.duration, radius, heading: 0 });
  profile.draw(effect, (...point) => points.push(point));
  return points;
}

test('Shielding Orb opts into its own profile and retains its TF ward parameters', () => {
  assert.equal(spell.presentation, profile);
  assert.equal(profile.id, spell.id);
  assert.equal(spell.root, 'shielding_orb');
  assert.equal(spell.supportive, true);
  assert.deepEqual(spell.variants[0].params, { cooldown: 10, mana: 4, shield_power: 13, shield_duration: 6 });
  assert.equal(spell.source.sha256, 'c9f405f18142629574b33481eadbd1e219bd9e0ed27d41487977509c68af4129');
});

test('all ward stages remain bounded, deterministic, ASCII, and fade to darkness', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const progress of [0, 0.23, 0.7, 1]) {
      const points = draw(stage, progress);
      assert.ok(points.length >= 20 && points.length <= 96, `${stage} has a bounded visible motif`);
      assert.deepEqual(points, draw(stage, progress), 'drawing is deterministic');
      for (const [x, z, char, color, brightness] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) <= 3 && Math.abs(z) <= 3);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.equal(color.length, 3);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0, `${stage} fades completely`);
      }
    }
  }
});

test('two orbiting cores travel inside a lattice and leave a paired bead wake', () => {
  for (const stage of ['cast', 'projectile']) {
    const first = draw(stage, 0.2, 0), later = draw(stage, 0.2, 0.17);
    const cores = points => points.filter(p => p[2] === 'o');
    assert.equal(cores(first).length, 2);
    assert.ok(Math.abs(cores(first)[0][0] + cores(first)[1][0]) < 1e-9);
    assert.ok(Math.abs(cores(later)[0][1] + cores(later)[1][1]) < 1e-9);
    assert.notDeepEqual(cores(first), cores(later), 'the double orb orbits independently of lifetime');
    assert.ok(first.some(p => p[2] === '+') && first.some(p => p[2] === ':'), 'lattice has ties and connecting ribs');
  }
  const wake = draw('projectile').filter(p => p[2] === '.');
  assert.ok(wake.length >= 6);
  assert.ok(wake.every(p => p[1] < -0.4));
  assert.ok(wake.some(p => p[0] < 0) && wake.some(p => p[0] > 0));
});

test('landing resolves the lattice into overlapping protective arcs with cross ties', () => {
  const cast = draw('cast'), early = draw('impact', 0.1), late = draw('impact', 0.6);
  assert.notDeepEqual(cast, early);
  for (const stage of ['impact', 'aura', 'zone']) {
    const points = draw(stage);
    assert.ok(points.filter(p => p[2] === '(').length > 10);
    assert.ok(points.filter(p => p[2] === ')').length > 10);
    assert.ok(points.some(p => p[2] === '='), 'guard retains its lattice cross ties');
  }
  const extent = points => Math.max(...points.map(p => Math.hypot(p[0], p[1])));
  assert.ok(extent(late) > extent(early), 'landing arcs spring outward');
  assert.ok(draw('pulse').length < draw('aura').length, 'repeated source pulses use a lighter silhouette');
});

test('paired beating bells lead a low rim hum and resilient falling impact thrum', () => {
  const [bellA, bellB, hum] = profile.sounds.cast;
  assert.ok([bellA, bellB].every(v => v.kind === 'tone' && v.type === 'sine' && v.release > v.duration * 0.7));
  assert.ok(Math.abs(bellA.frequency - bellB.frequency) > 0);
  assert.ok(Math.abs(bellA.frequency - bellB.frequency) / bellA.frequency < 0.03, 'near unison bells create a slow beat');
  assert.ok((bellB.delay ?? 0) < 0.04 && hum.delay > bellB.delay);
  assert.ok(hum.frequency < bellA.frequency / 3 && hum.attack > bellA.attack);
  const [thrum, overtone, ...rim] = profile.sounds.impact;
  assert.ok(thrum.endFrequency < thrum.frequency && thrum.frequency < hum.frequency);
  assert.ok(overtone.endFrequency < overtone.frequency);
  assert.ok(rim.every(v => v.delay > overtone.delay && v.type === 'sine'));
  assert.ok(profile.sounds.pulse.every(v => v.gain < 0.02 && v.duration <= 0.1));
  for (const recipe of Object.values(profile.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    for (const voice of recipe) {
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
    }
  }
});

test('real rune cast renders the authored projectile and ally ward with typed spatial sound cues', () => {
  const scene = runeScene(spell, { range: 12, allyInPath: true }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const acceptedEvents = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, acceptedEvents, 'cooldown rejection emits no cue');
  assert.equal(scene.casting.projectiles.length, 1);
  const castPoints = [];
  scene.casting.effects.paint((...p) => castPoints.push(p));
  assert.ok(castPoints.some(p => p[2] === 'o') && castPoints.some(p => p[2] === ':'));
  const projectilePoints = [];
  new SpellEffects().paint((...p) => projectilePoints.push(p), scene.casting.projectiles);
  assert.equal(projectilePoints.filter(p => p[2] === 'o').length, 2);
  assert.ok(projectilePoints.some(p => p[2] === '.'));
  scene.advance(0.3);
  assert.equal(scene.casting.state(scene.ally).shield, 13);
  assert.equal(scene.casting.state().shield, 0);
  assert.equal(scene.foe.health, 100);
  const ward = scene.casting.effects.list.find(e => e.stage === 'aura');
  assert.equal(ward?.presentation, profile);
  const landed = [];
  scene.casting.effects.paint((...p) => landed.push(p));
  assert.ok(landed.some(p => p[2] === '='));
  const cast = events.find(e => e.stage === 'cast'), impact = events.find(e => e.stage === 'impact');
  assert.ok(cast && impact);
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id && e.presentation === profile));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  assert.equal(impact.x, scene.ally.x);
  assert.equal(impact.y, scene.ally.y);
  const fake = fakeRecordedAudio();
  const handles = [cast, impact].flatMap(event => playSpellSound(fake.engine, event));
  assert.equal(handles.length, profile.sounds.cast.length + profile.sounds.impact.length);
  assert.ok(fake.routes.every(r => r.bus === 'sfx'));
  assert.ok(fake.routes.some(r => r.x === scene.ally.x && r.y === scene.ally.y));
  assert.ok(fake.nodes.some(n => n.starts.some(at => at > fake.context.currentTime)), 'bell and rim layers are scheduled');
  assert.deepEqual(fake.invalid, []);
  for (const handle of handles) handle.stop();
  assert.ok(fake.routes.every(r => r.disposals === 1));
  scene.advance(6.5);
  assert.equal(scene.casting.state(scene.ally).shield, 0, 'ward still expires after the TF duration');
});
