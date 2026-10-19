import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/mitlan-glyph.js';
import spell from '../../src/spells/definitions/mitlan-glyph.js';
import { SpellEffects } from '../../src/spells/effects.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress = 0.35, overrides = {}) {
  const points = [];
  const life = overrides.life ?? presentation.duration;
  const effect = Object.freeze({ stage, progress, age: progress * life,
    life, radius: 1, heading: 0, ...overrides });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}
// The 8 s glyph totems, checked at an absolute age.
const zoneAt = (age, overrides = {}) => draw('zone', age / 8, { life: 8, age, radius: 4, ...overrides });
const lit = points => points.filter(p => p.brightness > 0.05);
const radius = p => Math.hypot(p.x, p.z);
const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
const BUDGET = { cast: 200, projectile: 110, impact: 200, pulse: 90, aura: 160, zone: 160 };

test('the zone inscribes a water triskele inside a flowing ring, then dissolves', () => {
  assert.equal(spell.presentation, presentation);
  const settled = zoneAt(2.4), tips = settled.filter(p => p.char === 'O');
  assert.equal(tips.length, 3, 'three curling arms end in droplet tips');
  const radii = tips.map(radius);
  assert.ok(radii.every(r => Math.abs(r - radii[0]) < 1e-9));
  for (let i = 0; i < tips.length; i++) {
    const a = tips[i], b = tips[(i + 1) % tips.length];
    assert.ok(Math.abs((a.x * b.x + a.z * b.z) / radii[i] ** 2 + 0.5) < 1e-9, 'the arms are evenly spaced');
  }
  assert.equal(settled.filter(p => p.char === '@').length, 4, 'a bright seal plus three foam heads racing round the ring');
  assert.ok(settled.some(p => p.char === '(') && settled.some(p => p.char === ')'), 'the ring reads as a round, foreshortened circle');
  assert.ok(radii[0] < 4 * 0.42, 'the sigil sits well inside the 4 m damage radius');

  const opening = zoneAt(0.25);
  assert.ok(lit(opening).length < lit(settled).length * 0.6, 'the ring sweeps itself in rather than popping');
  assert.ok(opening.some(p => p.char === '*'), 'the sweeping head of the ring is foam');
  assert.equal(opening.filter(p => p.char === 'O').length, 0, 'arms are still growing');
  assert.ok(zoneAt(0).some(p => p.char === '*' && p.brightness > 0.9), 'the glyph lands with a splash');

  const rippleR = Math.max(...lit(zoneAt(1.9)).map(radius));
  assert.ok(rippleR > Math.max(...lit(zoneAt(0.85)).map(radius)) + 0.5, 'a ripple rolls out towards the hit radius');
  assert.notDeepEqual(zoneAt(3), zoneAt(3.05), 'the current keeps flowing');

  const dissolve = [6.4, 7.2, 7.7].map(age => lit(zoneAt(age)));
  assert.ok(dissolve[0].length > dissolve[1].length && dissolve[1].length > dissolve[2].length, 'the glyph breaks up');
  assert.ok(Math.max(...dissolve[2].map(p => p.brightness)) < Math.max(...dissolve[0].map(p => p.brightness)));
});

test('the zone is authored in screen space so strokes and lift ignore the caster heading', () => {
  const screen = heading => {
    const cells = [];
    paintPresentation(presentation, { x: 0, y: 0, stage: 'zone', age: 2.4, life: 8, radius: 4, heading },
      (x, y, char) => cells.push(`${Math.round(x * 1e6)},${Math.round(y * 1e6)},${char}`));
    return cells;
  };
  assert.deepEqual(screen(2), screen(0));
});

test('the short summoning totem draws water inward to the seal', () => {
  const heads = p => lit(draw('zone', p, { life: 1, radius: 4 })).filter(q => q.char === 'o' && radius(q) > 0.01);
  assert.equal(heads(0.25).length, 3, 'three streams lead with a droplet');
  assert.ok(mean(heads(0.5).map(radius)) < mean(heads(0.25).map(radius)) - 1, 'the streams converge');
  const core = p => draw('zone', p, { life: 1, radius: 4 }).find(q => q.x === 0 && q.z === 0);
  assert.ok(core(0.85).brightness > core(0.3).brightness, 'the seal brightens as the water arrives');
});

