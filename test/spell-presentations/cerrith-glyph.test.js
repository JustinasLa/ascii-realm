import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/cerrith-glyph.js';
import spell from '../../src/spells/definitions/cerrith-glyph.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function capture(stage, progress = 0.4, age = progress * presentation.duration, radius = 1) {
  const points = [];
  const effect = Object.freeze({ stage, progress, age, life: presentation.duration, radius, heading: 0 });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push([x, z, char, [...color], brightness]));
  return points;
}

test('Cerrith Glyph opts into a four-leaf knot, squared root curls and moving pollen', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const cast = capture('cast');
  for (const tip of ['^', '>', 'v', '<']) {
    assert.equal(cast.filter(p => p[2] === tip).length, 1, 'each cardinal leaf has its own pointed tip');
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    assert.ok(cast.some(([x, z, char]) => char === '+' && x * sx > 0.4 && z * sz > 0.4),
      'the knot is enclosed by squared roots in all four corners');
  }
  const earlyPollen = capture('zone', 0.3, 0.1).filter(p => p[2] === 'o');
  const latePollen = capture('zone', 0.3, 0.8).filter(p => p[2] === 'o');
  assert.equal(earlyPollen.length, 8);
  assert.notDeepEqual(earlyPollen.map(p => p.slice(0, 2)), latePollen.map(p => p.slice(0, 2)), 'pollen orbits the standing glyph');
  assert.deepEqual(capture('cast'), cast, 'geometry is deterministic and effect input stays immutable');
  assert.notDeepEqual(capture('cast', 0.1), capture('cast', 0.5), 'the leaf knot grows during casting');
  const impact = capture('impact');
  assert.notDeepEqual(impact, cast);
  assert.ok(impact.filter(p => p[2] === '+').length < cast.filter(p => p[2] === '+').length,
    'landing exchanges closed root spirals for outward binding hooks');
});

test('every Cerrith stage stays finite, within its draw budget, and fades to zero', () => {
  for (const stage of ['cast', 'impact', 'projectile', 'pulse', 'aura', 'zone']) {
    for (const radius of [0.1, 1, 40]) for (const progress of [0, 0.25, 0.65, 0.98, 1]) {
      const points = capture(stage, progress, progress * 8, radius);
      assert.ok(points.length > 0 && points.length <= 96, `${stage} is authored within budget`);
      for (const [x, z, char, color, light] of points) {
        assert.ok([x, z, light, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 9 && Math.abs(z) < 9, 'local metre geometry remains compact');
        assert.match(char, /^[\x21-\x7e]$/);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(light >= 0 && light <= 1);
        if (progress === 1) assert.equal(light, 0, `${stage} fades completely`);
      }
    }
  }
  const projectile = capture('projectile');
  assert.ok(projectile.length < 30, 'flight uses a compact four-leaf silhouette');
  assert.ok(projectile.some(([x, z, char]) => z < -0.8 && char === '.'), 'flight has a trailing pollen wake');
  assert.ok(projectile.some(p => p[2] === '^') && projectile.some(p => p[2] === 'v'));
});

test('the wooden four-note chord, moss breath and root knock have distinct envelopes', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const chord = cast.filter(v => v.kind === 'tone');
  assert.equal(chord.length, 4);
  assert.ok(chord.every(v => v.type === 'triangle' && v.attack < 0.01 && v.release > 0.3 && v.cutoff < 1500));
  const root = chord[0].frequency;
  assert.deepEqual(chord.map(v => v.frequency / root), [1, 1.25, 1.5, 2], 'a root/third/fifth/octave wooden chord');
  assert.ok(chord.slice(1).every((v, i) => v.delay > (chord[i].delay ?? 0)), 'the chord rolls in quickly');
  const breath = cast.find(v => v.kind === 'noise');
  assert.ok(breath.filterType === 'bandpass' && breath.attack > 0.1 && breath.gain < 0.025);
  assert.ok(impact.some(v => v.kind === 'tone' && v.endFrequency < v.frequency && v.duration < 0.15), 'a short downward root knock');
  assert.ok(impact.some(v => v.kind === 'noise' && v.filterType === 'lowpass' && v.duration < 0.1), 'a woody contact texture');
  assert.ok(pulse.every(v => v.gain <= 0.01 && v.duration <= 0.1), 'repeated shielding ticks stay soft and brief');
  assert.notDeepEqual(cast, impact);
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25 && voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
      assert.ok(Object.values(voice).filter(v => typeof v === 'number').every(Number.isFinite));
    }
  }
});

test('a real Cerrith cast renders its profile, emits spell cues and retains delayed shielding', () => {
  const scene = runeScene(spell, { range: 15, allyInPath: true, allyRange: 1.5 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejection stays silent');
  const cast = events.filter(e => e.stage === 'cast');
  assert.equal(cast.length, 1);
  assert.equal(scene.casting.mana, 92);
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'cast' && e.presentation === presentation));
  const points = [];
  scene.casting.effects.paint((...p) => points.push(p), scene.casting.projectiles);
  assert.ok(points.some(p => p[2] === 'o') && points.some(p => p[2] === '^'), 'runtime paints the leaf knot and pollen');
  scene.advance(0.8);
  assert.equal(scene.casting.state(scene.ally).shield, 0, 'arming delay is preserved');
  scene.advance(1.5);
  assert.equal(scene.casting.state(scene.ally).shield, 23);
  assert.ok(events.some(e => e.stage === 'impact'));
  assert.ok(events.some(e => e.stage === 'pulse'));
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === presentation && e.spellId === spell.id),
    'all cues use the typed spell profile without sword draw or slam fallbacks');
  for (const event of [cast[0], events.find(e => e.stage === 'impact')]) {
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, event);
    assert.equal(handles.length, presentation.sounds[event.stage].length);
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === event.x && r.y === event.y));
    assert.deepEqual(fake.invalid, []);
    for (const handle of handles) handle.stop();
  }
});
