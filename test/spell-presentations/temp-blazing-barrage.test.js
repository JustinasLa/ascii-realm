import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-blazing-barrage.js';
import spell from '../../src/spells/definitions/temp-blazing-barrage.js';
import { runeScene } from '../../test-support/spells.js';

const SMOKE = [78, 56, 50];
const BUDGET = { cast: 240, impact: 220, projectile: 110, pulse: 40, aura: 160, zone: 160 };

function frame(stage, progress, radius = 1, heading = 0.72) {
  const points = [];
  const life = stage === 'projectile' ? 1 : presentation.duration;
  const effect = Object.freeze({ stage, progress, age: progress * life, life, radius, heading });
  presentation.draw(effect, (x, z, char, color, brightness = 1) =>
    points.push({ x, z, char, color, brightness }));
  return points;
}
// Cast frames at a gameplay time in seconds, heading 0 so screen x = local x and screen up = local -z.
const castAt = time => frame('cast', time / presentation.duration, 1, 0);
const light = points => points.reduce((sum, p) => sum + p.brightness, 0);
const isSmoke = p => p.color.every((c, i) => c === SMOKE[i]);
// Circle centres in screen metres, in firing order (mirrors the presentation's barrel layout).
const BARRELS = [[-0.4, 0.62], [0.4, 0.62], [-1.12, 0.5], [1.12, 0.5], [-0.76, 1.12], [0.76, 1.12]];
const litCircles = points => BARRELS.filter(([bx, by]) =>
  points.filter(p => Math.abs(p.x - bx) < 0.2 && Math.abs(-p.z - by) < 0.2 && p.brightness > 0.3).length >= 10).length;

test('Blazing Barrage opts into a deterministic, bounded presentation for every effect stage', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  for (const stage of ['cast', 'impact', 'projectile', 'pulse', 'aura', 'zone']) {
    for (const radius of [0.6, 1, 40]) {
      for (const heading of [0, 0.72, 2.6]) {
        for (let i = 0; i <= 40; i++) {
          const progress = i / 40, points = frame(stage, progress, radius, heading);
          assert.ok(points.length <= BUDGET[stage], `${stage} stays within its glyph budget (${points.length})`);
          if (progress >= 1) assert.equal(points.length, 0, `${stage} fades to nothing`);
          for (const p of points) {
            assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
            assert.ok(Math.abs(p.x) < 7 && Math.abs(p.z) < 7, 'large radii remain readable');
            assert.match(p.char, /^[\x20-\x7e]$/);
            assert.equal(p.color.length, 3);
            assert.ok(p.color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
            assert.ok(Number.isFinite(p.brightness) && p.brightness >= 0 && p.brightness <= 1);
          }
        }
      }
      for (const progress of [0.02, 0.3, 0.6]) {
        assert.ok(frame(stage, progress, radius).length > 0, `${stage} has visible geometry`);
        assert.deepEqual(frame(stage, progress, radius), frame(stage, progress, radius), `${stage} is pure`);
      }
    }
  }
});

test('every stage dissolves smoothly into its final frame instead of popping out', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone']) {
    assert.ok(light(frame(stage, 0.995)) < 0.1, `${stage} has burned out just before progress 1`);
    assert.ok(light(frame(stage, 0.97)) < light(frame(stage, 0.85)) || light(frame(stage, 0.85)) === 0,
      `${stage} dims through its tail`);
  }
  assert.ok(Math.max(...frame('projectile', 0.999).map(p => p.brightness)) < 0.02, 'rounds fade as they expire');
});

