import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/restoration.js';
import spell from '../../src/spells/definitions/restoration.js';
import fireShard from '../../src/spells/presentations/fire-shard.js';
import { runeScene } from '../../test-support/spells.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

// The stages Restoration actually uses in play: the 1.45 s cast at radius 0.8,
// the 1.85 s radius-4 totem zone, 0.25 s radius-5 tick pulses and the 0.3 s
// self aura from its slow. Impact and projectile keep authored fallbacks.
const LIFE = { cast: presentation.duration, zone: 1.85, pulse: 0.25, aura: 0.3, impact: 0.6, projectile: 1 };
const RADIUS = { cast: 0.8, zone: 4, pulse: 5, aura: 1, impact: 1, projectile: 1 };
const BUDGET = { cast: 250, impact: 250, zone: 160, aura: 160, pulse: 90, projectile: 110 };

function points(stage, progress = 0.3, radius = RADIUS[stage], heading = 0) {
  const life = LIFE[stage];
  const state = Object.freeze({ stage, progress, age: progress * life, life, radius, heading });
  const result = [];
  presentation.draw(state, (x, z, char, color, brightness = 1) => result.push({ x, z, char, color, brightness }));
  return result;
}
const lit = (result, min = 0.2) => result.filter(p => p.brightness >= min);
const extent = result => Math.max(...result.map(p => Math.hypot(p.x, p.z)));
const PROGRESS = Array.from({ length: 41 }, (_, i) => i / 40);

test('Restoration opts into a bounded, deterministic presentation for every stage', () => {
  assert.equal(spell.presentation, presentation);
  for (const stage of Object.keys(LIFE)) {
    for (const radius of [RADIUS[stage], 0.5, 3]) {
      for (const progress of PROGRESS) {
        const result = points(stage, progress, radius);
        assert.ok(result.length <= BUDGET[stage], `${stage} ${progress} plots ${result.length}`);
        if (progress > 0.1 && progress < 0.75) assert.ok(result.length >= 20, `${stage} ${progress} reads clearly`);
        assert.deepEqual(result, points(stage, progress, radius), 'drawing has no mutable state or randomness');
        for (const point of result) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
          assert.ok(Math.abs(point.x) < 8 && Math.abs(point.z) < 8);
          assert.match(point.char, /^[\x20-\x7e]$/);
          assert.ok(point.color.length === 3 && point.color.every(c => Number.isInteger(c) && c >= 0 && c <= 255));
          assert.ok(Number.isFinite(point.brightness) && point.brightness > 0 && point.brightness <= 1);
        }
      }
      assert.ok(points(stage, 1, radius).every(p => p.brightness === 0), `${stage} fades fully`);
      assert.ok(lit(points(stage, 0.96, radius), 0.3).length <= 4, `${stage} dissolves instead of popping out`);
    }
    assert.notDeepEqual(points(stage, 0.2), points(stage, 0.55), `${stage} evolves with time`);
  }
});

test('ground-plane stages are drawn upright whatever the caster heading', () => {
  for (const stage of ['cast', 'zone', 'pulse', 'aura', 'impact']) {
    const heading = 1.1, c = Math.cos(heading), s = Math.sin(heading);
    // Apply the adapter's heading rotation; the on-screen result must not turn.
    const turned = points(stage, 0.5, RADIUS[stage], heading).map(p => [p.x * c + p.z * s, p.z * c - p.x * s, p.char]);
    const still = points(stage, 0.5, RADIUS[stage], 0);
    assert.equal(turned.length, still.length);
    turned.forEach(([x, z, char], i) => {
      assert.ok(Math.abs(x - still[i].x) < 1e-9 && Math.abs(z - still[i].z) < 1e-9 && char === still[i].char);
    });
  }
});

