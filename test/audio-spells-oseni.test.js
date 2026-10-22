import assert from 'node:assert/strict';
import test from 'node:test';
import { oseni } from '../src/spells/elements/oseni.js';
import { playSpellSound } from '../src/audio/spells.js';
import { fakeRecordedAudio } from '../test-support/recorded-audio.js';
import { runeScene } from '../test-support/spells.js';

const spells = await Promise.all(oseni.map(async id =>
  (await import(`../src/spells/definitions/${id}.js`)).default));
const stages = ['cast', 'impact', 'pulse'];
const supported = new Set(['kind', 'delay', 'duration', 'gain', 'attack', 'decay',
  'sustain', 'release', 'frequency', 'endFrequency', 'type', 'detune', 'cutoff',
  'filterType', 'Q', 'playbackRate', 'offset']);

for (const spell of spells) {
  test(`${spell.id}: all emitted stages have bounded, enveloped ritual sound layers`, () => {
    assert.equal(spell.presentation.id, spell.id);
    for (const stage of stages) {
      const recipe = spell.presentation.sounds[stage];
      assert.ok(recipe.length >= 3 && recipe.length <= 6, `${stage}: authored layer budget`);
      assert.ok(recipe.some(layer => layer.kind === 'tone'), `${stage}: pitched body`);
      assert.ok(recipe.some(layer => layer.kind === 'noise'), `${stage}: fire texture`);
      assert.ok(recipe.reduce((sum, layer) => sum + layer.gain, 0) <= 0.45,
        `${stage}: leave mix headroom for simultaneous spells`);
      for (const layer of recipe) {
        for (const field of Object.keys(layer)) assert.ok(supported.has(field), `${stage}: unsupported ${field}`);
        assert.ok(layer.duration > 0 && layer.duration <= 2.5);
        assert.ok((layer.delay ?? 0) >= 0 && (layer.delay ?? 0) <= 2);
        assert.ok(layer.gain > 0 && layer.gain <= 0.25);
        for (const field of ['attack', 'decay', 'sustain', 'release']) {
          assert.ok(Number.isFinite(layer[field]) && layer[field] >= 0, `${stage}: authored ${field}`);
        }
        assert.ok(layer.sustain <= 1);
        assert.ok(layer.attack >= 0.001 && layer.attack <= layer.duration * 0.5,
          `${stage}: attack fits the renderer's envelope bounds`);
        assert.ok(layer.release >= 0.001);
        assert.ok(layer.attack + layer.decay + layer.release <= layer.duration + 1e-9,
          `${stage}: renderer must not silently shorten the authored envelope`);
        if (layer.kind === 'noise') assert.ok(Number.isFinite(layer.cutoff), `${stage}: filtered fire texture`);
      }
    }
  });

  test(`${spell.id}: runtime stages render every layer spatially and release all nodes`, () => {
    const scene = runeScene(spell), events = [];
    scene.casting.onSound = event => events.push(event);
    const ctx = scene.casting.context(spell, scene.casting.variant(spell), scene.player);
    for (const [visualStage, soundStage] of [['cast', 'cast'], ['impact', 'impact'],
      ['aura', 'impact'], ['zone', 'pulse'], ['pulse', 'pulse']]) {
      scene.casting.presentationCues.clear();
      scene.casting.present(ctx, scene.foe, visualStage);
      const event = events.at(-1);
      assert.equal(event.stage, soundStage);
      assert.equal(event.presentation, spell.presentation);
      const audio = fakeRecordedAudio();
      const handles = playSpellSound(audio.engine, event);
      assert.equal(handles.length, spell.presentation.sounds[soundStage].length);
      assert.ok(audio.routes.every(route => route.bus === 'sfx' && route.x === scene.foe.x && route.y === scene.foe.y));
      assert.deepEqual(audio.invalid, []);
      const sources = audio.nodes.filter(node => node.kind === 'source' || node.kind === 'oscillator');
      assert.equal(sources.length, handles.length);
      assert.ok(sources.every(source => source.starts[0] >= audio.context.currentTime && source.stops[0] > source.starts[0]));
      for (const source of sources) source.onended();
      for (const handle of handles) { assert.equal(handle.ended, true); handle.stop(); }
      assert.ok(audio.routes.every(route => route.disposals === 1));
      assert.ok(audio.nodes.every(node => node.disconnects === 1));
      audio.context.state = 'suspended';
      assert.deepEqual(playSpellSound(audio.engine, event), []);
    }
  });

  test(`${spell.id}: successful gameplay emits authored cues and failed casts stay silent`, () => {
    const scene = runeScene(spell), events = [];
    scene.casting.onSound = event => events.push(event);
    assert.equal(scene.cast().ok, true);
    const count = events.length;
    assert.equal(scene.castWithoutMana().ok, false);
    assert.equal(events.length, count);
    scene.advance(4);
    const cues = events.filter(event => event.type === 'spell');
    assert.equal(cues.filter(event => event.stage === 'cast').length, 1);
    assert.ok(cues.every(event => event.presentation === spell.presentation &&
      spell.presentation.sounds[event.stage]?.length >= 3));
  });
}

test('Oseni spells have distinct cast, impact, and pulse signatures', () => {
  for (const stage of stages) {
    assert.equal(new Set(spells.map(spell => JSON.stringify(spell.presentation.sounds[stage]))).size,
      oseni.length, `${stage}: each spell has its own identity`);
  }
});
