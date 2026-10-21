import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/cerrith-glyph.js';
import spell from '../../src/spells/definitions/cerrith-glyph.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function capture(stage, progress = 0.4, age = progress * presentation.duration, radius = 1, life = presentation.duration, heading = 0) {
  const points = [];
  const effect = Object.freeze({ stage, progress, age, life, radius, heading });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push([x, z, char, [...color], brightness]));
  return points;
}
const lit = points => points.filter(p => p[4] > 0.05);
const tips = points => lit(points).filter(p => '^v<>'.includes(p[2]));
const motes = points => points.filter(p => ".':*o".includes(p[2]));
const meanRadius = points => points.reduce((sum, [x, z]) => sum + Math.hypot(x, z), 0) / points.length;
// The ground glyph as gameplay presents it: a radius-4 totem, by default the eight-second one.
const zone = (age, life = 8, heading = 0) => capture('zone', age / life, age, 4, life, heading);

test('Cerrith Glyph casts by gathering pollen, writing a four-leaf knot and shedding petals', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const gather = lit(capture('cast', 0.1, 0.115, 0.8)), closer = lit(capture('cast', 0.25, 0.29, 0.8));
  assert.equal(tips(gather).length, 0, 'anticipation draws no leaves yet');
  assert.ok(gather.length >= 8 && motes(gather).length === gather.length, 'only pollen motes gather at first');
  assert.ok(meanRadius(closer) < meanRadius(gather) * 0.75, 'pollen spirals inward toward the caster');

  const writing = lit(capture('cast', 0.38, 0.44, 0.8)), written = lit(capture('cast', 0.74, 0.85, 0.8));
  assert.ok(writing.length < written.length, 'leaves are traced stroke by stroke');
  assert.deepEqual(new Set(tips(written).map(p => p[2])), new Set(['^', 'v', '<', '>']), 'four leaves point to the four quarters');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    assert.ok(written.some(([x, z, char]) => char === '+' && x * sx > 0.3 && z * sz > 0.3), 'squared roots curl in all four corners');
  }
  assert.ok(written.filter(([x, z]) => Math.abs(Math.hypot(x, z) - 1.2) < 0.08).length >= 20, 'a rune ring binds the knot');

  const bind = capture('cast', 0.74, 0.85, 0.8);
  assert.ok(bind.some(([, , , [r, g, b], light]) => light > 0.6 && r > 200 && g > 240 && b > 180), 'the binding pulse flashes pale');
  const shed = capture('cast', 0.95, 1.09, 0.8);
  assert.ok(shed.filter(p => ",'`.".includes(p[2]) && Math.hypot(p[0], p[1]) > 1.35).length >= 8, 'petals drift out past the ring');
  assert.ok(lit(shed).length < written.length && Math.max(...shed.map(p => p[4])) < 0.6, 'the glyph thins away');
  assert.deepEqual(capture('cast', 0.74, 0.85, 0.8), capture('cast', 0.74, 0.85, 0.8), 'geometry is deterministic');
});

test('the seed spins in flight with a pollen wake and twisting vine strands', () => {
  const a = capture('projectile', 0.03, 0.3, 0.65, 10), b = capture('projectile', 0.032, 0.32, 0.65, 10);
  assert.equal(a.filter(p => p[2] === 'o').length, 1, 'one bright seed core');
  assert.notDeepEqual(tips(a).map(p => p.slice(0, 2)), tips(capture('projectile', 0.035, 0.35, 0.65, 10)).map(p => p.slice(0, 2)),
    'the clover leaves spin');
  const wake = a.filter(([, z]) => z < -0.5);
  assert.ok(wake.length >= 15 && wake.some(([, z]) => z < -1.5), 'a long wake trails behind the flight');
  const near = wake.filter(([, z]) => z > -1).map(p => p[4]), far = wake.filter(([, z]) => z < -1.4).map(p => p[4]);
  assert.ok(Math.max(...far) < Math.max(...near), 'the wake fades with distance');
  assert.equal(a.length, b.length);
  const moved = a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]));
  assert.ok(Math.max(...moved) < 0.15, 'motion is continuous between frames');
});

