import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-last-stand.js';
import spell from '../../src/spells/definitions/temp-last-stand.js';
import { runeScene } from '../../test-support/spells.js';

function frame(stage, progress = 0.25, extra = {}) {
  const points = [];
  presentation.draw({ stage, progress, age: progress * presentation.duration, life: presentation.duration,
    radius: 2, heading: 0, ...extra }, (x, z, char, color, brightness = 1) => {
    points.push({ x, z, char, color, brightness });
  });
  return points;
}

test('Flight of the Gladiator opts into its presentation without changing its rune resource costs', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.deepEqual(spell.variants[0].params, { cooldown: 20, mana: 8, damage: 20 });
  assert.equal(spell.checksum, 'ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7');
});

test('a real rune cast renders the crest and sends its own cast and landing sound cues', () => {
  const { casting, cast, advance, foe } = runeScene(spell, { range: 2 });
  const cues = [];
  casting.onSound = cue => cues.push(cue);
  assert.equal(cast().ok, true);
  const launch = casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(launch.presentation, presentation);
  assert.equal(launch.life, presentation.duration);
  assert.ok(cues.some(cue => cue.type === 'spell' && cue.stage === 'cast' && cue.presentation === presentation));
  advance(0.25);
  const rendered = [];
  casting.effects.paint((x, z, char) => rendered.push(char), casting.projectiles);
  assert.ok(rendered.filter(char => char === '|').length >= 6, 'runtime paints the raised gladius blade');
  assert.ok(rendered.includes('^') && rendered.includes('='), 'runtime paints the blade point and its guard');
  advance(0.25);
  assert.equal(foe.health, 90);
  advance(2);
  assert.equal(foe.health, 70);
  assert.ok(cues.some(cue => cue.type === 'spell' && cue.stage === 'impact' && cue.presentation === presentation));
  assert.ok(cues.filter(cue => cue.type === 'spell').every(cue => cue.spellId === spell.id));
  assert.ok(cues.every(cue => cue.type !== 'draw' && cue.type !== 'slam'), 'generic weapon sounds are replaced by spell cues');
});

const tip = points => points.find(p => p.char === '^');
const reach = points => Math.max(...points.map(p => Math.hypot(p.x, p.z)));
const count = (points, test) => points.filter(test).length;

test('the cast rallies, springs back on burning wings, dives home and stamps the ground', () => {
  // Rally: a ring of fire contracts around a gladius that is drawn up out of the ground.
  const early = frame('cast', 0.03), rally = frame('cast', 0.35);
  const ring = points => points.filter(p => Math.hypot(p.x, p.z) > 0.7);
  const meanRing = points => ring(points).reduce((sum, p) => sum + Math.hypot(p.x, p.z), 0) / ring(points).length;
  assert.ok(meanRing(rally) < meanRing(early) - 0.3, 'the rally ring contracts toward the caster');
  assert.ok(count(rally, p => p.char === '|') >= 8, 'the gladius blade is a continuous column');
  assert.ok(count(rally, p => p.char === '=') >= 8, 'the gladius has a broad guard');
  assert.ok(Math.abs(tip(rally).z) < 1.4, 'the blade is still raised at the caster');
  // Flight: the crest springs back (local -z), spreading wide feathered wings.
  const apex = frame('cast', 0.78);
  assert.ok(tip(apex).z < -2.5, 'the crest has sprung back behind the caster');
  const wingSpan = Math.max(...apex.map(p => Math.abs(p.x)));
  assert.ok(wingSpan > 1.2, 'the wings are spread wide');
  assert.ok(count(apex, p => p.x < -0.5) >= 12 && count(apex, p => p.x > 0.5) >= 12, 'both wings are full silhouettes');
  assert.ok(count(apex, p => p.char === '/') >= 8 && count(apex, p => p.char === '\\') >= 8, 'feathers are drawn as slanted strokes');
  // Dive: the crest returns toward the caster with its wings swept back.
  const dive = frame('cast', 0.9);
  assert.ok(tip(dive).z > tip(apex).z + 0.5, 'the crest dives back toward the landing point');
  // Landing: a white stamp at the caster and a spreading cracked ring.
  const land = frame('cast', 0.95), late = frame('cast', 0.985);
  const stamp = land.find(p => p.char === '@');
  assert.ok(stamp && Math.hypot(stamp.x, stamp.z) < 0.05, 'the landing is stamped at the caster');
  assert.deepEqual(stamp.color, [255, 250, 232]);
  assert.ok(reach(late) > reach(land.filter(p => p.brightness > 0.5)) * 0.9, 'landing ring and embers spread out');
  assert.ok(Math.max(...late.map(p => p.brightness)) < Math.max(...land.map(p => p.brightness)), 'the landing cools');
  // Motion is continuous: the blade tip never jumps far between 60 fps frames (the dive itself is a fast lunge).
  for (let p = 0.42; p < 0.92; p += 1 / 60 / presentation.duration) {
    const a = tip(frame('cast', p)), b = tip(frame('cast', p + 1 / 60 / presentation.duration));
    if (a && b) assert.ok(Math.abs(a.z - b.z) < (p < 0.83 ? 0.2 : 0.55), `the crest moves smoothly at p=${p.toFixed(3)}`);
  }
});

