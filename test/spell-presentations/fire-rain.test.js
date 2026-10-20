import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/fire-rain.js';
import spell from '../../src/spells/definitions/fire-rain.js';
import { runeScene } from '../../test-support/spells.js';

function draw(stage, progress, overrides = {}) {
  const points = [];
  presentation.draw({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius: 2, heading: 0, ...overrides },
  (x, z, char, color, brightness) => points.push({ x, z, char, color, brightness }));
  return points;
}

// Where the adapter puts a local point on the ground plane (metres, +z down the screen).
const world = (point, heading) => [point.x * Math.cos(heading) + point.z * Math.sin(heading),
  point.z * Math.cos(heading) - point.x * Math.sin(heading)];
const lit = point => point.brightness > 0.05;

test('a real Fire Rain cast paints its cloud, rain and ground strikes and emits typed spell cues', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'cast'
    && event.spellId === spell.id && event.presentation === presentation));
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'cast'
    && effect.presentation === presentation), 'runtime retains the selected profile');
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'zone' && effect.presentation === presentation),
    'the return anchor is presented as a zone');
  const acceptedCueCount = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, acceptedCueCount, 'cooldown rejection adds no sound');
  scene.advance(0.6);
  const storm = [];
  scene.casting.effects.paint((...point) => storm.push(point), scene.casting.projectiles);
  assert.ok(storm.some(point => point[2] === '%' || point[2] === '#'), 'runtime paints the burning cloud');
  assert.ok(storm.some(point => point[2] === '@'), 'runtime paints white-hot falling drops');
  scene.advance(0.7);
  assert.equal(scene.foe.health, 88, 'first falling shot keeps its TF damage and launch delay');
  const landing = [];
  scene.casting.effects.paint((...point) => landing.push(point), scene.casting.projectiles);
  assert.ok(landing.length > 0, 'runtime paints the landing');
  assert.ok(events.some(event => event.stage === 'impact') && events.some(event => event.stage === 'pulse'));
  assert.ok(events.every(event => event.type === 'spell' && event.presentation === presentation),
    'authored cues replace the generic draw and slam sounds');
});