test('casting winds up, inscribes and flashes the seal, then releases a ripple and spray', () => {
  const streams = p => lit(draw('cast', p, { radius: 0.8 })).filter(q => q.char === 'o');
  const gather = [0.12, 0.3].map(p => mean(streams(p).map(radius)));
  assert.ok(gather[1] < gather[0] - 0.3, 'streams spiral in towards the caster');
  const core = p => draw('cast', p, { radius: 0.8 }).find(q => q.x === 0 && q.z === 0);
  assert.equal(core(0.6).char, '@');
  assert.ok(core(0.6).brightness > 0.95 && core(0.6).brightness > core(0.45).brightness, 'a strong flash frame');
  const seal = lit(draw('cast', 0.5, { radius: 0.8 }));
  assert.ok(seal.some(p => p.char === '(') && seal.some(p => p.char === ')'));
  const ripple = p => Math.max(...lit(draw('cast', p, { radius: 0.8 })).map(radius));
  assert.ok(ripple(0.85) > ripple(0.66) + 0.3, 'the release ripple expands');
  assert.ok(lit(draw('cast', 0.7, { radius: 0.8 })).some(p => p.char === '\''), 'droplets are flung upward');
  assert.ok(lit(draw('cast', 0.97, { radius: 0.8 })).length < lit(draw('cast', 0.8, { radius: 0.8 })).length);
});

test('the projectile is a spinning seal with a wake streaming behind its heading', () => {
  const points = draw('projectile', 0.04, { life: 10, age: 0.4, radius: 0.65 });
  assert.equal(points.filter(p => p.char === '@').length, 1);
  assert.equal(points.filter(p => p.char === 'o').length, 3, 'three triskele beads');
  const wake = points.filter(p => radius(p) > 0.45);
  assert.ok(wake.length >= 20 && wake.every(p => p.z < 0.2), 'the wake trails behind the travel direction');
  assert.ok(points.every(p => radius(p) < 2.2));
  const turned = draw('projectile', 0.04, { life: 10, age: 0.4, radius: 0.65, heading: Math.PI / 2 });
  assert.ok(turned.filter(p => radius(p) > 0.45).every(p => p.z < 0.6), 'the wake follows any heading');
  assert.notDeepEqual(draw('projectile', 0.04, { life: 10, age: 0.4 }), draw('projectile', 0.045, { life: 10, age: 0.45 }));
  const extent = age => Math.max(...lit(draw('projectile', age / 10, { life: 10, age })).map(radius));
  assert.ok(extent(0.02) < extent(0.4) * 0.6, 'the seal and wake grow in from launch');
});

test('impact erupts a geyser that crowns into spray and rains back down', () => {
  const at = p => lit(draw('impact', p, { life: 0.6, age: p * 0.6 }));
  assert.ok(at(0.03).some(p => p.char === '*' && p.color.every(c => c > 220)), 'white flash frame');
  const column = at(0.3).filter(p => p.char === '|');
  assert.ok(column.length >= 8, 'a solid column of water');
  assert.ok(Math.min(...column.map(p => p.z)) < -1.2, 'the column rises well above the ground');
  assert.ok(at(0.3).some(p => p.char === '%' || p.char === '*'), 'a foam crest tops the geyser');
  const late = at(0.88);
  assert.equal(late.filter(p => p.char === '|').length, 0, 'the column collapses');
  assert.ok(late.filter(p => p.char === ',').length >= 8, 'droplets land around the target');
});

test('pulses splash outward at their configured size and auras bind the target in water', () => {
  const ring = (p, r) => Math.max(...lit(draw('pulse', p, { life: 0.25, radius: r })).map(radius));
  assert.ok(ring(0.6, 1) > ring(0.1, 1), 'the ripple expands');
  assert.ok(ring(0.5, 6) > ring(0.5, 3) * 1.6 && ring(0.5, 3) > ring(0.5, 1) * 2, 'sized by the visual radius');
  assert.ok(lit(draw('pulse', 0.4, { life: 0.25 })).some(p => p.char === '\''), 'a crown of droplets');
  const aura = lit(draw('aura', 0.4, { life: 1.5 }));
  const waist = aura.filter(p => p.z < -0.45), feet = aura.filter(p => p.z > -0.1);
  assert.ok(waist.length >= 8 && feet.length >= 14, 'bands at the feet and the waist');
  assert.ok(Math.max(0, ...draw('aura', 0.01, { life: 1.5 }).map(p => p.brightness)) < 0.3, 'the shackles fade in');
});

