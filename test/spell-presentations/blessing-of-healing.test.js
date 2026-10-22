import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/blessing-of-healing.js';
import spell from '../../src/spells/definitions/blessing-of-healing.js';
import { runeScene } from '../../test-support/spells.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

const TAU = Math.PI * 2;
// Lives the channel actually uses: 1.35 s cast, 1.5 s aura (0.3 s slow-potion beats),
// 0.6 s heal impact, 0.25 s bolt-tick pulses and a long-lived projectile.
const LIVES = { cast: presentation.duration, aura: 1.5, zone: 1.5, impact: 0.6, pulse: 0.25, projectile: 10 };
const BUDGET = { cast: 236, impact: 200, aura: 140, zone: 140, pulse: 90, projectile: 100 };
const draw = (stage, progress = 0.3, { heading = 0, life = LIVES[stage], radius = 1 } = {}) => {
  const points = [];
  presentation.draw({ stage, progress, age: progress * life, life, radius, heading },
    (...point) => points.push(point));
  return points;
};
const lit = points => points.filter(p => p[4] > 0.05);
const dist = p => Math.hypot(p[0], p[1]);
const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

test('cast gathers inward motes, flashes, then opens and sheds a six-petal rosette', () => {
  assert.equal(spell.presentation, presentation);
  const gathering = lit(draw('cast', 0.04)), converging = lit(draw('cast', 0.2));
  assert.ok(gathering.length >= 10 && mean(gathering.map(dist)) > 1.3, 'wind-up starts as motes far from the caster');
  assert.ok(mean(converging.filter(p => p[2] !== ':').map(dist)) < mean(gathering.map(dist)), 'motes spiral inward');
  assert.ok(gathering.every(p => p[2] !== '@'), 'no flash before the wind-up completes');
  const release = draw('cast', 0.3);
  assert.ok(release.some(p => p[2] === '@' && dist(p) < 0.01 && p[4] > 0.6), 'white-gold flash at the release');
  const bloom = lit(draw('cast', 0.55));
  const tips = bloom.filter(p => dist(p) > 0.85 && dist(p) < 1.3 && p[2] === '*');
  const sectors = new Set(tips.map(p => Math.round(((Math.atan2(p[1], p[0]) - 0.55 * presentation.duration * 0.35 + TAU * 2) % TAU) / (Math.PI / 3)) % 6));
  assert.equal(sectors.size, 6, 'six bright petal tips around the caster');
  assert.ok(bloom.filter(p => p[2] === '+' && dist(p) < 0.9).length >= 12, 'petal midribs and inner rosette');
  const shed = lit(draw('cast', 0.85)).filter(p => p[2] === '\'' || p[2] === ',');
  assert.ok(shed.length >= 8 && shed.every(p => dist(p) > 0.9), 'petals shed outward in the follow-through');
  assert.ok(lit(draw('cast', 0.95)).length < bloom.length, 'the rosette dissolves rather than popping');
});

test('aura garland swells with each beat and works for both the long and the 0.3 s beat', () => {
  const reach = progress => Math.max(...lit(draw('aura', progress)).map(dist));
  assert.ok(reach(0.8) > reach(0.2) + 0.08, 'the halo ring swells outward');
  assert.equal(draw('aura', 0.5).filter(p => p[2] === '*').length, 6, 'six budding leaves ride the halo');
  assert.ok(lit(draw('aura', 0.5, { life: 0.3 })).length >= 60, 'the short slow-potion beat is still a full garland');
  assert.ok(draw('aura', 0.02).every(p => p[4] < 0.2), 'the garland eases in');
});

test('healing bolt is a crowned seed of light trailing a fading twisted vine', () => {
  const bolt = draw('projectile', 0.02);
  const head = bolt.find(p => p[2] === '@');
  assert.ok(head && head[4] === 1 && bolt.every(p => p[1] <= head[1] + 0.2), 'bright seed leads the travel direction');
  assert.ok(bolt.filter(p => dist(p) > 0.15 && dist(p) < 0.2).length >= 6, 'petal crown circles the seed');
  const tail = bolt.filter(p => p[1] < -0.1);
  assert.ok(Math.min(...tail.map(p => p[1])) < -2 && tail.some(p => p[0] < -0.05) && tail.some(p => p[0] > 0.05),
    'twin strands trail behind');
  const near = tail.filter(p => p[1] > -1), far = tail.filter(p => p[1] < -1.6);
  assert.ok(mean(near.map(p => p[4])) > mean(far.map(p => p[4])) * 1.5, 'the vine fades towards its end');
  assert.notDeepEqual(bolt, draw('projectile', 0.0217), 'the vine twists while flying');
});

