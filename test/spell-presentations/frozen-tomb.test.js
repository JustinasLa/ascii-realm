import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import spell from '../../src/spells/definitions/frozen-tomb.js';
import presentation from '../../src/spells/presentations/frozen-tomb.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

// Gameplay lifetimes: cast flash, the target's 5 s tomb, the 1 s frost fields at
// radius 4 and 3, 0.25 s visual bursts, the 0.6 s damage impact and the slow aura.
const LIVES = { cast: presentation.duration, projectile: 10, impact: 0.6, pulse: 0.25, aura: 0.3, zone: 1 };
const RADII = { cast: 0.8, projectile: 0.65, impact: 1, pulse: 2, aura: 1, zone: 4 };

function draw(stage, { progress = 0.5, life = LIVES[stage], age = progress * life, radius = RADII[stage], heading = 0 } = {}) {
  const points = [];
  const effect = Object.freeze({ stage, progress: Math.min(1, age / life), age, life, radius, heading });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}
const tomb = (age, extra = {}) => draw('zone', { age, life: 5, radius: 0.2, ...extra });
const lit = points => points.filter(point => point.brightness > 0.05);
const top = points => Math.min(...points.map(point => point.z));
const width = points => Math.max(...points.map(point => Math.abs(point.x)));
const glow = points => points.reduce((sum, point) => sum + point.color[0] + point.color[1] + point.color[2], 0) / points.length;
const cells = (effect, budget = 256) => {
  const out = [];
  paintPresentation(presentation, { x: 0, y: 0, ...effect }, (x, y, char) => out.push({ x, y, char }), budget);
  return out;
};
// Same glyphs on the same screen cells (up to float noise) after the adapter's heading turn.
const sameScreen = (a, b) => a.length === b.length
  && a.every((cell, i) => cell.char === b[i].char && Math.abs(cell.x - b[i].x) < 1e-6 && Math.abs(cell.y - b[i].y) < 1e-6);

test('Frozen Tomb seals the target in an upright bevelled ice coffin that rises from the ground', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const sealed = lit(tomb(1.5));
  // Screen up is negative z: the coffin is tall, narrow at the head and widest at the shoulders.
  assert.ok(top(sealed) < -1.8, 'the coffin stands more than two metres tall');
  const head = sealed.filter(point => point.z < -1.5 && point.z > -1.75);
  const shoulders = sealed.filter(point => point.z > -1.15 && point.z < -0.95);
  assert.ok(width(head) < width(shoulders), 'the narrow head widens into angular shoulders');
  assert.ok(sealed.some(point => point.char === '/') && sealed.some(point => point.char === '\\'), 'slanted coffin walls');
  assert.ok(sealed.filter(point => point.char === '-' && point.z < -1.6).length >= 8, 'a solid lid edge and bevelled top');
  assert.ok(top(lit(tomb(0.05))) > top(sealed) * 0.4, 'the ice starts at the foot');
  assert.ok(top(lit(tomb(0.25))) < top(lit(tomb(0.05))) - 0.6, 'and the slabs grow up around the target');
  assert.ok(glow(lit(tomb(0.4))) > glow(sealed) + 30, 'the lid flashes white as it seals');
  assert.ok(sameScreen(cells({ stage: 'zone', age: 1.5, life: 5, radius: 0.2, heading: 0 }),
    cells({ stage: 'zone', age: 1.5, life: 5, radius: 0.2, heading: 2.1 })), 'the tomb stays upright whatever the facing');
});

test('Frozen Tomb glints while held, cracks when the damage lands and bursts into falling shards', () => {
  assert.notDeepEqual(tomb(1.6), tomb(2.4), 'a glint sweeps the sealed face');
  const before = lit(tomb(0.9)).length, after = lit(tomb(2)).length;
  assert.ok(after >= before + 6, 'fault lines open across the face after the damage pulse');
  const holding = lit(tomb(4.2)), bursting = lit(tomb(4.55)), settled = lit(tomb(4.92));
  assert.ok(width(bursting) > width(holding) + 0.15, 'the slabs kick outward');
  assert.ok(bursting.some(point => "'.,*`".includes(point.char)), 'into ice chips');
  assert.ok(top(settled) > top(holding) + 0.8, 'pieces fall under gravity');
  assert.ok(settled.length < holding.length, 'and thin out as they settle');
  assert.ok(Math.max(...tomb(4.92).map(point => point.brightness)) < 0.1, 'the shards fade before the root ends');
});

