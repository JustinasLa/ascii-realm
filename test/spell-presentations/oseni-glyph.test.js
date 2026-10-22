import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/oseni-glyph.js';
import spell from '../../src/spells/definitions/oseni-glyph.js';
import { runeScene } from '../../test-support/spells.js';

const LIFE = { cast: 1.16, projectile: 2.5, impact: 0.6, pulse: 0.25, aura: 1.5, zone: 8 };
const RADIUS = { cast: 0.8, projectile: 0.65, impact: 1, pulse: 3, aura: 1, zone: 4 };
const BUDGET = { cast: 230, projectile: 110, impact: 230, pulse: 90, aura: 100, zone: 160 };

function capture(stage, progress = 0.4, options = {}) {
  const life = options.life ?? LIFE[stage];
  const points = [];
  const effect = Object.freeze({ stage, progress, life, age: options.age ?? progress * life,
    radius: options.radius ?? RADIUS[stage], heading: options.heading ?? 0 });
  presentation.draw(effect, (x, z, char, color, brightness) => {
    points.push({ x, z, char, color, brightness });
  });
  return points;
}
const zoneAt = (age, options = {}) => capture('zone', age / LIFE.zone, { age, ...options });
const reach = points => Math.max(...points.map(p => Math.hypot(p.x, p.z)));
const meanReach = points => points.reduce((sum, p) => sum + Math.hypot(p.x, p.z), 0) / points.length;
const hottest = points => Math.max(...points.map(p => p.color[1] + p.color[2]));

test('Oseni Glyph opts into its own profile without changing its rune cost or timing', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.equal(presentation.duration, 1.16);
  assert.deepEqual(spell.variants[0].params, { cooldown: 20, mana: 8, duration: 8, damage: 23 });
});

test('the armed rune is a ring around an upward fire triangle and three curling arms', () => {
  const S = RADIUS.zone * 0.5, points = zoneAt(3);
  const onRing = points.filter(p => Math.abs(Math.hypot(p.x, p.z) / S - 1) < 0.01);
  assert.ok(onRing.length >= 45, 'the ring is a continuous dashed ellipse, not scattered dots');
  assert.ok(onRing.some(p => p.char === '|') && onRing.some(p => p.char === '-'),
    'ring strokes follow the on-screen tangent');
  assert.ok(onRing.some(p => p.char === '%' || p.char === '+'), 'rune marks are set into the ring');
  const base = points.filter(p => Math.abs(p.z - S * 0.39) < 1e-6 && p.char === '-');
  assert.ok(base.length >= 12, 'the triangle has a flat base below the core');
  const apex = points.filter(p => p.z < -S * 0.5 && Math.abs(p.x) < S * 0.3 && (p.char === '/' || p.char === '\\'));
  assert.ok(apex.length >= 4, 'the triangle edges rise to a point above the core');
  assert.ok(points.some(p => p.char === '@' && p.x === 0 && p.z === 0), 'a white-hot core');
  assert.ok(points.filter(p => p.char === '^').length >= 6, 'flames lick up from the ring');
});

test('the rune is inscribed by travelling pens, flashes as it seals, then burns steadily', () => {
  const early = zoneAt(0.05), drawn = zoneAt(0.45), sealed = zoneAt(0.75), steady = zoneAt(3);
  assert.ok(zoneAt(0).length > 0);
  assert.ok(early.length < drawn.length && drawn.length < steady.length, 'strokes appear progressively');
  assert.ok(early.some(p => p.char === '@' && p.z < 0), 'ring pens start at the top');
  assert.ok(drawn.filter(p => p.char === '@').length >= 2, 'the pens stay visible while drawing');
  assert.ok(hottest(sealed.filter(p => p.char === '-')) > hottest(steady.filter(p => p.char === '-')),
    'the seal flash runs the strokes white-hot before they settle to gold');
  const ring = points => points.filter(p => Math.abs(Math.hypot(p.x, p.z) / 2 - 1) < 0.01 && !"^'.".includes(p.char))
    .map(p => `${p.x.toFixed(4)},${p.z.toFixed(4)}`).sort();
  assert.deepEqual(ring(zoneAt(2)), ring(zoneAt(3)), 'the ring and triangle stay put');
  assert.notDeepEqual(zoneAt(2).filter(p => p.char === '*'), zoneAt(3).filter(p => p.char === '*'),
    'the arms keep turning inside them');
});