test('cast kindles six fire circles on the 3-tick cadence, each spitting a fireball, before a fireblast', () => {
  const opening = castAt(0.03), drawing = points => points.filter(p => Math.hypot(p.x + 0.4, -p.z - 0.62) < 0.3).length;
  assert.ok(drawing(opening) > 0 && drawing(opening) < drawing(castAt(0.12)), 'the first circle draws itself in');
  assert.ok(opening.some(p => Math.hypot(p.x, p.z - 0.4) < 0.95 && Math.hypot(p.x, p.z - 0.4) > 0.1),
    'anticipation: embers spiral in towards the caster');
  assert.equal(litCircles(castAt(0.1)), 1);
  assert.equal(litCircles(castAt(0.25)), 2, 'circles appear one every 0.15 s');
  assert.equal(litCircles(castAt(0.55)), 4);
  assert.equal(litCircles(castAt(0.95)), 6, 'all six circles hang in a fan above the caster');
  for (let i = 0; i < 6; i++) {
    const fire = 0.2 + i * 0.15, near = (time, [bx, by]) =>
      light(castAt(time).filter(p => Math.hypot(p.x - bx, -p.z - by) < 0.3));
    assert.ok(near(fire + 0.015, BARRELS[i]) > near(fire - 0.01, BARRELS[i]), `circle ${i} flares as it fires`);
    assert.ok(near(fire + 0.3, BARRELS[i]) < near(fire + 0.015, BARRELS[i]), `circle ${i} cools after firing`);
    assert.ok(castAt(fire + 0.04).some(p => p.char === '@' && -p.z < BARRELS[i][1] - 0.05),
      `circle ${i} spits a white-hot fireball down`);
  }

  // The circles unravel into a white-hot knot just in front of the caster.
  const gathered = castAt(1.22);
  assert.ok(litCircles(gathered) < 2, 'circles collapse before the blast');
  assert.ok(gathered.some(p => p.char === '@' && Math.hypot(p.x, p.z - 0.3) < 0.05), 'knot at the blast origin');

  // The fireblast is a continuous crescent spanning TF's ±48° projectile fan that rolls forward.
  const reach = points => Math.max(...points.filter(p => !isSmoke(p)).map(p => Math.hypot(p.x, p.z - 0.3)));
  const early = castAt(1.32), late = castAt(1.5);
  assert.ok(reach(late) > reach(early) + 0.4, 'the blast front races outwards');
  const front = late.filter(p => Math.hypot(p.x, p.z - 0.3) > 1.2 && !isSmoke(p));
  assert.ok(front.length > 40, 'the front is a dense wall, not scattered teeth');
  assert.ok(Math.max(...front.map(p => p.x)) - Math.min(...front.map(p => p.x)) > 2.4, 'the front spans the fan');
  assert.ok(front.every(p => Math.abs(Math.atan2(p.x, p.z - 0.3)) < 1.15), 'flames stay inside the ±48° fan');
  const heat = p => p.color[1];
  const hottestEdge = Math.max(...early.filter(p => Math.hypot(p.x, p.z - 0.3) > 0.6).map(heat));
  assert.ok(hottestEdge > Math.max(...late.map(heat)), 'the blast cools from yellow-white towards red');
});

test('fireballs fly as white-hot heads with tapering comet tails and shed sparks', () => {
  const points = frame('projectile', 0.4, 1, 0);
  const head = points.filter(p => Math.hypot(p.x, p.z) < 0.15);
  const tail = points.filter(p => p.z < -0.5);
  assert.ok(head.some(p => p.char === '%' || p.char === '@'), 'dense glyphs at the head');
  assert.ok(head.some(p => p.color[2] > 150), 'the head burns near white');
  assert.ok(tail.length >= 8, 'a long tail streams behind the round');
  const meanG = list => list.reduce((sum, p) => sum + p.color[1], 0) / list.length;
  assert.ok(meanG(tail) < meanG(head), 'the tail cools to red behind the head');
  assert.ok(Math.max(...tail.map(p => Math.abs(p.x))) < 0.4, 'the comet is a tight streak, not a cloud');
  assert.ok(frame('projectile', 0.01, 1, 0).length < points.length, 'the tail grows in as the round launches');
});

test('impacts flash white, swell into a solid fireball, burn out hollow and throw embers', () => {
  const flash = frame('impact', 0.02, 1, 0);
  assert.ok(flash.some(p => p.char === '@' && p.color[2] > 200 && p.brightness > 0.9), 'white flash at the hit');

  const inner = (points, p) => points.filter(q => !isSmoke(q) && Math.abs(q.x) < 0.12
    && Math.abs(q.z + 0.75 * 0.35 * p * p) < 0.2 && q.brightness > 0.2);
  const swell = frame('impact', 0.2, 1, 0), burnt = frame('impact', 0.55, 1, 0);
  assert.ok(inner(swell, 0.2).length >= 4, 'the young fireball is solid through its middle');
  assert.equal(inner(burnt, 0.55).length, 0, 'the core burns out into a hollow shell');

  // The body is laid on the screen cell grid: one glyph per cell, every other column, staggered by row.
  const onGrid = v => Math.abs(v - Math.round(v)) < 1e-6, lift = 0.75 * 0.35 * 0.2 ** 2; // the ball rises as it burns
  const body = swell.filter(p => onGrid(p.x * 26) && onGrid((p.z + lift) * 6.5) && Math.abs(p.x) < 0.6);
  const cells = new Set(body.map(p => `${Math.round(p.x * 26)},${Math.round((p.z + lift) * 6.5)}`));
  assert.ok(body.length > 40 && cells.size === body.length, 'a full ball without stacked glyphs');
  assert.ok(!body.some(p => cells.has(`${Math.round(p.x * 26) + 1},${Math.round((p.z + lift) * 6.5)}`)),
    'neighbouring columns stay open so the glow never blooms into a blob');

  const spread = points => Math.max(...points.filter(p => p.char === '*' || p.char === '+' || p.char === ':')
    .map(p => Math.hypot(p.x, p.z)));
  assert.ok(spread(frame('impact', 0.4, 1, 0)) > spread(frame('impact', 0.1, 1, 0)), 'embers fly outwards');
  assert.ok(frame('impact', 0.3, 1, 0).some(p => p.char === ','), 'a scorch ring marks the ground');
  assert.ok(frame('impact', 0.5, 1, 0).some(isSmoke), 'smoke billows off the burnt-out ball');
  assert.ok(light(frame('impact', 0.95)) < light(frame('impact', 0.6)), 'late flames fade cleanly');
});

