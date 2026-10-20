import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-earth-spike.js';
import spell from '../../src/spells/definitions/temp-earth-spike.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function draw(stage, progress, heading = 0, life = presentation.duration) {
  const points = [];
  presentation.draw({ stage, age: progress * life, life, progress, radius: 2, heading },
    (...point) => points.push(point));
  return points;
}

// The adapter's local-to-world rotation; world z grows down the screen.
const world = ([x, z], heading) => [x * Math.cos(heading) + z * Math.sin(heading), z * Math.cos(heading) - x * Math.sin(heading)];
const tips = points => points.filter(p => p[2] === '^');
const top = (points, heading = 0) => Math.min(...tips(points).map(p => world(p, heading)[1]));
const BUDGET = { cast: 256, impact: 256, pulse: 100, aura: 160, zone: 160, projectile: 110 };

test('Earth Spike stays finite, printable, within its glyph budget and fades out in every stage', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  for (const stage of Object.keys(BUDGET)) {
    const life = stage === 'projectile' ? 2 : stage === 'aura' || stage === 'zone' ? 3 : presentation.duration;
    for (const heading of [0, 1.1, -2.4]) {
      for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const points = draw(stage, progress, heading, life);
        assert.ok(points.length <= BUDGET[stage], `${stage} at ${progress} plots ${points.length}`);
        if (progress === 0.5) assert.ok(points.length >= 30, `${stage} is visible mid-life`);
        for (const [x, z, char, color, brightness] of points) {
          assert.ok([x, z, brightness, ...color].every(Number.isFinite));
          assert.ok(Math.abs(x) <= 8 && Math.abs(z) <= 8);
          assert.match(char, /^[\x20-\x7e]$/);
          assert.ok(color.length === 3 && color.every(c => c >= 0 && c <= 255));
          assert.ok(brightness >= 0 && brightness <= 1);
          if (progress === 1) assert.equal(brightness, 0, `${stage} fades completely`);
        }
      }
    }
  }
  assert.deepEqual(draw('impact', 0.3, 0.7), draw('impact', 0.3, 0.7), 'draw is a pure function of the effect state');
});

test('Earth Spike pulses punch an upright stone spike out of a crack, hold it, then crumble it away', () => {
  const crack = draw('pulse', 0.04), risen = draw('pulse', 0.3), crumbling = draw('pulse', 0.9);
  assert.equal(tips(crack).length, 0, 'only cracks before the eruption');
  assert.ok(crack.some(p => '-/\\|'.includes(p[2])), 'ground cracks open first');
  assert.equal(tips(risen).length, 3, 'a main spike flanked by two smaller ones');
  for (const heading of [0, 1.3, -2.2]) {
    const points = draw('pulse', 0.3, heading), tip = tips(points).map(p => world(p, heading))
      .sort((a, b) => a[1] - b[1])[0];
    assert.ok(Math.abs(tip[0]) < 0.1 && tip[1] < -2.4, 'the main spike stands straight up the screen at any heading');
  }
  assert.ok(risen.some(p => p[2] === '|') && risen.some(p => p[2] === '/'), 'tapered outline with sheer sides');
  assert.ok(crumbling.length < risen.length * 0.7, 'the spike crumbles away');
  assert.ok(top(crumbling) > top(risen) + 1, 'and sinks back into the ground');
  const flash = draw('pulse', 0.17);
  assert.ok(flash.some(p => p[3].every(c => c > 220)), 'the tip flashes pale as it breaks the surface');
});

test('Earth Spike impact skewers the target with a crown of spikes, cracks, debris and leaves', () => {
  const hit = draw('impact', 0.02), crown = draw('impact', 0.25), late = draw('impact', 0.85);
  assert.ok(hit.some(p => p[3].every(c => c >= 225) && p[4] > 0.8), 'white flash on contact');
  assert.equal(tips(crown).length, 3, 'three spikes erupt under the target');
  assert.ok(top(crown) < -3.5, 'the central spike towers two metres above the ground');
  const spread = points => Math.max(...points.filter(p => '-/\\|'.includes(p[2]) && p[1] > -0.4).map(p => Math.hypot(p[0], p[1])));
  assert.ok(spread(crown) > spread(hit) + 0.5, 'cracks race outward');
  assert.ok(crown.some(p => p[2] === "'" || p[2] === 'o' || p[2] === '*'), 'clods and shards are thrown');
  assert.ok(crown.some(p => '()'.includes(p[2]) && p[3][1] > p[3][0]), 'cerrith leaves flutter off the stone');
  assert.ok(Math.max(...late.map(p => p[4])) < Math.max(...crown.map(p => p[4])), 'everything settles and fades');
});

