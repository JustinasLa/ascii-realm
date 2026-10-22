import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/hand-cure.js';
import presentation from '../../src/spells/presentations/hand-cure.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

const LIFE = { cast: presentation.duration, impact: 0.6, pulse: 0.25, aura: 1.5, zone: 4, projectile: 1 };

function points(stage, progress = 0.25, radius = 1, heading = 0) {
  const result = [];
  presentation.draw(Object.freeze({ stage, progress, age: progress * LIFE[stage], life: LIFE[stage], radius, heading }), (...p) => result.push(p));
  return result;
}

// Screen cells through the real adapter: columns grow right, rows grow down.
function cells(stage, progress, heading = 0, radius = 1) {
  const result = [];
  paintPresentation(presentation, { x: 0, y: 0, stage, age: progress * LIFE[stage], life: LIFE[stage], radius, heading },
    (x, y, char, color, brightness) => { if (brightness > 0.05) result.push({ x, y, col: Math.floor(x), row: Math.floor(y), char, color, brightness }); });
  return result;
}
const GLOW_CHARS = '.,:;+*#@';
const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;

test('Hand Cure cast forms an upright hand of light beside the caster', () => {
  assert.equal(spell.presentation, presentation);
  const hand = cells('cast', 0.5), tips = hand.filter(c => c.char === '_');
  assert.equal(tips.length, 5, 'four fingertips and a thumb are capped');
  assert.equal(new Set(tips.map(c => c.col)).size, 5);
  const middle = tips.reduce((top, c) => (c.row < top.row ? c : top));
  assert.ok(tips.every(c => c === middle || c.row > middle.row), 'the middle finger is the tallest');
  const thumb = tips.reduce((right, c) => (c.col > right.col ? c : right));
  assert.ok(thumb.row - middle.row >= 4, 'the thumb sits lower and further out than the fingers');
  assert.ok(hand.filter(c => c.char === '|').length >= 20, 'finger and palm walls are drawn as solid strokes');
  assert.ok(tips.every(c => c.col > 8 && c.row < -8), 'the hand is raised beside the caster rather than on its feet');
  // Facing left mirrors the hand to the caster's left, thumb still outward.
  const left = cells('cast', 0.5, -1.5).filter(c => c.char === '_');
  assert.equal(left.length, 5);
  assert.ok(left.every(c => c.col < -8));
  assert.ok(left.reduce((a, c) => (c.col < a.col ? c : a)).row - middle.row >= 4);
});

test('Hand Cure cast traces light from the wrist up, glows, then lifts away', () => {
  const top = list => Math.min(...list.filter(c => '|_/\\'.includes(c.char)).map(c => c.row));
  const early = cells('cast', 0.12), full = cells('cast', 0.5);
  assert.ok(early.filter(c => c.char === '_').length < 5, 'fingertips are not lit before the light reaches them');
  assert.ok(top(early) > top(full), 'the outline is revealed from the wrist upward');
  assert.equal(cells('cast', 0).length, 0, 'nothing pops in on the first frame');
  const core = glyphs => glyphs.filter(c => '#@'.includes(c.char) && Math.abs(c.col - 19) <= 5 && Math.abs(c.row + 13) <= 4);
  assert.equal(core(cells('cast', 0.15)).length, 0, 'the palm is still dim during the wind-up');
  assert.ok(core(cells('cast', 0.42)).length >= 3, 'the palm flashes at the peak of the gesture');
  // Leaf motes spiral inward during the wind-up.
  const motes = progress => cells('cast', progress).filter(c => c.char === "'" && Math.abs(c.col - 19) > 10)
    .map(c => Math.hypot((c.x - 19) * 0.6, c.y + 15));
  assert.ok(motes(0.1).length >= 4);
  const late = cells('cast', 0.85);
  assert.equal(late.filter(c => c.char === '_' || c.char === '|').length, 0, 'the outline has dissolved by the end');
  assert.ok(late.length > 10, 'motes remain as the hand lifts away');
  assert.ok(mean(late.map(c => c.row)) < mean(full.map(c => c.row)), 'dissolving light drifts upward');
  for (const p of points('cast', 1)) assert.equal(p[4], 0);
});