test('Fire Rain casts a sigil, gathers a burning cloud overhead and rains slanted drops that splash', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const radius = 0.8;
  // Wind-up: a sigil ring at the feet while sparks spiral upward; no cloud yet.
  const windup = draw('cast', 0.08, { radius });
  assert.ok(windup.filter(point => Math.abs(Math.hypot(point.x, point.z) - 1.2) < 0.15).length >= 20, 'sigil ring at the feet');
  assert.ok(!windup.some(point => point.z < -2 && /[%#]/.test(point.char)), 'cloud has not formed yet');
  // The cloud: a dense band high above the caster.
  const storm = draw('cast', 0.45, { radius });
  const cloud = storm.filter(point => point.z < -2);
  assert.ok(cloud.length >= 60, 'cloud is a dense band rather than scattered dots');
  assert.ok(cloud.some(point => point.x < -1.4) && cloud.some(point => point.x > 1.4), 'cloud spans the field');
  assert.ok(cloud.some(point => /[%#]/.test(point.char)), 'cloud core uses dense glyphs');
  // Drops fall continuously and accelerate.
  const heads = progress => draw('cast', progress, { radius }).filter(point => point.char === '@' && point.z > -2);
  assert.ok(heads(0.45).length >= 2, 'several drops are in flight at once');
  const lowest = progress => Math.max(...heads(progress).map(point => point.z));
  assert.ok(lowest(0.46) > lowest(0.45), 'drops move down between frames');
  // Landing: splash crowns with droplets thrown to both sides.
  const late = draw('cast', 0.78, { radius });
  assert.ok(late.some(point => point.char === '/') && late.some(point => point.char === '\\')
    && late.some(point => point.char === ','), 'drops land in fire crowns');
  // Dissipation: everything thins out before the end.
  const total = progress => draw('cast', progress, { radius }).reduce((sum, point) => sum + point.brightness, 0);
  assert.ok(total(0.95) < total(0.7) * 0.4, 'the storm dissipates gracefully');
  // Flames rise and rain falls on screen whatever the cast heading.
  for (const heading of [Math.PI / 2, 2.4, -1]) {
    const turned = draw('cast', 0.45, { radius, heading });
    assert.equal(turned.length, storm.length);
    turned.forEach((point, i) => {
      const [x, z] = world(point, heading);
      assert.ok(Math.abs(x - storm[i].x) < 1e-9 && Math.abs(z - storm[i].z) < 1e-9, 'screen-aligned after the adapter rotation');
    });
  }
});

test('Fire Rain strikes the ground with a fireball, a shock ring, flame tongues and debris', () => {
  const strike = progress => draw('pulse', progress, { radius: 5, life: 0.25, age: progress * 0.25, shape: 'burst' });
  const flash = strike(0.05);
  assert.ok(flash.some(point => point.char === '@' && point.brightness > 0.8), 'white-hot core on impact');
  assert.ok(flash.filter(point => Math.hypot(point.x, point.z) < 0.6).length >= 25, 'fireball is a compact, dense blossom');
  const ring = progress => Math.max(...strike(progress).filter(point => /[-|/\\]/.test(point.char))
    .map(point => Math.hypot(point.x, point.z)));
  assert.ok(ring(0.5) > ring(0.1) * 1.5, 'shock ring expands');
  assert.ok(!strike(0.8).some(point => point.char === '@'), 'fireball burns out');
  assert.ok(strike(0.3).some(point => point.char === '^'), 'flame tongues stand up off the ring');
  // Projectile ticks leave small cinder puffs; the anchor ward is a lean ripple.
  assert.ok(draw('pulse', 0.3, { radius: 1, life: 0.25, age: 0.075 }).length <= 12);
  const ripple = progress => draw('pulse', progress, { radius: 1, life: 0.25, age: progress * 0.25, shape: 'ward' });
  assert.equal(ripple(0.2).length, 16);
  const extent = points => Math.max(...points.map(point => Math.hypot(point.x, point.z)));
  assert.ok(extent(ripple(0.7)) > extent(ripple(0.1)), 'ward ripple swells outward');
});

test('Fire Rain bonfire impact, updraft aura, anchor zone and fireball projectile', () => {
  const impact = draw('impact', 0.3, { radius: 1, life: 0.6, age: 0.18 });
  const flames = impact.filter(point => point.z < -0.2);
  assert.ok(flames.length >= 25, 'flames wrap the target');
  assert.ok(flames.some(point => point.char === '^' || point.char === "'"), 'flame tips');
  const top = points => Math.min(...points.map(point => point.z));
  const center = impact.filter(point => Math.abs(point.x) < 0.15);
  const side = impact.filter(point => Math.abs(point.x) > 0.35 && point.z < 0);
  assert.ok(top(center) < top(side), 'bonfire silhouette is tallest in the middle');

  const aura = draw('aura', 0.5, { radius: 1, life: 1.5, age: 0.75 });
  assert.ok(aura.some(point => point.z < -1), 'sparks ride the updraft above the caster');

  const zone = draw('zone', 0.5, { radius: 4, life: 6.5, age: 3.25 });
  const brazier = zone.filter(point => Math.abs(point.x) < 0.2 && point.z < 0 && point.z > -0.8);
  assert.ok(brazier.length >= 8 && brazier.some(point => point.char === '^'), 'a brazier flame burns at the anchor');
  const boundary = zone.filter(point => Math.abs(Math.hypot(point.x, point.z) - 2.2) < 0.05);
  assert.ok(boundary.length >= 50, 'the anchor boundary is a continuous ring');
  const levels = boundary.map(point => point.brightness);
  assert.ok(Math.max(...levels) - Math.min(...levels) > 0.3, 'heat waves run around the boundary');

  const projectile = draw('projectile', 0.02, { radius: 0.65, life: 10, age: 0.2 });
  const head = projectile.find(point => point.char === '@');
  assert.ok(head && head.x === 0 && head.z === 0 && head.brightness === Math.max(...projectile.map(point => point.brightness)), 'white-hot head leads');
  const trail = projectile.filter(point => point !== head && Math.abs(point.x) < 0.1 && point.z < -0.1);
  assert.ok(trail.length >= 10, 'a flame trail streams behind the head');
  assert.ok(!projectile.some(point => point.z > 0.2), 'nothing runs ahead of the head');
});

test('Fire Rain handles all presentation stages with finite, bounded, fading ASCII marks', () => {
  const budgets = { cast: 200, impact: 120, pulse: 100, aura: 80, zone: 160, projectile: 64 };
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const shape of stage === 'pulse' ? ['burst', 'ward'] : [undefined]) {
      for (const progress of [0, 0.05, 0.2, 0.45, 0.55, 0.7, 0.9, 0.99, 1]) {
        for (const radius of [0.1, 1, 5, 40]) {
          for (const heading of [0, 1.3]) {
            const points = draw(stage, progress, { radius, shape, heading });
            assert.ok(points.length <= budgets[stage], `${stage} draw budget stays bounded (${points.length})`);
            for (const point of points) {
              assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
              assert.ok(Math.hypot(point.x, point.z) <= 8, 'geometry stays local to the spell');
              assert.match(point.char, /^[\x20-\x7e]$/);
              assert.ok(point.color.length === 3 && point.color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255));
              assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
            }
            if (progress === 1) assert.equal(points.filter(lit).length, 0, 'expired effects leave no visible marks');
          }
        }
      }
      const peak = progress => Math.max(...draw(stage, progress, { shape }).map(point => point.brightness));
      assert.ok(peak(0.99) < peak(0.45) * 0.2, `${stage} fades smoothly before expiry`);
    }
  }
  assert.deepEqual(draw('cast', 0.3), draw('cast', 0.3), 'geometry is deterministic');
  assert.deepEqual(draw('zone', 0.3), draw('zone', 0.3), 'zone geometry is deterministic');
});

test('Fire Rain sounds rise into spaced falling whistles and sizzling drops', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const rise = cast.find(voice => voice.kind === 'tone' && voice.endFrequency > voice.frequency);
  assert.ok(rise && rise.delay === 0 && rise.attack > 0.08, 'airy opening sweep rises gradually');
  const whistles = cast.filter(voice => voice.kind === 'tone' && voice.endFrequency < voice.frequency);
  assert.equal(whistles.length, 3);
  assert.ok(whistles[1].delay - whistles[0].delay > 0.25 && whistles[2].delay - whistles[1].delay > 0.25,
    'three separate falling drops have room between them');
  for (const whistle of whistles) {
    assert.ok(cast.some(voice => voice.kind === 'noise' && voice.delay > whistle.delay
      && voice.delay < whistle.delay + whistle.duration && voice.filterType === 'highpass'), 'each whistle lands with a sizzle');
  }
  assert.ok(impact.filter(voice => voice.kind === 'noise').length >= 3, 'impact has a cascading sizzling texture');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(voice => voice.duration < 0.1 && voice.gain < 0.03), 'repeated ticks remain short and quiet');
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
      if (voice.kind === 'tone') assert.ok(voice.frequency > 0 && voice.endFrequency > 0);
    }
  }
});
