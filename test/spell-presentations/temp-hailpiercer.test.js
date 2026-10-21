import assert from 'node:assert/strict';
import test from 'node:test';
import presentation, { LAUNCHES } from '../../src/spells/presentations/temp-hailpiercer.js';
import spell from '../../src/spells/definitions/temp-hailpiercer.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function draw(stage, progress = 0.3, age = progress * presentation.duration,
  { radius = 1, heading = 0, life = presentation.duration } = {}) {
  const points = [];
  presentation.draw({ stage, progress, age, life, radius, heading }, (...point) => points.push(point));
  return points;
}
const lit = points => points.filter(p => p[4] > 0.05);
const brightest = points => Math.max(0, ...points.map(p => p[4]));
const isWhite = color => color.every(c => c >= 235);

test('Hailpiercer flies as a barbed ice harpoon pointing down its heading, with a frost contrail', () => {
  assert.equal(spell.presentation, presentation);
  const shaft = draw('projectile', 0.3, 0.2);
  assert.equal(shaft.filter(p => p[2] === 'v').length, 1, 'one nose arrow points forward (+z is down the screen)');
  const nose = shaft.find(p => p[2] === 'v');
  assert.ok(shaft.every(p => p[1] <= nose[1] + 1e-9), 'nothing flies ahead of the tip');
  assert.ok(shaft.filter(p => p[2] === '|' && Math.abs(p[0]) < 1e-9).length >= 5, 'long spine, one glyph per cell');
  assert.ok(shaft.some(p => p[0] < 0 && p[2] === '\\') && shaft.some(p => p[0] > 0 && p[2] === '/'), 'paired barbs sweep back');
  const wake = shaft.filter(p => '.:+'.includes(p[2]));
  assert.ok(wake.length >= 8 && wake.every(p => p[1] < nose[1] - 0.5), 'contrail trails behind the tip');
  const side = draw('projectile', 0.3, 0.2, { heading: Math.PI / 2 });
  assert.ok(side.some(p => p[2] === '>') && side.some(p => p[2] === '-'), 'glyphs re-orient with the heading');
  assert.notDeepEqual(draw('projectile', 0.3, 0.1), shaft, 'glint and wake move during flight');
  assert.ok(draw('projectile', 0.3, 0).length < shaft.length, 'harpoon extends out of the muzzle');
});

// Progress points where at least `jump` plotted glyphs appear at once: a fresh
// muzzle burst is the only part of the cast that pops in that many together.
function burstOnsets(jump = 12, step = 0.0005) {
  const onsets = [];
  let prev = draw('cast', 0).length;
  if (prev >= jump) onsets.push(0);
  for (let p = step; p < 1; p += step) {
    const now = draw('cast', p).length;
    if (now - prev >= jump) onsets.push(p);
    prev = now;
  }
  return onsets;
}

test('Hailpiercer cast draws a frost sigil, fires one muzzle burst per launch, then recharges and shatters', () => {
  const ring = p => draw('cast', p).filter(q => '-/\\|'.includes(q[2])
    && Math.hypot(q[0], q[1]) > 0.85 && Math.hypot(q[0], q[1]) < 1.05).length;
  assert.ok(ring(0.02) < ring(0.25) / 2, 'sigil is drawn around the caster rather than popping in');
  const shots = LAUNCHES.map(t => t / presentation.duration), step = 0.0005;
  const onsets = burstOnsets(12, step);
  assert.equal(onsets.length, LAUNCHES.length, `one muzzle burst per harpoon (${onsets.map(p => (p * presentation.duration).toFixed(3))})`);
  onsets.forEach((p, i) => assert.ok(Math.abs(p - shots[i]) <= step + 1e-9, `burst ${i + 1} at launch ${LAUNCHES[i]}s`));
  for (const s of shots.slice(1)) {
    assert.ok(draw('cast', s + 0.002).some(p => isWhite(p[3]) && '#*+'.includes(p[2])), 'each launch recoils the crystal white');
  }
  const after = shots.at(-1) + 0.07;
  assert.ok(!draw('cast', after).some(p => isWhite(p[3]) && '#*+'.includes(p[2])), 'no recoil once the last harpoon has left');
  assert.ok(draw('cast', 0.6).some(p => '#*+'.includes(p[2])), 'crystal holds above the sigil');
  assert.ok(draw('cast', 0.6).filter(p => p[2] === '#').length > draw('cast', after).filter(p => p[2] === '#').length,
    'emptied crystal refills from the inhaled hail');
  assert.ok(!draw('cast', 0.95).some(p => p[2] === '#'), 'crystal is spent after it shatters');
  assert.ok(draw('cast', 0.97).length < draw('cast', 0.5).length / 2, 'everything thins out at the end');
  assert.notDeepEqual(draw('cast', 0.1), draw('cast', 0.6));
});

