import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/crashing-wave.js';
import spell from '../../src/spells/definitions/crashing-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

// Lifetimes the game actually uses: the cast flash, a 10 s projectile clock
// (the wave spends itself at its 16 m range), the default impact, tick pulses.
const LIFE = { cast: profile.duration, projectile: 10, impact: 0.6, pulse: 0.25, aura: 1.5, zone: 3 };
const BUDGET = { cast: 200, projectile: 115, impact: 200, pulse: 30, aura: 100, zone: 100 };

function frame(stage, progress, { heading = 0, age, x, y } = {}) {
  const life = LIFE[stage], points = [];
  profile.draw({ stage, progress, age: age ?? progress * life, life, radius: 1, heading, x, y },
    (...point) => points.push(point));
  return points;
}
const flight = (age, heading = 0) => frame('projectile', age / LIFE.projectile, { age, heading });
const width = points => Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0]));
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const light = color => color[0] + color[1] + color[2];

test('the breaker flies as a broad crescent: foaming lip, dark barrel, swell rows and curled tips', () => {
  assert.equal(spell.presentation, profile);
  assert.equal(profile.id, spell.id);
  const points = flight(0.45);
  const lip = points.filter(p => p[2] === '~' && light(p[3]) > 600);
  assert.ok(lip.length >= 25, 'the lip is a continuous line of foam');
  assert.ok(width(lip) > 1.8, 'the crest spans the wide hit area');
  const centre = lip.filter(p => Math.abs(p[0]) < 0.2), ends = lip.filter(p => Math.abs(p[0]) > 0.8);
  assert.ok(mean(centre.map(p => p[1])) > mean(ends.map(p => p[1])) + 0.2, 'the crest bows forward');
  const swell = points.filter(p => p[2] === '=' && light(p[3]) > 200);
  assert.ok(swell.length >= 6 && swell.every(p => p[1] < mean(centre.map(q => q[1]))), 'swell rows ride behind the lip');
  const barrel = points.filter(p => light(p[3]) < 250);
  assert.ok(barrel.length >= 6 && barrel.every(p => p[4] < 0.6), 'a dim deep-water barrel shadows the lip');
  assert.ok(mean(lip.map(p => p[4])) > mean(swell.map(p => p[4])), 'foam is brighter than the swell');
  const tips = points.filter(p => Math.abs(p[0]) >= 1 && p[1] < mean(ends.map(q => q[1])) - 0.1);
  assert.ok(tips.length >= 4, 'both tips curl back behind the crest');
  assert.ok(points.some(p => p[2] === '"' || p[2] === "'"), 'spray and mist come off the crest');
});

test('the breaker swells up on launch, rolls continuously and spends itself at range', () => {
  const lipWidth = age => width(flight(age).filter(p => p[2] === '~' && light(p[3]) > 600));
  assert.ok(lipWidth(0.02) < lipWidth(0.4) * 0.7, 'the wave rears up from a narrow swell');
  assert.ok(mean(flight(0.02).map(p => p[4])) < mean(flight(0.4).map(p => p[4])));
  assert.ok(flight(1.14).every(p => p[4] < 0.05), 'the wave has spent itself when it reaches 16 m');
  // Successive 60 fps frames move smoothly instead of popping.
  const glow = points => points.reduce((sum, p) => sum + p[4], 0);
  for (let age = 0.2; age < 0.85; age += 0.05) {
    const a = flight(age), b = flight(age + 1 / 60);
    assert.ok(Math.abs(mean(a.map(p => p[1])) - mean(b.map(p => p[1]))) < 0.05, 'no jumps between frames');
    assert.ok(Math.abs(glow(a) - glow(b)) < glow(a) * 0.1, 'no flicker between frames');
  }
});

