import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/mana-transfer.js';
import spell from '../../src/spells/definitions/mana-transfer.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function draw(stage, progress = 0.2) {
  const points = [];
  const effect = Object.freeze({ stage, age: progress * profile.duration, life: profile.duration,
    progress, radius: 1, heading: 0 });
  profile.draw(effect, (...point) => points.push(point));
  return points;
}

test('Mana Transfer opts into nested gates and paired travelling blue-green packets', () => {
  assert.equal(spell.presentation, profile);
  assert.equal(profile.id, spell.id);
  const points = draw('cast');
  for (const char of ['[', ']']) {
    const gates = points.filter(p => p[2] === char);
    assert.ok(gates.some(p => p[1] < 0) && gates.some(p => p[1] > 0), 'source and receiver gates');
    assert.equal(new Set(gates.filter(p => p[1] < 0).map(p => p[0])).size, 2, 'nested source brackets');
  }
  const packets = points.filter(p => p[2] === 'o');
  assert.ok(packets.some(p => p[0] < 0) && packets.some(p => p[0] > 0), 'two travelling lanes');
  assert.ok(packets.some(p => p[3][2] > p[3][1]), 'blue packet');
  assert.ok(packets.some(p => p[3][1] > p[3][2]), 'green packet');
  const packetPositions = p => draw('aura', p).filter(point => point[2] === 'o').map(point => point.slice(0, 2));
  assert.notDeepEqual(packetPositions(0.1), packetPositions(0.35), 'packets advance with the clock');
});

test('receipt closes brackets around two reservoirs; projectile keeps a compact bead wake', () => {
  const receipt = draw('impact');
  const reservoirs = receipt.filter(p => p[2] === 'O');
  assert.equal(reservoirs.length, 2);
  assert.ok(reservoirs[0][0] < 0 && reservoirs[1][0] > 0);
  assert.notDeepEqual(reservoirs[0][3], reservoirs[1][3]);
  assert.ok(!receipt.some(p => p[2] === 'o'), 'receiving motif differs from the moving stream');
  const bracketWidth = p => Math.max(...draw('impact', p).filter(point => point[2] === '[').map(point => Math.abs(point[0])));
  assert.ok(bracketWidth(0.65) < bracketWidth(0.1), 'receiver contracts as packets settle');
  const projectile = draw('projectile');
  assert.ok(projectile.some(p => p[2] === '[') && projectile.some(p => p[2] === ']'));
  assert.ok(projectile.some(p => p[2] === 'o') && projectile.some(p => p[2] === '.' && p[1] < -0.6));
  assert.ok(projectile.every(p => Math.abs(p[0]) < 0.4 && Math.abs(p[1]) < 1.2));
});

test('every stage stays finite, bounded, deterministic and fades completely', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.25, 0.8, 1]) {
      const points = draw(stage, progress);
      assert.ok(points.length > 0 && points.length <= 96);
      assert.deepEqual(points, draw(stage, progress));
      for (const [x, z, char, color, brightness] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) <= 3 && Math.abs(z) <= 3);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.length === 3 && color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0);
      }
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
  const points = [];
  scene.casting.effects.paint((...point) => points.push(point), scene.casting.projectiles);
  assert.ok(points.some(p => p[2] === '[') && points.some(p => p[2] === 'o'), 'runtime paints authored gates and packets');
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'cast' && e.presentation === profile));
  scene.advance(1.1);
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