test('Hand Cure palm and outline cells fade to black before they disappear', () => {
  // Track every lit cell across fine steps of the glow and dissolve: whatever is
  // still visibly lit must be found, nearly as bright, in the very next frame.
  // (Starts after the hand's last one-row settle at progress 0.148.)
  const step = 4e-4, index = list => {
    const map = new Map();
    for (const c of list) { const key = `${c.col},${c.row}`; (map.get(key) ?? map.set(key, []).get(key)).push(c); }
    return map;
  };
  let previous = cells('cast', 0.16), checked = 0;
  for (let progress = 0.16 + step; progress < 0.98; progress += step) {
    const current = cells('cast', progress), near = index(current);
    for (const c of previous) {
      if (c.brightness < 0.08) continue;
      checked++;
      const found = [-1, 0, 1].some(dc => [-1, 0, 1].some(dr => (near.get(`${c.col + dc},${c.row + dr}`) ?? [])
        .some(n => Math.abs(n.x - c.x) < 0.5 && Math.abs(n.y - c.y) < 0.5 && n.brightness >= c.brightness - 0.06)));
      assert.ok(found, `'${c.char}' at ${c.col},${c.row} (brightness ${c.brightness.toFixed(3)}) pops out at progress ${progress.toFixed(4)}`);
    }
    previous = current;
  }
  assert.ok(checked > 5000);
  // The palm's last cells are dim specks just before they go.
  const palm = progress => cells('cast', progress).filter(c => GLOW_CHARS.includes(c.char) && Math.abs(c.col - 19) <= 4 && Math.abs(c.row + 13) <= 6);
  assert.ok(palm(0.5).length > palm(0.8).length, 'the palm thins out as it dissolves');
});

test('Hand Cure art stays upright for every heading', () => {
  const round = v => Math.round(v * 1e4) / 1e4 || 0;
  const key = list => list.map(c => `${c.char}${round(c.x)},${round(c.y)}`).join(' ');
  for (const stage of ['impact', 'pulse']) {
    assert.equal(key(cells(stage, 0.3, 2.4)), key(cells(stage, 0.3, 0)), `${stage} ignores facing`);
  }
  assert.equal(key(cells('cast', 0.45, 1.1)), key(cells('cast', 0.45, 0)), 'rightward casts share one upright hand');
});

test('Hand Cure impact blooms a healing cross, sprouts a ring of tufts and lifts sparks', () => {
  const flash = cells('impact', 0.04);
  assert.ok(flash.some(c => c.char === '@'), 'the cross core flashes white on contact');
  assert.ok(flash.some(c => c.char === '\\') && flash.some(c => c.char === '/'), 'diagonal rays snap outward');
  const bloom = cells('impact', 0.25), core = bloom.find(c => c.char === '#');
  assert.ok(core && Math.abs(core.col) <= 1 && core.row < -10, 'the cross sits at the ally\'s chest');
  const bar = bloom.filter(c => c.row === core.row && '=-'.includes(c.char));
  assert.ok(bar.some(c => c.col < -4) && bar.some(c => c.col > 4), 'horizontal arm reaches both sides');
  const post = bloom.filter(c => c.col === core.col && '|:'.includes(c.char));
  assert.ok(post.some(c => c.row < core.row - 2) && post.some(c => c.row > core.row + 2), 'vertical arm reaches above and below');
  assert.ok(cells('impact', 0.6).find(c => c.char === '#').row < core.row, 'the cross lifts as it fades');
  const tufts = progress => cells('impact', progress).filter(c => c.row > -8 && c.char === '|' && Math.abs(c.col) > 10);
  assert.ok(tufts(0.3).length >= 9, 'grass stems sprout around the feet');
  assert.ok(tufts(0.3).some(c => c.col < 0) && tufts(0.3).some(c => c.col > 0));
  assert.equal(tufts(0.95).length, 0, 'the tufts wilt away');
  const high = progress => cells('impact', progress).filter(c => '*+\'.'.includes(c.char) && c.row < -14).length;
  assert.ok(high(0.6) > high(0.1), 'sparks rise from the ground through the ally');
});