test('cast gathers spiralling motes, flashes, then blooms leaves around a growing sapling', () => {
  // Wind-up: motes converge on the caster before the bloom.
  const motes = progress => lit(points('cast', progress)).filter(p => p.char === '*' || p.char === '+' || p.char === "'");
  const spread = progress => motes(progress).reduce((sum, p) => sum + Math.hypot(p.x, p.z), 0) / motes(progress).length;
  assert.ok(spread(0.12) > spread(0.38) * 1.4, 'motes are drawn inward');
  assert.ok(!points('cast', 0.3).some(p => p.char === '@'), 'no flash during the wind-up');
  // Impact frame: a bright warm core with a starburst at the bloom.
  const flash = points('cast', 0.44).filter(p => Math.hypot(p.x, p.z) < 0.35 && p.brightness > 0.9);
  assert.ok(flash.some(p => p.char === '@') && flash.length >= 8, 'bloom flash');
  assert.ok(flash.every(p => p.color[0] > 240 && p.color[1] > 220), 'flash is warm white');
  // Leaves unfurl outward, then the ground ring and leaves fray away.
  assert.ok(extent(lit(points('cast', 0.65))) > extent(lit(points('cast', 0.4))));
  assert.ok(points('cast', 0.95).length < points('cast', 0.7).length * 0.6, 'follow-through thins out');
  // Sapling: a stem rising straight up the screen, crowned by a blossom.
  const stem = points('cast', 0.75).filter(p => p.char === '|' && Math.abs(p.x) < 0.1 && p.z < 0);
  assert.ok(stem.length >= 3, 'upright stem');
  assert.ok(points('cast', 0.75).some(p => p.char === '@' && Math.abs(p.x) < 0.15 && p.z < -0.4), 'blossom crowns the sapling');
  // Colour cools from warm motes to leaf green.
  const leaves = points('cast', 0.6).filter(p => Math.hypot(p.x, p.z) > 0.5 && /[\\/|-]/.test(p.char));
  assert.ok(leaves.filter(p => p.color[1] > p.color[0] + 40).length > leaves.length / 2, 'leaves are green');
});

test('the totem grove binds a vine ring, curling roots and rising motes, and pulses ripple outward', () => {
  const grove = points('zone', 0.5);
  const onRing = grove.filter(p => Math.abs(Math.hypot(p.x, p.z) - 4) < 0.25);
  assert.ok(onRing.length >= 40 && onRing.some(p => p.char === '&'), 'vine boundary with leaves');
  assert.ok(grove.some(p => p.char === '@' && Math.abs(p.x) < 0.15 && p.z < -0.4), 'totem sapling stands upright');
  assert.ok(grove.filter(p => Math.hypot(p.x, p.z) > 0.6 && Math.hypot(p.x, p.z) < 3.6).length >= 30, 'roots and motes fill the grove');
  // The ring is traced in rather than popping in.
  assert.ok(points('zone', 0.04).length < grove.length * 0.5);
  // A mote rises smoothly between 60 fps frames.
  const motesAt = age => points('zone', age / 1.85).filter(p => p.char === '.' || p.char === "'" || p.char === '+');
  assert.ok(motesAt(0.7).length > 5);
  // Pulse rings roll outward and cool from gold to green.
  const ring = progress => points('pulse', progress).filter(p => /[-|\\/]/.test(p.char));
  const median = list => list.map(p => Math.hypot(p.x, p.z)).sort((a, b) => a - b)[list.length >> 1];
  assert.ok(median(ring(0.6)) > median(ring(0.15)) + 1, 'ripple expands');
  assert.ok(ring(0.15)[0].color[0] > ring(0.7)[0].color[0], 'ripple cools from gold to green');
});

test('aura leaflets swoop in, and the impact stitches close into knots', () => {
  const leaflets = progress => points('aura', progress).filter(p => /[<>v^]/.test(p.char));
  assert.equal(leaflets(0.1).length, 8);
  assert.ok(extent(leaflets(0.1)) > extent(leaflets(0.5)) + 0.2, 'leaflets close around the target');
  const open = points('impact', 0.06), closed = points('impact', 0.5);
  assert.ok(open.some(p => p.char === '<') && open.some(p => p.char === '>'));
  assert.equal(closed.filter(p => p.char === 'x').length, 4, 'four stitches knot shut');
  const shoot = points('projectile', 0.5);
  assert.ok(shoot.some(p => p.char === '*' && p.z > 0.3), 'seed-leaf tip leads');
  assert.ok(shoot.some(p => p.z < -1), 'twin vine wake trails behind');
});

