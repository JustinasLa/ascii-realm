import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/healing-orb.js';
import spell from '../../src/spells/definitions/healing-orb.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

function points(stage, progress, heading = 0, radius = 3, life = profile.duration) {
  const result = [];
  const effect = Object.freeze({ stage, progress, age: progress * life, life, radius, heading });
  profile.draw(effect, (...point) => result.push(point));
  return result;
}

const lit = (drawn, min = 0.05) => drawn.filter(p => p[4] > min);
const dist = p => Math.hypot(p[0], p[1]);
const span = drawn => Math.max(...lit(drawn).map(dist));
const energy = drawn => drawn.reduce((sum, p) => sum + p[4], 0);
const budgets = { cast: 200, projectile: 110, impact: 240, pulse: 90, aura: 110, zone: 110 };

test('Healing Orb opts into a bounded, deterministic profile that fades in every stage', () => {
  assert.equal(spell.presentation, profile);
  for (const stage of Object.keys(budgets)) {
    for (const radius of [1, 3]) {
      for (const p of [0, 0.05, 0.25, 0.4, 0.7, 0.9, 1]) {
        const drawn = points(stage, p, 0, radius);
        assert.ok(drawn.length <= budgets[stage], `${stage} stays within its point budget`);
        if (p > 0 && p < 0.9) assert.ok(lit(drawn).length > 20, `${stage} is visible at ${p}`);
        for (const [x, z, char, color, brightness] of drawn) {
          assert.ok([x, z, brightness, ...color].every(Number.isFinite));
          assert.ok(Math.abs(x) <= 4 && Math.abs(z) <= 4);
          assert.match(char, /^[\x21-\x7e]$/);
          assert.ok(color.every(c => c >= 0 && c <= 255));
          assert.ok(brightness >= 0 && brightness <= 1);
        }
        assert.deepEqual(drawn, points(stage, p, Math.PI / 2, radius), 'the runtime owns heading rotation');
      }
      assert.ok(points(stage, 1, 0, radius).every(p => p[4] === 0), `${stage} fades completely`);
    }
    assert.notDeepEqual(points(stage, 0.1), points(stage, 0.6));
  }
  assert.ok(points('pulse', 0.3, 0, 1).length <= 40, 'trail sprouts repeat every tick, so they stay lean');
});

test('flight is a glowing phyllotaxis orb with orbiting leaves and a braided pollen wake', () => {
  const flight = points('projectile', 0.03, 0, 0.65, 10);
  const core = flight.filter(p => dist(p) < 0.4);
  assert.ok(core.length >= 50, 'the orb is densely filled');
  const bright = core.filter(p => '@#'.includes(p[2]));
  assert.ok(bright.length >= 4 && bright.every(p => dist(p) < 0.3), 'dense glyphs sit at the core');
  const rim = core.filter(p => dist(p) > 0.3);
  assert.ok(rim.every(p => '.:;+*'.includes(p[2])), 'the rim thins to sparse glyphs');
  assert.ok(Math.min(...rim.map(p => p[4])) < Math.max(...bright.map(p => p[4])), 'the core outshines the rim');
  const leaves = flight.filter(p => p[2] === '*' && Math.abs(dist(p) - 0.62) < 0.02);
  assert.equal(leaves.length, 3, 'three leaves orbit the orb');
  const wake = lit(flight.filter(p => p[1] < -0.4));
  assert.ok(wake.some(p => p[0] < -0.05) && wake.some(p => p[0] > 0.05), 'the wake braids on both sides');
  assert.ok(wake.some(p => p[1] < -2.2), 'pollen trails well behind the orb');
  assert.ok(flight.every(p => p[1] < 0.75), 'nothing leads the orb');
  // Positions vary continuously with age: at 60 fps no visible glyph jumps.
  const a = points('projectile', 0.03, 0, 0.65, 10), b = points('projectile', 0.03 + 1 / 600, 0, 0.65, 10);
  assert.equal(a.length, b.length);
  a.forEach((p, i) => { if (p[4] > 0.1 && b[i][4] > 0.1) assert.ok(Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) < 0.3); });
});

