import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/tide-shard.js';
import spell from '../../src/spells/definitions/tide-shard.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

// Radii and lives follow what the rune really spawns: the cast flash, the flying
// shard, in-flight wake ticks, the wide hit splash and the damage impact.
const RADIUS = { cast: 0.8, projectile: 0.65, impact: 1, pulse: 1, aura: 1, zone: 3 };
const LIFE = { projectile: 0.5, pulse: 0.25, impact: 0.6, aura: 1.5, zone: 8 };
const BUDGET = { cast: 200, projectile: 110, impact: 220, pulse: 90, aura: 160, zone: 160 };

function draw(stage, progress, { heading = 0, radius = RADIUS[stage], life = LIFE[stage] ?? presentation.duration, age = progress * life } = {}) {
  const points = [], effect = Object.freeze({ stage, progress, age, life, radius, heading });
  presentation.draw(effect, (...point) => points.push(point));
  return points;
}
const lit = points => points.filter(p => p[4] > 0.05);
const reach = points => Math.max(...points.map(p => Math.abs(p[0])));
const SLANTS = ['/', '\\', '|', '-'];

test('Tide Shard opts into its water presentation while retaining its rune costs', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.equal(presentation.duration, 0.78);
  assert.deepEqual(spell.variants[0].params, { cooldown: 10, mana: 4, damage: 12 });
});

test('the flying shard is a pointed, outlined spear trailing a twin helix wake', () => {
  const flight = lit(draw('projectile', 0.3));
  const tip = flight.find(p => p[2] === '*');
  assert.ok(tip && tip[0] === 0, 'a glinting needle tip sits on the spine');
  const tail = flight.find(p => p[2] === 'o');
  assert.ok(tail && tail[1] < tip[1], 'the rounded droplet tail is behind the tip');
  const body = flight.filter(p => p[1] > tail[1] && p[1] < tip[1]);
  assert.ok(body.some(p => p[0] < -0.08 && SLANTS.includes(p[2])) && body.some(p => p[0] > 0.08 && SLANTS.includes(p[2])),
    'both flanks are outlined with slanted edges');
  assert.ok(body.some(p => '=+*#'.includes(p[2]) && Math.abs(p[0]) < 0.08), 'a dense bright core fills the spine');
  const widest = body.reduce((a, p) => Math.abs(p[0]) > Math.abs(a[0]) ? p : a);
  assert.ok(Math.abs(widest[0]) < 0.25 && widest[1] < (tail[1] + tip[1]) / 2, 'widest a third along, tapering to the tip');
  const wake = flight.filter(p => p[1] < tail[1] - 0.1 && ['.', ',', '-', '~'].includes(p[2]));
  assert.ok(wake.length >= 14 && wake.some(p => p[0] < -0.1) && wake.some(p => p[0] > 0.1), 'the wake braids behind on both sides');
  assert.notDeepEqual(draw('projectile', 0.3, { age: 0.1 }), draw('projectile', 0.3, { age: 0.13 }), 'the helix turns with flight age');
});

test('shard edge glyphs follow the on-screen heading', () => {
  const edges = heading => new Set(lit(draw('projectile', 0.3, { heading })).filter(p => Math.abs(p[0]) > 0.05 && p[1] > -0.4)
    .map(p => p[2]).filter(c => SLANTS.includes(c)));
  const down = edges(0), across = edges(Math.PI / 4);
  assert.ok(down.has('|') && (down.has('/') || down.has('\\')), 'a downward shard has vertical flanks');
  assert.notDeepEqual([...down].sort(), [...across].sort(), 'a diagonal shard picks different slants');
});