test('fireblast trail puffs and burning auras stay lean and on theme', () => {
  const puff = frame('pulse', 0.3);
  assert.ok(puff.length > 10 && puff.length <= 40, 'pulse ticks are small, frequent puffs');
  const aura = frame('aura', 0.5, 1, 0);
  assert.ok(aura.some(p => p.char === '^'), 'flame tongues lick upwards around a burning target');
  assert.ok(aura.some(isSmoke), 'burning targets smoke');
  assert.ok(frame('aura', 0.05).some(p => p.char === '*'), 'ignition flares on the first frames');
});

test('sound uses six clipped fireball pops and a delayed emphatic low blast', () => {
  const pops = presentation.sounds.cast.slice(0, 6);
  assert.ok(pops.every(p => p.kind === 'tone' && p.duration < 0.1 && p.endFrequency < p.frequency));
  for (let i = 1; i < pops.length; i++) {
    assert.ok(Math.abs(pops[i].delay - pops[i - 1].delay - 0.15) < 1e-8, 'shots follow the gameplay rhythm');
    assert.notEqual(pops[i].type, pops[i - 1].type, 'alternating barrel timbres');
  }
  const blast = presentation.sounds.cast.slice(6);
  assert.ok(blast.some(v => v.kind === 'noise') && blast.some(v => v.endFrequency < 50));
  assert.ok(blast.every(v => v.delay > pops.at(-1).delay && v.duration > pops[0].duration));
  assert.ok(presentation.sounds.impact.some(v => v.kind === 'noise' && v.filterType === 'highpass'),
    'impact includes a short ember fizz after the attack');
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const v of voices) {
      assert.ok(v.gain > 0 && v.gain <= 0.25);
      assert.ok(v.duration > 0 && v.duration <= 2.5);
      assert.ok(v.delay >= 0 && v.delay <= 2);
      assert.ok(v.attack > 0 && v.release > 0 && v.attack + v.release <= v.duration);
    }
  }
});

test('real casts render the barrage profile and emit its typed cast/impact cues', () => {
  const scene = runeScene(spell, { range: 6 }), sounds = [];
  scene.casting.onSound = cue => sounds.push(cue);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejects a second cast');
  assert.equal(sounds.filter(cue => cue.stage === 'cast').length, 1);
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));

  scene.advance(0.4);
  assert.ok(scene.casting.projectiles.length > 0, 'source graph launches real fireballs');
  const stationary = [], moving = [];
  scene.casting.effects.paint((...point) => stationary.push(point));
  scene.casting.effects.paint((...point) => moving.push(point), scene.casting.projectiles);
  const rounds = moving.slice(stationary.length);
  assert.ok(rounds.length > scene.casting.projectiles.length * 10, 'each projectile draws its head, tail and sparks');
  assert.ok(rounds.some(point => point[2] === '%' || point[2] === '@') && rounds.some(point => point[2] === ':'),
    'runtime paints the dense fireball head and its cooling tail');

  scene.advance(4);
  assert.ok(scene.foe.health < 100, 'presentation preserves barrage damage');
  assert.ok(sounds.some(cue => cue.type === 'spell' && cue.stage === 'impact'));
  assert.ok(sounds.every(cue => cue.type === 'spell' && cue.spellId === spell.id && cue.presentation === presentation),
    'casts and hits use typed spell cues instead of sword draw/slam sounds');
});
