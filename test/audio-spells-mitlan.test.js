import assert from 'node:assert/strict';
import test from 'node:test';
import { mitlan } from '../src/spells/elements/mitlan.js';
import { GameAudio } from '../src/audio/audio.js';
import { playSpellSound } from '../src/audio/spells.js';
import { fakeRecordedAudio } from '../test-support/recorded-audio.js';
import { runeScene } from '../test-support/spells.js';

const spells = await Promise.all(mitlan.map(async id =>
  (await import(`../src/spells/definitions/${id}.js`)).default));
const supported = new Set(['kind', 'type', 'frequency', 'endFrequency', 'detune',
  'delay', 'duration', 'gain', 'attack', 'decay', 'sustain', 'release',
  'cutoff', 'filterType', 'Q', 'playbackRate', 'offset']);

for (const spell of spells) {
  test(`${spell.name}: every authored stage renders within the voice and envelope budget`, () => {
    const { sounds } = spell.presentation;
    for (const stage of ['cast', 'impact', 'pulse']) {
      const recipe = sounds[stage];
      assert.ok(Array.isArray(recipe) && recipe.length >= 3 && recipe.length <= 8, stage);
      assert.ok(recipe.reduce((sum, layer) => sum + layer.gain, 0) <= 0.45, `${stage} gain headroom`);
      assert.ok(recipe.some(layer => layer.kind === 'tone'), `${stage} pressure pitch`);
      assert.ok(recipe.some(layer => layer.kind === 'noise'), `${stage} water texture`);
      for (const layer of recipe) {
        assert.ok(Object.keys(layer).every(key => supported.has(key)), 'no silently ignored options');
        assert.ok(layer.duration >= 0.01 && layer.duration <= 2.5);
        assert.ok(layer.gain > 0 && layer.gain <= 0.25);
        assert.ok((layer.delay ?? 0) >= 0 && (layer.delay ?? 0) <= 2);
        for (const key of ['attack', 'decay', 'sustain', 'release']) assert.ok(Number.isFinite(layer[key]), key);
        assert.ok(layer.attack >= 0.001 && layer.attack <= layer.duration / 2);
        assert.ok(layer.decay >= 0 && layer.release >= 0.001);
        assert.ok(layer.attack + layer.decay + layer.release <= layer.duration + 1e-9, 'envelope fits without clamping');
        assert.ok(layer.sustain >= 0 && layer.sustain <= 1);
        if (layer.kind === 'noise') assert.ok(layer.cutoff >= 20, 'authored filtered texture');
      }
      const fake = fakeRecordedAudio();
      const handles = playSpellSound(fake.engine, { stage, presentation: spell.presentation, x: 3, y: 7 });
      assert.equal(handles.length, recipe.length, 'no layers truncated or dropped');
      assert.deepEqual(fake.invalid, [], 'finite Web Audio scheduling');
      assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 3 && route.y === 7));
      handles.forEach(handle => handle.stop());
      assert.ok(fake.routes.every(route => route.disposals === 1));
    }
  });

  test(`${spell.name}: real rune events select authored cues and cancel their delayed tails`, () => {
    const scene = runeScene(spell, { range: spell.id === 'drowning-prison' ? 20 : 2 }), events = [];
    scene.casting.onSound = event => events.push(event);
    assert.equal(scene.cast().ok, true);
    const initialCount = events.length;
    assert.equal(scene.castWithoutMana().ok, false);
    assert.equal(events.length, initialCount, 'rejected cast stays silent');
    scene.advance(10);
    const cues = events.filter(event => event.type === 'spell');
    assert.deepEqual([...new Set(cues.map(event => event.stage))].sort(), ['cast', 'impact', 'pulse'],
      'exercise every emitted stage in a real cast');
    const fake = fakeRecordedAudio(), audio = new GameAudio({}, fake.engine);
    const handles = [];
    for (const stage of new Set(cues.map(event => event.stage))) {
      const event = cues.find(cue => cue.stage === stage);
      assert.equal(event.presentation, spell.presentation);
      const played = audio.play(event);
      assert.equal(played.length, spell.presentation.sounds[stage].length, stage);
      handles.push(...played);
    }
    audio.play({ type: 'spell-stop', owner: scene.casting });
    assert.ok(handles.every(handle => handle.ended), 'including future delayed layers');
    assert.ok(fake.routes.every(route => route.disposals === 1));
    assert.deepEqual(fake.invalid, []);
  });
}

test('Mitlan spells and their three sound stages have individual authored identities', () => {
  const signatures = spells.flatMap(spell => Object.values(spell.presentation.sounds).map(recipe => JSON.stringify(recipe)));
  assert.equal(new Set(signatures).size, signatures.length, 'no copied complete cues');
});