test('the cast winds up, flashes, jets forward and throws a falling bow splash', () => {
  const windup = lit(draw('cast', 0.05));
  assert.ok(windup.filter(p => p[2] === '~' || p[2] === 'o').length >= 10, 'water ribbons spiral in');
  assert.ok(!windup.some(p => p[2] === '@'), 'no flash before release');
  const release = lit(draw('cast', 0.16));
  assert.ok(release.some(p => p[2] === '@'), 'a white flash marks the release');
  const jet = release.filter(p => p[2] === '|' && Math.abs(p[0]) < 0.01);
  assert.ok(jet.length >= 3 && Math.max(...jet.map(p => p[1])) - Math.min(...jet.map(p => p[1])) > 0.6,
    'a jet streaks forward along the heading');
  const spray = lit(draw('cast', 0.3)), later = lit(draw('cast', 0.6));
  const drops = points => points.filter(p => ["'", ',', 'o'].includes(p[2]));
  assert.ok(drops(spray).length >= 15, 'droplets burst from the hand');
  assert.ok(reach(later) > reach(spray), 'splash and ripples keep spreading');
  assert.ok(lit(draw('cast', 0.75)).filter(p => p[2] === '.' && p[4] < 0.6).length >= 5, 'landed droplets bead the ground');
  assert.ok(!later.some(p => p[2] === '@'), 'the flash has faded');
});

test('impact flashes, shatters the shard and raises a crown that sheds beads outward', () => {
  const strike = lit(draw('impact', 0.03));
  assert.ok(strike.some(p => p[2] === '@' && p[4] > 0.9), 'a bright strike flash');
  const crown = lit(draw('impact', 0.3)), shed = lit(draw('impact', 0.6));
  assert.ok(!crown.some(p => p[2] === '@'), 'the flash is brief');
  const beads = points => points.filter(p => p[2] === 'o');
  assert.equal(beads(crown).length, 16, 'every crown spike carries a bead');
  const spread = points => beads(points).reduce((s, p) => s + Math.abs(p[0]), 0);
  assert.ok(beads(shed).length === 16 && spread(shed) > spread(crown), 'beads fly outward as they fall');
  assert.ok(crown.filter(p => SLANTS.includes(p[2])).length >= 24, 'spikes and shard fragments read as slanted strokes');
  const ripple = points => reach(points.filter(p => p[2] === '~' || p[2] === '-'));
  assert.ok(ripple(lit(draw('impact', 0.7))) > ripple(lit(draw('impact', 0.15))), 'ground ripples roll outward');
  assert.ok(reach(crown) < 2, 'the splash stays a compact, readable silhouette');
});

test('flight ticks leave a small wake while the hit splash spreads wide', () => {
  const tick = lit(draw('pulse', 0.4)), splash = lit(draw('pulse', 0.4, { radius: 3 }));
  assert.ok(tick.length >= 10 && tick.length <= 26, 'ticks repeat twice per 50 ms, so they stay lean');
  assert.ok(tick.every(p => Math.abs(p[0]) < 0.8 && p[1] < 0.6), 'the tick wake sits behind and below the shard');
  assert.ok(splash.length > tick.length && reach(splash) > reach(tick) * 1.5);
});

test('all stages animate smoothly, stay within budget and fade without invalid values', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    let peak = 0;
    for (const heading of [0, 1.2, -2.5]) {
      for (const p of [0, 0.1, 0.25, 0.45, 0.6, 0.8, 0.95, 1]) {
        const points = draw(stage, p, { heading });
        peak = Math.max(peak, points.length);
        assert.ok(points.length > 0 && points.length <= BUDGET[stage], `${stage} ${p}: ${points.length}`);
        for (const [x, z, char, color, brightness] of points) {
          assert.ok([x, z, brightness, ...color].every(Number.isFinite));
          assert.ok(Math.abs(x) < 6 && Math.abs(z) < 6);
          assert.match(char, /^[\x20-\x7e]$/);
          assert.ok(color.length === 3 && color.every(c => c >= 0 && c <= 255));
          assert.ok(brightness >= 0 && brightness <= 1);
          if (p === 1) assert.equal(brightness, 0, `${stage} fades out at the end of its life`);
        }
      }
    }
    assert.ok(peak <= BUDGET[stage]);
    assert.notDeepEqual(draw(stage, 0.1), draw(stage, 0.6));
    assert.deepEqual(draw(stage, 0.3), draw(stage, 0.3), 'same effect state renders deterministically');
    // Consecutive 60 fps frames move every glyph only a short distance.
    for (const p of [0.33, 0.52, 0.71]) {
      const a = draw(stage, p), b = draw(stage, p + 1 / 60 / (LIFE[stage] ?? presentation.duration));
      assert.equal(a.length, b.length, `${stage} keeps a stable glyph set at ${p}`);
      // Recycled droplets may respawn, but only while invisible.
      const jump = Math.max(0, ...a.map((q, i) => q[4] > 0.05 && b[i][4] > 0.05 ? Math.hypot(q[0] - b[i][0], q[1] - b[i][1]) : 0));
      assert.ok(jump < 0.35, `${stage} moves smoothly at ${p}: ${jump}`);
    }
  }
});

