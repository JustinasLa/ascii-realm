import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/blessing-of-swiftness.js';
import spell from '../../src/spells/definitions/blessing-of-swiftness.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

// Lives and radii match how gameplay presents each stage.
const LIVES = { cast: presentation.duration, impact: presentation.duration, aura: 0.3, pulse: 0.25, zone: 4, projectile: 1 };
const RADII = { cast: 0.8, impact: 1, aura: 1, pulse: 1, zone: 1.5, projectile: 1 };
const BUDGET = { cast: 230, impact: 230, aura: 140, pulse: 90, zone: 150, projectile: 110 };

function draw(stage, progress = 0.3, heading = 0) {
  const points = [], life = LIVES[stage];
  presentation.draw({ stage, age: progress * life, life, progress, radius: RADII[stage], heading },
    (x, z, char, color, brightness = 1) => points.push([x, z, char, color, brightness]));
  return points;
}
const lit = points => points.filter(p => p[4] > 0.05);
const total = points => points.reduce((sum, p) => sum + p[4], 0);
const LINES = /^[-|/\\=]$/;

test('the cast gathers a spiralling gust into a bright seed before the leaves open', () => {
  const gather = lit(draw('cast', 0.2)), seed = lit(draw('cast', 0.33));
  assert.ok(gather.length >= 16, 'wind arms are visible during the wind-up');
  assert.ok(gather.every(p => !['>', '<', 'v', '^'].includes(p[2])), 'no leaf tips before the seed opens');
  const meanRadius = points => points.reduce((s, p) => s + Math.hypot(p[0], p[1]), 0) / points.length;
  assert.ok(meanRadius(lit(draw('cast', 0.08))) > meanRadius(gather) + 0.2, 'the gust spirals inward');
  assert.ok(gather.filter(p => LINES.test(p[2])).length >= gather.length / 2, 'arms are drawn as oriented strokes');
  const core = seed.filter(p => Math.hypot(p[0], p[1]) < 0.05);
  assert.ok(core.some(p => p[2] === '@' && p[4] > 0.6), 'a bright seed flashes at the feet');
  assert.ok(core.some(p => p[3].every(c => c > 220)), 'the seed flashes near white');
});

test('cast and impact open two veined leaves into a forward arrowhead with speed lines', () => {
  for (const stage of ['cast', 'impact']) {
    const open = lit(draw(stage, 0.62));
    // Each swept-back leaf keeps a bright diagonal midrib from its stem to its tip.
    const ribs = open.filter(p => (p[2] === '/' || p[2] === '\\') && p[4] > 0.65 && Math.abs(p[0]) > 0.1 && Math.abs(p[0]) < 0.8 && p[1] < 0.3);
    assert.ok(ribs.filter(p => p[0] < 0).length >= 4 && ribs.filter(p => p[0] > 0).length >= 4, `${stage}: both leaves keep a midrib`);
    assert.ok(ribs.filter(p => p[0] < 0).every(p => p[2] === '\\') && ribs.filter(p => p[0] > 0).every(p => p[2] === '/'),
      `${stage}: midribs slant back along each leaf`);
    const tips = open.filter(p => p[2] === '<' || p[2] === '>');
    assert.ok(tips.some(p => p[0] < -0.3) && tips.some(p => p[0] > 0.3), `${stage}: leaf tips spread to both sides`);
    const tipZ = Math.max(...tips.filter(p => Math.abs(p[0]) > 0.3 && Math.abs(p[0]) < 1).map(p => p[1]));
    const bases = open.filter(p => Math.abs(p[0]) < 0.06 && LINES.test(p[2]));
    assert.ok(bases.some(p => p[1] > tipZ + 0.2), `${stage}: the leaf bases lead the swept-back tips`);
    assert.ok(open.filter(p => p[2] === ':' || p[2] === '.').length >= 6, `${stage}: leaves are filled, not just outlined`);
    assert.ok(open.filter(p => p[2] === '|' && Math.abs(p[0]) > 0.6).length >= 4, `${stage}: speed lines rush past`);
    assert.ok(open.some(p => ["'", ',', '*'].includes(p[2])), `${stage}: petals are flicked away`);
  }
  const stems = points => lit(points).filter(p => Math.abs(p[0]) < 0.06 && LINES.test(p[2]));
  const lead = points => Math.max(...stems(points).map(p => p[1]));
  assert.ok(lead(draw('cast', 0.9)) > lead(draw('cast', 0.6)), 'the arrowhead strides forward as it fades');
  assert.ok(total(draw('cast', 0.9)) < total(draw('cast', 0.6)) * 0.6, 'follow-through thins out');
  assert.ok(lit(draw('impact', 0.15)).some(p => p[2] === '@'), 'impact reaches its seed sooner than the cast');
  assert.ok(!lit(draw('cast', 0.15)).some(p => p[2] === '@'));
});

