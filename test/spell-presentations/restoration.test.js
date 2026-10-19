import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/restoration.js';
import spell from '../../src/spells/definitions/restoration.js';
import fireShard from '../../src/spells/presentations/fire-shard.js';
import { runeScene } from '../../test-support/spells.js';

function points(stage, progress = 0.3, radius = 3) {
  const state = Object.freeze({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius, heading: 0 });
  const result = [];
  presentation.draw(state, (x, z, char, color, brightness = 1) => result.push({ x, z, char, color, brightness }));
  return result;
}

test('Restoration opts into a bounded, deterministic leaflet and stitch presentation for every stage', () => {
  assert.equal(spell.presentation, presentation);
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.2, 0.55, 0.9, 1]) {
      const result = points(stage, progress);
      assert.ok(result.length > 0 && result.length <= 96, stage);
      assert.deepEqual(result, points(stage, progress), 'drawing has no mutable state or randomness');
      for (const point of result) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.ok(Math.abs(point.x) < 6 && Math.abs(point.z) < 6);
        assert.match(point.char, /^[\x21-\x7e]$/);
        assert.ok(point.color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
        if (progress === 1) assert.equal(point.brightness, 0, 'all stages fade fully');
      }
    }
    assert.notDeepEqual(points(stage, 0.2), points(stage, 0.55), `${stage} evolves with time`);
  }
});

test('leaflets fall clockwise around repeated complete stitched crosses and unfurl into branches', () => {
  const early = points('cast', 0.15), later = points('cast', 0.2);
  assert.ok(early[0].x * later[0].z - early[0].z * later[0].x > 0, 'leaflet turns clockwise');
  const crosses = early.filter(p => p.char === '+');
  assert.ok(crosses.length >= 3, 'healing stitches repeat');
  for (const cross of crosses) {
    assert.ok(early.some(p => p.char === '-' && p.x < cross.x && p.z === cross.z));
    assert.ok(early.some(p => p.char === '-' && p.x > cross.x && p.z === cross.z));
    assert.ok(early.some(p => p.char === '|' && p.x === cross.x && p.z < cross.z));
    assert.ok(early.some(p => p.char === '|' && p.x === cross.x && p.z > cross.z));
  }
  const impact = points('impact');
  assert.notDeepEqual(early.map(p => p.char), impact.map(p => p.char));
  assert.ok(impact.some(p => p.char === '<') && impact.some(p => p.char === '>'), 'healing branch forks');
  const extent = result => Math.max(...result.map(p => Math.hypot(p.x, p.z)));
  assert.ok(extent(points('impact', 0.55)) > extent(points('impact', 0.05)), 'branches unfurl outward');
  const projectile = points('projectile');
  assert.ok(projectile.some(p => p.char === '>') && projectile.some(p => p.char === '+'));
  assert.ok(projectile.some(p => p.z < -0.5), 'leaf shoot keeps a small stitched wake');
});

test('Restoration has a slow rising warm chime with held breath and restrained repeating notes', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const notes = cast.filter(v => v.kind === 'tone');
  assert.ok(notes.length >= 4);
  for (let i = 1; i < notes.length; i++) {
    assert.ok(notes[i].frequency > notes[i - 1].frequency);
    assert.ok(notes[i].delay - notes[i - 1].delay >= 0.25, 'a slow rising phrase');
  }
  const breath = cast.find(v => v.kind === 'noise');
  assert.ok(breath.duration > 1 && breath.attack > 0.1 && breath.filterType === 'lowpass');
  assert.ok(impact.some(v => v.kind === 'tone'));
  assert.ok(pulse.every(v => v.gain <= 0.02 && v.duration < 0.2), 'repeated totem ticks stay quiet and brief');
  assert.notDeepEqual(cast, impact);
  assert.notDeepEqual(cast, fireShard.sounds.cast, 'Restoration has its own phrase and texture');
  for (const voices of [cast, impact, pulse]) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});

test('real Restoration cast renders its profile, emits typed cues, and preserves the TF cleanse', () => {
  const scene = runeScene(spell, { range: 15, allyInPath: true }), events = [];
  scene.casting.onSound = event => events.push(event);
  const ctx = scene.casting.context(spell, spell.variants[0], scene.player);
  for (const name of ['Slowed', 'Frozen', 'Burnt', 'Weakened', 'Silenced']) {
    scene.casting.aura(scene.ally, { auraname: name, d: '200' }, ctx);
  }
  scene.casting.clearPresentation(); events.length = 0;
  assert.equal(scene.cast().ok, true);
  const count = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, count, 'cooldown rejection emits no extra cue');
  assert.equal(scene.casting.mana, 92, 'original 8 mana cost');
  scene.advance(0.075); // The TF totem begins after its authored one-tick delay.
  assert.equal(scene.casting.zones.length, 1);
  const rendered = [];
  scene.casting.effects.paint((...p) => rendered.push(p));
  assert.ok(rendered.some(p => p[2] === '<') && rendered.some(p => p[2] === '+'), 'runtime consumes leaf and stitched-cross geometry');
  scene.advance(3);
  for (const name of ['Slowed', 'Frozen', 'Burnt', 'Weakened']) assert.equal(scene.aura(scene.ally, name), false);
  assert.ok(scene.aura(scene.ally, 'Silenced'));
  assert.equal(scene.foe.health, 100);
  assert.ok(events.some(e => e.stage === 'cast'));
  assert.ok(events.some(e => e.stage === 'impact'), 'aura cue uses the restorative arrival sound');
  assert.ok(events.some(e => e.stage === 'pulse'), 'totem uses the quiet repeating notes');
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === 'restoration' && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
});