test('Hailpiercer muzzle bursts follow the definition and the runtime launch schedule', () => {
  // Derive the schedule from the definition the way the runtime reads it:
  // one run plus `repeat` repeats, `repeatinterval` ticks apart (default 1).
  const step = spell.nodes.temp_hailpiercer_cast.steps.find(s => s.op === 'skill' && s.args.s === 'TEMP_Hailpiercer_PRO');
  const repeat = Number(step.args.repeat), ticks = Number(step.args.repeatinterval ?? 1);
  const expected = Array.from({ length: repeat + 1 }, (_, i) => i * ticks / 20);
  assert.equal(LAUNCHES.length, expected.length);
  LAUNCHES.forEach((t, i) => assert.ok(Math.abs(t - expected[i]) < 1e-9, `launch ${i + 1}: ${t} vs ${expected[i]}`));

  // Record when a real cast actually launches harpoons, with a fine time step.
  const scene = runeScene(spell), launched = [], t0 = scene.casting.time;
  const launch = scene.casting.launch.bind(scene.casting);
  scene.casting.launch = (...args) => { launched.push(scene.casting.time - t0); return launch(...args); };
  assert.equal(scene.cast().ok, true);
  for (let i = 0; i < 1000; i++) scene.casting.update(0.001);
  assert.equal(launched.length, LAUNCHES.length, `runtime launches ${launched.map(t => t.toFixed(3))}`);
  launched.forEach((t, i) => assert.ok(Math.abs(t - LAUNCHES[i]) <= 0.0011, `harpoon ${i + 1} at ${t.toFixed(4)}s, burst at ${LAUNCHES[i]}s`));
  assert.ok(LAUNCHES.at(-1) < presentation.duration, 'every launch happens while the cast effect is up');
});

test('Hailpiercer impact punches through with a white flash, exit spray and a spreading ring', () => {
  const life = 0.6, at = p => draw('impact', p, p * life, { life });
  const early = at(0.02), mid = at(0.4);
  assert.ok(early.some(p => p[2] === '@' && isWhite(p[3])), 'white impact star');
  assert.ok(early.some(p => p[2] === 'v'), 'streak drives through the target');
  assert.ok(!mid.some(p => p[2] === '@'), 'flash is brief');
  const reach = points => Math.max(...points.filter(p => p[1] > 0).map(p => Math.hypot(p[0], p[1])));
  assert.ok(reach(mid) > reach(at(0.08)) * 1.5, 'shards spray out of the far side');
  const centre = points => points.reduce((s, p) => s + p[1] * p[4], 0) / points.reduce((s, p) => s + p[4], 0);
  assert.ok(centre(at(0.7)) > centre(at(0.08)) + 0.2, 'debris carries forward out of the exit wound');
  assert.ok(brightest(at(0.9)) < brightest(early) * 0.2, 'impact cools and fades');
});

test('Hailpiercer ground summons erupt as a crown of ice spears that crumble; hit flecks are small snowflakes', () => {
  const at = p => draw('pulse', p, p * 0.6, { radius: 2, life: 0.6 });
  const tips = points => points.filter(p => p[2] === '^');
  assert.equal(tips(at(0)).length, 0, 'nothing stands before the eruption');
  assert.ok(tips(at(0.35)).length >= 5, 'a crown of spears stands');
  const height = points => Math.max(...tips(points).map(p => Math.hypot(p[0], p[1])));
  assert.ok(height(at(0.35)) > height(at(0.06)), 'spears rise');
  assert.ok(lit(at(0.9)).length < lit(at(0.35)).length / 2, 'spears crumble away');
  assert.ok(at(0.8).some(p => p[2] === "'" || p[2] === ','), 'falling shards');
  assert.notDeepEqual(at(0.4), at(0.5), 'a glint slides up the standing spears');
  const flake = draw('pulse', 0.2, 0.06, { radius: 0.6, life: 0.3 });
  assert.ok(flake.length <= 30 && flake.some(p => p[2] === '*' || p[2] === '+'), 'small six-armed snowflake for hits');
});