test('the rune crumbles into rising embers as it expires', () => {
  const steady = zoneAt(5), ending = zoneAt(7.6), last = zoneAt(7.95);
  assert.ok(ending.length < steady.length && last.length < ending.length, 'strokes drop away');
  assert.ok(ending.filter(p => p.char === '.' || p.char === ',').length
    > steady.filter(p => p.char === '.' || p.char === ',').length, 'what remains turns to embers');
  assert.ok(Math.max(...last.map(p => p.brightness)) < 0.2);
  // A one-second summoning copy of the zone fades within its own short life.
  assert.ok(capture('zone', 0.5, { life: 1 }).length > 0);
  assert.ok(Math.max(...capture('zone', 0.99, { life: 1 }).map(p => p.brightness), 0) < 0.05);
});

test('the cast gathers embers inward, inscribes the rune, seals it with a shockwave and burns out', () => {
  const embers = progress => capture('cast', progress).filter(p => p.char === '.' || p.char === ':');
  assert.ok(embers(0.02).length >= 20, 'anticipation starts with embers far out');
  assert.ok(meanReach(embers(0.02)) > meanReach(capture('cast', 0.22).filter(p => p.char === '+' || p.char === '*')),
    'embers spiral in toward the heart');
  const inscribing = capture('cast', 0.45);
  assert.ok(inscribing.some(p => p.char === '@' && Math.hypot(p.x, p.z) > 0.3), 'a pen is drawing the rune');
  const sigilSize = 0.55 + RADIUS.cast * 0.9;
  assert.ok(reach(capture('cast', 0.9)) > sigilSize * 1.5, 'the seal throws a shock ring beyond the rune');
  assert.ok(hottest(capture('cast', 0.7)) >= hottest(capture('cast', 0.95)), 'the flash cools');
  assert.ok(capture('cast', 0.97).filter(p => p.char === '.').length > 10, 'it ends as drifting embers');
});

test('the thrown rune spins with a hot core and sheds an ember wake behind it', () => {
  for (const heading of [0, 1.2, -2.4]) {
    const flight = capture('projectile', 0.3, { heading });
    const wake = flight.filter(p => p.char === '.' || p.char === ':');
    assert.ok(wake.length >= 4);
    assert.ok(wake.reduce((sum, p) => sum + p.z, 0) / wake.length < 0, 'the wake trails behind the flight');
    assert.ok(flight.some(p => p.char === '@'));
    assert.ok(reach(flight.filter(p => p.char !== '.' && p.char !== ':' && p.char !== '\'' && p.char !== '^'
      && p.char !== '+' && p.char !== '*')) < 1.4, 'the rune itself stays compact');
  }
  assert.notDeepEqual(capture('projectile', 0.3), capture('projectile', 0.31), 'the rune spins in flight');
});

test('impact flashes white, brands the triangle, throws arcing sparks and cools to red', () => {
  const flash = capture('impact', 0.01), mid = capture('impact', 0.35), brand = capture('impact', 0.55);
  const late = capture('impact', 0.75);
  assert.ok(flash.some(p => p.char === '@' && p.color.every(c => c > 225)), 'white-hot contact flash');
  assert.ok(reach(mid) > reach(flash) * 1.5, 'rays, ring and sparks burst outward');
  assert.ok(brand.some(p => p.char === '-' && Math.abs(p.z - 0.85 * 0.72 * 0.39) < 1e-6),
    'the triangle brand is still smouldering');
  const warmth = points => points.reduce((sum, p) => sum + p.color[1] / Math.max(1, p.color[0]), 0) / points.length;
  assert.ok(warmth(late) < warmth(flash), 'colours cool from white toward ember red');
});

test('pulses roll a ring of flame outward and stay lean even when very large', () => {
  const ring = progress => meanReach(capture('pulse', progress, { radius: 3 }));
  assert.ok(ring(0.7) > ring(0.1));
  assert.ok(capture('pulse', 0.4, { radius: 1 }).some(p => p.char === '^'));
  assert.ok(capture('pulse', 0.4, { radius: 6 }).length <= 90);
});

