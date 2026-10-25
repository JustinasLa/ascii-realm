import assert from 'node:assert/strict';
import test from 'node:test';
import presentation, { RING_LIFE, RING_RADIUS } from '../../src/spells/presentations/ring-of-fire.js';
import spell from '../../src/spells/definitions/ring-of-fire.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

const LIFT = 5 / 6.5;
const LIVES = { cast: presentation.duration, zone: RING_LIFE, impact: 0.6, pulse: 5, aura: 1.5, projectile: 1 };
function draw(stage, age, overrides = {}) {
  const points = [], glows = [];
  const life = overrides.life ?? LIVES[stage];
  const effect = Object.freeze({ stage, age, life, progress: Math.min(1, age / life), radius: RING_RADIUS, heading: 0,
    x: 40, y: 12, seed: 17, vx: 0, vy: 0, shape: stage === 'pulse' ? 'scorch' : 'burst', ...overrides });
  presentation.draw(effect, (x, z, char, color, brightness = 1, unlit = false) => points.push({ x, z, char, color, brightness, ...unlit && { unlit } }),
    (x, z, k, reach) => glows.push({ x, z, k, reach }));
  return { points, glows };
}
const lit = points => points.filter(p => p.brightness > 0.05);
const BAND = '+o%&@';
const band = points => points.filter(p => BAND.includes(p.char));
const radius = p => Math.hypot(p.x, p.z);
const bins = points => {
  const filled = new Set(points.map(p => Math.floor((Math.atan2(p.x, p.z) + Math.PI) / (2 * Math.PI) * 64) % 64));
  return [...Array(64).keys()].filter(i => !filled.has(i));
};
const warm = color => color[0] >= color[1] && color[1] >= color[2];
const screen = (stage, age, heading, extra = {}) => {
  const cells = [];
  paintPresentation(presentation, { x: 0, y: 0, stage, age, life: LIVES[stage], radius: RING_RADIUS, heading, seed: 5, ...extra },
    (x, y, char) => cells.push(`${Math.round(x * 1e6)},${Math.round(y * 1e6)},${char}`));
  return cells;
};

test('every stage is finite, printable ASCII, bounded and deterministic at any size and heading', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.keepScenery, true, 'flames pass behind fine-grid scenery');
  const cases = [['cast'], ['zone'], ['zone', { vx: 5, vy: -3 }], ['impact', { shape: 'burn', life: 1 }], ['impact'],
    ['pulse'], ['pulse', { shape: 'burst' }], ['aura'], ['projectile']];
  for (const [stage, extra = {}] of cases) {
    const life = extra.life ?? LIVES[stage];
    for (const size of [0.3, 1, 1.5, 3]) {
      for (const heading of [0, 2.1]) {
        for (const f of [0, 0.05, 0.2, 0.5, 0.8, 0.95, 0.999]) {
          const options = { radius: size, heading, ...extra };
          const { points, glows } = draw(stage, f * life, options);
          assert.ok(points.length <= 256, `${stage} ${size} ${f}: ${points.length}`);
          assert.ok(glows.length <= 32);
          assert.deepEqual(draw(stage, f * life, options), { points, glows });
          for (const p of points) {
            assert.ok([p.x, p.z, p.brightness, ...p.color].every(Number.isFinite));
            assert.match(p.char, /^[\x21-\x7e]$/);
            assert.ok(p.color.every(c => c >= 0 && c <= 255) && p.brightness > 0 && p.brightness <= 1);
          }
          for (const g of glows) assert.ok([g.x, g.z, g.k, g.reach].every(Number.isFinite));
        }
        assert.equal(draw(stage, life, { radius: size, heading, ...extra }).points.length, 0, `${stage} ends`);
      }
    }
  }
  const empty = { points: [], glows: [] };
  assert.deepEqual(draw('aura', 0.5), empty);
  assert.deepEqual(draw('pulse', 0.5, { shape: 'burst' }), empty);
  // Malformed clocks fall back to safe defaults.
  assert.doesNotThrow(() => draw('zone', NaN, { life: NaN, heading: NaN, seed: NaN, radius: NaN, vx: NaN, vy: NaN }));
  assert.doesNotThrow(() => presentation.draw({ stage: 'zone', age: 1, life: 6 }, () => {}));
});

