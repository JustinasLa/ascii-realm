import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/tidal-shield.js';
import spell from '../../src/spells/definitions/tidal-shield.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { runeScene } from '../../test-support/spells.js';
import { readFileSync } from 'node:fs';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

// The radius and life each stage receives from the real Tidal Shield cast.
const SETUP = { cast: [0.8, profile.duration], impact: [1, 0.6], pulse: [2, 0.4], aura: [1, 0.6],
  zone: [2, 2], projectile: [0.65, 1] };
const BUDGET = { cast: 200, impact: 160, pulse: 90, aura: 110, zone: 160, projectile: 110 };

function points(stage, progress = 0.3, { radius = SETUP[stage][0], life = SETUP[stage][1], heading = 0 } = {}) {
  const result = [];
  const effect = Object.freeze({ stage, age: progress * life, life, progress, radius, heading });
  profile.draw(effect, (...point) => result.push(point));
  return result;
}
const lit = list => list.filter(p => p[4] > 0.05);
const top = list => Math.min(...lit(list).map(p => p[1])); // most negative z is highest on screen
const RIM = new Set(['(', ')', '/', '\\', '~', '-']); // shell strokes, not droplets or spray
const rimTop = list => top(list.filter(p => RIM.has(p[2])));

test('the tide climbs both walls of a tall dome, seals at the crown, holds, then recedes', () => {
  assert.equal(spell.presentation, profile);
  assert.ok(top(points('cast', 0.02)) > -1.5, 'the cast opens as a swell at the feet');

  const rising = lit(points('cast', 0.2));
  const heads = rising.filter(p => p[2] === 'o');
  assert.ok(heads.some(p => p[0] < -0.3) && heads.some(p => p[0] > 0.3), 'a foam crest climbs each wall');
  assert.ok(!rising.some(p => RIM.has(p[2]) && Math.abs(p[0]) < 0.3 && p[1] < -3.6), 'the crown is still open');

  const seal = lit(points('cast', 0.36));
  assert.ok(seal.some(p => p[2] === '*' && p[4] > 0.8 && p[1] < -3.8 && Math.abs(p[0]) < 0.05), 'a white flash seals the crown');

  const held = lit(points('cast', 0.5));
  assert.ok(held.some(p => p[2] === '(' && p[0] < -0.8) && held.some(p => p[2] === ')' && p[0] > 0.8), 'both bowed walls stand');
  assert.ok(top(held) < -3.8, 'the dome rises well above the caster');
  assert.ok(held.filter(p => p[1] < -3.8).every(p => Math.abs(p[0]) < 0.6), 'the crown is rounded, not boxy');
  assert.ok(!held.some(p => Math.abs(p[0]) < 0.2 && p[1] > -3.5 && p[1] < -1.2), 'the caster stays readable inside');
  assert.ok(held.length >= 90, 'the held shell is a dense, continuous outline');

  const receding = lit(points('cast', 0.75));
  assert.ok(rimTop(receding) > rimTop(held) + 1, 'the water falls back from the crown');
  assert.ok(receding.some(p => p[2] === ':' || p[2] === '|'), 'droplets fall from the receding shell');
  assert.ok(Math.max(...lit(points('cast', 0.95)).map(p => Math.abs(p[0]))) > 1.15, 'a final ripple spreads past the shell');
});

test('the waterline climbs smoothly frame to frame', () => {
  const frame = 1 / 60 / profile.duration;
  let last = Infinity;
  for (let p = 0.06; p <= 0.34; p += frame) {
    const rim = lit(points('cast', p)).filter(q => RIM.has(q[2]));
    const height = Math.min(...rim.map(q => q[1]));
    if (last !== Infinity) {
      assert.ok(height <= last + 1e-9, 'the waterline never drops back while rising');
      assert.ok(last - height < 0.35, 'no visible jump between frames');
    }
    last = height;
  }
});

test('the dome stays upright on screen whichever way the caster faces', () => {
  const cells = heading => {
    const out = [];
    paintPresentation(profile, { x: 0, y: 0, stage: 'cast', age: 0.5 * profile.duration, life: profile.duration,
      radius: 0.8, heading }, (x, y, ch) => out.push(`${x.toFixed(3)},${y.toFixed(3)},${ch}`));
    return out;
  };
  assert.deepEqual(cells(1.3), cells(0));
  assert.deepEqual(cells(-2.4), cells(0));
});

