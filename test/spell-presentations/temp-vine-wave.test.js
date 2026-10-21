import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-vine-wave.js';
import spell from '../../src/spells/definitions/temp-vine-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function capture(stage, progress = 0.3, { radius = 1, life = presentation.duration, age = progress * life, heading = 0 } = {}) {
  const result = [];
  const effect = Object.freeze({ stage, progress, age, life, radius, heading });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => result.push([x, z, char, [...color], brightness]));
  return result;
}
const lit = list => list.filter(p => p[4] > 0.05);
const strokes = list => list.filter(p => '/\\|'.includes(p[2]));
const leaves = list => list.filter(p => ",'`.".includes(p[2]));
const maxZ = list => Math.max(...list.map(p => p[1]));
const minZ = list => Math.min(...list.map(p => p[1]));
const meanRadius = list => list.reduce((sum, [x, z]) => sum + Math.hypot(x, z), 0) / list.length;
const whiteHot = ([, , , [r, g, b], light]) => light > 0.6 && r > 230 && g > 245 && b > 200;
const brownness = list => list.reduce((sum, [, , , [r, g]]) => sum + r / g, 0) / list.length;
// Gameplay lives: pulse 0.6 s, impact 0.6 s, stun aura 1.5 s; projectiles fly ~0.8 s of a 10 s clock.
const BUDGET = { cast: 230, projectile: 110, impact: 200, pulse: 90, aura: 160, zone: 160 };

test('the cast gathers leaves into a rooted knot before the vine wave tears loose', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const early = lit(capture('cast', 0.08)), late = lit(capture('cast', 0.22));
  assert.equal(strokes(early).filter(p => Math.hypot(p[0], p[1]) > 0.6).length, 0, 'anticipation draws only the knot, no vines yet');
  const motes = list => list.filter(p => '.,:;*'.includes(p[2]));
  assert.ok(motes(early).length >= 12, 'leaf motes gather');
  assert.ok(meanRadius(motes(late)) < meanRadius(motes(early)) * 0.75, 'motes spiral inward to the caster');
  const burst = capture('cast', 0.32);
  assert.ok(burst.some(p => p[2] === '@' && whiteHot(p)), 'a white-green flash marks the wave tearing loose');
  assert.ok(maxZ(early) < 1.8, 'nothing races ahead during the wind-up');
});

test('the wave crests, rolls forward on a braid and crashes into drifting leaves', () => {
  const rising = lit(capture('cast', 0.36)), rolling = lit(capture('cast', 0.55)), crashed = lit(capture('cast', 0.9));
  assert.ok(maxZ(rolling) > maxZ(rising) + 0.8 && maxZ(rolling) > 2.4, 'the crest rolls forward');
  const width = list => Math.max(...list.map(p => Math.abs(p[0])));
  assert.ok(width(rolling) > width(rising) * 1.3 && width(rolling) > 1, 'the crescent widens as it travels');
  assert.ok(rolling.filter(p => p[2] === '^').length >= 3, 'the lip crests');
  assert.ok(rolling.filter(p => p[2] === '~' || p[2] === '=').length >= 20, 'a tangled vine base runs across the front');
  const braid = strokes(rolling).filter(p => p[1] > 0.3 && p[1] < 1.6 && Math.abs(p[0]) < 0.4);
  assert.ok(braid.length >= 12, 'a braid feeds the wave from the caster');
  assert.ok(crashed.length < rolling.length && Math.max(...crashed.map(p => p[4])) < 0.6, 'the crash thins and dims');
  assert.ok(leaves(crashed).filter(p => p[1] > 2).length >= 8, 'leaves drift beyond the broken crest');
  assert.ok(!crashed.some(p => p[2] === '^' && p[4] > 0.5), 'the crest has collapsed');
  const a = capture('cast', 0.5), b = capture('cast', 0.51);
  assert.ok(Math.abs(maxZ(lit(a)) - maxZ(lit(b))) < 0.15, 'the front moves smoothly between frames');
});