test('the ring stays screen-aligned whatever the caster heading', () => {
  assert.deepEqual(screen('zone', 1.2, 2.1), screen('zone', 1.2, 0));
  assert.deepEqual(screen('cast', 0.3, 2.1), screen('cast', 0.3, 0));
  assert.deepEqual(screen('impact', 0.3, 2.1, { shape: 'burn', life: 1 }), screen('impact', 0.3, 0, { shape: 'burn', life: 1 }));
});

test('the band is 3 m across and squashed 2:1 like other ground rings', () => {
  const ring = band(lit(draw('zone', 1.5).points));
  const extent = Math.max(...ring.map(p => Math.abs(p.x)));
  assert.ok(Math.abs(extent - 1.5) <= 0.2, `${extent}`);
  const cells = [];
  paintPresentation(presentation, { x: 0, y: 0, stage: 'zone', age: 1.5, life: RING_LIFE, radius: RING_RADIUS, seed: 17 },
    (x, y, char) => { if (BAND.includes(char)) cells.push([x, y]); });
  const cols = Math.max(...cells.map(c => c[0])) - Math.min(...cells.map(c => c[0]));
  const rows = Math.max(...cells.map(c => c[1])) - Math.min(...cells.map(c => c[1]));
  assert.ok(cols >= 60 && cols <= 72, `${cols} columns`);
  assert.ok(rows >= 17 && rows <= 23, `${rows} rows`);
});

test('the ring is burning fuel, not a stamp: it breathes, gaps move and tongues respawn', () => {
  const ring = band(lit(draw('zone', 1).points)), radii = ring.map(radius);
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  const cv = Math.sqrt(radii.reduce((a, r) => a + (r - mean) ** 2, 0) / radii.length) / mean;
  assert.ok(cv >= 0.02, `coefficient of variation ${cv}`);
  assert.notDeepEqual(band(draw('zone', 1.4).points).map(p => [p.x, p.z]), ring.map(p => [p.x, p.z]));
  const gaps = [];
  for (const age of [0.6, 1, 1.7, 2.4, 3.3, 4.1, 4.9]) {
    const empty = bins(band(draw('zone', age).points));
    assert.ok(empty.length >= 3, `age ${age}: ${empty.length} empty bins`);
    gaps.push(empty.join());
  }
  assert.ok(new Set(gaps).size >= 6, 'the gaps move');
  const tongues = age => draw('zone', age).points.filter(p => p.char === '^').map(p => Math.round(Math.atan2(p.x, p.z) * 10));
  assert.notDeepEqual(tongues(1), tongues(2.5));
  for (const seed of [0, 3, 50, 96]) assert.ok(bins(band(draw('zone', 2, { seed }).points)).length >= 3, `seed ${seed}`);
});

test('tongues and sparks rise up the screen in warm colours', () => {
  const { points } = draw('zone', 2);
  const top = Math.min(...band(points).map(p => p.z));
  assert.ok(points.some(p => p.z < top - 0.15), 'something climbs above the band');
  assert.ok(points.some(p => p.char === '^') && points.some(p => "*'.".includes(p.char)));
  assert.ok(points.every(p => warm(p.color)));
});

