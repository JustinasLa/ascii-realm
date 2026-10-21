import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/ice-shard.js';
import spell from '../../src/spells/definitions/ice-shard.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { runeScene } from '../../test-support/spells.js';

function points(stage, progress, options = {}) {
  const result = [];
  const effect = Object.freeze({ stage, progress, age: progress * (options.life ?? 0.86), life: 0.86,
    radius: 2, heading: 1.3, ...options });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => {
    result.push({ x, z, char, color: [...color], brightness });
  });
  return result;
}

// Screen-space glyphs through the real adapter (columns/rows around the origin).
function cells(stage, age, options = {}) {
  const result = [];
  paintPresentation(presentation, { x: 0, y: 0, stage, age, life: 0.86, radius: 2, heading: 0, ...options },
    (x, y, char, color, brightness) => result.push({ x, y, char, brightness }),
    stage === 'projectile' ? 128 : 256);
  return result;
}

const distance = point => Math.hypot(point.x, point.z);
const unique = list => new Set(list.map(point => `${Math.floor(point.x)},${Math.floor(point.y)}`)).size;
const STROKES = ['|', '/', '\\', '-'];

test('Ice Shard opts into its crystal profile while retaining its rune parameters', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.equal(spell.root, 'ice_shard');
  assert.deepEqual(spell.variants[0].params, { cooldown: 10, mana: 4, duration: 6 });
  assert.equal(spell.nodes.ice_shard.steps[0].args.onhit, 'Ice_Shard_HIT');
});

test('real Ice Shard casts paint the crystal, its frost trail and the shatter with typed cues', () => {
  const scene = runeScene(spell);
  const events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false, 'mana rejection emits no extra cast cue');
  assert.equal(events.filter(event => event.stage === 'cast').length, 1);
  assert.equal(scene.casting.effects.list[0].presentation, presentation);
  assert.equal(scene.casting.projectiles[0].ctx.spell.presentation, presentation);
  const flight = [];
  scene.casting.effects.paint((...point) => flight.push(point), scene.casting.projectiles);
  assert.ok(flight.some(point => point[2] === 'v'), 'the shard points down-screen toward the foe');
  assert.ok(flight.some(point => point[2] === '.'), 'frost wake trails the shard');
  scene.advance(0.05);
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'pulse' && effect.radius === 1),
    'each projectile tick leaves a frost puff');
  scene.advance(0.05);
  assert.ok(scene.aura(scene.foe, 'Slowed'));
  assert.equal(scene.foe.health, 100, 'presentation preserves the slow-only rune');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'));
  assert.ok(events.every(event => event.type === 'spell' && event.spellId === spell.id
    && event.presentation === presentation), 'cast replaces generic draw/slam cues');
  const burst = scene.casting.effects.list.find(effect => effect.stage === 'pulse' && effect.radius === 3);
  assert.ok(burst, 'the hit spawns the radius-3 shatter');
  const shatter = [];
  paintPresentation(presentation, burst, (...point) => shatter.push(point));
  assert.ok(shatter.length > 80 && shatter.length <= 256);
  assert.ok(shatter.filter(point => point[2] === '*').length >= 6, 'starburst spikes end in bright tips');
});

test('projectile is a solid faceted spike with a chevron tip, sweeping glint and frost wake', () => {
  for (const [heading, chevron] of [[0, 'v'], [Math.PI / 2, '>'], [Math.PI, '^'], [-Math.PI / 2, '<']]) {
    const flight = points('projectile', 0.03, { life: 10, radius: 0.65, heading });
    const tip = flight.reduce((best, point) => point.z > best.z ? point : best);
    assert.equal(tip.char, chevron, `tip chevron follows the screen direction at heading ${heading}`);
    assert.equal(tip.x, 0);
  }
  for (const heading of [0, 0.7, 1.3, 2.4]) {
    for (const age of [0.05, 0.3, 0.62]) {
      const flight = points('projectile', age / 10, { life: 10, radius: 0.65, heading });
      assert.ok(flight.length >= 50 && flight.length <= 110, `lean but solid (${flight.length})`);
      const screen = cells('projectile', age, { life: 10, radius: 0.65, heading });
      assert.ok(unique(screen) >= screen.length * 0.8, 'body is rasterised one glyph per cell');
    }
  }
  const flight = points('projectile', 0.03, { life: 10, radius: 0.65, heading: 0 });
  const body = flight.filter(point => point.z >= -0.5 && Math.abs(point.x) < 0.2 && point.char !== '.');
  assert.ok(body.some(point => STROKES.includes(point.char)), 'faceted outline');
  assert.ok(body.some(point => '=+*#'.includes(point.char)), 'intensity-ramped interior');
  const wake = flight.filter(point => point.char === '.');
  assert.ok(wake.length >= 4 && wake.every(point => point.z < -0.5), 'wake stays behind the tail');
  const brightest = progress => points('projectile', progress, { life: 10, radius: 0.65, heading: 0 })
    .filter(point => '=+*#%@'.includes(point.char) && point.z > -0.5)
    .reduce((best, point) => point.brightness > best.brightness ? point : best).z;
  assert.ok(brightest(0.025) > brightest(0.015) + 0.2, 'the glint sweeps from tail to tip');
  assert.notDeepEqual(points('projectile', 0.01, { life: 10 }), points('projectile', 0.04, { life: 10 }));
});

