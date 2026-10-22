import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-frost-bolt.js';
import spell from '../../src/spells/definitions/temp-frost-bolt.js';
import { runeScene } from '../../test-support/spells.js';
import { readFile } from 'node:fs/promises';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio, sources } from '../../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

function draw(stage, progress, options = {}) {
  const points = [];
  const life = options.life ?? presentation.duration;
  presentation.draw(Object.freeze({ stage, progress, age: progress * life,
    life, radius: 1, heading: 0, ...options }),
  (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}

// Undo the adapter's heading rotation to get the world (screen-aligned) position.
const world = (p, heading) => ({ ...p, x: p.x * Math.cos(heading) + p.z * Math.sin(heading),
  z: p.z * Math.cos(heading) - p.x * Math.sin(heading) });
const lit = (points, floor = 0.2) => points.filter(p => p.brightness > floor);
const extent = (points, axis) => Math.max(...points.map(p => p[axis])) - Math.min(...points.map(p => p[axis]));
const mean = (points, axis) => points.reduce((sum, p) => sum + p[axis], 0) / points.length;
const cells = points => new Set(points.map(p => `${Math.floor(p.x * 13 / 0.6)},${Math.floor(p.z * 6.5)}`)).size;

test('Frost Bolt flies as a faceted ice lance with a white core and a spiralling contrail', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const points = draw('projectile', 0.4, { radius: 0.65, life: 0.6 });
  const nose = points.find(p => 'v^<>'.includes(p.char));
  assert.equal(nose?.char, 'v', 'heading 0 flies down the screen, so the nose points down');
  assert.ok(Math.max(...points.map(p => p.z)) <= nose.z + 1e-9, 'nothing leads the nose');
  assert.ok(points.some(p => p.char === '@' && p.z > 0), 'a white-hot core sits in the head');
  assert.ok(points.filter(p => '/\\'.includes(p.char)).length >= 6, 'raked facets outline the lance');
  const trail = points.filter(p => p.z < -0.5);
  assert.ok(trail.length >= 12, 'a contrail streams behind the lance');
  assert.ok(Math.max(...trail.map(p => p.brightness)) < Math.max(...points.map(p => p.brightness)),
    'the contrail is dimmer than the lance');
  assert.ok(points.length <= 110, `projectile stays lean (${points.length})`);
  // The geometry follows the on-screen direction: flying right shows a '>' nose.
  const right = draw('projectile', 0.4, { radius: 0.65, life: 0.6, heading: Math.PI / 2 }).map(p => world(p, Math.PI / 2));
  assert.equal(right.find(p => 'v^<>'.includes(p.char))?.char, '>');
  assert.ok(right.some(p => p.char === '-' || p.char === '_'), 'a sideways lance is outlined by flat rims');
  // Motion is continuous: a 1/60 s step moves glyphs only slightly.
  const a = draw('projectile', 0.3, { radius: 0.65, life: 0.6 });
  const b = draw('projectile', 0.3 + 1 / 36, { radius: 0.65, life: 0.6 });
  const near = (p, points) => points.some(q => Math.hypot(p.x - q.x, p.z - q.z) < 0.2);
  assert.ok(lit(b, 0.3).every(p => near(p, a)), 'no bright glyph jumps between frames');
});

test('the cast gathers frost at the hand, flashes, then throws a sinking jet and shock ring', () => {
  const at = age => draw('cast', age / presentation.duration);
  const gather = at(0.01), late = at(0.07);
  assert.ok(gather.length >= 12 && gather.every(p => p.brightness < 0.9), 'motes gather dimly before release');
  const hand = { x: 0, z: 0.35 * 1.25 - 1.5 * 5 / 6.5 };
  const spread = points => mean(points.map(p => ({ d: Math.hypot(p.x - hand.x, p.z - hand.z) })), 'd');
  assert.ok(spread(late) < spread(gather), 'the motes converge on the hand');
  const flash = at(0.1);
  assert.ok(flash.some(p => p.char === '@' && p.brightness > 0.9), 'a white release flash');
  assert.ok(flash.some(p => p.char === '|') && flash.some(p => p.char === '-'), 'the flash throws star rays');
  const jet = points => points.filter(p => p.z > hand.z + 0.15);
  const early = at(0.14), mid = at(0.3);
  assert.ok(mean(jet(mid), 'z') > mean(jet(early), 'z'), 'the jet travels forward');
  assert.ok(extent(mid, 'x') > 1.2, 'the shock ring spreads wide around the hand');
  assert.ok(lit(at(0.6)).length < lit(mid).length, 'the cast thins out as it dissipates');
  for (const points of [gather, flash, mid]) assert.ok(points.length <= 200, 'cast stays within its burst budget');
});

test('impact flashes, grows a six-armed rime snowflake, rains shards and thaws from the tips', () => {
  const flash = draw('impact', 0.02);
  assert.ok(flash.some(p => p.char === '@' && p.brightness > 0.85 && p.z < -0.5), 'a white flash at chest height');
  const grow = draw('impact', 0.15), full = draw('impact', 0.45), thaw = draw('impact', 0.8);
  const arms = points => points.filter(p => Math.abs(p.z) < 0.08 && p.char === '-' && p.brightness > 0.3);
  assert.ok(arms(full).length >= 16, 'the flat arms read as solid lines along the ground');
  assert.ok(extent(arms(full), 'x') > extent(arms(grow), 'x'), 'the snowflake grows outward');
  assert.ok(full.some(p => p.char === '\\') && full.some(p => p.char === '/'), 'the diagonal arms are drawn');
  const reach = points => Math.max(0, ...lit(points.filter(p => p.char === '-' && Math.abs(p.z) < 0.08), 0.15)
    .map(p => Math.abs(p.x)));
  assert.ok(reach(thaw) < reach(full), 'the rime thaws from the tips inward');
  const flying = grow.filter(p => p.z < -0.3 && '/\\|-'.includes(p.char));
  assert.ok(flying.length >= 8, 'shards arc through the air');
  assert.ok(draw('impact', 0.6).some(p => p.char === ','), 'shards land and lie on the ground');
  assert.ok(cells(full) > full.length * 0.8, 'glyphs rarely stack in one cell');
  for (const points of [flash, grow, full, thaw]) assert.ok(points.length <= 250);
});

test('the burst pulse is a short crystalline star that blooms and fades', () => {
  const early = draw('pulse', 0.1, { life: 0.25 }), late = draw('pulse', 0.7, { life: 0.25 });
  assert.ok(early.some(p => p.char === '@'));
  assert.ok(extent(late, 'x') > extent(early, 'x'), 'the star blooms outward');
  assert.ok(Math.max(...late.map(p => p.brightness)) < Math.max(...early.map(p => p.brightness)));
  assert.ok(early.length <= 90 && late.length <= 90);
});

test('every effect stage is deterministic, bounded, atlas compatible, and fades out', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    const budget = stage === 'projectile' ? 128 : 256;
    for (const progress of [0, 0.05, 0.1, 0.2, 0.4, 0.65, 0.9, 0.99]) {
      for (const radius of [0, 0.65, 1, 40]) {
        for (const heading of [0, 2.2]) {
          const options = { radius, heading };
          const points = draw(stage, progress, options);
          assert.deepEqual(points, draw(stage, progress, options));
          assert.ok(points.length <= budget, `${stage} stays within the draw budget (${points.length})`);
          for (const p of points) {
            assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
            assert.ok(Math.abs(p.x) < 8 && Math.abs(p.z) < 12);
            assert.match(p.char, /^[ -~]$/);
            assert.equal(p.color.length, 3);
            assert.ok(p.color.every(value => Number.isFinite(value) && value >= 0 && value <= 255));
            assert.ok(Number.isFinite(p.brightness) && p.brightness >= 0 && p.brightness <= 1);
          }
        }
      }
    }
    assert.ok(draw(stage, 0.2).length > 0, `${stage} draws something`);
    assert.ok(Math.max(0, ...draw(stage, 0.99).map(p => p.brightness)) < 0.05);
    assert.deepEqual(draw(stage, 1), []);
  }
});

