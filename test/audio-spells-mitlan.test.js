import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mitlan } from '../src/spells/elements/mitlan.js';
import { GameAudio } from '../src/audio/audio.js';
import { playSpellSound } from '../src/audio/spells.js';
import { fakeRecordedAudio } from '../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../test-support/spell-audio.js';
import { runeScene } from '../test-support/spells.js';

const spells = await Promise.all(mitlan.map(async id =>
  (await import(`../src/spells/definitions/${id}.js`)).default));
const supported = new Set(['kind', 'url', 'gain', 'rate', 'delay']);

for (const spell of spells) {
  test(`${spell.name}: every stage uses real recordings within the mix budget`, async () => {
    const { sounds } = spell.presentation;
    for (const stage of ['cast', 'impact', 'pulse']) {
      const recipe = sounds[stage];
      assert.ok(Array.isArray(recipe) && recipe.length >= 1 && recipe.length <= 4, stage);
      assert.ok(recipe.reduce((sum, layer) => sum + layer.gain, 0) <= 0.65, `${stage} gain headroom`);
      for (const layer of recipe) {
        assert.ok(Object.keys(layer).every(key => supported.has(key)), 'no silently ignored options');
        assert.equal(layer.kind, 'recording', 'no oscillator or generated-noise substitute');
        assert.match(layer.url, /^\/assets\/audio\/spells\/mitlan\/[a-z-]+\.wav$/);
        assert.ok(layer.gain >= 0.04 && layer.gain <= 0.35);
        if (stage === 'pulse') assert.ok(layer.gain <= 0.07, 'repeated movement stays unobtrusive');
        assert.ok(layer.rate >= 0.75 && layer.rate <= 1.2, 'retain recognizable natural texture');
        assert.ok((layer.delay ?? 0) >= 0 && (layer.delay ?? 0) <= 2);
      }
      const fake = fakeRecordedAudio();
      await prepareRecordedSpellTest(fake, spell);
      const handles = playSpellSound(fake.engine, { stage, presentation: spell.presentation, x: 3, y: 7 });
      assert.equal(handles.length, recipe.length, 'no layers truncated or dropped');
      assert.deepEqual(fake.invalid, [], 'finite Web Audio scheduling');
      assert.equal(fake.nodes.filter(node => node.kind === 'oscillator').length, 0);
      assert.equal(fake.nodes.filter(node => node.kind === 'source').length, recipe.length);
      assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 3 && route.y === 7));
      handles.forEach(handle => handle.stop());
      assert.ok(fake.routes.every(route => route.disposals === 1));
    }
  });

  test(`${spell.name}: real rune events select authored cues and cancel their delayed tails`, async () => {
    const scene = runeScene(spell, { range: spell.id === 'drowning-prison' ? 20 : 2 }), events = [];
    scene.casting.onSound = event => events.push(event);
    assert.equal(scene.cast().ok, true);
    const initialCount = events.length;
    if (scene.casting.modifiers(scene.casting.variant(spell)).mana > 0) {
      assert.equal(scene.castWithoutMana().ok, false);
    } else {
      // Free toggles can cast at zero mana; silence still rejects without cues.
      scene.casting.state().auras.set('silenced', { until: Infinity });
      assert.equal(scene.cast().ok, false);
      scene.casting.state().auras.delete('silenced');
    }
    assert.equal(events.length, initialCount, 'rejected cast stays silent');
    scene.advance(10);
    const cues = events.filter(event => event.type === 'spell');
    assert.deepEqual([...new Set(cues.map(event => event.stage))].sort(), ['cast', 'impact', 'pulse'],
      'exercise every emitted stage in a real cast');
    const fake = fakeRecordedAudio(), audio = new GameAudio({}, fake.engine);
    await prepareRecordedSpellTest(fake, spell);
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

test('Mitlan spells do not reuse one another\'s foreground recordings', () => {
  const owners = new Map();
  for (const spell of spells) {
    for (const voice of Object.values(spell.presentation.sounds).flat()) {
      const owner = owners.get(voice.url);
      assert.ok(!owner || owner === spell.id, `${spell.id} reuses ${owner}'s texture: ${voice.url}`);
      owners.set(voice.url, spell.id);
    }
  }
});

test('Mitlan CC0 recordings retain source detail with clean bounded PCM and documented provenance', async () => {
  const directory = new URL('../assets/audio/spells/mitlan/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('sources.json', directory), 'utf8'));
  assert.equal(manifest.license, 'CC0-1.0');
  assert.equal(manifest.clips.length, 19);
  const sourceNames = new Set(manifest.sources.map(source => source.file));
  assert.ok(!sourceNames.has('boiling.mp3') && !sourceNames.has('wading.mp3'), 'no boiling or close foot splashes');
  for (const source of manifest.sources) {
    assert.equal(source.license, 'CC0-1.0');
    assert.match(source.page, /^https:\/\/(freesound.org|opengameart.org)\//);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
  for (const clip of manifest.clips) {
    assert.ok(sourceNames.has(clip.source));
    const bytes = await readFile(new URL(clip.file, directory));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt16LE(20), 1, 'uncompressed PCM');
    assert.equal(bytes.readUInt16LE(22), 1, 'mono spatial foley');
    assert.equal(bytes.readUInt32LE(24), 44100, 'retain original preview bandwidth');
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.ok(clip.duration >= 0.14 && clip.duration <= (clip.file === 'thunder-clap.wav' ? 1.4 : 0.96));
    const samples = (bytes.length - 44)/2;
    let sum = 0, sumSquares = 0, peak = 0;
    for (let index = 0; index < samples; index++) {
      const value = bytes.readInt16LE(44+index*2)/32768;
      sum += value; sumSquares += value*value; peak = Math.max(peak, Math.abs(value));
    }
    assert.ok(peak > 0.1 && peak <= 0.581, `${clip.file}: restrained unclipped peak`);
    assert.ok(Math.abs(sum/samples) < 0.0001, `${clip.file}: removed DC`);
    const rms = Math.sqrt(sumSquares/samples);
    assert.ok(rms > 0.005 && rms <= clip.rmsCeiling + 0.001, `${clip.file}: audible but restrained body`);
    assert.equal(bytes.readInt16LE(44), 0, 'click-free opening');
    assert.equal(bytes.readInt16LE(bytes.length-2), 0, 'click-free close');
  }
  const files = new Set(manifest.clips.map(clip => '/assets/audio/spells/mitlan/'+clip.file));
  for (const spell of spells) for (const recipe of Object.values(spell.presentation.sounds)) {
    for (const layer of recipe) assert.ok(files.has(layer.url), 'every used recording has provenance');
  }
  // Different filenames or small pitch/gain changes can still mask the same
  // foreground material. The seven revised casts must use different recordings.
  const sourceByFile = new Map(manifest.clips.map(clip => [clip.file, clip.source]));
  const materials = spells.filter(spell => !['lightning', 'drowning-prison'].includes(spell.id)).map(spell => {
    const lead = spell.presentation.sounds.cast.reduce((a, b) => a.gain > b.gain ? a : b);
    return sourceByFile.get(lead.url.split('/').at(-1));
  });
  assert.equal(new Set(materials).size, materials.length, 'foreground casts use different source materials');
});