test('in flight a compact crest rolls ahead of a fading braided wake', () => {
  const flight = capture('projectile', 0.03, { age: 0.3, life: 10, radius: 0.65 });
  assert.ok(maxZ(flight) < 0.8, 'the head stays compact');
  assert.ok(flight.filter(p => p[2] === '^').length >= 2 && minZ(flight.filter(p => p[2] === '^')) > -0.6, 'the rolling crest leads, lifted above the head');
  const wake = flight.filter(p => p[1] < -0.4);
  assert.ok(wake.length >= 20 && minZ(wake) < -1.5, 'a long braided wake trails behind');
  const near = wake.filter(p => p[1] > -1).map(p => p[4]), far = wake.filter(p => p[1] < -1.5).map(p => p[4]);
  assert.ok(Math.max(...far) < Math.max(...near), 'the wake fades with distance');
  const next = capture('projectile', 0.031, { age: 0.31, life: 10, radius: 0.65 });
  const crest = list => list.filter(p => p[2] === '^').map(p => p[0]);
  assert.ok(Math.abs(crest(flight).length - crest(next).length) <= 1, 'the crest holds its shape between frames');
  assert.ok(capture('projectile', 0, { age: 0, life: 10 }).length > 30, 'the projectile is visible from launch');
});

test('pulses erupt as hooked tendrils that sink back, impacts snap thorns into a binding coil', () => {
  const up = lit(capture('pulse', 0.3, { life: 0.6, radius: 2 })), sunk = lit(capture('pulse', 0.9, { life: 0.6, radius: 2 }));
  assert.ok(minZ(up) < -0.5, 'tendrils rise above the ground');
  assert.ok(up.some(p => p[2] === '(') && up.some(p => p[2] === ')'), 'tendril tips hook outward both ways');
  assert.ok(minZ(sunk) > minZ(up) + 0.3, 'tendrils sink back');

  const hit = capture('impact', 0, { life: 0.6 });
  assert.ok(hit.some(p => p[2] === '@' && whiteHot(p)), 'a strong white flash on the hit frame');
  const thorns = lit(capture('impact', 0.18, { life: 0.6 })).filter(p => p[2] === '^');
  assert.ok(thorns.length >= 6, 'thorns erupt in a ring');
  const coil = lit(capture('impact', 0.5, { life: 0.6 })), wither = lit(capture('impact', 0.9, { life: 0.6 }));
  assert.ok(minZ(coil) < -0.9, 'vines coil up around the target');
  assert.ok(coil.filter(p => p[2] === '~').length >= 8, 'the coil wraps in vine strokes');
  const debris = list => list.filter(p => 'o.'.includes(p[2]) || ",'`".includes(p[2]));
  assert.ok(meanRadius(debris(capture('impact', 0.5, { life: 0.6 }))) > meanRadius(debris(capture('impact', 0.08, { life: 0.6 }))),
    'soil and leaves fly outward');
  assert.ok(brownness(wither) > brownness(coil), 'the coil withers to bark');
});

test('the binding aura holds a steady coil with venom drips and unwraps at the end', () => {
  const opts = { life: 1.5 };
  const a = lit(capture('aura', 0.4, opts)), b = lit(capture('aura', 0.5, opts)), end = lit(capture('aura', 0.95, opts));
  assert.ok(minZ(a) < -1, 'the coil climbs the bound entity');
  assert.ok(Math.abs(minZ(a) - minZ(b)) < 0.06 && Math.abs(a.length - b.length) <= 4, 'overlapping auras read as one steady coil');
  assert.ok(a.some(p => p[3][0] === 178 && p[3][1] === 214), 'venom drips');
  assert.ok(end.length < a.length && minZ(end) > minZ(a), 'the coil unwraps from the top');
  const zone = lit(capture('zone', 0.5, { radius: 2, life: 4 }));
  assert.ok(zone.filter(p => Math.abs(Math.hypot(p[0], p[1]) - 2) < 0.15).length >= 40, 'a zone draws a braided thicket ring');
});