test('Frost Bolt uses recorded breath, a crisp ice fracture and following snow scatter', async () => {
  const { cast, impact, pulse } = presentation.sounds;
  const breath = cast.find(v => v.url.endsWith('/cold-breath.wav'));
  assert.ok(breath && breath.rate > 1 && breath.delay === 0, 'compressed recorded breath starts the launch');
  const fracture = impact.find(v => v.url.endsWith('/ice-crack.wav'));
  const scatter = impact.find(v => v.url.endsWith('/snow-scuff.wav'));
  assert.ok(fracture && scatter && scatter.delay > fracture.delay, 'snow scatters after the physical fracture');
  assert.equal(pulse.length, 1, 'repeat bursts use only one quiet grain');
  assert.ok(pulse[0].url.endsWith('/ice-tick.wav') && pulse[0].gain <= 0.18);
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.reduce((sum, v) => sum + v.gain, 0) < cast.reduce((sum, v) => sum + v.gain, 0), 'repeat pulses stay beneath the cast');
  const provenance = JSON.parse(await readFile(new URL('../../assets/audio/spells/seithr/sources.json', import.meta.url), 'utf8'));
  const clips = Object.values(provenance).find(value => Array.isArray(value) && value.some(entry => entry.file));
  for (const sequence of Object.values(presentation.sounds)) {
    assert.ok(sequence.length > 0 && sequence.length <= 4);
    assert.ok(sequence.reduce((sum, voice) => sum + voice.gain, 0) <= 1.2);
    for (const voice of sequence) {
      assert.equal(voice.kind, 'recording');
      assert.deepEqual(Object.keys(voice).sort(), ['delay', 'gain', 'kind', 'rate', 'url']);
      assert.match(voice.url, /^\/assets\/audio\/spells\/seithr\/[a-z-]+\.wav$/);
      const clip = clips.find(entry => entry.file === voice.url.split('/').at(-1));
      assert.ok(clip && provenance.sources.some(source => source.id === clip.sourceId && source.license), 'every clip has a licensed recording source');
      assert.ok(voice.gain >= 0.1 && voice.gain <= 0.8);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
    }
  }
});

