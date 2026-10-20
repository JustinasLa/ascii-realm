import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/mana-transfer.js';
import spell from '../../src/spells/definitions/mana-transfer.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

const STAGES = ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile'];
const BUDGET = { cast: 200, impact: 200, pulse: 90, aura: 160, zone: 160, projectile: 110 };

function draw(stage, progress = 0.2, { heading = 0, radius = 1 } = {}) {
  const points = [];
  const effect = Object.freeze({ stage, age: progress * profile.duration, life: profile.duration,
    progress, radius, heading });
  profile.draw(effect, (...point) => points.push(point));
  return points;
}
const lit = points => points.filter(p => (p[4] ?? 1) > 0.05);
const light = points => points.reduce((sum, p) => sum + (p[4] ?? 1), 0);
const isBlue = c => c[2] > c[1] + 20;
const isGreen = c => c[1] > c[2] + 20;
const meanRadius = points => points.reduce((s, p) => s + Math.hypot(p[0], p[1]), 0) / points.length;

test('cast: mana is inhaled, braided forward between two gates and delivered into the receiver', () => {
  assert.equal(spell.presentation, profile);
  assert.equal(profile.id, spell.id);
  // Wind-up: loose motes converge on the source core before anything launches.
  const motes = p => lit(draw('cast', p)).filter(q => ['.', ':', '+', '*'].includes(q[2]) && Math.hypot(q[0], q[1]) < 1.1);
  assert.ok(meanRadius(motes(0.2)) < meanRadius(motes(0.06)), 'motes spiral inwards during the wind-up');
  assert.ok(lit(draw('cast', 0.06)).every(q => q[1] < 1.2), 'nothing reaches the receiver before launch');
  // Source gate brackets open around the caster.
  const early = lit(draw('cast', 0.2));
  assert.ok(early.some(q => q[2] === '[' && q[0] < 0 && Math.abs(q[1]) < 0.3));
  assert.ok(early.some(q => q[2] === ']' && q[0] > 0 && Math.abs(q[1]) < 0.3));
  // The braid head advances with easing, carrying blue and green packets on two strands.
  const reach = p => Math.max(...lit(draw('cast', p)).map(q => q[1]));
  assert.ok(reach(0.3) < reach(0.4) && reach(0.4) < reach(0.55), 'braid shoots forward');
  const mid = lit(draw('cast', 0.6));
  const packets = mid.filter(q => q[2] === 'o' && q[1] > 0.2 && q[1] < 1.5);
  assert.ok(packets.some(q => isBlue(q[3])) && packets.some(q => isGreen(q[3])), 'blue and green packets');
  const strand = side => mid.some(q => side * q[0] > 0.03 && q[1] > 0.3 && q[1] < 1.4);
  assert.ok(strand(-1) && strand(1), 'two strands twist around the axis');
  assert.ok(mid.some(q => q[2] === '[' && q[1] > 1.4) && mid.some(q => q[2] === ']' && q[1] > 1.4), 'receiving gate opens');
  const packetsAt = p => draw('cast', p).filter(q => q[2] === 'o').map(q => q.slice(0, 2));
  assert.notDeepEqual(packetsAt(0.6), packetsAt(0.62), 'packets travel');
  // Delivery: the receiver core fills to '@' and the braid is reeled in from the tail.
  const late = lit(draw('cast', 0.86));
  assert.ok(late.some(q => q[2] === '@' && Math.abs(q[1] - 1.7) < 0.01), 'receiver fills');
  const strandZ = late.filter(q => (q[2] === 'o' || q[2] === ':') && Math.hypot(q[0], q[1]) > 0.3).map(q => q[1]);
  assert.ok(Math.min(...strandZ) > 0.5, 'braid reeled in from the tail');
  const receiverWidth = p => Math.max(...lit(draw('cast', p)).filter(q => q[2] === ']' && q[1] > 1.4).map(q => q[0]));
  assert.ok(receiverWidth(0.9) < receiverWidth(0.68), 'receiving gate cinches shut');
});

