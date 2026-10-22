import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/ice-wave.js';
import spell from '../../src/spells/definitions/ice-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

// Radii and lives match what the rune actually spawns: the cast flash (0.8 m),
// hits on each target (1 m), the visual pulses at the caster (2 m and 1 m) and
// the Slowed aura (1.5 s, then 0.3 s potion ticks).
const STAGES = {
  cast: { radius: 0.8, life: presentation.duration, budget: 240 },
  impact: { radius: 1, life: 0.6, budget: 140 },
  pulse: { radius: 2, life: 0.4, budget: 80 },
  aura: { radius: 1, life: 1.5, budget: 72 },
  zone: { radius: 3, life: 2, budget: 140 },
  projectile: { radius: 0.65, life: 1, budget: 72 },
};

function points(stage, progress, extra = {}) {
  const result = [], { radius = 1, life = presentation.duration } = STAGES[stage] ?? {};
  presentation.draw(Object.freeze({ stage, age: progress * life,
    life, progress, radius, heading: 0, ...extra }),
  (x, z, char, color, brightness = 1) => result.push({ x, z, char, color, brightness }));
  return result;
}
const only = (drawing, chars) => drawing.filter(point => chars.includes(point.char));
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const distance = point => Math.hypot(point.x, point.z);
// Screen-down offset (world z) of a local point once the adapter applies heading.
const worldZ = (point, heading) => point.z * Math.cos(heading) - point.x * Math.sin(heading);

test('Ice Wave opts into its own presentation while retaining its rune cost and source', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.deepEqual(spell.variants[0].params, { cooldown: 15, mana: 6, duration: 10, damage: 8 });
  assert.equal(spell.source.sha256, 'dd420157d6e6bbbfa6a8aa60a51f3e625b8a4885f4070cfc3fb59b94b1130599');
});

test('a real rune cast renders the authored effects and emits typed spatial cast/impact cues', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  scene.advance(0.05);
  assert.equal(scene.foe.health, 92);
  assert.ok(scene.aura(scene.foe, 'Slowed'));
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'impact' && effect.presentation === presentation));
  const rendered = [];
  scene.casting.effects.paint((...point) => rendered.push(point), scene.casting.projectiles);
  assert.ok(rendered.length > 120 && rendered.length <= 4096);
  assert.ok(['^', '|', '/', '\\', '*'].every(char => rendered.some(point => point[2] === char)),
    'the target bursts into a crystal cluster while frost gathers at the caster');
  assert.ok(rendered.every(point => /^[\x20-\x7e]$/.test(point[2])));
  const castCue = events.find(event => event.type === 'spell' && event.stage === 'cast');
  assert.ok(castCue && castCue.spellId === spell.id && castCue.presentation === presentation);
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'
    && event.spellId === spell.id && event.presentation === presentation));
  assert.ok(events.every(event => !['draw', 'slam'].includes(event.type)));
  const count = events.length;
  assert.equal(scene.castWithoutMana().ok, false, 'an empty mana pool rejects a second cast');
  assert.equal(events.length, count, 'rejected casts remain silent');
  const audio = fakeRecordedAudio();
  const handles = playSpellSound(audio.engine, castCue);
  assert.equal(handles.length, presentation.sounds.cast.length);
  assert.ok(audio.routes.every(route => route.bus === 'sfx' && route.x === castCue.x && route.y === castCue.y));
  assert.deepEqual(audio.invalid, []);
  for (const handle of handles) handle.stop();
});

test('frost motes spiral in to a point ahead of the caster before the wave is released', () => {
  const motes = drawing => only(drawing, ['.', '+', '*']).filter(point => distance(point) > 0.05);
  const gather = point => Math.hypot(point.x, point.z - 0.35);
  const start = motes(points('cast', 0)), late = motes(points('cast', 0.135));
  assert.ok(start.length >= 15, 'a ring of motes surrounds the caster');
  assert.ok(start.some(point => point.z < -0.6), 'some motes start behind the caster');
  assert.ok(mean(late.map(gather)) < mean(start.map(gather)) * 0.4, 'they converge as the cast winds up');
  assert.ok(Math.max(...late.map(point => point.brightness)) > Math.max(...start.map(point => point.brightness)),
    'and brighten as they gather');
  const flash = points('cast', 0.13).filter(point => point.char === '*' && point.brightness > 0.5);
  assert.ok(flash.length > 0, 'the gathered frost flashes before the crest rolls out');
});