test('strokes follow the on-screen direction of travel', () => {
  const lipAt = heading => flight(0.4, heading)
    .filter(p => !`"'`.includes(p[2]) && light(p[3]) > 600 && Math.abs(p[0]) < 0.25 && p[1] > 0.2);
  assert.ok(lipAt(0).every(p => p[2] === '~'), 'flying down the screen the lip is a horizontal swell');
  assert.ok(lipAt(Math.PI / 2).some(p => p[2] === ')'), 'flying right the lip bulges right');
  assert.ok(lipAt(-Math.PI / 2).some(p => p[2] === '('), 'flying left the lip bulges left');
});

test('the impact slams white, throws a forward crown and spray, then settles into foam and a ripple', () => {
  const slam = frame('impact', 0.01);
  const core = slam.find(p => p[2] === '@');
  assert.ok(core && core[4] > 0.8 && light(core[3]) === 765, 'a white flash marks the hit');
  assert.ok(slam.length < 70, 'the first frame stays legible instead of a blob');
  const early = frame('impact', 0.1), late = frame('impact', 0.45);
  assert.ok(width(late) > width(early) * 1.3, 'the crown spreads');
  const crown = frame('impact', 0.3).filter(p => '~()/\\'.includes(p[2]) && light(p[3]) > 450);
  const ahead = crown.filter(p => p[1] > 0.2), behind = crown.filter(p => p[1] < -0.2);
  assert.ok(mean(ahead.map(p => p[4])) > mean(behind.map(p => p[4])), 'the surf is heaviest where the wave pushes on');
  assert.ok(early.some(p => p[2] === 'o') && late.some(p => p[2] === ',' || p[2] === '.'), 'droplets break up as they fly');
  assert.ok(mean(late.map(p => light(p[3]))) < mean(early.map(p => light(p[3]))), 'foam cools from white to sea');
  assert.ok(frame('impact', 0.85).some(p => p[2] === '~' && Math.hypot(p[0], p[1]) > 1.6), 'a ripple spreads last');
});

test('the cast draws water in, heaves at the feet, hurls a surge forward and settles', () => {
  const radius = points => mean(points.map(p => Math.hypot(p[0], p[1])));
  assert.ok(radius(frame('cast', 0.02)) > radius(frame('cast', 0.1)) + 0.2, 'droplets spiral inward first');
  assert.ok(frame('cast', 0.13).some(p => p[2] === '#' && p[4] > 0.8), 'the water heaves up at the feet');
  const front = p => Math.max(...frame('cast', p).filter(q => q[2] === '~' && Math.abs(q[0]) < 0.2).map(q => q[1]));
  assert.ok(front(0.45) > front(0.22) + 0.4, 'the surge rolls forward');
  const settle = frame('cast', 0.6);
  assert.ok(settle.length > 20 && frame('cast', 0.95).length < settle.length / 2, 'the water settles away');
});

test('tick pulses leave a lean, varied wake that fades in and out', () => {
  assert.equal(frame('pulse', 0).length, 0, 'wake fades in instead of popping');
  const a = frame('pulse', 0.3, { x: 10, y: 4 }), b = frame('pulse', 0.3, { x: 12, y: 8 });
  assert.ok(a.length >= 16 && a.every(p => p[4] <= 0.5), 'the repeated wake stays dim');
  assert.notDeepEqual(a.map(p => p.slice(0, 2)), b.map(p => p.slice(0, 2)), 'each tick churns differently');
  assert.ok(width(a) < 3, 'the wake matches the breaker width');
});