test('Hand Cure pulse is a crisp expanding contact ring', () => {
  const rim = progress => cells('pulse', progress).filter(c => '()-/\\'.includes(c.char));
  const width = list => Math.max(...list.map(c => Math.abs(c.x)));
  assert.ok(width(rim(0.6)) > width(rim(0.1)) * 1.5, 'the rim expands');
  const ring = rim(0.5);
  assert.ok(ring.some(c => c.char === ')' && c.x > 0) && ring.some(c => c.char === '(' && c.x < 0), 'side glyphs follow the ellipse');
  assert.ok(ring.some(c => c.char === '-' && c.y < 0) && ring.some(c => c.char === '-' && c.y > 0));
  assert.ok(mean(rim(0.8).map(c => c.brightness)) < mean(rim(0.1).map(c => c.brightness)), 'the ring dims as it spreads');
});

test('all Hand Cure stages are deterministic, bounded, animated, and fully faded at their end', () => {
  const budget = { cast: 200, impact: 160, pulse: 90, aura: 160, zone: 160, projectile: 110 };
  for (const stage of Object.keys(budget)) {
    for (const progress of [0, 0.1, 0.25, 0.45, 0.7, 0.9, 1]) for (const radius of [1, 40]) for (const heading of [0, 2]) {
      const draw = points(stage, progress, radius, heading);
      assert.ok(draw.length <= budget[stage], `${stage} stays within its glyph budget`);
      assert.deepEqual(draw, points(stage, progress, radius, heading), 'profile uses no random state');
      for (const [x, z, char, color, brightness] of draw) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 6 && Math.abs(z) < 6);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(v => v >= 0 && v <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0);
      }
    }
    assert.ok(points(stage, 0.45).length > 10, `${stage} draws a substantial shape`);
    assert.notDeepEqual(points(stage, 0.1), points(stage, 0.6), `${stage} evolves over time`);
  }
});

test('Hand Cure motion is smooth between neighbouring frames', () => {
  // Glyphs fade in and out rather than popping, so the light-weighted centre of
  // each stage glides by at most a few cells per 60 fps frame.
  for (const stage of ['cast', 'impact', 'pulse']) {
    const step = 1 / 60 / LIFE[stage];
    let previous = null;
    for (let progress = 0.02; progress < 0.98; progress += step) {
      const lit = cells(stage, progress), weight = lit.reduce((sum, c) => sum + c.brightness, 0);
      const centre = [lit.reduce((sum, c) => sum + c.x * c.brightness, 0) / weight, lit.reduce((sum, c) => sum + c.y * c.brightness, 0) / weight];
      if (weight < 4) { previous = null; continue; }
      if (previous) assert.ok(Math.hypot(centre[0] - previous[0], centre[1] - previous[1]) < 3.5,
        `${stage} jumps at progress ${progress.toFixed(3)}`);
      previous = centre;
    }
  }
});