test('a breaking crest rolls through the cone with a foam line, an ice face and a toothed lip', () => {
  const foam = progress => only(points('cast', progress), ['=']);
  const radii = [0.25, 0.4, 0.55].map(progress => mean(foam(progress).map(distance)));
  assert.ok(radii[0] > 1 && radii[1] > radii[0] + 0.4 && radii[2] > radii[1] + 0.15,
    'the front advances quickly and eases out');
  assert.ok(radii[2] > 3, 'the crest carries well into the 6 m cone');
  const mid = points('cast', 0.45), front = foam(0.45);
  const angles = front.map(point => Math.atan2(point.x, point.z));
  assert.ok(Math.min(...angles) < -0.9 && Math.max(...angles) > 0.9, 'it fans across the 120-degree cone');
  assert.ok(Math.max(...angles.map(Math.abs)) <= Math.PI / 3, 'without spilling outside it');
  assert.ok(front.length >= 20, 'the foam line is a continuous arc, not scattered dots');
  assert.ok(only(mid, ['~']).length >= 25, 'a long toothed lip crowns the crest');
  assert.ok(only(mid, ['%', '#']).length >= 10, 'a dense ice face sits beneath it');
  assert.ok(Math.max(...only(mid, ['~']).map(point => point.brightness))
    > Math.max(...front.map(point => point.brightness)), 'the lip is the brightest part');
  const late = points('cast', 0.82);
  assert.equal(only(late, ['%', '#', '=']).length, 0, 'the spent crest collapses into scattered foam');
  assert.ok(only(late, ['.', ',']).length > 20);
});

test('crest, spikes and spray rise up the screen whichever way the wave is cast', () => {
  for (const heading of [0, Math.PI / 2, Math.PI, -2.3]) {
    const drawing = points('cast', 0.4, { heading });
    const lip = only(drawing, ['~']), foam = only(drawing, ['=']);
    assert.ok(mean(lip.map(point => worldZ(point, heading))) < mean(foam.map(point => worldZ(point, heading))) - 0.25,
      `the lip stands above the foam line at heading ${heading}`);
    assert.deepEqual(drawing, points('cast', 0.4, { heading }), 'drawing stays deterministic');
  }
});

test('a wake of ice spikes punches up behind the crest and then shatters', () => {
  const spikes = progress => only(points('cast', progress), ['|']).filter(point => distance(point) > 0.6);
  assert.equal(spikes(0.1).length, 0, 'no spikes before the crest has passed');
  const standing = spikes(0.5), crest = mean(only(points('cast', 0.5), ['=']).map(distance));
  assert.ok(standing.length >= 6, 'tall spikes stand in the wake');
  assert.ok(standing.every(point => distance(point) < crest), 'only where the crest has already been');
  assert.equal(spikes(0.9).length, 0, 'every spike has shattered by the end');
  assert.ok(only(points('cast', 0.78), ["'"]).length >= 4, 'shattering spikes and spray throw crystal fragments');
});

test('impact freezes white, grows a crystal cluster upward, then shatters with an expanding frost ring', () => {
  const flash = points('impact', 0.02);
  assert.ok(flash.some(point => point.char === '*' && point.brightness > 0.9 && distance(point) < 0.25));
  const cluster = points('impact', 0.3);
  const shards = only(cluster, ['|', '/', '\\', '-']);
  assert.ok(shards.length >= 20, 'nine shards read as solid lines');
  assert.ok(shards.filter(point => point.z < 0).length > shards.length * 0.8, 'shards rise above the target');
  assert.ok(only(cluster, ['*']).length >= 9, 'each shard ends in a bright tip');
  const shattered = points('impact', 0.75);
  assert.equal(only(shattered, ['|', '/', '\\', '-']).length, 0, 'the cluster shatters into fragments');
  assert.ok(only(shattered, ['.', "'"]).length > 10);
  const ring = progress => mean(only(points('impact', progress), [':']).map(distance));
  assert.ok(ring(0.25) > ring(0.05) + 0.45, 'a frost ring spreads across the ground');
});

