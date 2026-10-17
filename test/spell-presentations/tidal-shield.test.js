import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/tidal-shield.js';
import spell from '../../src/spells/definitions/tidal-shield.js';
import { runeScene } from '../../test-support/spells.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function points(stage, progress = 0.3) {
  const result = [];
  const effect = Object.freeze({ stage, age: progress * profile.duration, life: profile.duration,
    progress, radius: 1, heading: 0 });
  profile.draw(effect, (...point) => result.push(point));
  return result;
}

test('Tidal Shield forms a tapered shell with interior streams and rim-bound beads', () => {
  assert.equal(spell.presentation, profile);
  const shell = points('cast', 0.65);
  assert.ok(shell.some(p => p[2] === '(') && shell.some(p => p[2] === ')'), 'both bowed sides are visible');
  const rim = shell.filter(p => p[2] === 'o');
  assert.ok(rim.length > 4, 'separate droplets trace the shell rim');
  assert.ok(rim.every(p => Math.hypot(p[0], p[1]) > 0.5), 'droplets stay out of the interior');
  const currents = shell.filter(p => p[2] === '=');
  assert.ok(currents.some(p => p[1] > 0.2) && currents.some(p => p[1] < -0.2), 'streams cross different parts of the shell');
  const outline = shell.slice(0, 28);
  const topWidth = Math.max(...outline.filter(p => p[1] > 0).map(p => Math.abs(p[0])));
  const bottomWidth = Math.max(...outline.filter(p => p[1] < 0).map(p => Math.abs(p[0])));
  assert.ok(topWidth > bottomWidth, 'the lower half tapers like a shield');
  assert.notDeepEqual(points('cast', 0.15), points('cast', 0.65), 'the shell rises while its currents travel');
  assert.notDeepEqual(points('aura', 0.2), points('aura', 0.4), 'an established shell keeps flowing');
});

test('contact flexes the shell and sends open ripples from one side; projectile retains a shell and wake', () => {
  const contact = points('impact');
  assert.ok(!contact.some(p => p[2] === 'o'), 'contact releases the rim beads');
  assert.ok(contact.filter(p => p[2] === '.').every(p => p[0] > 0.5), 'splash travels away from the contact side');
  assert.notDeepEqual(contact, points('cast'), 'contact is distinct from shell assembly');
  const projectile = points('projectile');
  assert.ok(projectile.some(p => p[2] === '(') && projectile.some(p => p[2] === ')'));
  assert.ok(projectile.filter(p => p[1] < -0.4).length >= 8, 'a forked liquid wake follows the miniature shell');
});

test('all stages are deterministic, bounded, printable, and fade completely', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.2, 0.7, 1]) {
      const drawn = points(stage, progress);
      assert.ok(drawn.length > 10 && drawn.length <= 96);
      assert.deepEqual(drawn, points(stage, progress), 'drawing has no random state');
      for (const [x, z, char, color, brightness] of drawn) {
        assert.ok(Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < 4 && Math.abs(z) < 4);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.length === 3 && color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(brightness) && brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0);
      }
    }
  }
});

test('water audio combines a smooth rising chord, spaced laps, hollow contact, and quiet pulse', () => {
  const { cast, impact, pulse } = profile.sounds;
  const chord = cast.filter(v => v.kind === 'tone');
  assert.ok(chord.length >= 3 && chord.every(v => v.endFrequency > v.frequency && v.attack >= 0.07));
  assert.ok(chord.some(v => v.type === 'sine'), 'rounded tones carry the water chord');
  const laps = cast.filter(v => v.kind === 'noise');
  assert.ok(laps.length >= 2 && laps[1].delay > laps[0].delay + laps[0].duration, 'separate wave laps have audible space');
  assert.ok(laps.every(v => v.filterType === 'lowpass'), 'laps are soft water rather than bright fracture noise');
  assert.ok(impact.some(v => v.kind === 'tone' && v.endFrequency < v.frequency && v.attack < 0.02));
  assert.ok(pulse.every(v => v.gain <= 0.025 && v.duration <= 0.15), 'repeated laps remain quiet');
  for (const [stage, voices] of Object.entries(profile.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { stage, x: 2, y: 3, presentation: profile });
    assert.equal(handles.length, voices.length, 'each authored layer reaches the real voice instruments');
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 3));
    assert.deepEqual(fake.invalid, []);
    for (const voice of voices) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
    handles.forEach(h => h.stop());
  }
});

test('real Tidal Shield cast renders the profile and emits typed cues while preserving shield and burst', () => {
  const scene = runeScene(spell, { range: 2 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'a rejected repeat stays silent');
  const drawn = [];
  scene.casting.effects.paint((...point) => drawn.push(point), scene.casting.projectiles);
  assert.ok(drawn.some(p => p[2] === '(') && drawn.some(p => p[2] === 'o'), 'runtime renders the authored shell');
  scene.advance(0.5);
  assert.equal(scene.casting.state().shield, 7);
  assert.equal(scene.foe.health, 94);
  assert.equal(events.filter(e => e.type === 'spell' && e.stage === 'cast').length, 1);
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => e.presentation === profile && !['draw', 'slam'].includes(e.type)));
});