test('Frozen Tomb freezes the landing ground into interleaved six-armed frost stars', () => {
  const tips = (radius, progress) => draw('zone', { radius, progress }).filter(point => point.char === '*' || point.char === '+');
  const angles = points => points.map(point => Math.round(Math.atan2(point.z, point.x) * 180 / Math.PI)).sort((a, b) => a - b);
  assert.equal(tips(4, 0.3).length, 6, 'six racing frost tips');
  const reach = progress => Math.max(...tips(4, progress).map(point => Math.hypot(point.x, point.z)));
  assert.ok(reach(0.05) < reach(0.2) && reach(0.2) < reach(0.4), 'arms grow outward with easing');
  assert.ok(tips(4, 0.5).every(point => point.char === '+'), 'tips settle once fully grown');
  const outer = angles(tips(4, 0.3)), inner = angles(tips(3, 0.3));
  assert.ok(inner.every(angle => !outer.includes(angle)), 'the radius 3 and 4 fields interleave into a twelve-point star');
  assert.ok(lit(draw('zone', { progress: 0.95 })).length < lit(draw('zone', { progress: 0.5 })).length * 0.5, 'frost thins away');
});

test('Frozen Tomb casts from a hexagonal rune with a wind-up, a release flash and six rising ice spikes', () => {
  const cast = progress => draw('cast', { progress });
  const focus = points => points.filter(point => point.char === '.' || point.char === '*')
    .reduce((sum, point) => sum + Math.hypot(point.x, point.z - (0.55 - 1.15 * 5 / 6.5)), 0);
  assert.ok(focus(cast(0.14)) < focus(cast(0.01)), 'frost motes spiral into the focus');
  assert.ok(cast(0.13).some(point => point.char === '@'), 'white release flash');
  assert.ok(!cast(0.5).some(point => point.char === '@'), 'the flash is brief');
  const tips = progress => cast(progress).filter(point => point.char === '^');
  assert.equal(tips(0.45).length, 6, 'six spike points');
  assert.ok(top(tips(0.45)) < top(tips(0.18)) - 0.3, 'the spikes rise from the rune');
  assert.ok(!cast(0.95).some(point => point.char === '^'), 'and shatter into glitter before the end');
  const spikes = heading => cells({ stage: 'cast', age: 0.5, life: presentation.duration, radius: 0.8, heading })
    .filter(cell => cell.char === '^');
  assert.ok(sameScreen(spikes(0), spikes(1.2)), 'spikes always point up the screen');
});

test('Frozen Tomb flies a spinning coffin crystal with a cooling frost wake', () => {
  const flight = draw('projectile', { age: 0.06 });
  assert.ok(flight.some(point => point.char === '#' && point.z > 0), 'a bright core leads the crystal');
  const wake = flight.filter(point => point.z < -0.3);
  assert.ok(wake.length >= 30, 'a dense frost wake trails behind');
  assert.ok(wake.every(point => point.z < 0), 'the wake stays behind the crystal');
  assert.ok(width(flight) < 0.6, 'flight shape stays compact');
  assert.notDeepEqual(flight, draw('projectile', { age: 0.09 }), 'crystal spins and the wake streams with time');
  const near = flight.filter(point => point.z > -0.6 && point.z < -0.3), far = flight.filter(point => point.z < -1.4);
  assert.ok(glow(near) > glow(far), 'the wake cools away from the crystal');
});

test('Frozen Tomb impact, bursts and shackles have distinct choreography', () => {
  const impact = progress => draw('impact', { progress });
  assert.ok(impact(0.02).some(point => point.char === '@'), 'impact opens on a white core');
  const span = points => Math.max(...points.map(point => Math.hypot(point.x, point.z)));
  assert.ok(span(impact(0.3)) > span(impact(0.02)) + 0.4, 'faults and frost ring burst outward');
  const airborne = progress => impact(progress).filter(point => point.z < -0.6 && point.brightness > 0.05).length;
  assert.ok(airborne(0.9) < airborne(0.15), 'ice chips fall back to the ground');
  const radius = points => points.reduce((sum, point) => sum + Math.hypot(point.x, point.z), 0) / points.length;
  assert.ok(radius(draw('pulse', { progress: 0.7 })) > radius(draw('pulse', { progress: 0.1 })), 'burst needles fly outward');
  assert.ok(radius(draw('pulse', { radius: 4 })) > radius(draw('pulse', { radius: 1 })), 'bursts scale with their radius');
  const ring = progress => draw('aura', { progress }).filter(point => point.char !== '^' && point.char !== '|' || Math.abs(point.z) < 0.05);
  assert.ok(radius(ring(0.5)) < radius(ring(0.05)), 'frost shackles cinch around the feet');
  assert.ok(!draw('aura', { progress: 0.2 }).some(point => point.char === '^'), 'icicles wait for the lock');
  assert.equal(draw('aura', { progress: 0.6 }).filter(point => point.char === '^').length, 6, 'then six snap up');
});