test('Restoration grows a sanctuary from recorded roots, slow water and restrained leaf ripples', async () => {
  const { cast, impact, pulse } = presentation.sounds;
  const file = layer => layer.url.split('/').at(-1);
  const gain = recipe => recipe.reduce((sum, layer) => sum + layer.gain, 0);
  assert.deepEqual(cast.map(file), ['root-creak.wav', 'water-flow.wav', 'leaf-drift.wav']);
  assert.ok(cast.every(v => v.rate < 1), 'slow organic growth anchors the sanctuary');
  assert.ok(cast[1].delay > cast[0].delay && cast[2].delay > cast[1].delay, 'water and leaves open after the roots');
  assert.ok(impact.some(v => file(v) === 'branch-strain.wav') && impact.some(v => file(v) === 'water-touch.wav'), 'wood settles as cleansing water arrives');
  assert.equal(pulse.length, 1);
  assert.ok(gain(pulse) <= 0.3 && gain(pulse) < gain(impact) * 0.2, 'frequent pulses stay beneath the arrival');
  assert.ok(pulse.every(v => file(v) === 'leaf-turn.wav' && v.rate >= 1 && v.delay === 0));
  assert.notDeepEqual(cast, impact);
  assert.notDeepEqual(cast, fireShard.sounds.cast, 'Restoration has its own physical textures');
  const fake = fakeRecordedAudio();
  assert.equal(await prepareRecordedSpellTest(fake, presentation), true, 'actual authored WAV files load');
  for (const stage of ['cast', 'impact', 'pulse']) {
    const recipe = presentation.sounds[stage];
    assert.ok(recipe.length >= 1 && recipe.length <= 4);
    assert.ok(gain(recipe) <= 1.2);
    for (const layer of recipe) {
      assert.equal(layer.kind, 'recording');
      assert.match(layer.url, /^\/assets\/audio\/spells\/cerrith\/[a-z-]+\.wav$/);
      assert.ok(layer.gain >= 0.1 && layer.gain <= 0.8);
      assert.ok(layer.rate >= 0.75 && layer.rate <= 1.2);
      assert.ok(layer.delay >= 0 && layer.delay <= 2);
    }
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 3, y: 7 });
    assert.equal(handles.length, recipe.length);
    const sources = fake.nodes.filter(v => v.kind === 'source').slice(-handles.length);
    sources.forEach((source, i) => {
      assert.equal(source.buffer.id, file(recipe[i]));
      assert.equal(source.starts[0], fake.context.currentTime + recipe[i].delay);
      assert.equal(source.playbackRate.calls[0].args[0], recipe[i].rate);
      assert.ok(source.buffer.duration > 0 && source.buffer.duration < 2);
      if (stage === 'pulse') assert.ok(source.buffer.duration / recipe[i].rate < 0.5, 'repeat is a short brush');
    });
    handles.forEach(handle => handle.stop());
  }
  assert.ok(!fake.nodes.some(v => v.kind === 'oscillator'));
  assert.deepEqual(fake.allocations, [], 'no generated noise buffers');
  assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 3 && r.y === 7 && r.disposals === 1));
  assert.deepEqual(fake.invalid, []);
});

test('real Restoration cast renders its profile, emits typed cues, and preserves the rune cleanse', () => {
  const scene = runeScene(spell, { range: 15, allyInPath: true }), events = [];
  scene.casting.onSound = event => events.push(event);
  const ctx = scene.casting.context(spell, spell.variants[0], scene.player);
  for (const name of ['Slowed', 'Frozen', 'Burnt', 'Weakened', 'Silenced']) {
    scene.casting.aura(scene.ally, { auraname: name, d: '200' }, ctx);
  }
  scene.casting.clearPresentation(); events.length = 0;
  assert.equal(scene.cast().ok, true);
  const count = events.length;
  assert.equal(scene.castWithoutMana().ok, false);
  assert.equal(events.length, count, 'mana rejection emits no extra cue');
  assert.equal(scene.casting.mana, 92, 'original 8 mana cost');
  scene.advance(0.075); // The rune's totem begins after its authored one-tick delay.
  assert.equal(scene.casting.zones.length, 1);
  scene.advance(0.6);
  const rendered = [];
  scene.casting.effects.paint((...p) => rendered.push(p));
  assert.ok(rendered.length > 150, 'cast, grove and ripples all paint');
  assert.ok(rendered.some(p => p[2] === '&') && rendered.some(p => p[2] === '@'), 'runtime consumes vine and blossom geometry');
  scene.advance(3);
  for (const name of ['Slowed', 'Frozen', 'Burnt', 'Weakened']) assert.equal(scene.aura(scene.ally, name), false);
  assert.ok(scene.aura(scene.ally, 'Silenced'));
  assert.equal(scene.foe.health, 100);
  assert.ok(events.some(e => e.stage === 'cast'));
  assert.ok(events.some(e => e.stage === 'impact'), 'aura cue uses the restorative arrival sound');
  assert.ok(events.some(e => e.stage === 'pulse'), 'totem uses the quiet leaf ripples');
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === 'restoration' && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
});
