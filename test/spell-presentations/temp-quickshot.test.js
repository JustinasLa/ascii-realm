import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-quickshot.js';
import spell from '../../src/spells/definitions/temp-quickshot.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

const STAGES = ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone'];
const BUDGET = { cast: 200, impact: 200, projectile: 110, pulse: 90, aura: 160, zone: 160 };
const LIFE = { projectile: 1.2, impact: 0.6, pulse: 0.5, aura: 1.5, zone: 4 };

function points(stage, progress = 0.25, { heading = 0, radius = 1 } = {}) {
  const life = LIFE[stage] ?? presentation.duration, result = [];
  presentation.draw({ stage, progress, age: progress * life, life, radius, heading }, (...p) => result.push(p));
  return result;
}
const lit = frame => frame.filter(p => p[4] > 0.05);
const near = (frame, x, z, r) => frame.filter(p => Math.hypot(p[0] - x, p[1] - z) <= r);

test('Leaf Arrow flies as a shaft, pointed leaf blade and fluttering leaflet fletching with a slipstream', () => {
  assert.equal(spell.presentation, presentation);
  const flight = points('projectile', 0.1);
  const shaft = flight.filter(p => p[0] === 0 && p[1] < 0 && p[1] > -0.85);
  assert.ok(shaft.length >= 5 && shaft.every(p => p[2] === '|'), 'a continuous straight shaft runs down the flight line');
  const tip = flight.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.equal(tip[2], 'v', 'the pointed head leads, drawn in the screen direction of travel');
  assert.ok(tip[1] > 0.4 && tip[4] === 1);
  const blade = flight.filter(p => p[1] > 0 && p[1] < tip[1] && p[0] !== 0);
  assert.ok(blade.some(p => p[0] < -0.1) && blade.some(p => p[0] > 0.1), 'the leaf blade has two edges');
  const wake = flight.filter(p => p[1] < -1);
  assert.ok(wake.length >= 12, 'motes and torn leaves stream behind the arrow');
  const close = wake.filter(p => p[1] > -1.6), far = wake.filter(p => p[1] < -2.2);
  const mean = list => list.reduce((s, p) => s + p[4], 0) / Math.max(1, list.length);
  assert.ok(mean(close) > mean(far), 'the slipstream dims with distance');
  // Fletching flutters continuously rather than snapping between poses.
  const a = points('projectile', 0.1), b = points('projectile', 0.1 + 0.004);
  assert.notDeepEqual(a, b);
  const fletch = frame => frame.filter(p => p[1] < -0.55 && p[1] > -0.95 && p[0] !== 0 && p[3][1] > 130);
  fletch(a).forEach((p, i) => assert.ok(Math.abs(p[0] - fletch(b)[i][0]) < 0.03));
});

test('Leaf Arrow line glyphs follow the on-screen flight direction', () => {
  const across = points('projectile', 0.1, { heading: Math.PI / 2 + 0.01 });
  const tip = across.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.equal(tip[2], '>');
  assert.ok(across.filter(p => p[0] === 0 && p[1] < 0 && p[1] > -0.85).every(p => p[2] === '-'));
  const back = points('projectile', 0.1, { heading: Math.PI });
  assert.equal(back.reduce((a, b) => (b[1] > a[1] ? b : a))[2], '^');
});