test('cast gathers frost, flashes, blooms an upright six-armed flake, flings needles and sublimates', () => {
  const cast = (progress, options = {}) => points('cast', progress, { radius: 0.8, heading: 0, ...options });
  const centre = 0.8 * 0.32;
  const spread = list => Math.max(...list.map(point => Math.hypot(point.x, point.z - centre)));
  assert.ok(!cast(0.02).some(point => STROKES.includes(point.char)), 'opens with gathering motes, no crystal yet');
  const motes = progress => cast(progress).filter(point => point.char === ':');
  assert.ok(spread(motes(0.08)) < spread(motes(0.02)) * 0.8, 'motes snap inward before the flash');
  const flash = cast(0.13).find(point => point.char === '@');
  assert.ok(flash && flash.brightness > 0.9 && Math.abs(flash.z - centre) < 0.1, 'white flash at the crystal');

  const bloom = cells('cast', 0.3 * 0.86, { radius: 0.8 });
  const [cx, cy] = [0, 0.8 * 0.32 * 6.5];
  const arm = (dx, dy, char) => bloom.some(point => point.char === char
    && Math.floor(point.x) === Math.floor(cx) + dx && Math.floor(point.y) === Math.floor(cy) + dy);
  assert.ok(arm(0, -2, '|') && arm(0, 2, '|'), 'vertical spine');
  assert.ok(arm(2, -2, '/') && arm(-2, 2, '/') && arm(2, 2, '\\') && arm(-2, -2, '\\'), '1:1 diagonal arms');
  assert.ok(cast(0.3).filter(point => point.char === '*').length >= 6, 'six bright arm tips');

  const needles = cast(0.35);
  assert.ok(Math.max(...needles.map(point => point.z)) > centre + 1.2 * 0.8, 'needles fly ahead of the caster');
  assert.ok(Math.min(...needles.map(point => point.z)) > -1.2, 'nothing is thrown backwards');
  assert.ok(cast(0.85).length < cast(0.3).length / 3, 'the flake retracts and sublimates');
  for (const progress of [0.1, 0.3, 0.6]) assert.ok(cast(progress).length <= 200);
});

test('hit shatters into a starburst, tumbling fragments and an expanding shock ring; ticks stay lean', () => {
  const hit = (progress, options = {}) => points('pulse', progress, { radius: 3, life: 0.25, heading: 0, ...options });
  const early = hit(0.06);
  assert.ok(early.some(point => point.char === '@' && distance(point) < 0.12 && point.brightness > 0.7));
  for (const char of STROKES) assert.ok(early.some(point => point.char === char), `spike stroke ${char}`);
  assert.ok(early.filter(point => point.char === '*').length >= 6);
  const ring = progress => Math.max(...hit(progress).map(distance));
  assert.ok(ring(0.6) > ring(0.2) + 0.5, 'shock ring keeps expanding');
  assert.ok(hit(0.92).length < hit(0.15).length / 2, 'spikes crumble away');
  assert.ok(Math.max(...hit(0.15).map(point => point.brightness)) > Math.max(...hit(0.8).map(point => point.brightness)));
  assert.deepEqual(points('impact', 0.3, { radius: 3, heading: 0 }).length, hit(0.3).length,
    'impact shares the shatter choreography');

  for (const progress of [0, 0.3, 0.7]) {
    const puff = points('pulse', progress, { radius: 1, life: 0.25, heading: 0 });
    assert.ok(puff.length > 0 && puff.length <= 30, 'trail ticks stay lean');
    assert.ok(puff.every(point => distance(point) < 0.8), 'and compact');
  }
  assert.ok(points('pulse', 0.1, { radius: 1, life: 0.25, heading: 0 }).some(point => point.char === '|'),
    'a short contrail along the flight line');
});