test('pulses read as a cold gust through the cone and a frost snap at the feet', () => {
  const gust = points('pulse', 0.5);
  assert.ok(gust.length >= 30);
  assert.ok(gust.every(point => point.z > 0 && Math.abs(Math.atan2(point.x, point.z)) < 1.15),
    'the 2 m gust only blows forward through the cone');
  assert.ok(Math.max(...gust.map(distance)) > 1.8);
  const snap = points('pulse', 0.4, { radius: 1, life: 0.25 });
  assert.ok(snap.length >= 15 && snap.length < gust.length, 'the 1 m snap is a smaller flake');
  assert.ok(snap.every(point => distance(point) < 0.9));
  assert.ok(snap.some(point => point.char === '*' && distance(point) < 0.05));
  assert.equal(only(snap, ['+']).length, 6, 'six flake arms end in crystal tips');
});

test('the Slowed aura crusts rime around the feet, grows short crystals and lets snow settle', () => {
  for (const life of [1.5, 0.3]) {
    const drawing = points('aura', 0.4, { life });
    const rime = only(drawing, [':', '*']).filter(point => Math.abs(distance(point) - 0.52) < 0.12);
    assert.ok(rime.length >= 5, 'a rime ring circles the feet');
    assert.ok(only(drawing, ['^']).length >= 4, 'small crystals jut up through it');
    assert.ok(drawing.length <= STAGES.aura.budget);
  }
});

test('every stage remains deterministic, finite, bounded and fades to an empty final frame', () => {
  for (const [stage, { budget }] of Object.entries(STAGES)) {
    for (const heading of [0, 1.1, Math.PI, -2]) {
      for (let progress = 0; progress < 1; progress += 0.04) {
        const drawing = points(stage, progress, { heading });
        assert.ok(drawing.length > 0 && drawing.length <= budget, `${stage} ${progress} plots ${drawing.length}`);
        assert.ok(drawing.length <= (stage === 'projectile' ? 128 : 256));
        assert.deepEqual(drawing, points(stage, progress, { heading }));
        for (const point of drawing) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
          assert.ok(Math.abs(point.x) < 6 && Math.abs(point.z) < 6);
          assert.match(point.char, /^[\x20-\x7e]$/);
          assert.equal(point.color.length, 3);
          assert.ok(point.color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255));
          assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
        }
      }
    }
    assert.ok(Math.max(...points(stage, 0.95).map(point => point.brightness))
      < Math.max(...points(stage, 0.5).map(point => point.brightness)) / 3);
    assert.deepEqual(points(stage, 1), []);
  }
});

test('the wave moves smoothly between 60 fps frames', () => {
  const step = 1 / 60 / presentation.duration;
  for (let progress = 0.15; progress < 0.68; progress += step) {
    const before = mean(only(points('cast', progress), ['=']).map(distance));
    const after = mean(only(points('cast', progress + step), ['=']).map(distance));
    assert.ok(after >= before - 0.02 && after - before < 0.2, `front jumps at ${progress.toFixed(3)}`);
  }
});

test('Ice Wave rolls a deep grinding front through staggered fractures', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.kind === 'noise' && v.duration > 1), 'long grinding front');
  assert.ok(cast.filter(v => v.kind === 'noise' && v.delay > 0.2).length >= 2, 'rolling ice fractures');
  assert.ok(cast.some(v => v.kind === 'tone' && v.frequency < 200), 'a low body anchors the spell');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.reduce((sum, v) => sum + v.gain, 0) < cast.reduce((sum, v) => sum + v.gain, 0), 'repeat pulses stay beneath the cast');
  for (const sequence of Object.values(presentation.sounds)) {
    assert.ok(sequence.length > 0 && sequence.length <= 8);
    for (const voice of sequence) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
      if (voice.kind === 'tone') {
        assert.ok(voice.frequency > 20 && voice.endFrequency > 20);
      }
    }
  }
});