test('impact flashes white, cuts a crossing X and sprays cooling embers on a spreading ring', () => {
  const flash = frame('impact', 0.02, { radius: 1, life: 0.6 });
  const core = flash.find(p => p.char === '@');
  assert.ok(core && core.x === 0 && core.z === 0 && core.brightness === 1, 'a full white flash at the contact point');
  const cut = frame('impact', 0.18, { radius: 1, life: 0.6 });
  assert.ok(count(cut, p => p.char === '\\') >= 14 && count(cut, p => p.char === '/') >= 14, 'two thick crossing cuts');
  // The cuts are true diagonals: a '\\' stroke runs down-right and '/' down-left.
  const back = cut.filter(p => p.char === '\\' && Math.abs(p.z) < 0.8 && Math.abs(p.x) < 0.45);
  assert.ok(back.filter(p => p.x * p.z > 0).length > back.filter(p => p.x * p.z < 0).length);
  const late = frame('impact', 0.6, { radius: 1, life: 0.6 });
  assert.ok(count(late, p => p.char === '\\' || p.char === '/') < count(cut, p => p.char === '\\' || p.char === '/') / 2,
    'the cuts erode away');
  assert.ok(reach(late) > reach(frame('impact', 0.1, { radius: 1, life: 0.6 })), 'the ring and embers spread');
  assert.ok(!late.some(p => p.char === '@'), 'the flash is gone by the follow-through');
  assert.ok(reach(frame('impact', 0.3, { radius: 2 })) > reach(frame('impact', 0.3, { radius: 1 })), 'impact scales with radius');
});

test('pulse rings follow their burst radius and the aura is a laurel that grows in and burns away', () => {
  const small = frame('pulse', 0.5, { radius: 2, life: 0.25 }), large = frame('pulse', 0.5, { radius: 8, life: 0.25 });
  assert.ok(reach(large) > reach(small) * 3, 'each shockwave sits on its own burst radius');
  assert.ok(reach(frame('pulse', 0.8, { radius: 4 })) > reach(frame('pulse', 0.1, { radius: 4 })), 'the shockwave expands');

  const sprout = frame('aura', 0.05, { radius: 1, life: 1.5 }), full = frame('aura', 0.45, { radius: 1, life: 1.5 });
  const burnt = frame('aura', 0.93, { radius: 1, life: 1.5 });
  assert.ok(full.length > sprout.length * 2, 'the wreath grows in');
  const left = count(full, p => p.x < -0.4), right = count(full, p => p.x > 0.4);
  assert.ok(left >= 25 && right >= 25 && Math.abs(left - right) <= 6, 'two matching laurel branches');
  assert.ok(full.some(p => p.char === '^' && p.z < -0.6), 'a flame crest sits in the gap at the top of the wreath');
  assert.ok(full.some(p => p.char === '@' && p.z > 0.6), 'the branches meet in a knot at the bottom');
  assert.ok(count(burnt, p => p.brightness > 0.2) < count(full, p => p.brightness > 0.2) / 2, 'the leaves burn away');

  const projectile = frame('projectile', 0.4);
  assert.ok(projectile.length <= 110 && count(projectile, p => p.char === '|') >= 6, 'a compact thrown gladius');
  assert.ok(projectile.some(p => p.char === '*' && p.z > 0.5) && projectile.some(p => p.z < -1), 'point forward, fire trail behind');
});

