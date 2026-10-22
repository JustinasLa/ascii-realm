import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/rekindle.js';
import spell from '../../src/spells/definitions/rekindle.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress = 0.35, overrides = {}) {
  const points = [];
  const life = overrides.life ?? presentation.duration;
  const effect = Object.freeze({ stage, progress, age: progress * life, life, radius: 1, heading: 0, x: 40, y: 12, ...overrides });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}
const lit = points => points.filter(p => p.brightness > 0.05);
const warm = color => color[0] >= color[1] && color[1] >= color[2];
const BUDGET = { cast: 140, projectile: 40, impact: 80, pulse: 40, aura: 60, zone: 40 };

test('flames climb from the feet to the chest and the ember there flares', () => {
  assert.equal(spell.presentation, presentation);
  const top = p => Math.min(...lit(draw('cast', p)).filter(q => '()'.includes(q.char)).map(q => q.z));
  assert.ok(top(0.5) < top(0.15) - 1, 'the flames climb');
  assert.ok(top(0.5) >= -2.4 - 1e-9, 'up to the chest');
  assert.ok(lit(draw('cast', 0.1)).every(q => q.z <= 1e-9), 'nothing below the feet');
  const flare = lit(draw('cast', 0.55));
  assert.ok(flare.some(q => q.char === '@' && Math.abs(q.z + 2.4) < 1e-9), 'the chest ember flares');
  assert.ok(lit(draw('cast', 0.1)).every(q => q.char !== '@'), 'only once the flames arrive');
  assert.ok(flare.every(q => warm(q.color)), 'all fire colours');
});

test('each heal blooms sparks up from the chest; the burn smoulders around the body', () => {
  const bloom = p => lit(draw('impact', p, { life: 0.6 }));
  const sparks = bloom(0.3).filter(q => "*+'.".includes(q.char) && q.z < -2.4);
  assert.ok(sparks.length >= 6, 'sparks rise above the chest');
  assert.ok(bloom(0.1).filter(q => q.char === '|' || q.char === '-').length === 4, 'a warm cross marks the heal');
  assert.ok(bloom(0.8).length < bloom(0.2).length, 'and it fades');
  const smoulder = lit(draw('aura', 0.5, { life: 1.5 }));
  assert.ok(smoulder.some(q => q.z > -0.5 && '()^'.includes(q.char)), 'flames flicker at the feet');
  assert.ok(smoulder.some(q => q.z < -2), 'embers drift past the shoulders');
  assert.notDeepEqual(draw('aura', 0.5, { life: 1.5 }), draw('aura', 0.55, { life: 1.5 }), 'the fire moves');
});

test('flames rise straight up the screen whatever the caster heading', () => {
  const screen = heading => {
    const cells = [];
    paintPresentation(presentation, { x: 0, y: 0, stage: 'cast', age: 0.3, life: 0.7, radius: 0.8, heading },
      (x, y, char) => cells.push(`${Math.round(x * 1e6)},${Math.round(y * 1e6)},${char}`));
    return cells;
  };
  assert.deepEqual(screen(2.1), screen(0));
});

test('all stages remain deterministic, finite, ASCII and within budget, then fade cleanly', () => {
  const lives = { cast: [presentation.duration], projectile: [1], impact: [0.6], pulse: [0.5], aura: [1.5], zone: [0.6] };
  for (const stage of Object.keys(BUDGET)) {
    for (const life of lives[stage]) {
      for (const size of [0.3, 1, 2.5, 6]) {
        for (const progress of [0, 0.05, 0.1, 0.25, 0.5, 0.7, 0.9, 0.99, 1]) {
          const options = { radius: size, life };
          const points = draw(stage, progress, options);
          assert.ok(points.length <= BUDGET[stage], `${stage} ${size} ${progress}: ${points.length}`);
          assert.deepEqual(points, draw(stage, progress, options));
          for (const point of points) {
            assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
            assert.ok(Math.abs(point.x) < 6 && Math.abs(point.z) < 6);
            assert.match(point.char, /^[\x20-\x7e]$/);
            assert.ok(point.color.every(channel => channel >= 0 && channel <= 255));
            assert.ok(point.brightness > 0 && point.brightness <= 1);
          }
          if (progress === 1) assert.equal(points.length, 0, `${stage} fades out`);
        }
      }
    }
  }
});

test('the cast whooshes up into a warm chime and plays through the effects bus', () => {
  const { impact, cast } = presentation.sounds;
  assert.ok(cast.some(v => v.kind === 'tone' && v.endFrequency > v.frequency), 'the kindling rises');
  assert.ok(impact.some(v => v.kind === 'tone' && v.type === 'sine'), 'each heal chimes softly');
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.duration > 0 && voice.duration <= 2.5 && voice.gain > 0 && voice.gain <= 0.25);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
  }
  const fake = fakeRecordedAudio();
  const handles = playSpellSound(fake.engine, { type: 'spell', stage: 'cast', presentation, x: 3, y: 9 });
  assert.equal(handles.length, cast.length);
  handles.forEach(handle => handle.stop());
  assert.deepEqual(fake.invalid, []);
});

test('a real cast kindles on the caster and every heal blooms there with its own cue', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const mine = () => scene.casting.effects.list.filter(e => e.presentation === presentation);
  assert.ok(mine().some(e => e.stage === 'cast' && e.x === scene.player.x && e.y === scene.player.y));
  assert.equal(mine().filter(e => e.stage === 'impact').length, 1);
  scene.advance(1.1);
  assert.ok(mine().some(e => e.stage === 'aura'), 'the burn smoulders');
  scene.advance(3.5);
  assert.equal(events.filter(e => e.stage === 'impact').length, 5, 'one chime per heal');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id));
});
