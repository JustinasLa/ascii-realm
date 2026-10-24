import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-earth-spike.js';
import spell from '../../src/spells/definitions/temp-earth-spike.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

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

test('Earth Spike impact spikes stay rooted in the ground through the whole rise, overshoot included', () => {
  // Stone glyphs only: greyish colours (soil and leaves are strongly tinted) and outline/ridge characters.
  const stone = points => points.filter(p => '^/\\|:+%#'.includes(p[2]) && Math.abs(p[3][0] - p[3][1]) < 20);
  const rowStep = 2 / 13; // one text row of height in local ground metres
  for (const progress of [0.06, 0.1, 0.14, 0.2, 0.25, 0.35, 0.5]) {
    const column = stone(draw('impact', progress)).filter(p => Math.abs(p[0]) < 0.25 && p[1] < 0.03).map(p => p[1]).sort((a, b) => a - b);
    const tip = column[0], base = column[column.length - 1];
    assert.ok(tip < -3, `the central spike towers at ${progress}`);
    assert.ok(base > -rowStep * 1.5, `the central spike reaches the ground at ${progress} (base ${base.toFixed(2)})`);
    for (let i = 1; i < column.length; i++) {
      assert.ok(column[i] - column[i - 1] < rowStep * 1.5, `no gap in the central spike at ${progress}`);
    }
  }
});

test('Earth Spike looping leaves fade around each cycle instead of jumping', () => {
  const leafGlyphs = (stage, age, life) => {
    const points = [];
    presentation.draw({ stage, age, life, progress: age / life, radius: 2, heading: 0 }, (...p) => points.push(p));
    return points.filter(p => p[3][1] > p[3][0] + 30);
  };
  for (const [stage, life] of [['projectile', 3], ['aura', 6], ['zone', 6]]) {
    const dt = 1 / 120;
    let prev = leafGlyphs(stage, 0.4, life);
    for (let age = 0.4 + dt; age < 2.6; age += dt) {
      const next = leafGlyphs(stage, age, life);
      for (const [from, to] of [[prev, next], [next, prev]]) {
        for (const leaf of to) {
          if (leaf[4] < 0.06) continue;
          const near = Math.min(Infinity, ...from.map(p => Math.hypot(p[0] - leaf[0], p[1] - leaf[1])));
          assert.ok(near < 0.2, `${stage} leaf at ${age.toFixed(3)}s jumps ${near.toFixed(2)} m at brightness ${leaf[4].toFixed(2)}`);
        }
      }
      prev = next;
    }
  }
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

test('Earth Spike uses root strain, earth weight and falling timber recordings with quiet travelling cracks', async () => {
  const { cast, impact, pulse } = presentation.sounds;
  const root = cast.find(v => v.url.endsWith('/root-creak.wav'));
  const snap = cast.find(v => v.url.endsWith('/branch-snap.wav'));
  const stomp = cast.find(v => v.url.endsWith('/earth-impact.wav'));
  assert.ok(root && snap && stomp, 'root strain precedes a physical ground-breaking stomp');
  assert.ok(root.delay < snap.delay && snap.delay <= stomp.delay);
  const earth = impact.find(v => v.url.endsWith('/earth-impact.wav'));
  const timber = impact.find(v => v.url.endsWith('/wood-crash.wav'));
  const splinters = impact.find(v => v.url.endsWith('/branch-snap.wav'));
  assert.ok(earth && timber && splinters);
  assert.ok(earth.delay < timber.delay && timber.delay < splinters.delay, 'heavy earth leads the falling debris');
  assert.ok(earth.gain > timber.gain && timber.gain > splinters.gain, 'debris recedes behind the earth strike');
  assert.equal(pulse.length, 1, 'travelling eruptions use one small fracture');
  assert.ok(pulse[0].url.endsWith('/branch-snap.wav') && pulse[0].gain <= 0.3);
  for (const [stage, recipe] of Object.entries(presentation.sounds)) {
    assert.ok(recipe.length >= 1 && recipe.length <= 4);
    assert.ok(recipe.reduce((sum, v) => sum + v.gain, 0) <= 1.2, `${stage} keeps layered peaks bounded`);
    for (const voice of recipe) {
      assert.equal(voice.kind, 'recording', 'every layer uses physical foley');
      assert.match(voice.url, /^\/assets\/audio\/spells\/cerrith\/[a-z-]+\.wav$/);
      assert.ok(voice.gain >= 0.1 && voice.gain <= 0.8);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
    }
    const audio = fakeRecordedAudio();
    await prepareRecordedSpellTest(audio, presentation);
    const handles = playSpellSound(audio.engine, { stage, presentation, x: 2, y: 3 });
    assert.equal(handles.length, recipe.length, `${stage} schedules every authored recording`);
    assert.ok(audio.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 3));
    assert.deepEqual(audio.invalid, []);
    for (const handle of handles) handle.stop();
  }
});

test('real Earth Spike cast renders its profile, emits typed cues and preserves damaging lift without sword sounds', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false, 'an empty mana pool rejects a second cast');
  assert.equal(events.filter(e => e.type === 'spell' && e.stage === 'cast').length, 1);
  scene.advance(0.05); // The travelling mound fades in after launch.
  const points = [];
  scene.casting.effects.paint((...p) => points.push(p), scene.casting.projectiles);
  assert.ok(points.some(p => p[2] === '_') && points.some(p => p[2] === '^'), 'runtime paints the burrowing mound and its stone tip');
  scene.advance(0.75);
  assert.ok(scene.foe.health <= 88 && scene.foe.magicLift > 0, 'rune damage and lifting fissure remain intact');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
});