test('the cast gathers pollen into a self-drawing sigil, flares white, then thins away', () => {
  const ringPoints = p => lit(points('cast', p)).filter(q => Math.abs(dist(q) - 1.05) < 0.04 || q[2] === 'o');
  assert.ok(ringPoints(0.3).length > ringPoints(0.04).length * 2, 'the sigil circle draws itself around');
  const heads = p => lit(points('cast', p)).filter(q => q[2] === '+' || q[2] === '*').filter(q => dist(q) > 0.3);
  const meanR = drawn => drawn.reduce((s, q) => s + dist(q), 0) / drawn.length;
  assert.ok(meanR(heads(0.3)) < meanR(heads(0.05)), 'pollen spirals inward during the wind-up');
  const nucleus = p => energy(points('cast', p).filter(q => dist(q) < 0.45));
  assert.ok(nucleus(0.36) > nucleus(0.08) * 2, 'the nucleus brightens through the gather');
  const flare = points('cast', 0.39);
  assert.ok(flare.some(q => q[2] === '@' && q[3].every(c => c > 200) && q[4] > 0.75), 'release flares white');
  assert.ok(span(flare) > 1, 'a shock ring leaves the hand');
  assert.ok(energy(points('cast', 0.8)) < energy(points('cast', 0.45)) * 0.6, 'the follow-through dissipates');
  assert.ok(lit(points('cast', 0.8), 0.01).length > 20, 'without popping out');
});

test('the heal flashes, then unfurls five leaves around the cross before the tips dissolve', () => {
  const flash = points('impact', 0.03);
  assert.ok(flash.some(p => p[2] === '@' && p[3].every(c => c > 200)), 'a white landing flash');
  const bloom = points('impact', 0.55);
  const tips = lit(bloom).filter(p => p[2] === 'o');
  assert.equal(tips.length, 5);
  assert.ok(tips.every(p => dist(p) > 1.2));
  const angles = tips.map(p => Math.atan2(p[0], p[1])).sort((a, b) => a - b);
  angles.forEach((a, i) => i && assert.ok(Math.abs(a - angles[i - 1] - Math.PI * 2 / 5) < 0.05, 'leaves are evenly spaced'));
  assert.equal(bloom.filter(p => p[2] === '+' && p[0] === 0 && p[1] === 0).length, 1, 'the healing cross holds the centre');
  const tipSpan = p => span(points('impact', p).filter(q => q[2] === 'o'));
  assert.ok(tipSpan(0.5) > tipSpan(0.05) * 1.8, 'leaves unfurl outward');
  const late = points('impact', 0.85);
  assert.ok(!lit(late).some(p => p[2] === 'o'), 'leaf tips dissolve first');
  assert.ok(energy(late) < energy(bloom) * 0.4);
  assert.notDeepEqual(points('cast', 0.55), bloom);
});

test('pulses are small ground sprouts on the trail and a wide ring on the hit burst', () => {
  const trail = r => span(points('pulse', 0.5, 0, r, 0.25));
  assert.ok(trail(3) > trail(1) * 2, 'pulse geometry follows the visual radius');
  assert.ok(span(points('pulse', 0.6, 0, 1, 0.25)) > span(points('pulse', 0.05, 0, 1, 0.25)) * 1.5, 'the glint ring expands');
  assert.ok(energy(points('pulse', 0.7, 0, 1, 0.25)) < energy(points('pulse', 0.1, 0, 1, 0.25)) * 0.5, 'and fades');
  // The hit burst front is ten crescent arcs, each brightest and densest at its centre.
  const burst = points('pulse', 0.4, 0, 3, 0.25), front = Math.max(...burst.map(dist));
  const crests = burst.filter(p => dist(p) > front * 0.95 && '#@'.includes(p[2]));
  assert.equal(crests.length, 10, 'ten crescent crests lead the ring');
  const rim = burst.filter(p => dist(p) > front * 0.9);
  assert.ok(rim.filter(p => '.:'.includes(p[2])).every(p => p[4] < Math.min(...crests.map(c => c[4]))), 'arc ends thin out');
  // Five sprouts spring out with overshoot and a bright bud tip.
  const buds = p => points('pulse', p, 0, 3, 0.25).filter(q => q[2] === '*' && dist(q) > 0.3 && dist(q) < 1.6);
  assert.ok(buds(0.3).length >= 5, 'five buds spring up');
  assert.ok(points('pulse', 0.05, 0, 3, 0.25).some(p => p[2] === '@' && dist(p) === 0), 'the centre glints first');
});