test('the standing glyph writes itself, beats with a heartbeat and unravels after a converging summon breath', () => {
  const summon = lit(zone(0.3, 1)), summonLate = lit(zone(0.7, 1));
  assert.equal(tips(summon).length, 0, 'the one-second summon totem only traces the ring and gathers pollen');
  assert.ok(meanRadius(motes(summonLate)) < meanRadius(motes(summon)), 'summoning pollen converges on the ring');

  const opening = lit(zone(0.25)), standing = lit(zone(3));
  assert.ok(opening.length < standing.length * 0.6, 'the glyph is written in over its first second');
  assert.deepEqual(new Set(tips(standing).map(p => p[2])), new Set(['^', 'v', '<', '>']));
  assert.ok(standing.length >= 120, 'the shielding glyph is a dense, readable silhouette');
  const core = age => zone(age).find(([x, z, char]) => x === 0 && z === 0 && char === '*')[4];
  const beats = [2, 2.3, 2.6, 2.9, 3.2, 3.5].map(core);
  assert.ok(Math.max(...beats) - Math.min(...beats) > 0.1, 'a heartbeat pulses out of the knot');
  assert.notDeepEqual(zone(3).filter(p => p[2] === 'o').map(p => p.slice(0, 2)),
    zone(3.4).filter(p => p[2] === 'o').map(p => p.slice(0, 2)), 'ring beads and pollen keep moving');
  const forward = (points, x0, z0) => points.find(([x, z]) => Math.abs(x - x0) < 0.2 && Math.abs(z - z0) < 0.2)?.[2];
  assert.equal(forward(tips(zone(3)), 0, 1.32), 'v', 'the forward leaf points down the screen at heading 0');
  assert.equal(forward(tips(zone(3, 8, Math.PI / 2)), 0, 1.32), '>', 'leaf glyphs follow the world heading');
  assert.ok(Math.max(...zone(7.8).map(p => p[4])) < 0.35, 'the glyph unravels before it expires');
});

test('impact snaps open with a flash; pulses ripple outward; shield auras spiral leaves upward', () => {
  const flash = capture('impact', 0.04), later = capture('impact', 0.5);
  assert.ok(flash.some(([, , , [r, g, b], light]) => light > 0.6 && r > 225 && g > 245 && b > 210), 'impact flashes white');
  assert.ok(later.some(p => ",'`.".includes(p[2]) && Math.hypot(p[0], p[1]) > 2), 'torn petals arc away');
  const pulse = progress => lit(capture('pulse', progress, progress * 0.25, 3, 0.25));
  assert.ok(meanRadius(pulse(0.6)) > meanRadius(pulse(0.1)) * 1.5, 'the seed-bloom ripple opens outward');
  // Height is drawn along local -z at heading 0; the first eighteen glyphs are the leaves and their trails.
  const height = progress => -capture('aura', progress, progress * 0.6, 1, 0.6).slice(0, 18)
    .reduce((sum, p) => sum + p[1], 0) / 18;
  assert.ok(height(0.7) > height(0.1) + 0.4, 'shield leaves rise up the ally');
});

test('every Cerrith stage stays finite, within its draw budget, and fades to zero', () => {
  const budget = { cast: 250, impact: 250, projectile: 110, pulse: 64, aura: 40, zone: 190 };
  for (const stage of Object.keys(budget)) {
    for (const radius of [0.1, 0.8, 4, 40]) for (const life of [0.25, 1, 8]) for (const progress of [0, 0.25, 0.65, 0.98, 1]) {
      for (const heading of [0, 2.2]) {
        const points = capture(stage, progress, progress * life, radius, life, heading);
        assert.ok(points.length > 0 && points.length <= budget[stage], `${stage} is authored within budget (${points.length})`);
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
  }
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
  assert.equal(scene.castWithoutMana().ok, false, 'mana rejection stays silent');
  const cast = events.filter(e => e.stage === 'cast');
  assert.equal(cast.length, 1);
  assert.equal(scene.casting.mana, 92);
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'cast' && e.presentation === presentation));
  const points = [];
  scene.casting.effects.paint((...p) => points.push(p), scene.casting.projectiles);
  assert.ok(points.some(p => p[2] === 'o'), 'runtime paints the spinning seed core');
  assert.ok(points.some(p => ".':*".includes(p[2])), 'runtime paints the gathering pollen');
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