test('delayed ripple rings swell in instead of popping into view', () => {
  // Ring starts: impact's second ripple at 0.25, cast ripples at 0.1 and 0.26.
  const sum = points => points.reduce((s, p) => s + p[4], 0);
  for (const [stage, start] of [['impact', 0.25], ['cast', 0.1], ['cast', 0.26]]) {
    for (const heading of [0, 1.2]) {
      const before = draw(stage, start - 0.00125, { heading }), after = draw(stage, start + 0.00125, { heading });
      assert.ok(after.length > before.length, `${stage} adds its ripple glyphs at ${start}`);
      assert.ok(Math.abs(lit(after).length - lit(before).length) <= 2,
        `${stage} ${start}: ${lit(before).length} -> ${lit(after).length} lit glyphs`);
      assert.ok(Math.abs(sum(after) - sum(before)) < 1.5, `${stage} ${start}: brightness jumps by ${sum(after) - sum(before)}`);
    }
  }
});

test('a draw nested inside the plot callback does not change the outer draw', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    const life = LIFE[stage] ?? presentation.duration, expected = draw(stage, 0.3, { heading: 0.7 });
    const outer = [];
    let nested = 0;
    presentation.draw(Object.freeze({ stage, progress: 0.3, age: 0.3 * life, life, radius: RADIUS[stage], heading: 0.7 }), (...point) => {
      outer.push(point);
      // Re-enter with a different stage and heading on every plotted glyph.
      presentation.draw(Object.freeze({ stage: 'impact', progress: 0.5, age: 0.3, life: 0.6, radius: 1, heading: -2 }), () => nested++);
    });
    assert.deepEqual(outer, expected, `${stage} keeps every outer glyph in its own callback`);
    assert.equal(nested, expected.length * draw('impact', 0.5, { heading: -2, age: 0.3 }).length, `${stage} nested draws stay complete`);
  }
});

test('the paint adapter keeps every stage under its glyph cap', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    const life = LIFE[stage] ?? presentation.duration;
    for (const p of [0, 0.2, 0.5, 0.8]) {
      let count = 0;
      const plotted = paintPresentation(presentation, { x: 10, y: 10, stage, age: p * life, life, radius: RADIUS[stage], heading: 0.7 },
        () => count++, stage === 'projectile' ? 128 : 256);
      assert.equal(plotted, count);
      assert.ok(count <= BUDGET[stage]);
    }
  }
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

test('real rune casts render the shard, wake and crown and emit typed liquid cues without sword sounds', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false, 'mana rejection stays silent');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  assert.ok(scene.casting.projectiles.length > 0);
  scene.advance(0.05);
  const launch = [];
  scene.casting.effects.paint((...p) => launch.push(p), scene.casting.projectiles);
  assert.ok(launch.some(p => p[2] === '*') && launch.some(p => p[2] === '~'), 'the shard tip and its wake are painted');
  const before = scene.foe.y;
  scene.advance(0.15);
  assert.equal(scene.foe.health, 88);
  assert.ok(scene.foe.y > before, 'the original knockback still applies');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  const impact = scene.casting.effects.list.find(e => e.stage === 'impact');
  assert.ok(impact && impact.presentation === presentation);
  const crown = [];
  paintPresentation(impact.presentation, impact, (...p) => crown.push(p));
  assert.ok(crown.filter(p => p[2] === 'o').length >= 12, 'the runtime paints the crown beads');
  assert.ok(crown.length > 60 && crown.length <= BUDGET.impact);
});