test('all stages remain deterministic, finite and within budget, then fade cleanly', () => {
  const lives = { cast: [presentation.duration], projectile: [10, 1], impact: [0.6, 1.15], pulse: [0.25], aura: [1.5, 0.3], zone: [8, 1] };
  for (const stage of Object.keys(BUDGET)) {
    for (const life of lives[stage]) {
      for (const size of [0.8, 1, 4, 6]) {
        for (const progress of [0, 0.05, 0.25, 0.5, 0.7, 0.9, 0.99, 1]) {
          const options = { radius: size, life };
          const points = draw(stage, progress, options);
          assert.ok(points.length > 0 && points.length <= BUDGET[stage], `${stage} ${size} ${progress}: ${points.length}`);
          assert.deepEqual(points, draw(stage, progress, options));
          for (const point of points) {
            assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
            assert.ok(Math.abs(point.x) < 6 && Math.abs(point.z) < 6);
            assert.match(point.char, /^[\x20-\x7e]$/);
            assert.ok(point.color.every(channel => channel >= 0 && channel <= 255));
            assert.ok(point.brightness >= 0 && point.brightness <= 1);
          }
          if (progress === 1) assert.ok(points.every(point => point.brightness === 0), `${stage} fades out`);
        }
      }
    }
  }
});

test('sound phrase has three timed liquid glides over a submerged hum and a separate droplet seal', () => {
  const cast = presentation.sounds.cast;
  const hum = cast.find(v => v.kind === 'tone' && v.frequency < 200);
  assert.ok(hum.duration > 0.8 && hum.attack > 0.1 && hum.cutoff < 500);
  const notes = cast.filter(v => v.kind === 'tone' && v !== hum);
  assert.equal(notes.length, 3);
  assert.ok(notes.every(v => v.type === 'sine' && v.endFrequency < v.frequency && v.attack < 0.01));
  assert.ok(notes[0].frequency < notes[1].frequency && notes[1].frequency < notes[2].frequency);
  assert.ok(Math.abs((notes[1].delay - notes[0].delay) - (notes[2].delay - notes[1].delay)) < 1e-9);
  assert.ok(presentation.sounds.impact.some(v => v.kind === 'tone' && v.frequency > 1000 && v.attack < 0.005));
  assert.notDeepEqual(presentation.sounds.impact, cast);
  assert.ok(presentation.sounds.pulse.every(v => v.gain < 0.025 && v.duration < 0.15));
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
      assert.ok(Object.values(voice).filter(v => typeof v === 'number').every(Number.isFinite));
    }
  }
});

test('authored liquid layers schedule their delays through the spatial effects bus', () => {
  const fake = fakeRecordedAudio();
  for (const stage of ['cast', 'impact']) {
    const before = fake.nodes.length;
    const handles = playSpellSound(fake.engine, { type: 'spell', stage, presentation, x: 3, y: 9 });
    const sources = fake.nodes.slice(before).filter(n => n.kind === 'oscillator' || n.kind === 'source');
    assert.equal(handles.length, presentation.sounds[stage].length);
    assert.deepEqual(sources.map(n => n.starts[0]),
      presentation.sounds[stage].map(voice => fake.context.currentTime + (voice.delay ?? 0)));
    handles.forEach(handle => handle.stop());
  }
  assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 3 && route.y === 9 && route.disposals === 1));
  assert.deepEqual(fake.invalid, []);
});

test('real Mitlan Glyph cast renders the profile and emits typed cast/impact cues with unchanged rune behavior', () => {
  const scene = runeScene(spell, { range: 1 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.casting.mana, 92);
  assert.equal(scene.cast().ok, false);
  assert.equal(events.filter(e => e.stage === 'cast').length, 1, 'rejected recasts stay silent');
  assert.ok(scene.casting.effects.list.some(e => e.presentation === presentation && e.stage === 'cast'));
  const moving = [];
  new SpellEffects().paint((...point) => moving.push(point), scene.casting.projectiles);
  assert.ok(moving.some(p => p[2] === '~') && moving.some(p => p[2] === 'o'), 'the real launched projectile uses the small spiral');
  scene.advance(0.8);
  assert.equal(scene.foe.health, 100, 'the configured arming delay remains intact');
  assert.ok(scene.casting.effects.list.some(e => e.presentation === presentation && e.stage === 'zone'));
  for (let i = 0; i < 40 && scene.foe.health === 100; i++) scene.advance(0.05);
  assert.equal(scene.foe.health, 86);
  assert.ok(scene.aura(scene.foe, 'Slowed'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  const rendered = [];
  scene.casting.effects.paint((...point) => rendered.push(point), scene.casting.projectiles);
  assert.ok(rendered.some(p => p[2] === '!'), 'contact erupts the geyser beneath the target');
  assert.ok(rendered.some(p => p[2] === '@'), 'the newly landed glyph shows its bright seal');
});