test('impact flashes white, races a leafy ring outward and draws healing motes in', () => {
  const first = draw('impact', 0);
  assert.ok(first.some(p => p[2] === '@' && dist(p) < 0.01 && p[4] === 1), 'strong white impact frame');
  assert.ok(first.filter(p => p[2] === '*' || p[2] === '+').length >= 8, 'starburst rays');
  const reach = progress => Math.max(...draw('impact', progress).filter(p => p[2] === 'o' && p[4] > 0.05).map(dist));
  assert.ok(reach(0.4) > reach(0.1) + 0.3, 'the ring travels outward');
  const motes = progress => lit(draw('impact', progress)).filter(p => p[2] === '+' && dist(p) > 0.75);
  assert.ok(motes(0.35).filter(p => dist(p) > 1.2).length >= 4, 'healing motes arrive from outside the ring');
  assert.ok(mean(motes(0.75).map(dist)) < mean(motes(0.35).map(dist)), 'healing motes spiral into the ally');
  assert.ok(lit(draw('impact', 0.9)).length < lit(draw('impact', 0.3)).length, 'impact dissipates gracefully');
});

test('channel pulse lights the bolt path as a braided ribbon; the wide heal burst is a ring', () => {
  const braid = lit(draw('pulse', 0.3));
  assert.ok(Math.min(...braid.map(p => p[1])) < -5 && Math.max(...braid.map(p => p[1])) <= 0.35,
    'ribbon spans the ~5 m between bolt ticks');
  assert.ok(braid.filter(p => p[0] < -0.15).length >= 15 && braid.filter(p => p[0] > 0.15).length >= 15,
    'two strands twist around the path');
  assert.ok(braid.some(p => p[2] === '*') && braid.some(p => p[2] === '.' || p[2] === ':'), 'near strand bright, far strand dim');
  assert.ok(braid.every(p => Math.abs(p[0]) < 1), 'path ribbon stays narrow');
  assert.ok(lit(draw('pulse', 0.85)).length < braid.length, 'the ribbon frays as it fades');
  const burst = lit(draw('pulse', 0.5, { radius: 3 }));
  assert.ok(burst.length >= 40 && mean(burst.map(dist)) > 1.8, 'the radius-3 heal burst is a wide ring');
});

test('all stages remain finite, bounded, deterministic, animated and fade completely', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const radius of stage === 'pulse' ? [1, 3] : [1]) {
      for (const progress of [0, 0.02, 0.15, 0.3, 0.5, 0.75, 0.9, 1]) {
        const points = draw(stage, progress, { radius });
        assert.ok(points.length > 0 && points.length <= BUDGET[stage], `${stage} at ${progress}: ${points.length}`);
        assert.deepEqual(points, draw(stage, progress, { radius, heading: Math.PI / 2 }), 'heading belongs to the shared adapter');
        assert.deepEqual(points, draw(stage, progress, { radius }), 'pure function of the effect state');
        for (const [x, z, char, color, brightness] of points) {
          assert.ok(Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < 6.5 && Math.abs(z) < 6.5);
          assert.match(char, /^[\x20-\x7e]$/);
          assert.ok(color.length === 3 && color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
          assert.ok(Number.isFinite(brightness) && brightness >= 0 && brightness <= 1);
          if (progress === 1) assert.equal(brightness, 0);
        }
      }
    }
    assert.notDeepEqual(draw(stage, 0.1), draw(stage, 0.8));
  }
});

test('glyphs move continuously between 60 fps frames', () => {
  for (const stage of ['cast', 'aura', 'impact', 'pulse']) {
    const life = LIVES[stage];
    for (let progress = 0.05; progress < 0.95; progress += 0.1) {
      const a = draw(stage, progress), b = draw(stage, progress + 1 / 60 / life).filter(p => p[4] > 0.2);
      // Every glyph in the next frame continues from something nearby in this one (no pops).
      let jump = 0;
      for (const q of b) jump = Math.max(jump, Math.min(...a.map(p => Math.hypot(p[0] - q[0], p[1] - q[1]))));
      assert.ok(jump < 0.35, `${stage} at ${progress.toFixed(2)} jumps ${jump.toFixed(2)} m in one frame`);
    }
  }
});