test('Leaf Arrow cast holds a full draw, snaps the string and sheds the bow into leaves', () => {
  const held = points('cast', 0.08);
  const bow = held.filter(p => Math.abs(p[0]) > 0.3 && p[1] > 0.1 && p[1] < 0.75 && ['-', '/', '\\', '|'].includes(p[2]));
  assert.ok(bow.length >= 12, 'the drawn bow limbs span both sides of the caster');
  assert.ok(held.some(p => p[2] === 'v' && p[1] > 0.8 && p[1] < 1.6), 'a nocked arrow points down range');
  const tips = Math.min(...bow.map(p => p[1]));
  const nock = Math.min(...held.filter(p => Math.abs(p[0]) < 0.05).map(p => p[1]));
  assert.ok(nock < tips - 0.15, 'the string is drawn back well behind the bow tips');
  const motes = held.filter(p => ['.', ':', '+', '*', '#'].includes(p[2]));
  assert.ok(motes.length >= 6, 'leaf motes gather on the arrowhead during the wind-up');
  // Release: the arrow streaks far forward and leaf shards burst out.
  const snap = points('cast', 0.14);
  assert.ok(snap.some(p => p[1] > 2.5 && p[4] > 0.3), 'the released arrow streaks away down range');
  const streak = q => points('cast', q).filter(p => p[0] === 0 && p[1] > 2 && ['|', 'v'].includes(p[2]) && p[4] > 0.05);
  assert.ok(streak(0.14).length >= 3 && streak(0.4).length === 0, 'the streak clears quickly');
  const shards = q => lit(points('cast', q)).filter(p => p[1] > 1.2 && p[0] !== 0).length;
  assert.ok(shards(0.3) >= 6, 'a forward cone of leaf shards bursts from the grip');
  // Follow-through: line strokes of the bow give way to leaf glyphs, tips first.
  const strokes = f => lit(f).filter(p => ['-', '/', '\\', '|'].includes(p[2])).length;
  const leaves = f => lit(f).filter(p => [',', '`'].includes(p[2])).length;
  const mid = points('cast', 0.45), late = points('cast', 0.7);
  assert.ok(strokes(late) < strokes(held));
  assert.ok(leaves(mid) >= 10, 'the bow sheds into leaves');
  const total = f => f.reduce((s, p) => s + p[4], 0);
  assert.ok(total(points('cast', 0.9)) < total(mid) * 0.5, 'the shed leaves dissipate');
});

test('Leaf Arrow impact flashes white, quivers in the target and bursts into splinters and leaves', () => {
  const strike = points('impact', 0.02);
  const core = strike.find(p => p[2] === '@');
  assert.ok(core && core[0] === 0 && core[1] === 0 && core[3].every(c => c > 220), 'a white strike flash marks the hit');
  assert.ok(strike.filter(p => Math.hypot(p[0], p[1]) > 0.1 && p[3][0] > 200).length >= 8, 'short rays punch out of the flash');
  const shaft = frame => frame.filter(p => ['|', '/', '\\'].includes(p[2]) && p[1] < -0.2 && p[1] > -1.05 && Math.abs(p[0]) < 0.25 && p[3][0] > 120 && p[3][1] < 170);
  assert.ok(shaft(points('impact', 0.1)).length >= 8, 'the arrow sticks out behind the point of impact');
  const wobble = [0.05, 0.08, 0.11].map(q => Math.max(...shaft(points('impact', q)).map(p => p[0])));
  assert.ok(new Set(wobble.map(w => w.toFixed(3))).size > 1, 'the embedded arrow quivers');
  assert.equal(shaft(points('impact', 0.7)).length, 0, 'the arrow dissolves');
  const spread = q => Math.max(...lit(points('impact', q)).map(p => Math.hypot(p[0], p[1])));
  assert.ok(spread(0.05) < spread(0.3), 'splinters, leaves and the ring travel outward');
  const forward = near(points('impact', 0.25), 0, 0.7, 0.6).length, backward = near(points('impact', 0.25), 0, -0.7, 0.6).length;
  assert.ok(forward > 0 && backward > 0, 'the burst sprays splinters and leaves both ahead of and behind the hit');
  assert.ok(!points('impact', 0.5).some(p => p[2] === '@'), 'the flash is gone by follow-through');
});

test('all Leaf Arrow stages are finite, bounded, deterministic, animated, within budget and fade out', () => {
  for (const stage of STAGES) {
    const first = points(stage, 0.05), middle = points(stage, 0.5), last = points(stage, 1);
    assert.deepEqual(middle, points(stage, 0.5));
    assert.notDeepEqual(first, middle, `${stage} geometry develops over time`);
    assert.ok(middle.length > 10, `${stage} draws a readable shape`);
    for (const heading of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.2]) {
      for (let q = 0; q <= 1.0001; q += 0.025) {
        const frame = points(stage, Math.min(1, q), { heading, radius: stage === 'zone' ? 3 : 1 });
        assert.ok(frame.length <= BUDGET[stage], `${stage} stays within ${BUDGET[stage]} glyphs (${frame.length})`);
        for (const [x, z, char, color, brightness] of frame) {
          assert.ok([x, z, brightness, ...color].every(Number.isFinite));
          assert.ok(Math.abs(x) < 6 && Math.abs(z) < 6);
          assert.match(char, /^[\x20-\x7e]$/);
          assert.ok(color.every(c => c >= 0 && c <= 255));
          assert.ok(brightness >= 0 && brightness <= 1);
        }
      }
    }
    assert.ok(last.every(p => p[4] === 0), `${stage} fades completely`);
  }
  assert.notDeepEqual(points('cast'), points('projectile'));
  assert.notDeepEqual(points('cast'), points('impact'));
});