test('Frost Bolt schedules actual recording buffers on the positional spell bus', async () => {
  const fake = fakeRecordedAudio();
  await prepareRecordedSpellTest(fake, presentation);
  for (const [stage, recipe] of Object.entries(presentation.sounds)) {
    const before = sources(fake).length;
    const handles = playSpellSound(fake.engine, { presentation, stage, x: 3, y: -2 });
    assert.equal(handles.length, recipe.length);
    sources(fake).slice(before).forEach((source, i) => {
      assert.equal(source.buffer.id, recipe[i].url.split('/').at(-1));
      assert.equal(source.starts[0], fake.context.currentTime + recipe[i].delay);
      assert.ok(source.buffer.duration > 0);
    });
    handles.forEach(handle => handle.stop());
  }
  assert.equal(fake.nodes.filter(node => node.kind === 'oscillator').length, 0);
  assert.equal(fake.allocations.length, 0, 'no synthesized noise buffer');
  assert.deepEqual(fake.invalid, []);
  assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 3 && route.y === -2));
});

test('a real Frost Bolt cast renders its lance and rime impact and emits typed spell cues', () => {
  const { casting, cast, advance, foe } = runeScene(spell);
  const sounds = [];
  casting.onSound = event => sounds.push(event);
  assert.equal(cast().ok, true);
  assert.ok(casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));
  assert.equal(casting.projectiles.length, 1);
  const rendered = [];
  const paint = () => casting.effects.paint((x, z, char, color, brightness) =>
    rendered.push({ x, z, char, color, brightness }), casting.projectiles);
  advance(0.05);
  paint();
  assert.ok(rendered.some(point => 'v^<>'.includes(point.char)), 'the runtime paints the lance nose');
  assert.ok(rendered.some(point => point.char === '@'), 'the runtime paints a white-hot core');
  advance(0.15);
  assert.equal(foe.health, 92);
  assert.ok(casting.effects.list.some(effect => effect.stage === 'impact' && effect.presentation === presentation));
  advance(0.2);
  rendered.length = 0;
  paint();
  assert.ok(rendered.filter(point => point.char === '-').length >= 16, 'the real impact paints the rime snowflake');
  for (const stage of ['cast', 'impact']) {
    const cue = sounds.find(event => event.type === 'spell' && event.stage === stage);
    assert.ok(cue, `the ${stage} sound reaches the spatial spell bus`);
    assert.equal(cue.spellId, spell.id);
    assert.equal(cue.presentation, presentation);
  }
  assert.ok(!sounds.some(event => event.type === 'draw' || event.type === 'slam'));
});