test('moving sweeps the trailing side back and sheds embers behind', () => {
  const sides = extra => {
    const ring = band(draw('zone', 2, extra).points);
    const west = Math.max(...ring.filter(p => p.x < -0.5).map(radius)), east = Math.max(...ring.filter(p => p.x > 0.5).map(radius));
    return { west, east };
  };
  const moving = sides({ vx: 4 }), still = sides({});
  assert.ok(moving.west >= moving.east * 1.08, `${moving.west} vs ${moving.east}`);
  assert.ok(Math.abs(still.west - still.east) / still.east < 0.08, 'standing still, both sides match');
  const embers = draw('zone', 2, { vx: 4 }).points.filter(p => p.x < -RING_RADIUS * 1.15 && lit([p]).length);
  assert.ok(embers.length >= 2, 'embers fall behind');
  assert.ok(draw('zone', 2).points.every(p => p.x >= -RING_RADIUS * 1.2), 'none while standing');
  // Never strays far from the damage area.
  assert.ok(band(draw('zone', 2, { vx: 12 }).points).every(p => Math.abs(radius(p) - RING_RADIUS) < 0.35));
});

test('the cast erupts unevenly, catches as the ring, which gutters out to lingering dots', () => {
  const front = draw('cast', 0.2).points.filter(p => '-|/\\'.includes(p.char)).map(radius);
  assert.ok(Math.max(...front) - Math.min(...front) >= 0.3, 'a ragged front, not an expanding ellipse');
  const landed = draw('cast', 0.85 * presentation.duration).points.filter(p => Math.abs(radius(p) - RING_RADIUS) < 0.05);
  assert.ok(landed.length >= 36, `${landed.length} rays reached the band`);
  assert.ok(draw('cast', 0.3).glows.length > 0);
  const bright = age => Math.max(0, ...band(draw('zone', age).points).map(p => p.brightness));
  assert.ok(bright(0.2) < 0.4, 'dim while the cast is still running out');
  assert.ok(bright(0.5) >= 0.8, 'fully alight by half a second');
  const steady = lit(draw('zone', 4.5).points), late = lit(draw('zone', RING_LIFE - 0.3).points);
  assert.ok(late.length < steady.length * 0.6, 'guttering');
  const mean = ps => ps.reduce((a, p) => a + p.brightness, 0) / ps.length;
  assert.ok(mean(late) < mean(steady));
  const last = lit(draw('zone', RING_LIFE - 0.05).points);
  assert.ok(last.filter(p => '.,'.includes(p.char)).length >= 3, 'a few dots linger to the end');
  assert.ok(last.every(p => '.,'.includes(p.char)));
  assert.equal(draw('zone', RING_LIFE).points.length, 0);
  assert.equal(draw('zone', 6, { life: 6 }).points.length, 0);
});

test('the scorch is a dark, broken band where the ring settled, cooling to nothing', () => {
  const at = age => draw('pulse', age);
  for (const age of [1.6, 2.5, 4]) assert.ok(at(age).points.every(p => Math.max(...p.color) <= 110), `dark at ${age}`);
  const early = at(0.1).points;
  const hot = early.filter(p => Math.max(...p.color) > 110);
  assert.ok(hot.length >= 4 && hot.length <= 12 && hot.every(p => '*.'.includes(p.char)), 'only embers glow early');
  for (const p of at(1).points) assert.ok(Math.abs(radius(p) - RING_RADIUS) <= 0.25, 'no filled disc');
  assert.ok(at(2).points.every(p => p.unlit), 'cold char gives off no light of its own');
  assert.ok(hot.every(p => !p.unlit), 'the embers still glow');
  assert.ok(at(1).glows.length > 0 && at(1).glows.every(g => g.k < 0));
  assert.ok(at(1).points.length > 60);
  assert.ok(at(4.8).points.length < at(1).points.length * 0.2, 'fading by the end');
  assert.equal(at(5).points.length, 0);
  assert.deepEqual(at(1, { vx: 6 }), at(1), 'the scorch is the ring at rest, wherever it was going');
  // It lies where the ring's last dots were: same seed, same samples, same shape.
  const scorch = at(0.5).points.filter(p => '.,:;~'.includes(p.char));
  const dots = lit(draw('zone', RING_LIFE - 1e-4).points);
  const near = dots.filter(d => scorch.some(s => Math.hypot(s.x - d.x, s.z - d.z) < 0.02));
  assert.ok(near.length >= dots.length * 0.5, `${near.length} of ${dots.length}`);
});

