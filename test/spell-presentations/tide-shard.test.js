import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/tide-shard.js';
import spell from '../../src/spells/definitions/tide-shard.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress, age = progress * presentation.duration) {
  const points = [], effect = Object.freeze({ stage, progress, age, life: presentation.duration, radius: 1, heading: 0 });
  presentation.draw(effect, (...point) => points.push(point));
  return points;
}

test('Tide Shard opts into the droplet presentation while retaining its rune costs', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.deepEqual(spell.variants[0].params, { cooldown: 10, mana: 4, damage: 12 });
});

test('a pointed water drop leads a forked wake in flight, then forms an outward bead crown', () => {
  const projectile = draw('projectile', 0.2);
  const tip = projectile.find(p => p[2] === '^');
  assert.ok(tip && tip[0] === 0 && tip[1] === Math.max(...projectile.map(p => p[1])));
  assert.ok(projectile.some(p => p[2] === 'o'), 'the drop retains a round specular water bead');
  const wake = projectile.filter(p => p[1] < -0.5 && ['.', '~'].includes(p[2]));
  assert.ok(wake.length >= 10 && wake.some(p => p[0] < -0.3) && wake.some(p => p[0] > 0.3));
  assert.ok(projectile.every(p => Math.abs(p[0]) < 0.6), 'the flying spear stays compact');
  const early = draw('impact', 0.1).filter(p => p[2] === 'o' && (p[0] || p[1]));
  const late = draw('impact', 0.6).filter(p => p[2] === 'o' && (p[0] || p[1]));
  assert.equal(early.length, 8);
  assert.equal(late.length, 8);
  for (let i = 0; i < early.length; i++) {
    assert.ok(Math.hypot(late[i][0], late[i][1]) > Math.hypot(early[i][0], early[i][1]), 'crown beads splash outward');
  }
  assert.ok(draw('impact', 0.3).some(p => p[2] === '~'), 'a scalloped water rim joins the crown');
  assert.notDeepEqual(draw('cast', 0.3), draw('projectile', 0.3));
  assert.notDeepEqual(draw('projectile', 0.3), draw('impact', 0.3));
});

test('all stages evolve, stay within the plot budget and fade without invalid values', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const p of [0, 0.25, 0.6, 1]) {
      const points = draw(stage, p);
      assert.ok(points.length > 0 && points.length <= 96);
      for (const [x, z, char, color, brightness] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 5 && Math.abs(z) < 5);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (p === 1) assert.equal(brightness, 0, 'all geometry fades at the end of its life');
      }
    }
    assert.notDeepEqual(draw(stage, 0.1), draw(stage, 0.6));
    assert.deepEqual(draw(stage, 0.3), draw(stage, 0.3), 'same effect state renders deterministically');
  }
  assert.notDeepEqual(draw('projectile', 0.3, 0.1), draw('projectile', 0.3, 0.2), 'forked wake curls with flight age');
});

test('the sound recipe has a high plip, reversing low liquid wobble and crisp splash tail', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const tones = cast.filter(v => v.kind === 'tone');
  assert.ok(tones.every(v => v.type === 'sine'), 'rounded liquid tones avoid metallic harmonics');
  assert.ok(tones[0].frequency > 1000 && tones[0].endFrequency < tones[0].frequency);
  assert.ok(tones[1].frequency < 300 && tones[1].endFrequency < tones[1].frequency);
  assert.equal(tones[1].endFrequency, tones[2].frequency);
  assert.ok(tones[2].endFrequency > tones[2].frequency && tones[2].delay > tones[1].delay, 'low wobble reverses direction after the plip');
  const sharp = impact.find(v => v.kind === 'noise' && v.filterType === 'highpass');
  const body = impact.find(v => v.kind === 'noise' && v.filterType === 'bandpass');
  assert.ok(sharp.attack <= 0.002 && sharp.duration < body.duration && body.delay > 0, 'splash opens crisply before a liquid wash');
  assert.ok(impact.some(v => v.kind === 'tone' && v.delay > 0.1), 'a final water bead follows the splash');
  assert.ok(pulse.every(v => v.gain < 0.025 && v.duration < 0.1), 'repeating ticks remain quiet and short');
  for (const recipe of [cast, impact, pulse]) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    for (const v of recipe) {
      assert.ok(v.gain > 0 && v.gain <= 0.25 && v.duration > 0 && v.duration <= 2.5);
      assert.ok((v.delay ?? 0) >= 0 && (v.delay ?? 0) <= 2);
    }
  }
  const fake = fakeRecordedAudio();
  for (const stage of ['cast', 'impact', 'pulse']) {
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 4, y: 7 });
    assert.equal(handles.length, presentation.sounds[stage].length);
    for (const handle of handles) handle.stop();
  }
  assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 4 && r.y === 7 && r.disposals === 1));
  assert.deepEqual(fake.invalid, []);
});

test('real rune casts render the drop and crown and emit typed liquid cues without sword sounds', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejection stays silent');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  assert.ok(scene.casting.projectiles.length > 0);
  const launch = [];
  scene.casting.effects.paint((...p) => launch.push(p), scene.casting.projectiles);
  assert.ok(launch.some(p => p[2] === '^') && launch.some(p => p[2] === '~'));
  const before = scene.foe.y;
  scene.advance(0.2);
  assert.equal(scene.foe.health, 88);
  assert.ok(scene.foe.y > before, 'the original knockback still applies');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  const impact = scene.casting.effects.list.find(e => e.stage === 'impact');
  assert.ok(impact && impact.presentation === presentation);
  const crown = [];
  paintPresentation(impact.presentation, impact, (...p) => crown.push(p));
  assert.equal(crown.filter(p => p[2] === 'o').length, 9, 'the runtime paints the crown beads and central drop');
});
