import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/lightning.js';
import spell from '../../src/spells/definitions/lightning.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { Monster, toCells } from '../../src/entities/monsters.js';

function draw(stage, progress = 0.35, overrides = {}) {
  const points = [];
  const life = overrides.life ?? presentation.duration;
  const effect = Object.freeze({ stage, progress, age: progress * life, life, radius: 1, heading: 0, x: 40, y: 12, ...overrides });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}
const boltAt = (age, overrides = {}) => draw('impact', age / 0.9, { life: 0.9, age, radius: 2.5, shape: 'bolt', ...overrides });
const lit = points => points.filter(p => p.brightness > 0.05);
const strokes = points => lit(points).filter(p => '|/\\'.includes(p.char));
const BUDGET = { cast: 140, projectile: 80, impact: 230, pulse: 200, aura: 80, zone: 120 };

test('a faint leader feels its way down before the white return stroke lands', () => {
  assert.equal(spell.presentation, presentation);
  const leader = boltAt(0.03);
  assert.equal(strokes(leader).length, 0, 'the leader is broken dots, not a channel');
  const dots = leader.filter(p => p.char === ':');
  assert.ok(dots.length >= 6 && dots.every(p => p.brightness < 0.6), 'a dim, broken leader');
  assert.ok(Math.max(...dots.map(p => p.z)) < Math.max(...boltAt(0.045).filter(p => p.char === ':').map(p => p.z)), 'it descends');
  const stroke = boltAt(0.08), channel = strokes(stroke);
  assert.ok(channel.length >= 34, 'a continuous channel from the sky to the ground');
  assert.ok(Math.min(...channel.map(p => p.z)) < -5 && channel.some(p => p.z === 0 && p.x === 0), 'it ends at the strike point');
  assert.ok(channel.some(p => p.char === '/') && channel.some(p => p.char === '\\'), 'the channel is jagged');
  assert.ok(stroke.some(p => p.char === '@' && p.brightness === 1 && p.color.every(c => c > 230)), 'a white flash');
});

test('the stroke flickers on the same channel, then sparks and ground arcs fade out', () => {
  const key = points => strokes(points).map(p => `${p.x.toFixed(4)},${p.z.toFixed(4)},${p.char}`).sort();
  const dim = Math.max(...strokes(boltAt(0.24)).map(p => p.brightness));
  const restroke = Math.max(...strokes(boltAt(0.3)).map(p => p.brightness));
  assert.ok(restroke > dim + 0.2, 'a second pulse brightens the channel again');
  assert.deepEqual(key(boltAt(0.3)), key(boltAt(0.08)), 'real lightning re-uses its channel');
  const reach = age => Math.max(...lit(boltAt(age)).filter(p => p.char === '~' || p.char === '-').filter(p => p.z > -4).map(p => Math.hypot(p.x, p.z)));
  assert.ok(reach(0.32) > reach(0.12) + 1 && reach(0.32) <= 2.5 + 1e-9, 'arcs crawl out to the hit radius');
  assert.ok(lit(boltAt(0.2)).some(p => p.char === '+' || p.char === '*'), 'sparks burst from the strike point');
  assert.ok(lit(boltAt(0.85)).length < lit(boltAt(0.4)).length / 2);
  assert.notDeepEqual(boltAt(0.08, { x: 1, y: 2 }), boltAt(0.08), 'each strike takes its own path');
});

test('the bolt falls straight down the screen whatever the caster heading', () => {
  const screen = heading => {
    const cells = [];
    paintPresentation(presentation, { x: 0, y: 0, stage: 'impact', shape: 'bolt', age: 0.08, life: 0.9, radius: 2.5, heading },
      (x, y, char) => cells.push(`${Math.round(x * 1e6)},${Math.round(y * 1e6)},${char}`));
    return cells;
  };
  assert.deepEqual(screen(2.1), screen(0));
});

test('the charge marks the hit radius and draws static to its centre', () => {
  const at = p => lit(draw('zone', p, { life: 0.6, radius: 2.5 }));
  const ring = p => at(p).filter(q => Math.abs(Math.hypot(q.x, q.z) - 2.5) < 1e-6 && (q.char === '-' || q.char === '~'));
  assert.ok(ring(0.8).length > ring(0.2).length * 1.5, 'the ring traces itself in');
  assert.ok(ring(0.8).length >= 30);
  assert.equal(at(0.5).filter(q => q.char === '*').length, 4, 'crackles race round the ring');
  assert.ok(at(0.8).some(q => q.char === '~' && q.z < -5), 'cloud gathers above the strike point');
});

test('struck targets crackle and the cast raises sparks from the hand', () => {
  const body = lit(draw('impact', 0.3, { life: 0.6 }));
  assert.ok(body.length >= 16 && body.every(p => p.z <= 0 && p.z > -3.6 && Math.abs(p.x) < 1.2));
  assert.notDeepEqual(draw('impact', 0.3, { life: 0.6 }), draw('impact', 0.4, { life: 0.6 }), 'the current flickers');
  const leap = lit(draw('cast', 0.45)).filter(p => p.z < -3.7);
  assert.ok(leap.length >= 8, 'a spark leaps skyward from the raised hand');
});