test('Earth Spike cast winds up, stomps, fans out shards and tears a fissure toward the target', () => {
  const radius = points => points.reduce((sum, p) => sum + Math.hypot(p[0], p[1]), 0) / points.length;
  const gather = draw('cast', 0.03), drawn = draw('cast', 0.22);
  assert.ok(radius(drawn) < radius(gather) - 0.4, 'soil and leaf motes spiral inward');
  assert.ok(draw('cast', 0.31).some(p => p[2] === '@'), 'the stomp lands with a bright core');
  assert.equal(tips(draw('cast', 0.45)).length, 5, 'a fan of five shards pops up ahead');
  for (const heading of [0, 1.2]) {
    const reach = points => Math.max(...points.map(p => p[1]).filter(z => z > 0));
    assert.ok(reach(draw('cast', 0.75, heading)) > reach(draw('cast', 0.4, heading)) + 1,
      'the fissure tears forward along the cast heading');
  }
});

test('Earth Spike projectile burrows as a heaving soil mound with a stone tip and a trailing furrow', () => {
  for (const heading of [0, Math.PI / 2]) {
    const points = draw('projectile', 0.3, heading, 2).map(p => [...world(p, heading), ...p.slice(2)]);
    const mound = points.filter(p => p[2] === '_');
    assert.ok(mound.length >= 2 && mound.every(p => p[1] > 1), 'the mound sits on the ground below the flight anchor');
    assert.ok(points.some(p => p[2] === '^' && p[1] < 1), 'a stone tip breaks through the crest');
    const behind = points.filter(p => (heading ? -p[0] : -(p[1] - 1.15)) > 1);
    assert.ok(behind.length >= 10, 'a cracked furrow trails behind the mound');
  }
  const a = draw('projectile', 0.3, 0, 2), b = draw('projectile', 0.31, 0, 2);
  assert.notDeepEqual(a, b, 'the mound heaves and sprays soil as it travels');
});

test('Earth Spike has a soil rise, separated rock cracks, compact descending strike and quiet tick recipe', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.kind === 'noise' && v.filterType === 'lowpass' && v.attack >= 0.05));
  const cracks = cast.filter(v => v.kind === 'noise' && v.filterType === 'bandpass');
  assert.equal(cracks.length, 2);
  assert.ok(cracks[1].delay - cracks[0].delay >= 0.1, 'two distinct cracks follow the rumble');
  assert.ok(impact.some(v => v.kind === 'tone' && v.frequency > v.endFrequency && v.endFrequency < 50));
  assert.ok(pulse.every(v => v.gain < 0.025 && v.duration <= 0.1), 'travelling pulses remain quiet');
  for (const [stage, recipe] of Object.entries(presentation.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    assert.ok(recipe.every(v => v.gain > 0 && v.gain <= 0.25 && v.duration > 0 && v.duration <= 2.5 && (v.delay ?? 0) <= 2));
    const audio = fakeRecordedAudio();
    const handles = playSpellSound(audio.engine, { stage, presentation, x: 2, y: 3 });
    assert.equal(handles.length, recipe.length, `${stage} schedules every authored layer`);
    assert.ok(audio.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 3));
    assert.deepEqual(audio.invalid, []);
    for (const handle of handles) handle.stop();
  }
});

test('real Earth Spike cast renders its profile, emits typed cues and preserves damaging lift without sword sounds', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejects a second cast');
  assert.equal(events.filter(e => e.type === 'spell' && e.stage === 'cast').length, 1);
  const points = [];
  scene.casting.effects.paint((...p) => points.push(p), scene.casting.projectiles);
  assert.ok(points.some(p => p[2] === '_') && points.some(p => p[2] === '^'), 'runtime paints the burrowing mound and its stone tip');
  scene.advance(0.8);
  assert.ok(scene.foe.health <= 88 && scene.foe.magicLift > 0, 'TF damage and lifting fissure remain intact');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
});