test('Hand Cure layers close cloth and liquid recordings with a subdued contact pulse', async () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.url.endsWith('/cloth-sweep.wav') && v.delay === 0), 'the sleeve begins the hand gesture');
  assert.ok(cast.some(v => v.url.endsWith('/water-touch.wav') && v.delay > 0), 'liquid follows the palm gesture');
  assert.ok(impact.some(v => v.url.endsWith('/water-touch.wav') && v.delay < 0.05), 'liquid contact lands promptly');
  assert.ok(impact.some(v => v.url.endsWith('/cloth-breath.wav')), 'soft cloth keeps contact intimate');
  assert.equal(pulse.length, 1, 'repeated rings carry only one soft detail');
  assert.ok(pulse.reduce((sum, v) => sum + v.gain, 0) <= 0.3);
  for (const voices of [cast, impact, pulse]) {
    assert.ok(voices.length >= 1 && voices.length <= 4);
    assert.ok(voices.reduce((sum, v) => sum + v.gain, 0) <= 1.2);
    for (const voice of voices) {
      assert.equal(voice.kind, 'recording');
      assert.match(voice.url, /^\/assets\/audio\/spells\/cerrith\/(cloth|water)-[a-z]+\.wav$/);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.gain >= 0.1 && voice.gain <= 0.8);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
    }
  }
  const fake = fakeRecordedAudio();
  assert.equal(await prepareRecordedSpellTest(fake, presentation), true, 'all authored WAV files load');
  for (const stage of ['cast', 'impact', 'pulse']) {
    const before = fake.nodes.length;
    const handles = playSpellSound(fake.engine, { presentation, stage, x: 0, y: 0 });
    const sources = fake.nodes.slice(before).filter(n => n.kind === 'source');
    assert.equal(sources.length, presentation.sounds[stage].length);
    assert.ok(sources.every(n => n.buffer.duration > 0 && n.buffer.duration < 0.8), 'short close recordings keep this distinct from a flying orb');
    for (const source of sources) assert.equal(source.loop, false);
    for (const handle of handles) handle.stop();
  }
  assert.ok(!fake.nodes.some(n => n.kind === 'oscillator'));
});

test('real Hand Cure cast heals unchanged and routes authored profiles and typed spatial sound cues', async () => {
  const scene = runeScene(spell, { range: 12, allyInPath: true, allyRange: 1 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.ally.vitals.health, 38);
  assert.equal(scene.casting.mana, 94);
  scene.advance(0.05);
  assert.equal(scene.player.magicSpeed, 0);
  assert.equal(scene.ally.magicSpeed, 0);
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'cast' && e.x === scene.player.x && e.y === scene.player.y));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'impact' && e.x === scene.ally.x && e.y === scene.ally.y), 'healing cross appears on the ally');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === 'hand-cure' && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  const before = events.length;
  assert.equal(scene.castWithoutMana().ok, false);
  assert.equal(events.length, before, 'mana rejection has no new sound');
  const rendered = [], expected = [];
  scene.casting.effects.paint((...p) => rendered.push(p));
  for (const effect of scene.casting.effects.list) {
    assert.equal(effect.presentation, presentation);
    paintPresentation(presentation, effect, (...p) => expected.push(p));
  }
  assert.ok(rendered.some(p => p[2] === "'") && rendered.some(p => p[2] === '@'), 'gathering motes and the cross flash are on screen');
  assert.deepEqual(rendered, expected, 'runtime effect stream actually calls the Hand Cure profile');
  const fake = fakeRecordedAudio(), handles = [];
  assert.equal(await prepareRecordedSpellTest(fake, presentation), true);
  for (const event of events) handles.push(...playSpellSound(fake.engine, event));
  assert.equal(handles.length, events.reduce((sum, e) => sum + presentation.sounds[e.stage].length, 0));
  assert.ok(fake.routes.every(r => r.bus === 'sfx'));
  assert.ok(fake.routes.some(r => r.x === scene.ally.x && r.y === scene.ally.y));
  assert.ok(fake.nodes.some(n => n.kind === 'source' && n.starts[0] > fake.context.currentTime));
  assert.deepEqual(fake.invalid, []);
  for (const handle of handles) handle.stop();
  assert.ok(fake.routes.every(r => r.disposals === 1));
  scene.advance(1.2);
  assert.equal(scene.player.magicSpeed, 1);
  assert.equal(scene.ally.magicSpeed, 1);
  assert.equal(scene.casting.effects.list.length, 0);
});