test('all effect stages remain deterministic, bounded, finite and fade completely', () => {
  const budget = { cast: 230, impact: 230, pulse: 90, aura: 160, zone: 160, projectile: 110 };
  for (const stage of Object.keys(budget)) {
    for (const radius of [1, 2, 10]) {
      for (const p of [0, 0.03, 0.2, 0.45, 0.7, 0.8, 0.9, 0.95, 0.99]) {
        const points = frame(stage, p, { radius });
        assert.ok(points.length > 0 || p >= 0.95 || stage === 'zone' && p === 0, `${stage} draws at ${p}`);
        assert.ok(points.length <= budget[stage], `${stage} r${radius} p${p} uses ${points.length}`);
        assert.deepEqual(points, frame(stage, p, { radius }));
        for (const point of points) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
          assert.ok(Math.abs(point.x) <= (radius > 4 ? 16 : 8) && Math.abs(point.z) <= (radius > 4 ? 16 : 8));
          assert.match(point.char, /^[\x20-\x7e]$/);
          assert.equal(point.color.length, 3);
          assert.ok(point.color.every(c => Number.isInteger(c) && c >= 0 && c <= 255));
          assert.ok(Number.isFinite(point.brightness) && point.brightness > 0 && point.brightness <= 1);
        }
      }
    }
    assert.deepEqual(frame(stage, 1), []);
    assert.ok(Math.max(...frame(stage, 0.99).map(p => p.brightness)) < 0.5, `${stage} has nearly faded out`);
    assert.notDeepEqual(frame(stage, 0.1), frame(stage, 0.6));
  }
  assert.deepEqual(frame('cast', 0.3, { heading: 2 }), frame('cast', 0.3), 'heading rotation belongs to the runtime');
});

test('dark air and wing gestures follow the flight before a separate muted landing', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const clip = (layers, name) => layers.find(v => v.url.endsWith('/' + name + '.wav'));
  assert.equal(clip(cast, 'air-draw').delay, 0, 'air gathers with the raised blade');
  assert.equal(clip(cast, 'wing-sweep').delay, 0.6, 'cloth wings open at the backward launch');
  assert.equal(clip(cast, 'air-release').delay, 1.2, 'the air sweep marks the forward dive');
  assert.equal(clip(impact, 'muted-hit').delay, 0, 'the landing starts with a solid contact');
  assert.ok(clip(impact, 'pressure').gain <= 0.25, 'landing weight stays restrained');
  assert.ok(clip(impact, 'pressure').delay > clip(impact, 'muted-hit').delay);
  assert.ok(pulse.every(v => v.gain <= 0.15), 'repeated waves stay quiet');
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 4);
    assert.ok(voices.reduce((sum, voice) => sum + voice.gain, 0) <= 0.75);
    for (const voice of voices) {
      assert.equal(voice.kind, 'recording');
      assert.match(voice.url, /^\/assets\/audio\/spells\/oseni\/[a-z-]+\.wav$/);
      assert.deepEqual(Object.keys(voice).sort(), ['delay', 'gain', 'kind', 'rate', 'url']);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
      assert.ok(voice.gain >= 0.04 && voice.gain <= 0.35);
    }
  }
  assert.notDeepEqual(cast, impact);
});