test('stroke and arrow glyphs follow the on-screen heading', () => {
  const arrows = heading => draw('impact', 0.6, heading).filter(p => /^[<>^v]$/.test(p[2])).map(p => p[2]);
  assert.notDeepEqual(arrows(0), arrows(Math.PI / 2));
  const flat = heading => draw('impact', 0.6, heading).filter(p => p[2] === '-' || p[2] === '=').length;
  assert.ok(flat(Math.PI / 2) > flat(0), 'speed lines lie flat when heading sideways');
});

test('draw is stateless when another heading draws from inside plot', () => {
  for (const stage of ['cast', 'impact', 'aura', 'pulse', 'zone', 'projectile']) {
    const life = LIVES[stage], effect = { stage, age: 0.6 * life, life, progress: 0.6, radius: RADII[stage], heading: 0.4 };
    const solo = [], nested = [];
    presentation.draw(effect, (...p) => solo.push(p));
    let first = true;
    presentation.draw(effect, (...p) => {
      if (first) {
        first = false;
        presentation.draw({ ...effect, heading: 2.1 }, () => {});
      }
      nested.push(p);
    });
    assert.deepEqual(nested, solo, `${stage}: an interleaved draw at another heading leaves the outer draw unchanged`);
  }
});

test('the aura winds a tightening gust around the feet and sends chevrons ahead', () => {
  const early = lit(draw('aura', 0.2)), late = lit(draw('aura', 0.5));
  const gust = points => points.filter(p => Math.hypot(p[0], p[1]) > 0.45 && (p[2] === '~' || LINES.test(p[2])) && p[1] < 0.5);
  const reach = points => gust(points).reduce((s, p, _, a) => s + Math.hypot(p[0], p[1]) / a.length, 0);
  assert.ok(gust(early).length >= 8, 'gust ribbons circle the feet');
  assert.ok(reach(late) < reach(early), 'the gust tightens around the blessed');
  const chevrons = late.filter(p => p[2] === 'v' && Math.abs(p[0]) < 0.01);
  assert.ok(chevrons.length >= 1 && chevrons.every(p => p[1] > 0.5), 'chevron tips point ahead of the feet');
  assert.ok(late.filter(p => p[2] === '\\' && p[0] < 0 && p[1] > 0.3).length >= 2, 'chevrons have swept arms');
  assert.ok(late.filter(p => p[2] === '|' && Math.abs(p[0]) < 0.3).length >= 2, 'a small leaf pair opens at the feet');
});

test('the pulse bursts outward, the zone circles and the projectile trails wind', () => {
  const reach = points => Math.max(...lit(points).map(p => Math.hypot(p[0], p[1])));
  assert.ok(reach(draw('pulse', 0.6)) > reach(draw('pulse', 0.1)) + 0.4, 'pulse rays shoot outward');
  assert.ok(draw('pulse', 0.05).some(p => p[2] === '*' && p[4] > 0.8), 'pulse opens on a flash');
  const zone = lit(draw('zone', 0.5));
  assert.ok(zone.filter(p => /^[<>^v]$/.test(p[2])).length >= 4, 'leaves and gust heads ride the zone');
  assert.notDeepEqual(draw('zone', 0.4), draw('zone', 0.45), 'the zone keeps circling');
  const dart = lit(draw('projectile', 0.4));
  assert.ok(Math.max(...dart.map(p => Math.abs(p[0]))) < 0.75, 'the travelling leaf pair stays compact');
  assert.ok(dart.filter(p => p[1] < -0.3).length >= 12, 'wind and petals trail behind');
  assert.ok(dart.some(p => p[1] > 0.15), 'leaf bases lead the dart');
});