test('every Hailpiercer stage is deterministic, bounded, and fades completely', () => {
  const cases = [['cast'], ['projectile', { radius: 0.65 }], ['impact', { life: 0.6 }], ['pulse', { radius: 2, life: 0.6 }],
    ['pulse', { radius: 0.6, life: 0.3 }], ['pulse', { radius: 3 }], ['aura', { life: 1.5 }], ['zone', { radius: 1, life: 0.05 }],
    ['zone', { radius: 3, life: 2 }], ['impact'], ['aura'], ['zone']];
  for (const [stage, opts = {}] of cases) {
    for (const heading of [0, 1.1, -2.4]) {
      for (let i = 0; i <= 40; i++) {
        const progress = i / 40, life = opts.life ?? presentation.duration, o = { ...opts, heading };
        const points = draw(stage, progress, progress * life, o);
        assert.deepEqual(points, draw(stage, progress, progress * life, o));
        const budget = stage === 'projectile' ? 110 : stage === 'pulse' ? 130 : 160;
        assert.ok(points.length <= budget, `${stage} budget ${points.length}`);
        for (const [x, z, char, color, brightness] of points) {
          assert.ok([x, z, brightness, ...color].every(Number.isFinite));
          assert.ok(Math.abs(x) < 6 && Math.abs(z) < 6);
          assert.match(char, /^[\x20-\x7e]$/);
          assert.ok(color.every(c => c >= 0 && c <= 255));
          assert.ok(brightness >= 0 && brightness <= 1);
        }
        if (progress === 1) assert.ok(points.every(p => p[4] === 0), `${stage} fully faded`);
        if (progress > 0.1 && progress < 0.6) assert.ok(lit(points).length > 0, `${stage} visible mid-life`);
      }
    }
  }
});

test('Hailpiercer sound pairs a low twang/high whizz with a pinpoint strike and diminishing rattle', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.kind === 'tone' && v.frequency < 300 && v.endFrequency < v.frequency));
  assert.ok(cast.some(v => v.kind === 'tone' && v.frequency > 2000 && v.endFrequency > v.frequency));
  assert.ok(cast.some(v => v.kind === 'noise' && v.filterType === 'highpass'));
  assert.ok(impact.some(v => (v.delay ?? 0) === 0 && v.duration < 0.08), 'short pinpoint attack');
  const rattle = impact.filter(v => v.kind === 'noise' && v.delay > 0);
  assert.equal(rattle.length, 3);
  assert.ok(rattle.every((v, i) => !i || (v.delay > rattle[i - 1].delay && v.gain < rattle[i - 1].gain)), 'separate diminishing rattle grains');
  assert.ok(pulse.every(v => v.gain <= 0.025 && v.duration <= 0.08));
  for (const recipe of Object.values(presentation.sounds)) {
    assert.ok(recipe.length <= 8);
    assert.ok(recipe.every(v => v.gain <= 0.25 && v.duration <= 2.5 && (v.delay ?? 0) <= 2));
  }
  for (const stage of ['cast', 'impact', 'pulse']) {
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 3, y: 5 });
    assert.equal(handles.length, presentation.sounds[stage].length);
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 3 && r.y === 5));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(handle => handle.stop());
  }
});

test('real Hailpiercer casts use the authored profile and spell cues while preserving the delayed damage', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'second cast is rejected while charging');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  const launch = [];
  scene.casting.effects.paint((...p) => launch.push(p), scene.casting.projectiles);
  assert.ok(launch.some(p => p[2] === 'v') && launch.some(p => p[2] === '|'), 'runtime renders the authored sigil');
  scene.advance(0.3);
  const volley = [];
  scene.casting.effects.paint((...p) => volley.push(p), scene.casting.projectiles);
  assert.ok(scene.casting.projectiles.length > 0 && volley.some(p => p[2] === 'v'), 'harpoons fly toward the foe');
  scene.advance(0.2);
  assert.equal(scene.foe.health, 100, 'charge delay is preserved');
  scene.advance(4);
  assert.ok(scene.monsters.events.some(e => e.type === 'hurt' && e.amount === 20));
  const cues = events.filter(e => e.type === 'spell');
  assert.ok(cues.some(e => e.stage === 'impact'));
  assert.ok(cues.every(e => e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)), 'spell never uses sword cues');
});