test('Frozen Tomb geometry remains finite, bounded, deterministic and fades at every stage', () => {
  const budgets = { cast: 200, projectile: 110, impact: 200, pulse: 90, aura: 90, zone: 170 };
  const variants = [...Object.keys(budgets).map(stage => [stage, {}]),
    ['zone', { radius: 3 }], ['zone', { radius: 0.2, life: 5 }], ['pulse', { radius: 1 }], ['pulse', { radius: 4 }],
    ['projectile', { life: 0.05 }], ['cast', { heading: 2.4 }], ['zone', { radius: 0.2, life: 0.4 }]];
  for (const [stage, options] of variants) {
    for (const progress of [0, 0.17, 0.55, 0.94, 1]) {
      const points = draw(stage, { ...options, progress, age: undefined });
      assert.ok(points.length > 0 && points.length <= budgets[stage], `${stage} draw budget (${points.length})`);
      assert.deepEqual(points, draw(stage, { ...options, progress, age: undefined }), 'repeated render does not alter state');
      for (const point of points) {
        assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
        assert.ok(Math.abs(point.x) < 4 && Math.abs(point.z) < 4, 'local metre coordinates');
        assert.match(point.char, /^[\x20-\x7e]$/, 'one supported ASCII glyph');
        assert.ok(point.brightness >= 0 && point.brightness <= 1);
        assert.ok(point.color.every(channel => channel >= 0 && channel <= 255));
        if (progress === 1) assert.equal(point.brightness, 0, `${stage} fades completely`);
      }
    }
    assert.notDeepEqual(draw(stage, { ...options, progress: 0.1, age: undefined }),
      draw(stage, { ...options, progress: 0.95, age: undefined }), 'animation evolves');
  }
  // Smooth motion: one 60 fps step moves rising spikes and racing frost tips by about a cell.
  const step = (a, b) => Math.max(...a.map((point, i) => Math.hypot((point.x - b[i].x) * 26, (point.z - b[i].z) * 6.5)));
  const spikes = age => draw('cast', { age }).filter(point => point.char === '^');
  assert.ok(step(spikes(0.3), spikes(0.3 + 1 / 60)) < 2.5, 'spikes rise smoothly between frames');
  const field = age => draw('zone', { age }).filter(point => point.char === '*');
  assert.ok(step(field(0.2), field(0.2 + 1 / 60)) < 2.5, 'frost tips race smoothly between frames');
});

test('Frozen Tomb uses physical ice-field strain, lake fracture and compressed snow recordings', async () => {
  const { cast, impact, pulse } = presentation.sounds;
  const file = voice => voice.url.split('/').at(-1);
  assert.deepEqual(cast.map(file), ['ice-strain.wav', 'ice-rumble.wav', 'snow-scuff.wav']);
  assert.ok(cast[0].delay < cast[1].delay && cast[1].delay < cast[2].delay,
    'ice strain leads the rising mass and ground scuff');
  assert.deepEqual(impact.map(file), ['ice-split.wav', 'snow-crush.wav', 'ice-grit.wav']);
  assert.equal(impact[0].delay, 0, 'lake fracture lands with the damage');
  assert.ok(impact[0].gain > impact[1].gain && impact[1].gain > impact[2].gain,
    'heavy split leads compression and falling ice debris');
  assert.ok(impact[0].delay < impact[1].delay && impact[1].delay < impact[2].delay);
  assert.equal(pulse.length, 1, 'repeated frost only adds a quiet tick');
  assert.equal(file(pulse[0]), 'ice-tick.wav');
  assert.ok(pulse[0].gain >= 0.1 && pulse[0].gain <= 0.18);
  const provenance = JSON.parse(await readFile(new URL('../../assets/audio/spells/seithr/sources.json', import.meta.url), 'utf8'));
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length >= 1 && voices.length <= 4);
    assert.ok(voices.reduce((sum, voice) => sum + voice.gain, 0) <= 1.2);
    for (const voice of voices) {
      assert.equal(voice.kind, 'recording', 'no oscillator or generated noise layers');
      assert.deepEqual(Object.keys(voice).sort(), ['delay', 'gain', 'kind', 'rate', 'url']);
      assert.ok([voice.gain, voice.rate, voice.delay].every(Number.isFinite));
      assert.ok(voice.gain >= 0.1 && voice.gain <= 0.8);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      const clip = provenance.clips.find(entry => entry.file === file(voice));
      assert.ok(clip, 'recording has a documented source clip');
      const source = provenance.sources.find(entry => entry.id === clip.sourceId);
      assert.ok(source?.provenance && source?.page && source?.license, 'physical recording has attribution and license');
      const bytes = await readFile(new URL('../..' + voice.url, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256,
        'the played recording matches its documented derivation');
    }
  }
  const sourceTitle = voice => provenance.sources.find(source => source.id === provenance.clips.find(clip => clip.file === file(voice)).sourceId).title;
  assert.equal(sourceTitle(cast[0]), 'Ice Fields Moving Rumbling');
  assert.equal(sourceTitle(impact[0]), 'Ice - Lake fractures');
  assert.equal(sourceTitle(impact[1]), 'Snow crunch 01.WAV');
});