test('impact: brackets snap shut, the core flashes white, then a ring and dragging sparks bloom outward', () => {
  const width = p => Math.max(...draw('impact', p).filter(q => q[2] === '[').map(q => Math.abs(q[0])));
  assert.ok(width(0.4) < width(0.02), 'receiver brackets close');
  const core = p => draw('impact', p).find(q => q[0] === 0 && q[1] === 0);
  assert.equal(core(0.2)[2], '@');
  assert.ok(core(0.2)[3].every(c => c > 230), 'white flash on the strong frame');
  assert.notEqual(core(0.7)[2], '@', 'flash cools');
  const pull = p => lit(draw('impact', p)).filter(q => q[2] === ':' || q[2] === '+');
  assert.ok(meanRadius(pull(0.15)) < meanRadius(pull(0.02)), 'anticipation motes are drawn in');
  const spread = p => Math.max(...lit(draw('impact', p)).map(q => Math.hypot(q[0], q[1])));
  assert.ok(spread(0.3) < spread(0.5) && spread(0.5) < spread(0.75), 'burst keeps travelling outward');
  assert.ok(light(draw('impact', 0.25)) > 2 * light(draw('impact', 0.85)), 'burst dissipates');
  const reservoirs = draw('impact', 0.3).filter(q => q[2] === 'O' && q[1] === 0).sort((a, b) => a[0] - b[0]);
  assert.equal(reservoirs.length, 2);
  const [left, right] = reservoirs;
  assert.ok(left[0] < 0 && isBlue(left[3]) && right[0] > 0 && isGreen(right[3]), 'giver blue, receiver green');
});

test('pulse swaps a blue and a green packet across expanding rings; aura comets chase around the link', () => {
  const packets = p => draw('pulse', p).filter(q => q[2] === 'o');
  const blueX = p => packets(p).find(q => isBlue(q[3]))[0];
  const greenX = p => packets(p).find(q => isGreen(q[3]))[0];
  assert.ok(blueX(0.05) < 0 && blueX(0.7) > 0, 'blue packet crosses left to right');
  assert.ok(greenX(0.05) > 0 && greenX(0.7) < 0, 'green packet crosses right to left');
  const ring = p => Math.max(...draw('pulse', p).filter(q => q[2] !== 'o').map(q => Math.hypot(q[0], q[1])));
  assert.ok(ring(0.1) < ring(0.5), 'rings expand');
  const comets = p => draw('aura', p).filter(q => (q[2] === 'O' || q[2] === '*') && Math.hypot(q[0], q[1]) > 0.3);
  assert.ok(comets(0.3).some(q => isBlue(q[3])) && comets(0.3).some(q => isGreen(q[3])), 'blue and green comets');
  assert.notDeepEqual(comets(0.3).map(q => q.slice(0, 2)), comets(0.45).map(q => q.slice(0, 2)), 'comets orbit');
  const projectile = lit(draw('projectile', 0.4));
  assert.ok(projectile.some(q => q[2] === '@' && q[0] === 0 && q[1] === 0), 'bright packet core leads');
  assert.ok(projectile.some(q => q[1] < -0.6), 'braided wake trails behind');
  assert.ok(projectile.every(q => Math.abs(q[0]) < 0.6 && q[1] < 0.2 && q[1] > -1.1), 'compact silhouette');
});

test('every stage stays finite, bounded, deterministic, within budget and fades completely', () => {
  for (const stage of STAGES) {
    for (const heading of [0, 1.2, Math.PI / 2, Math.PI]) {
      for (const radius of [1, 3]) {
        for (const progress of [0, 0.1, 0.25, 0.5, 0.8, 0.95, 1]) {
          const points = draw(stage, progress, { heading, radius });
          assert.ok(points.length > 0 && points.length <= BUDGET[stage], `${stage} plots ${points.length}`);
          assert.deepEqual(points, draw(stage, progress, { heading, radius }));
          for (const [x, z, char, color, brightness] of points) {
            assert.ok([x, z, brightness, ...color].every(Number.isFinite));
            assert.ok(Math.abs(x) <= 6 && Math.abs(z) <= 6);
            assert.match(char, /^[\x20-\x7e]$/);
            assert.ok(color.length === 3 && color.every(c => c >= 0 && c <= 255));
            assert.ok(brightness >= 0 && brightness <= 1);
            if (progress === 1) assert.equal(brightness, 0);
          }
        }
      }
    }
  }
});