test('every Vine Wave stage stays finite, ASCII, within budget, deterministic and fades completely', () => {
  for (const stage of Object.keys(BUDGET)) {
    for (const radius of [0.1, 1, 40]) {
      for (const heading of [0, 1.3, -2.6]) {
        for (const progress of [0, 0.05, 0.3, 0.55, 0.85, 0.99, 1]) {
          const life = stage === 'projectile' ? 1 : presentation.duration;
          const dots = capture(stage, progress, { radius, heading, life });
          assert.ok(dots.length <= BUDGET[stage], `${stage} stays within ${BUDGET[stage]} glyphs (${dots.length})`);
          if (progress > 0.04 && progress < 0.9) assert.ok(lit(dots).length > 10, `${stage} is visible at ${progress}`);
          for (const [x, z, char, color, brightness] of dots) {
            assert.ok([x, z, brightness, ...color].every(Number.isFinite));
            assert.ok(Math.abs(x) < 6 && Math.abs(z) < 6);
            assert.match(char, /^[\x20-\x7e]$/);
            assert.ok(color.length === 3 && color.every(c => c >= 0 && c <= 255));
            assert.ok(brightness >= 0 && brightness <= 1);
            if (progress === 1) assert.equal(brightness, 0, `${stage} fades fully`);
          }
        }
      }
    }
    assert.deepEqual(capture(stage), capture(stage), 'draw is deterministic');
    assert.notDeepEqual(capture(stage, 0.1), capture(stage, 0.6), `${stage} animates`);
  }
  // Draw keeps no module state: a nested draw issued from inside the plot callback
  // (different stage and heading) leaves the outer draw's output unchanged.
  for (const stage of Object.keys(BUDGET)) {
    const outer = { stage, progress: 0.5, age: 0.5, life: 1.05, radius: 1, heading: 0.7 };
    const plain = [], nested = [];
    presentation.draw(outer, (...p) => plain.push(p));
    presentation.draw(outer, (...p) => {
      nested.push(p);
      presentation.draw({ stage: stage === 'impact' ? 'cast' : 'impact', progress: 0.95, age: 0.3, life: 0.6, radius: 2, heading: -2.6 }, () => {});
    });
    assert.deepEqual(nested, plain, `${stage} is unaffected by a nested draw`);
  }
  // Malformed clocks never throw or emit non-finite geometry.
  for (const stage of Object.keys(BUDGET)) {
    const dots = [];
    presentation.draw({ stage, progress: NaN, age: NaN, life: NaN, radius: NaN, heading: NaN }, (...p) => dots.push(p));
    assert.ok(dots.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)));
  }
});

test('Vine Wave sound layers rasp, alternate wood taps and release a low flexible whip', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast[0].kind === 'noise' && cast[0].filterType === 'bandpass');
  const taps = cast.filter(v => v.kind === 'tone' && v.duration < 0.1);
  assert.ok(taps.length >= 3 && taps.every((v, i) => !i || v.delay > taps[i - 1].delay));
  assert.ok(taps[0].frequency > taps[1].frequency && taps[2].frequency > taps[1].frequency, 'wood taps alternate pitch');
  assert.ok(cast.some(v => v.kind === 'tone' && v.duration > 0.2 && v.endFrequency < 100 && v.delay > taps.at(-1).delay), 'low whip follows the taps');
  assert.ok(impact.some(v => v.type === 'sawtooth' && v.endFrequency < v.frequency));
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(v => v.gain <= 0.03 && v.duration <= 0.1));
  for (const [stage, voices] of Object.entries(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const v of voices) {
      assert.ok(v.gain > 0 && v.gain <= 0.25 && v.duration > 0 && v.duration <= 2.5);
      assert.ok((v.delay ?? 0) >= 0 && (v.delay ?? 0) <= 2);
      assert.ok(Object.values(v).filter(value => typeof value === 'number').every(Number.isFinite));
    }
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { type: 'spell', stage, presentation, x: 2, y: 4 });
    assert.equal(handles.length, voices.length, `${stage} creates all layers`);
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 4));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(handle => handle.stop());
  }
});

test('real Vine Wave casts render the braid and emit typed cues while preserving delayed damage', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false, 'an empty mana pool rejects repeated cast');
  assert.equal(events.filter(e => e.type === 'spell' && e.stage === 'cast').length, 1);
  assert.ok(scene.casting.effects.list.some(e => e.presentation === presentation && e.stage === 'cast'));
  assert.equal(scene.casting.projectiles[0].ctx.spell.presentation, presentation);
  const dots = [];
  scene.casting.effects.paint((...point) => dots.push(point), scene.casting.projectiles);
  assert.ok(dots.some(p => p[2] === '~') && dots.some(p => p[2] === '(' || p[2] === ')'), 'runtime paints the rolling crest and braid');
  scene.advance(0.4);
  assert.equal(scene.foe.health, 100, 'damage retains the source delay');
  scene.advance(1);
  assert.ok(scene.foe.health <= 84 && scene.potion(scene.foe, 'poison'));
  const spellEvents = events.filter(e => e.type === 'spell');
  assert.ok(spellEvents.some(e => e.stage === 'impact'));
  assert.ok(spellEvents.every(e => e.presentation === presentation && e.spellId === spell.id));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)), 'spell cues replace sword cues');
});