test('a chain arc leaps chest to chest from the last foe struck to the next', () => {
  const arc = (p, overrides = {}) => draw('pulse', p, { life: 0.35, age: p * 0.35, radius: 3, shape: 'chain', ...overrides });
  const end = points => points.find(q => q.char === '@');
  assert.ok(arc(0.1).length < arc(0.4).length, 'the arc races out from the first foe');
  assert.equal(end(arc(0.1)), undefined);
  const full = lit(arc(0.4));
  assert.ok(Math.abs(end(full).z - 0.4) < 1e-9 && Math.abs(end(full).x) < 1e-9, 'it lands at chest height on the next foe');
  assert.ok(full.every(q => q.z >= -2.6 - 0.2 && q.z <= 0.4 + 1 / 6.5 + 1e-9 && Math.abs(q.x) < 0.2), 'a narrow jagged path between them');
  assert.ok(full.some(q => q.char === '*' && q.z === -2.6), 'it leaves the first foe at chest height');
  assert.notDeepEqual(arc(0.4), arc(0.5), 'the arc flickers');
  assert.ok(Math.max(...arc(0.9).map(q => q.brightness)) < 0.1, 'and fades');
  assert.ok(lit(arc(0.4, { heading: Math.PI / 2 })).some(q => q.char === '-'), 'sideways arcs run level across the screen');

  const cells = heading => {
    const out = [];
    paintPresentation(presentation, { x: 0, y: 0, stage: 'pulse', shape: 'chain', age: 0.14, life: 0.35, radius: 3, heading },
      (x, y, char) => out.push({ x, y, char }));
    return out.find(q => q.char === '@');
  };
  for (const heading of [0, 1, -2.3]) {
    const [x, y] = toCells(Math.sin(heading) * 3, Math.cos(heading) * 3 - 2.6);
    assert.ok(Math.abs(cells(heading).x - x) < 1e-6 && Math.abs(cells(heading).y - y) < 1e-6, `reaches the next foe at heading ${heading}`);
  }
});

test('a real cast chains on to a second foe with its own arc and crackle', () => {
  const scene = runeScene(spell, { range: 4 });
  const other = new Monster(...toCells(1, 6), { risen: true });
  other.health = other.maxHealth = 100;
  scene.monsters.list.push(other); scene.casting.sync();
  scene.cast();
  scene.advance(0.8);
  const chain = scene.casting.effects.list.filter(e => e.stage === 'pulse' && e.shape === 'chain');
  assert.equal(chain.length, 1);
  assert.equal(chain[0].presentation, presentation);
  assert.equal(scene.casting.effects.list.filter(e => e.shape === 'bolt').length, 1, 'only one bolt');
  const rendered = [];
  scene.casting.effects.paint((...point) => rendered.push(point));
  assert.ok(rendered.some(p => p[2] === '@' && Math.abs(p[0] - other.x) < 1e-6 && Math.abs(p[1] - (other.y - toCells(0, 2.6)[1])) < 1e-6),
    'the arc reaches the second foe');
});

test('all stages remain deterministic, finite, ASCII and within budget, then fade cleanly', () => {
  const lives = { cast: [presentation.duration], projectile: [10, 1], impact: [0.6, 0.9], pulse: [0.5], aura: [1.5], zone: [0.6, 8] };
  for (const stage of Object.keys(BUDGET)) {
    for (const life of lives[stage]) {
      for (const shape of { impact: ['burst', 'bolt'], pulse: ['burst', 'chain'] }[stage] ?? ['burst']) {
        for (const size of [0.8, 1, 2.5, 6]) {
          for (const progress of [0, 0.05, 0.1, 0.25, 0.5, 0.7, 0.9, 0.99, 1]) {
            const options = { radius: size, life, shape };
            const points = draw(stage, progress, options);
            assert.ok(points.length <= BUDGET[stage], `${stage} ${shape} ${size} ${progress}: ${points.length}`);
            assert.deepEqual(points, draw(stage, progress, options));
            for (const point of points) {
              assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
              assert.ok(Math.abs(point.x) < 6 && Math.abs(point.z) < 6);
              assert.match(point.char, /^[\x20-\x7e]$/);
              assert.ok(point.color.every(channel => channel >= 0 && channel <= 255));
              assert.ok(point.brightness > 0 && point.brightness <= 1);
            }
            if (progress === 1) assert.equal(points.length, 0, `${stage} fades out`);
          }
        }
      }
    }
  }
});

test('the strike cracks sharply over a low rumble and plays through the effects bus', () => {
  const { impact, cast } = presentation.sounds;
  assert.ok(impact.some(v => v.kind === 'noise' && v.filterType === 'highpass' && v.attack <= 0.002 && v.gain >= 0.15), 'a sharp crack');
  assert.ok(impact.some(v => v.kind === 'tone' && v.frequency < 100 && v.duration > 1), 'a low rumble');
  assert.ok(cast.some(v => v.kind === 'tone' && v.endFrequency > v.frequency), 'the charge hum rises');
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.duration > 0 && voice.duration <= 2.5 && voice.gain > 0 && voice.gain <= 0.25);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
  }
  const fake = fakeRecordedAudio();
  const handles = playSpellSound(fake.engine, { type: 'spell', stage: 'impact', presentation, x: 3, y: 9 });
  assert.equal(handles.length, impact.length);
  handles.forEach(handle => handle.stop());
  assert.deepEqual(fake.invalid, []);
});

test('a real cast shows the charge ring, then one strike with a single crack cue', () => {
  const scene = runeScene(spell, { range: 4 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  scene.advance(0.3);
  assert.ok(scene.casting.effects.list.some(e => e.presentation === presentation && e.stage === 'zone' && e.radius === 2.5));
  scene.advance(0.35);
  const bolts = scene.casting.effects.list.filter(e => e.stage === 'impact' && e.shape === 'bolt');
  assert.equal(bolts.length, 1);
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'impact' && e.shape !== 'bolt'), 'the target crackles');
  assert.equal(events.filter(e => e.stage === 'impact').length, 1, 'the strike and its hit share one crack');
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id));
  const rendered = [];
  scene.casting.effects.paint((...point) => rendered.push(point));
  assert.ok(rendered.some(p => p[2] === '@'), 'the strike point blazes');
});