test('real Frozen Tomb cast renders its profile and routes typed cues while preserving root and damage', async () => {
  const scene = runeScene(spell, { range: 20 });
  const events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.casting.mana, 90, 'TF mana cost');
  assert.equal(scene.castWithoutMana().ok, false, 'an empty mana pool rejects repeat casts');
  assert.equal(events.filter(event => event.stage === 'cast').length, 1);
  const projectile = scene.casting.projectiles[0];
  assert.equal(projectile.ctx.spell.presentation, presentation);
  const initial = [];
  scene.casting.effects.paint((...point) => initial.push(point), scene.casting.projectiles);
  assert.ok(initial.some(point => point[2] === '#'), 'runtime paints the flying crystal core');
  const expected = [];
  paintPresentation(presentation, scene.casting.effects.list.find(effect => effect.stage === 'cast'), (...point) => expected.push(point));
  assert.deepEqual(initial.slice(0, expected.length), expected, 'effects renderer consumes authored geometry');
  scene.advance(0.7);
  assert.equal(scene.foe.magicSpeed, 0);
  assert.equal(scene.foe.health, 100, 'damage waits for the source delay');
  const sealed = scene.casting.effects.list.find(effect => effect.stage === 'zone' && effect.radius < 1);
  assert.ok(sealed && sealed.life >= 4.9, 'the target is sealed in a tomb for the root duration');
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'zone' && effect.radius >= 3), 'the ground freezes around it');
  scene.advance(1);
  assert.equal(scene.foe.health, 77);
  assert.ok(events.some(event => event.stage === 'impact'));
  assert.ok(events.every(event => event.type === 'spell' && event.spellId === spell.id && event.presentation === presentation),
    'spell cues replace sword draw/slam cues for the whole cast');
  const fake = fakeRecordedAudio();
  assert.equal(await prepareRecordedSpellTest(fake, presentation), true);
  const castEvent = events.find(event => event.stage === 'cast');
  const impactEvent = events.find(event => event.stage === 'impact');
  const castHandles = playSpellSound(fake.engine, castEvent);
  const impactHandles = playSpellSound(fake.engine, impactEvent);
  assert.equal(castHandles.length, presentation.sounds.cast.length);
  assert.equal(impactHandles.length, presentation.sounds.impact.length);
  assert.ok(fake.routes.every(route => route.bus === 'sfx' && Number.isFinite(route.x) && Number.isFinite(route.y)));
  assert.ok(fake.nodes.some(node => node.starts.some(time => time > fake.context.currentTime)), 'recorded compression and debris are scheduled in audio time');
  assert.ok(!fake.nodes.some(node => node.kind === 'oscillator'), 'no synthesis is used');
  assert.deepEqual(fake.allocations, [], 'no generated noise buffers');
  assert.deepEqual(fake.nodes.filter(node => node.kind === 'source').map(node => node.buffer.id),
    [...presentation.sounds.cast, ...presentation.sounds.impact].map(layer => layer.url.split('/').at(-1)),
    'runtime plays the authored physical recordings');
  assert.deepEqual(fake.invalid, []);
  for (const handle of [...castHandles, ...impactHandles]) handle.stop();
  scene.advance(5);
  assert.equal(scene.foe.magicSpeed, 1, 'root expires at the source duration');
});
