import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-vine-wave.js';
import spell from '../../src/spells/definitions/temp-vine-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function points(stage, progress = 0.3, radius = 1) {
  const result = [];
  const effect = Object.freeze({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius, heading: 0.7 });
  presentation.draw(effect, (...point) => result.push(point));
  return result;
}

test('Vine Wave opts in with moving paired stems, alternate leaf hooks and a compact flight braid', () => {
  assert.equal(spell.presentation, presentation);
  const cast = points('cast'), flight = points('projectile'), impact = points('impact');
  for (const glyph of ['/', '\\', '(', ')', '^']) assert.ok(cast.some(p => p[2] === glyph), `braid includes ${glyph}`);
  const stemPairs = cast.filter(p => p[2] === '/' || p[2] === '\\');
  assert.ok(stemPairs.some((p, i) => stemPairs.slice(i + 1).some(q => q[1] === p[1] && p[0] !== q[0])), 'stems share forward positions');
  assert.ok(cast.some(p => p[2] === '(' && p[0] < 0) && cast.some(p => p[2] === ')' && p[0] > 0), 'leaves alternate across braid');
  assert.ok(Math.max(...flight.map(p => p[1])) < 0.6 && Math.min(...flight.map(p => p[1])) < -1, 'recognizable tip trails a compact braid');
  assert.ok(impact.some(p => p[2] === '~') && !impact.some(p => p[2] === '^'), 'impact closes into a surrounding entanglement');
  const castStart = points('cast', 0.1), castLater = points('cast', 0.6);
  assert.ok(Math.max(...castLater.map(p => p[1])) > Math.max(...castStart.map(p => p[1])), 'cast stems visibly unfurl forward');
  const hitEarly = points('impact', 0.1), hitLate = points('impact', 0.65);
  assert.ok(Math.max(...hitLate.map(p => Math.abs(p[0]))) < Math.max(...hitEarly.map(p => Math.abs(p[0]))), 'impact tendrils tighten');
});

test('every Vine Wave stage stays finite, ASCII, bounded, deterministic and fades completely', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const radius of [0.1, 1, 40]) {
      for (const age of [0, 0.3, 0.85, 1]) {
        const dots = points(stage, age, radius);
        assert.ok(dots.length > 10 && dots.length <= 96);
        for (const [x, z, char, color, brightness] of dots) {
          assert.ok([x, z, brightness, ...color].every(Number.isFinite));
          assert.ok(Math.abs(x) < 5 && Math.abs(z) < 5);
          assert.match(char, /^[\x20-\x7e]$/);
          assert.ok(color.length === 3 && color.every(c => c >= 0 && c <= 255));
          assert.ok(brightness >= 0 && brightness <= 1);
          if (age === 1) assert.equal(brightness, 0, `${stage} fades fully`);
        }
      }
    }
    assert.deepEqual(points(stage), points(stage), 'draw is deterministic');
    assert.notDeepEqual(points(stage, 0.1), points(stage, 0.6), `${stage} animates`);
  }
});

test('Vine Wave sound layers rasp, alternate wood taps and release a low flexible whip', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast[0].kind === 'noise' && cast[0].filterType === 'bandpass');
  const taps = cast.filter(v => v.kind === 'tone' && v.duration < 0.1);
  assert.ok(taps.length >= 3 && taps.every((v, i) => !i || v.delay > taps[i - 1].delay));
  assert.ok(taps[0].frequency > taps[1].frequency && taps[2].frequency > taps[1].frequency, 'wood taps alternate pitch');
  assert.ok(cast.some(v => v.kind === 'tone' && v.duration > 0.2 && v.endFrequency < 100 && v.delay > taps.at(-1).delay), 'low whip follows the taps');
  assert.ok(impact.some(v => v.type === 'sawtooth' && v.endFrequency < v.frequency));
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(v => v.gain <= 0.03 && v.duration <= 0.1));
  for (const [stage, voices] of Object.entries(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const v of voices) {
      assert.ok(v.gain > 0 && v.gain <= 0.25 && v.duration > 0 && v.duration <= 2.5);
      assert.ok((v.delay ?? 0) >= 0 && (v.delay ?? 0) <= 2);
      assert.ok(Object.values(v).filter(value => typeof value === 'number').every(Number.isFinite));
    }
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { type: 'spell', stage, presentation, x: 2, y: 4 });
    assert.equal(handles.length, voices.length, `${stage} creates all layers`);
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 4));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(handle => handle.stop());
  }
});

test('real Vine Wave casts render the braid and emit typed cues while preserving delayed damage', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejects repeated cast');
  assert.equal(events.filter(e => e.type === 'spell' && e.stage === 'cast').length, 1);
  assert.ok(scene.casting.effects.list.some(e => e.presentation === presentation && e.stage === 'cast'));
  assert.equal(scene.casting.projectiles[0].ctx.spell.presentation, presentation);
  const dots = [];
  scene.casting.effects.paint((...point) => dots.push(point), scene.casting.projectiles);
  assert.ok(dots.some(p => p[2] === '^') && dots.some(p => p[2] === '('), 'runtime paints authored vine glyphs');
  scene.advance(0.4);
  assert.equal(scene.foe.health, 100, 'damage retains the source delay');
  scene.advance(1);
  assert.ok(scene.foe.health <= 84 && scene.potion(scene.foe, 'poison'));
  const spellEvents = events.filter(e => e.type === 'spell');
  assert.ok(spellEvents.some(e => e.stage === 'impact'));
  assert.ok(spellEvents.every(e => e.presentation === presentation && e.spellId === spell.id));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)), 'spell cues replace sword cues');
});