test('the ring lights the grass along the band, never a disc in the middle', () => {
  for (const age of [0.6, 2, 4]) {
    const { glows } = draw('zone', age);
    assert.ok(glows.length >= 8 && glows.length <= 16);
    assert.ok(glows.every(g => g.k > 0 && Math.abs(radius(g) - RING_RADIUS) <= 0.3 && radius(g) >= 0.8));
    // Each disc's cost grows with its area, so the reach stays within the frame budget.
    assert.ok(glows.every(g => g.reach <= 1.2 && g.k <= 1));
  }
  assert.ok(draw('scorch', 1).glows.length === 0, 'unknown stages draw nothing');
});

test('burning foes carry flames that climb from the feet and flicker', () => {
  const burn = age => draw('impact', age, { shape: 'burn', life: 1 }).points;
  const flames = burn(0.3).filter(p => "()^'".includes(p.char));
  assert.ok(flames.length >= 6);
  assert.ok(flames.every(p => p.z <= 1e-9 && p.z >= -1.2 * LIFT - 1e-9));
  assert.ok(flames.some(p => p.z < -0.6 * LIFT), 'up the legs');
  assert.ok(burn(0.3).some(p => p.z < -1.2 * LIFT), 'embers above');
  assert.notDeepEqual(burn(0.3), burn(0.5));
  assert.ok(burn(0.9).length > 0, 'still alight when the next burn tick renews it');
  assert.ok(draw('impact', 0.1).points.length > 0 && draw('impact', 0.45).points.length === 0, 'a pulse hit is a quick flare-up');
  assert.notDeepEqual(draw('impact', 0.2, { seed: 4 }).points, draw('impact', 0.2, { seed: 60 }).points);
});

test('ring of fire sounds are recorded Oseni foley, and real casts cue them', async () => {
  for (const [stage, voices] of Object.entries(presentation.sounds)) {
    const fake = fakeRecordedAudio();
    await prepareRecordedSpellTest(fake, presentation);
    const handles = playSpellSound(fake.engine, { type: 'spell', stage, presentation, x: 3, y: 9 });
    assert.equal(handles.length, voices.length);
    const sources = fake.nodes.filter(n => n.kind === 'source');
    sources.forEach((source, i) => assert.equal(source.buffer.id, voices[i].url.split('/').at(-1)));
    assert.ok(voices.every(v => v.url.startsWith('/assets/audio/spells/oseni/')));
    handles.forEach(handle => handle.stop());
    assert.deepEqual(fake.invalid, []);
  }
  const scene = runeScene(spell, { range: 1 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  scene.advance(0.6);
  assert.equal(scene.cast().ok, false, 'still recharging');
  const cues = events.filter(e => e.type === 'spell');
  assert.equal(cues.filter(e => e.stage === 'cast').length, 1, 'the refused recast stays silent');
  assert.ok(cues.some(e => e.stage === 'impact'), 'foes catching fire');
  assert.ok(cues.some(e => e.stage === 'pulse'), 'the ring itself');
  // Every effect of one cast shares its seed, so the scorch matches the ring
  // even after the caster has moved; hits on different foes differ.
  const zoneSeed = scene.casting.effects.list.find(e => e.stage === 'zone').seed;
  scene.player.x += 30;
  scene.advance(5.5);
  const scorch = scene.casting.effects.list.find(e => e.shape === 'scorch');
  assert.equal(scorch.seed, zoneSeed);
  const pair = runeScene(spell, { range: 1 });
  const other = new (scene.foe.constructor)(pair.foe.x + 8, pair.foe.y, { risen: true });
  other.health = other.maxHealth = 100;
  pair.monsters.list.push(other);
  pair.casting.sync();
  assert.equal(pair.cast().ok, true);
  pair.advance(0.05);
  const hits = pair.casting.effects.list.filter(e => e.stage === 'impact');
  assert.equal(hits.length, 2);
  assert.notEqual(hits[0].seed, hits[1].seed);
});