test('Healing Orb layers real foliage, liquid and cloth with a restrained recorded trail', async () => {
  const { cast, impact, pulse } = profile.sounds;
  const file = v => v.url.split('/').at(-1);
  assert.ok(cast.some(v => file(v) === 'leaf-drift.wav'), 'foliage opens around the seed');
  assert.ok(cast.some(v => file(v) === 'cloth-breath.wav'), 'the release has a physical breath');
  assert.ok(impact.some(v => file(v) === 'water-touch.wav' && v.delay === 0), 'gentle liquid contact marks the heal immediately');
  assert.ok(impact.some(v => file(v) === 'leaf-turn.wav' && v.delay > 0), 'leaves unfold after contact');
  const gain = recipe => recipe.reduce((sum, v) => sum + v.gain, 0);
  assert.ok(gain(pulse) <= 0.3 && gain(pulse) < gain(cast) * 0.2 && gain(pulse) < gain(impact) * 0.2);
  assert.ok(pulse.every(v => file(v) === 'leaf-turn.wav' && v.rate >= 1 && v.delay === 0), 'frequent trail uses a short, immediate leaf brush');
  for (const recipe of [cast, impact, pulse]) {
    assert.ok(recipe.length >= 1 && recipe.length <= 4);
    assert.ok(gain(recipe) <= 1.2);
    for (const v of recipe) {
      assert.equal(v.kind, 'recording');
      assert.match(v.url, /^\/assets\/audio\/spells\/cerrith\/[a-z-]+\.wav$/);
      assert.ok(v.gain >= 0.1 && v.gain <= 0.8 && v.rate >= 0.75 && v.rate <= 1.2 && v.delay >= 0 && v.delay <= 2);
    }
  }
  const fake = fakeRecordedAudio();
  assert.equal(await prepareRecordedSpellTest(fake, profile), true, 'all authored recordings load from real WAV files');
  for (const stage of ['cast', 'impact', 'pulse']) {
    const handles = playSpellSound(fake.engine, { stage, presentation: profile, x: 4, y: 8 });
    assert.equal(handles.length, profile.sounds[stage].length);
    const sources = fake.nodes.filter(v => v.kind === 'source').slice(-handles.length);
    sources.forEach((source, i) => {
      const layer = profile.sounds[stage][i];
      assert.equal(source.buffer.id, file(layer));
      assert.equal(source.starts[0], fake.context.currentTime + layer.delay);
      assert.ok(source.buffer.duration > 0 && source.buffer.duration <= 2);
      assert.equal(source.playbackRate.calls[0].args[0], layer.rate);
    });
    handles.forEach(handle => handle.stop());
  }
  assert.ok(!fake.nodes.some(v => v.kind === 'oscillator'));
  assert.deepEqual(fake.allocations, [], 'no synthesized noise buffers');
  assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 4 && r.y === 8 && r.disposals === 1));
  assert.deepEqual(fake.invalid, []);
});

test('real Healing Orb casts render the profile and emit typed heal cues without sword sounds', () => {
  const scene = runeScene(spell, { range: 12, allyInPath: true }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false, 'mana rejection stays silent');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  assert.equal(scene.casting.projectiles.length, 1);
  const flight = [];
  scene.casting.effects.paint((...p) => flight.push(p), scene.casting.projectiles);
  assert.ok(flight.some(p => p[2] === '@'), 'runtime renders the orb core');
  assert.ok(flight.some(p => p[2] === 'o'), 'runtime renders the cast sigil nodes');
  scene.advance(0.15);
  assert.equal(scene.ally.vitals.health, 32);
  assert.equal(scene.player.vitals.health, 60);
  assert.equal(scene.foe.health, 100);
  assert.ok(events.some(e => e.stage === 'impact'));
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id && e.presentation === profile));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  const landing = [];
  scene.casting.effects.paint((...p) => landing.push(p), scene.casting.projectiles);
  assert.ok(landing.some(p => p[2] === '+'), 'runtime renders the healing petal centre');
  assert.ok(landing.some(p => p[2] === '@'), 'runtime renders the landing flash');
});