test('slow aura grows a screen-aligned hexagon of rime; refreshes ripple outward', () => {
  const rime = heading => cells('aura', 0.6, { radius: 1, life: 1.5, heading });
  const [upright, turned] = [rime(0), rime(1.3)];
  assert.equal(upright.length, turned.length);
  assert.ok(upright.every(point => turned.some(other => other.char === point.char
    && Math.abs(other.x - point.x) < 0.01 && Math.abs(other.y - point.y) < 0.01)),
  'rime looks the same whatever the cast heading');
  const formed = cells('aura', 0.6, { radius: 1, life: 1.5 });
  assert.ok(formed.filter(point => point.char === '-').length >= 20, 'flat top and bottom edges');
  assert.ok(formed.filter(point => point.char === '/' || point.char === '\\').length >= 16, 'slanted sides');
  assert.ok(formed.length <= 160);
  const aura = (progress, life) => points('aura', progress, { radius: 1, life, heading: 0 });
  assert.ok(aura(0.95, 1.5).length < aura(0.5, 1.5).length / 2, 'the rime thaws away');
  const ripple = progress => Math.max(...aura(progress, 0.3).map(distance));
  assert.ok(ripple(0.7) > ripple(0.1) * 1.2, 'refresh ripple expands');
  assert.ok(!aura(0.4, 0.3).some(point => point.char === '*'), 'refresh is a bare ripple, not a second rime');
});

test('every supported stage is deterministic, bounded and fades to nothing', () => {
  const budgets = { cast: 200, projectile: 110, impact: 220, pulse: 220, aura: 160, zone: 160 };
  for (const stage of Object.keys(budgets)) {
    const early = points(stage, 0.2);
    assert.deepEqual(early, points(stage, 0.2));
    assert.ok(early.length > 0);
    for (const progress of [0, 0.05, 0.2, 0.4, 0.65, 0.999]) {
      for (const radius of [0.5, 1, 2, 3]) {
        const list = points(stage, progress, { radius });
        assert.ok(list.length <= budgets[stage], `${stage} ${progress} r${radius}: ${list.length}`);
        for (const point of list) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
          assert.ok(distance(point) < 5);
          assert.match(point.char, /^[\x20-\x7e]$/);
          assert.ok(point.color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255));
          assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
        }
      }
    }
    assert.ok(Math.max(...points(stage, 0.999).map(point => point.brightness)) < 0.01);
    assert.equal(points(stage, 1).length, 0);
    assert.equal(points(stage, 1.5).length, 0);
    for (const point of points(stage, NaN, { age: NaN, life: Infinity, radius: NaN, heading: NaN })) {
      assert.ok([point.x, point.z, point.brightness].every(Number.isFinite));
    }
  }
});

test('glass plink and rising whistle resolve into an irregular high-frequency fracture cluster', () => {
  const { cast, impact } = presentation.sounds;
  const plink = cast[0];
  assert.equal(plink.kind, 'tone');
  assert.ok(plink.attack < 0.005 && plink.frequency > 2000 && plink.duration < 0.15);
  const whistle = cast.find(voice => voice.endFrequency > voice.frequency);
  assert.ok(whistle && whistle.delay > plink.delay && whistle.attack > plink.attack);
  assert.ok(cast.some(voice => voice.kind === 'noise' && voice.filterType === 'highpass'));
  assert.equal(impact[0].kind, 'noise');
  assert.ok(impact.filter(voice => voice.kind === 'tone' && voice.endFrequency < voice.frequency).length >= 3);
  assert.ok(new Set(impact.slice(1).map((voice, index) =>
    Math.round((voice.delay - impact[index].delay) * 1000))).size > 3,
  'falling glass fragments land at uneven intervals');
  assert.notDeepEqual(cast, impact);
  for (const voices of [cast, impact]) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
      assert.ok(Object.values(voice).every(value => typeof value !== 'number' || Number.isFinite(value)));
    }
  }
});