test('Leaf Arrow moves smoothly between 60 fps frames', () => {
  for (const stage of ['projectile', 'impact', 'aura']) {
    const life = LIFE[stage], dt = 1 / 60 / life;
    for (const q of [0.2, 0.45, 0.7]) {
      const a = points(stage, q), b = points(stage, q + dt);
      if (a.length !== b.length) continue;
      const jumps = a.filter((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) > 0.35).length;
      assert.ok(jumps <= Math.ceil(a.length * 0.12), `${stage} at ${q}: ${jumps} of ${a.length} glyphs jump`);
    }
  }
});

test('Leaf Arrow schedules a woody two-part twang, delayed dart and uneven dry leaf flicks on SFX', () => {
  const { cast, impact } = presentation.sounds;
  const twang = cast.filter(v => v.kind === 'tone');
  assert.equal(twang.length, 2);
  assert.ok(twang.every(v => v.endFrequency < v.frequency && v.attack <= 0.002));
  assert.ok(twang.some(v => v.type === 'triangle') && twang.some(v => v.type === 'sine'));
  const dart = cast.find(v => v.kind === 'noise');
  assert.ok(dart.delay > Math.max(...twang.map(v => v.delay ?? 0)));
  assert.equal(dart.filterType, 'bandpass');
  const flicks = impact.filter(v => v.kind === 'noise');
  assert.equal(flicks.length, 3);
  const intervals = flicks.slice(1).map((v, i) => v.delay - (flicks[i].delay ?? 0));
  assert.notEqual(intervals[0], intervals[1], 'the dry flicks have an uneven rhythm');
  assert.ok(flicks.every(v => v.duration <= 0.05));
  assert.notDeepEqual(cast, impact);
  for (const [stage, recipe] of Object.entries(presentation.sounds)) {
    assert.ok(recipe.length <= 8);
    for (const v of recipe) {
      assert.ok(v.gain > 0 && v.gain <= 0.25 && v.duration > 0 && v.duration <= 2.5);
      assert.ok((v.delay ?? 0) >= 0 && (v.delay ?? 0) <= 2);
      assert.ok(Object.values(v).filter(v => typeof v === 'number').every(Number.isFinite));
    }
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { presentation, stage, x: 7, y: 11 });
    assert.equal(handles.length, recipe.length);
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 7 && r.y === 11));
    const sources = fake.nodes.filter(n => ['source', 'oscillator'].includes(n.kind));
    assert.deepEqual(sources.map(n => n.starts[0]), recipe.map(v => fake.context.currentTime + (v.delay ?? 0)));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(h => h.stop());
    assert.ok(fake.routes.every(r => r.disposals === 1));
  }
});

test('real Leaf Arrow casts render the authored profile, emit typed spell cues and retain eight damage', () => {
  const scene = runeScene(spell), sounds = [];
  scene.casting.onSound = event => sounds.push(event);
  const mana = scene.casting.state(scene.player).mana;
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.casting.state(scene.player).mana, mana - 4);
  assert.equal(scene.cast().ok, false, 'cooldown rejects a second shot');
  assert.equal(sounds.length, 1, 'a rejected cast is silent');
  assert.equal(sounds[0].type, 'spell');
  assert.equal(sounds[0].stage, 'cast');
  assert.equal(sounds[0].presentation, presentation);
  assert.equal(scene.casting.projectiles[0].ctx.spell.presentation, presentation);
  const launched = [];
  scene.casting.effects.paint((...p) => launched.push(p), scene.casting.projectiles);
  assert.ok(launched.some(p => p[2] === '|') && launched.some(p => p[2] === 'v'), 'the arrow flies down range at heading 0');
  scene.advance(0.2);
  assert.equal(scene.foe.health, 92);
  assert.ok(sounds.some(e => e.stage === 'impact' && e.type === 'spell'));
  assert.ok(sounds.every(e => e.presentation === presentation && !['draw', 'slam'].includes(e.type)));
  const impact = scene.casting.effects.list.find(e => e.stage === 'impact');
  assert.equal(impact.presentation, presentation);
  const rendered = [];
  paintPresentation(presentation, impact, (...p) => rendered.push(p));
  assert.ok(rendered.length > 30 && rendered.length <= 200);
  scene.advance(2);
  assert.equal(scene.foe.health, 92, 'the leaf burst is cosmetic');
  assert.equal(scene.casting.projectiles.length, 0);
});