test('all Swiftness stages animate deterministically, stay bounded and fade cleanly', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    const samples = [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95, 1].map(p => draw(stage, p));
    assert.notDeepEqual(samples[2], samples[4], `${stage} moves over its lifetime`);
    assert.deepEqual(draw(stage, 0.5), draw(stage, 0.5), `${stage} is deterministic`);
    assert.ok(Math.max(...samples.map(s => lit(s).length)) > 10, `${stage} shows something`);
    for (const points of samples) {
      assert.ok(points.length <= BUDGET[stage], `${stage} stays within ${BUDGET[stage]} glyphs (${points.length})`);
      for (const [x, z, char, color, brightness] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 4 && Math.abs(z) < 4);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.length === 3 && color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
      }
    }
    assert.ok(samples.at(-1).every(p => p[4] === 0), `${stage} disappears at expiry`);
    assert.ok(total(samples.at(-2)) < Math.max(...samples.map(total)) * 0.6, `${stage} fades out rather than popping`);
    for (let i = 0; i < 60; i++) {
      const a = total(draw(stage, i / 60)), b = total(draw(stage, (i + 0.5) / 60));
      assert.ok(Math.abs(a - b) < Math.max(12, a * 0.35), `${stage} has no brightness pop near ${(i / 60).toFixed(2)}`);
    }
  }
});

test('Swiftness plays a quick woody arpeggio with a brush and a high finishing ping', () => {
  const cast = presentation.sounds.cast, impact = presentation.sounds.impact;
  const wood = cast.filter(s => s.kind === 'tone' && s.type === 'triangle');
  assert.equal(wood.length, 3);
  assert.ok(wood.every((s, i) => !i || s.frequency > wood[i - 1].frequency));
  assert.ok(wood.every((s, i) => !i || s.delay > (wood[i - 1].delay ?? 0)));
  assert.ok(wood.every(s => s.attack <= 0.003 && s.duration < 0.1 && s.cutoff <= 2000), 'short filtered plucks make the woody attack');
  assert.ok(cast.some(s => s.kind === 'noise' && s.attack > 0.04), 'wind brushes in beneath the plucks');
  const ping = cast.find(s => s.type === 'sine');
  assert.ok(ping.frequency > wood.at(-1).frequency && ping.delay > wood.at(-1).delay);
  assert.notDeepEqual(cast, impact);
  assert.ok(presentation.sounds.pulse.every(s => s.duration <= 0.1 && s.gain < 0.02));
  for (const [stage, recipe] of Object.entries(presentation.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    for (const voice of recipe) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { presentation, stage, x: 2, y: 4 });
    assert.equal(handles.length, recipe.length);
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 4));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(h => h.stop());
  }
});

test('real Swiftness casts render the profile and emit typed cues without changing the blessing', () => {
  const scene = runeScene(spell, { range: 12, allyInPath: true, allyRange: 1 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const acceptedEvents = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, acceptedEvents, 'cooldown rejection is silent');
  assert.equal(scene.casting.mana, 94);
  scene.advance(0.1);
  const dots = [];
  scene.casting.effects.paint((...p) => dots.push(p), scene.casting.projectiles);
  assert.ok(dots.some(p => p[2] === '~') && dots.some(p => LINES.test(p[2])), 'runtime paints authored gusts and strokes');
  assert.ok(dots.some(p => p[3][1] > p[3][0] && p[3][1] > p[3][2] && p[4] > 0.3), 'runtime paints lit cerrith greens');
  assert.equal(scene.ally.magicSpeed, 0, 'the source root still applies');
  scene.advance(1.2);
  assert.equal(scene.ally.magicSpeed, 1.4, 'the source grants Speed II');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  scene.advance(6);
  assert.equal(scene.ally.magicSpeed, 1, 'the six-second blessing still expires');
});