test('animation is smooth: total light never jumps between 240 Hz samples', () => {
  for (const stage of STAGES) {
    for (let i = 0; i < 240; i++) {
      const step = Math.abs(light(draw(stage, i / 240)) - light(draw(stage, (i + 1) / 240)));
      assert.ok(step < 10, `${stage} pops by ${step.toFixed(2)} at ${(i / 240).toFixed(3)}`);
    }
  }
});

test('sound phrase alternates hollow plunks, rises into a whistle, and resolves as a receiving pair', () => {
  const plunks = profile.sounds.cast.filter(v => v.duration <= 0.15);
  assert.equal(plunks.length, 4);
  assert.ok(plunks.every(v => v.type === 'sine' && v.endFrequency < v.frequency && v.attack < 0.01));
  assert.equal(plunks[0].frequency, plunks[2].frequency);
  assert.equal(plunks[1].frequency, plunks[3].frequency);
  assert.notEqual(plunks[0].frequency, plunks[1].frequency);
  assert.ok(plunks.every((v, i) => i === 0 || v.delay > (plunks[i - 1].delay ?? 0)));
  const whistle = profile.sounds.cast.find(v => v.endFrequency > v.frequency);
  assert.ok(whistle && whistle.duration > 0.3 && whistle.attack > 0.03);
  const [first, second] = profile.sounds.impact;
  assert.equal(profile.sounds.impact.length, 2);
  assert.ok(second.delay > 0 && second.frequency > first.frequency);
  assert.ok(profile.sounds.pulse.every(v => v.duration < 0.1 && v.gain <= 0.02));
  for (const voices of Object.values(profile.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
  }
});

test('real rune cast renders its profile and emits typed transfer cues while preserving mana ticks', () => {
  const scene = runeScene(spell, { range: 15, allyInPath: true, allyRange: 1 });
  const events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const eventCount = events.length;
  assert.equal(scene.cast().ok, false, 'cooldown rejects the duplicate cast');
  assert.equal(events.length, eventCount, 'rejected casts stay silent');
  scene.advance(0.4);
  const points = [];
  scene.casting.effects.paint((...point) => points.push(point), scene.casting.projectiles);
  assert.ok(points.some(p => p[2] === '[') && points.some(p => p[2] === 'o'), 'runtime paints authored gates and packets');
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'cast' && e.presentation === profile));
  scene.advance(0.7);
  assert.ok(scene.casting.state(scene.ally).mana >= 24, 'existing two-mana resource pulses reach the ally');
  assert.ok(scene.casting.mana < 94);
  assert.equal(scene.player.magicSpeed, 0, 'channel movement restriction remains');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'cast'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'), 'aura activation uses receiving sound');
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === profile));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
});

test('all authored cues schedule their layers through spatial SFX without invalid audio values', () => {
  for (const stage of ['cast', 'impact', 'pulse']) {
    const audio = fakeRecordedAudio();
    const handles = playSpellSound(audio.engine, { presentation: profile, stage, x: 2, y: 3 });
    assert.equal(handles.length, profile.sounds[stage].length);
    assert.ok(audio.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 3));
    assert.ok(audio.nodes.some(n => n.starts.some(at => at > audio.context.currentTime)), 'paired notes are scheduled');
    assert.deepEqual(audio.invalid, []);
    for (const handle of handles) handle.stop();
    assert.ok(audio.routes.every(r => r.disposals === 1));
  }
});