test('all effect stages stay bounded, deterministic, atlas-compatible and fade out', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const radius of [0.4, RADIUS[stage], 6]) {
      for (const progress of [0, 0.1, 0.2, 0.35, 0.55, 0.7, 0.93]) {
        const points = capture(stage, progress, { radius, heading: 0.7 });
        assert.ok(points.length > 0, `${stage} draws at ${progress}`);
        assert.ok(points.length <= BUDGET[stage], `${stage} at ${progress} used ${points.length}`);
        assert.deepEqual(points, capture(stage, progress, { radius, heading: 0.7 }));
        for (const p of points) {
          assert.ok([p.x, p.z, p.brightness, ...p.color].every(Number.isFinite));
          assert.ok(Math.hypot(p.x, p.z) < 24);
          assert.match(p.char, /^[\x21-\x7e]$/);
          assert.ok(p.color.every(c => c >= 0 && c <= 255));
          assert.ok(p.brightness >= 0 && p.brightness <= 1);
        }
      }
      assert.ok(Math.max(0, ...capture(stage, 0.99, { radius }).map(p => p.brightness)) < 0.05);
      assert.deepEqual(capture(stage, 1, { radius }), []);
    }
  }
});

test('the glyph draws inward, closes on its flash and leaves restrained resonance', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const asset = name => `/assets/audio/spells/oseni/${name}.wav`;
  const draw = cast.find(v => v.url === asset('air-draw'));
  const swell = cast.find(v => v.url === asset('dark-swell'));
  const seal = cast.find(v => v.url === asset('muted-hit'));
  assert.ok(draw && swell && seal);
  assert.equal(draw.delay, 0);
  assert.ok(swell.delay > draw.delay && swell.delay < seal.delay);
  assert.ok(seal.delay >= 0.72 && seal.delay <= 0.9, 'closure coincides with the visible seal flash');
  assert.ok(impact.some(v => v.url === asset('muted-hit') && v.delay === 0), 'contact starts with a muted hit');
  assert.ok(impact.some(v => v.url === asset('pressure') && v.delay < 0.1), 'pressure follows contact');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(v => v.url === asset('soft-return')), 'repeated wards avoid hard impacts');
  assert.ok(pulse.reduce((sum, v) => sum + v.gain, 0) <= 0.08, 'repeated ward cues remain quiet');
  for (const voices of [cast, impact, pulse]) {
    assert.ok(voices.length >= 1 && voices.length <= 4);
    assert.ok(voices.reduce((sum, v) => sum + v.gain, 0) <= 0.75);
    for (const voice of voices) {
      assert.deepEqual(Object.keys(voice).sort(), ['delay', 'gain', 'kind', 'rate', 'url']);
      assert.equal(voice.kind, 'recording');
      assert.match(voice.url, /^\/assets\/audio\/spells\/oseni\/[a-z-]+\.wav$/);
      assert.ok(voice.gain >= 0.04 && voice.gain <= 0.35);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
    }
  }
});

test('a real rune cast paints the sigil and emits its typed cast and impact cues', () => {
  const { casting, cast, advance, foe } = runeScene(spell, { range: 1 });
  const sounds = [], stages = new Set(), chars = new Set();
  let busiest = 0;
  casting.onSound = event => sounds.push(event);
  assert.equal(cast().ok, true);
  const castEffect = casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(castEffect.presentation, presentation);
  assert.equal(castEffect.life, presentation.duration);

  for (let frame = 0; frame < 120; frame++) {
    for (const effect of casting.effects.list) {
      assert.equal(effect.presentation, presentation);
      stages.add(effect.stage);
    }
    if (casting.projectiles.length) stages.add('projectile');
    let painted = 0;
    casting.effects.paint((x, z, char) => {
      assert.ok(Number.isFinite(x) && Number.isFinite(z));
      chars.add(char);
      painted++;
    }, casting.projectiles);
    busiest = Math.max(busiest, painted);
    advance(0.05);
  }

  for (const stage of ['cast', 'projectile', 'impact', 'zone', 'pulse']) assert.ok(stages.has(stage), stage);
  for (const char of ['@', '^', '%', '|', '\\']) assert.ok(chars.has(char), 'the profile reaches the actual world-cell paint stream');
  assert.ok(busiest <= 4096);
  for (const stage of ['cast', 'impact']) {
    assert.ok(sounds.some(event => event.type === 'spell' && event.stage === stage
      && event.spellId === spell.id && event.presentation === presentation));
  }
  assert.ok(!sounds.some(event => event.type === 'draw' || event.type === 'slam'));
  assert.equal(foe.health, 77);
});