test('gathering motes fade out instead of vanishing when the wind-up hands over to the bloom', () => {
  // A bright glyph must still have a comparably bright glyph close by in the next frame.
  const vanished = (from, to, reach) => {
    const next = draw('cast', to);
    return draw('cast', from).filter(q => q[4] > 0.15
      && !next.some(r => Math.hypot(r[0] - q[0], r[1] - q[1]) < reach && r[4] > q[4] * 0.5));
  };
  assert.deepEqual(vanished(0.2999, 0.3001, 0.05), [], 'no motes drop out across the 0.3 release cutoff');
  const step = 1 / 60 / LIVES.cast;
  for (let progress = 0.2; progress < 0.45; progress += step) {
    assert.deepEqual(vanished(progress, progress + step, 0.3), [], `bright glyphs vanish at ${progress.toFixed(3)}`);
  }
});

test('gentle water and cloth recordings sustain a quiet channel with leaf responses', async () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.url.endsWith('/water-flow.wav') && v.rate < 1));
  assert.ok(cast.some(v => v.url.endsWith('/cloth-breath.wav') && v.delay < 0.1));
  assert.ok(cast.some(v => v.url.endsWith('/leaf-drift.wav') && v.delay >= 0.3), 'leaves follow the opening breath');
  assert.ok(impact.some(v => v.url.endsWith('/water-touch.wav')) && impact.some(v => v.url.endsWith('/leaf-turn.wav')));
  assert.ok(impact.reduce((sum, v) => sum + v.gain, 0) <= 0.3, 'channel healing responses stay restrained');
  assert.equal(pulse.length, 1, 'rapid traces use one soft recording');
  assert.ok(pulse[0].gain <= 0.15 && pulse[0].delay === 0);
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length >= 1 && voices.length <= 4);
    assert.ok(voices.reduce((sum, v) => sum + v.gain, 0) <= 1.2);
    for (const voice of voices) {
      assert.equal(voice.kind, 'recording', 'all layers use natural foley');
      assert.match(voice.url, /^\/assets\/audio\/spells\/cerrith\/[a-z-]+\.wav$/);
      assert.ok(voice.gain >= 0.1 && voice.gain <= 0.8 && voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
    }
  }
  for (const [stage, voices] of Object.entries(presentation.sounds)) {
    const fake = fakeRecordedAudio();
    assert.equal(await prepareRecordedSpellTest(fake, presentation), true, 'real WAV assets load');
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 3, y: 4 });
    assert.equal(handles.length, voices.length);
    const sources = fake.nodes.filter(node => node.kind === 'source');
    assert.equal(sources.length, voices.length);
    assert.ok(!fake.nodes.some(node => node.kind === 'oscillator'), 'no synthesized voices');
    sources.forEach((source, index) => {
      const voice = voices[index];
      assert.equal(source.buffer.id, voice.url.split('/').at(-1));
      assert.equal(source.starts[0], fake.context.currentTime + voice.delay);
      assert.equal(source.playbackRate.calls[0].args[0], voice.rate);
      const duration = source.buffer.duration / voice.rate;
      if (stage === 'pulse') assert.ok(duration <= 0.5, 'short leaf movement limits overlapping traces');
      if (stage === 'impact') assert.ok(duration + voice.delay < 0.75, 'healing response clears quickly');
      assert.ok(Math.abs(source.stops[0] - source.starts[0] - duration - 0.01) < 1e-8);
    });
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 3 && r.y === 4));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(h => h.stop());
    assert.ok(fake.routes.every(r => r.disposals === 1), 'every layer releases its spatial route');
  }
});

test('real channel cast renders its profile and emits typed healing cues without sword sounds', () => {
  const scene = runeScene(spell, { range: 15, allyInPath: true }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'cast' && e.presentation === presentation));
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'cast' && e.presentation === presentation));
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'aura' && e.presentation === presentation));
  scene.advance(0.15);
  const dots = [];
  scene.casting.effects.paint((...p) => dots.push(p), scene.casting.projectiles);
  assert.ok(dots.filter(p => p[4] > 0.05).length >= 40, 'gathering motes and the halo garland paint at the real cast');
  scene.advance(2.05);
  assert.ok(scene.ally.vitals.health >= 44, 'original healing continues');
  assert.ok(scene.casting.mana < 87, 'original channel mana drain continues');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  assert.ok(events.filter(e => e.type === 'spell').every(e => e.presentation === presentation));
});