test('the burst surf ring, impact splash, and body-wrapping aura each have their own choreography', () => {
  const crestReach = progress => {
    const crests = lit(points('pulse', progress)).filter(p => p[2] === '^');
    assert.ok(crests.length >= 4, 'raised crests ride the ring');
    return crests.reduce((sum, p) => sum + Math.hypot(p[0], p[1]), 0) / crests.length;
  };
  assert.ok(crestReach(0.1) < 1.2 && crestReach(0.8) > 1.6, 'the surf ring rolls out to the burst radius');
  const ring = lit(points('pulse', 0.5));
  assert.ok(ring.some(p => p[2] === '(') && ring.some(p => p[2] === ')'), 'the ring bows on its steep sides');

  const slam = lit(points('impact', 0.05));
  assert.ok(slam.some(p => p[2] === 'O' && p[0] === 0 && p[1] === 0 && p[4] > 0.7), 'contact flashes at the foe');
  const crown = lit(points('impact', 0.4));
  assert.ok(crown.filter(p => p[1] < -0.5).length >= 10, 'a crown of droplets is thrown upward');
  assert.ok(!crown.some(p => p[2] === 'O'), 'the flash has passed');
  const ripples = lit(points('impact', 0.85)).filter(p => p[2] === '(' || p[2] === ')');
  assert.ok(ripples.some(p => Math.abs(p[0]) > 1), 'ground ripples spread away from the contact');

  assert.ok(top(points('aura', 0.6)) < top(points('aura', 0.15)) - 1, 'the water ribbons climb the body');
  const wrap = lit(points('aura', 0.4));
  assert.ok(wrap.some(p => p[4] > 0.6) && wrap.some(p => p[4] < 0.35), 'the near side of the helix is bright, the far side dim');

  const projectile = lit(points('projectile', 0.4));
  assert.ok(projectile.some(p => p[2] === '(') && projectile.some(p => p[2] === ')') && projectile.some(p => p[2] === 'O'));
  assert.ok(projectile.filter(p => p[1] < -0.4).length >= 12, 'a forked liquid wake follows the orb');
});

test('all stages are deterministic, bounded, printable, and fade completely', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.2, 0.36, 0.5, 0.75, 0.95, 1]) {
      const drawn = points(stage, progress);
      assert.ok(drawn.length > 10 && drawn.length <= BUDGET[stage], `${stage} at ${progress} drew ${drawn.length}`);
      assert.deepEqual(drawn, points(stage, progress), 'drawing has no random state');
      for (const [x, z, char, color, brightness] of drawn) {
        assert.ok(Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < 8 && Math.abs(z) < 8);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.length === 3 && color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(brightness) && brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0);
      }
    }
  }
  for (const radius of [0.2, 3, 40]) {
    for (const stage of ['cast', 'pulse', 'zone']) {
      assert.ok(points(stage, 0.5, { radius }).length <= BUDGET[stage], 'budgets hold at any radius');
    }
  }
});

test('water audio uses recorded displacement, physical splash, and quiet droplets', async () => {
  const { cast, impact, pulse } = profile.sounds;
  assert.ok(cast[0].url.endsWith('/water-lift.wav'));
  assert.ok(cast[1].url.endsWith('/wash.wav') && cast[1].delay > cast[0].delay);
  assert.ok(impact[0].url.endsWith('/water-strike.wav'));
  assert.ok(pulse.every(v => v.url.endsWith('/droplets.wav') && v.gain <= 0.15), 'repeated droplets remain quiet');
  for (const [stage, voices] of Object.entries(profile.sounds)) {
    const fake = fakeRecordedAudio();
    await prepareRecordedSpellTest(fake, profile);
    const handles = playSpellSound(fake.engine, { stage, x: 2, y: 3, presentation: profile });
    assert.equal(handles.length, voices.length, 'each recording reaches the positional audio bus');
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 3));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(handle => handle.stop());
    assert.ok(voices.length >= 1 && voices.length <= 3);
    assert.ok(voices.reduce((sum, v) => sum + v.gain, 0) <= 1.2);
    for (const voice of voices) {
      assert.equal(voice.kind, 'recording');
      assert.ok(Object.keys(voice).every(key => ['kind', 'url', 'gain', 'rate', 'delay'].includes(key)));
      assert.ok(voice.gain >= 0.1 && voice.gain <= 0.8);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.match(voice.url, /^\/assets\/audio\/spells\/mitlan\/[a-z-]+\.wav$/);
      const wav = readFileSync(new URL(`../../${voice.url.slice(1)}`, import.meta.url));
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
      assert.ok(wav.length > 1000, 'recorded material contains audio data');
    }
  }
});

test('real Tidal Shield cast renders the profile and emits typed cues while preserving shield and burst', () => {
  const scene = runeScene(spell, { range: 2 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false, 'a rejected repeat stays silent');
  const drawn = [];
  scene.casting.effects.paint((...point) => drawn.push(point), scene.casting.projectiles);
  assert.ok(drawn.some(p => p[2] === '(') && drawn.some(p => p[2] === '~'), 'runtime renders the swell of the shell');
  assert.ok(drawn.some(p => p[2] === 'O'), 'runtime renders the splash on the struck foe');
  scene.advance(0.5);
  assert.equal(scene.casting.state().shield, 7);
  assert.equal(scene.foe.health, 94);
  assert.equal(events.filter(e => e.type === 'spell' && e.stage === 'cast').length, 1);
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => e.presentation === profile && !['draw', 'slam'].includes(e.type)));
});