test('every stage stays finite, bounded, deterministic, moving and fully faded', () => {
  for (const stage of Object.keys(LIFE)) {
    let peak = 0;
    for (const heading of [0, 0.7, Math.PI / 2, Math.PI, -2]) {
      for (const p of [0, 0.03, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1]) {
        const options = { heading, ...(stage === 'projectile' ? { age: p * 1.15 } : {}) };
        const points = frame(stage, stage === 'projectile' ? p * 1.15 / LIFE.projectile : p, options);
        assert.ok(points.length <= BUDGET[stage], `${stage} ${points.length} glyphs stays within budget`);
        peak = Math.max(peak, points.length);
        for (const [x, z, char, color, brightness] of points) {
          assert.ok(Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < 4 && Math.abs(z) < 4);
          assert.match(char, /^[\x20-\x7e]$/);
          assert.ok(color.length === 3 && color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
          assert.ok(Number.isFinite(brightness) && brightness > 0 && brightness <= 1);
        }
        assert.deepEqual(points, frame(stage, stage === 'projectile' ? p * 1.15 / LIFE.projectile : p, options));
      }
    }
    assert.ok(peak > 20, `${stage} draws a substantial effect`);
    const at = p => stage === 'projectile' ? flight(p) : frame(stage, p);
    assert.ok(at(0.2).length && at(0.65).length);
    assert.notDeepEqual(at(0.2).map(p => p.slice(0, 2)), at(0.65).map(p => p.slice(0, 2)));
    assert.ok(frame(stage, 1).every(p => p[4] === 0), `${stage} is fully faded at progress 1`);
    assert.ok(frame(stage, 1, { age: 0.5 }).every(p => p[4] === 0));
  }
});

test('surf gathers in staggered noise layers, then a deep thump leads a long foam hiss', () => {
  const { cast, impact, pulse } = profile.sounds;
  const rush = cast.filter(v => v.kind === 'noise');
  assert.ok(rush.length >= 3 && new Set(rush.map(v => v.delay ?? 0)).size === rush.length);
  assert.ok(rush[0].attack > 0.2, 'the surf swells instead of clicking');
  const thump = impact.find(v => v.kind === 'tone');
  const hiss = impact.find(v => v.kind === 'noise' && v.filterType === 'highpass');
  assert.ok(thump.frequency < 120 && thump.endFrequency < thump.frequency);
  assert.ok(hiss.delay > 0 && hiss.duration > 1 && hiss.release > 1, 'foam outlasts the breaker hit');
  assert.ok(pulse.every(v => v.gain <= 0.02 && v.duration <= 0.1), 'repeating tick foam stays quiet');
  for (const voices of Object.values(profile.sounds)) {
    assert.ok(voices.length <= 8);
    for (const v of voices) {
      assert.ok(v.gain > 0 && v.gain <= 0.25 && v.duration > 0 && v.duration <= 2.5);
      assert.ok((v.delay ?? 0) >= 0 && (v.delay ?? 0) <= 2);
    }
  }
  const fake = fakeRecordedAudio();
  for (const stage of ['cast', 'impact', 'pulse']) {
    const handles = playSpellSound(fake.engine, { type: 'spell', stage, presentation: profile, x: 2, y: 7 });
    assert.equal(handles.length, profile.sounds[stage].length);
    handles.forEach(h => h.stop());
  }
  assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 7));
  assert.deepEqual(fake.invalid, []);
});

test('real Crashing Wave casts render the breaker and emit typed spell cues while preserving damage', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false, 'mana rejection produces no second cast');
  const cast = events.filter(e => e.type === 'spell' && e.stage === 'cast');
  assert.equal(cast.length, 1);
  assert.equal(cast[0].presentation, profile);
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'cast' && e.presentation === profile));
  assert.ok(scene.casting.projectiles.some(p => p.ctx.spell.presentation === profile));
  scene.advance(0.1);
  const points = [];
  scene.casting.effects.paint((...point) => points.push(point), scene.casting.projectiles);
  assert.ok(points.filter(p => p[2] === '~').length >= 10, 'runtime draws the foaming lip');
  assert.ok(points.length <= 4096);
  const before = scene.foe.y;
  scene.advance(0.6);
  assert.equal(scene.foe.health, 82);
  assert.ok(scene.foe.y > before, 'the original knockback still applies');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact' && e.presentation === profile));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)), 'casting never emits sword draw or slam cues');
});
