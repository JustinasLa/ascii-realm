import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { oseni } from '../src/spells/elements/oseni.js';
import { playSpellSound } from '../src/audio/spells.js';
import { fakeRecordedAudio } from '../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../test-support/spell-audio.js';
import { runeScene } from '../test-support/spells.js';

const spells = await Promise.all(oseni.map(async id =>
  (await import(`../src/spells/definitions/${id}.js`)).default));
const stages = ['cast', 'impact', 'pulse'];
const supported = new Set(['kind', 'url', 'gain', 'rate', 'delay']);
const bank = new URL('../assets/audio/spells/oseni/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('sources.json', bank), 'utf8'));

for (const spell of spells) {
  test(`${spell.id}: every emitted stage uses licensed physical foley without synthesized layers`, () => {
    assert.equal(spell.presentation.id, spell.id);
    for (const stage of stages) {
      const recipe = spell.presentation.sounds[stage];
      assert.ok(recipe.length >= 1 && recipe.length <= 4, `${stage}: recorded layer budget`);
      assert.ok(recipe.reduce((sum, layer) => sum + layer.gain, 0) <= 0.75,
        `${stage}: leave mix headroom for simultaneous spells`);
      for (const layer of recipe) {
        for (const field of Object.keys(layer)) assert.ok(supported.has(field), `${stage}: unsupported ${field}`);
        assert.equal(layer.kind, 'recording');
        assert.match(layer.url, /^\/assets\/audio\/spells\/oseni\/[a-z-]+\.wav$/);
        assert.ok(manifest.clips.some(clip => layer.url.endsWith('/' + clip.file)), 'recording has documented provenance');
        assert.ok((layer.delay ?? 0) >= 0 && (layer.delay ?? 0) <= 2);
        assert.ok(layer.gain >= 0.04 && layer.gain <= 0.35);
        if (stage === 'pulse') assert.ok(layer.gain <= 0.08, 'repeated cues stay beneath the cast');
        assert.ok(layer.rate >= 0.75 && layer.rate <= 1.2, 'physical foley keeps its natural detail');
      }
    }
  });

  test(`${spell.id}: runtime stages render every recording spatially and release all nodes`, async () => {
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
      await prepareRecordedSpellTest(audio, spell.presentation);
      const handles = playSpellSound(audio.engine, event);
      assert.equal(handles.length, spell.presentation.sounds[soundStage].length);
      assert.ok(audio.routes.every(route => route.bus === 'sfx' && route.x === scene.foe.x && route.y === scene.foe.y));
      assert.deepEqual(audio.invalid, []);
      assert.ok(!audio.nodes.some(node => node.kind === 'oscillator'), 'no oscillator allocation');
      const sources = audio.nodes.filter(node => node.kind === 'source');
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
      spell.presentation.sounds[event.stage]?.length >= 1));
  });
}

test('Oseni spells have distinct cast, impact, and pulse signatures', () => {
  for (const stage of stages) {
    assert.equal(new Set(spells.map(spell => JSON.stringify(spell.presentation.sounds[stage]))).size,
      oseni.length, `${stage}: each spell has its own identity`);
  }
});

test('Oseni recordings retain full-rate PCM, clean ends, headroom and traceable real-world sources', () => {
  assert.ok(manifest.sources.length >= 4);
  assert.ok(manifest.sources.every(source => source.license === 'CC0-1.0' && source.author && source.recording));
  assert.deepEqual(manifest.sources.map(source => source.id).sort(), ['cloth', 'crack', 'swish', 'thunder'],
    'the bank contains no fireplace or blowtorch source');
  for (const clip of manifest.clips) {
    const bytes = readFileSync(new URL(clip.file, bank));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    let pcm, sampleRate, channels, bits;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(offset + 4), tag = bytes.toString('ascii', offset, offset + 4);
      if (tag === 'fmt ') {
        assert.equal(bytes.readUInt16LE(offset + 8), 1);
        channels = bytes.readUInt16LE(offset + 10);
        sampleRate = bytes.readUInt32LE(offset + 12);
        bits = bytes.readUInt16LE(offset + 22);
      }
      if (tag === 'data') pcm = bytes.subarray(offset + 8, offset + 8 + size);
      offset += 8 + size + size % 2;
    }
    assert.equal(channels, 1);
    assert.equal(bits, 16);
    assert.ok(sampleRate >= 44100);
    const duration = pcm.length / 2 / sampleRate;
    assert.ok(duration >= 0.3 && duration <= 0.9, 'short tails leave room for footsteps and ambience');
    assert.ok(Math.abs(duration - clip.durationSeconds) < 1 / sampleRate);
    assert.equal(pcm.readInt16LE(0), 0);
    assert.equal(pcm.readInt16LE(pcm.length - 2), 0);
    let energy = 0, peak = 0;
    for (let i = 0; i < pcm.length; i += 2) {
      const value = pcm.readInt16LE(i) / 32768;
      peak = Math.max(peak, Math.abs(value)); energy += value * value;
    }
    assert.ok(peak > 0.2 && peak <= 0.551, `${clip.file}: intact transient with restrained peak`);
    const rms = Math.sqrt(energy / (pcm.length / 2));
    assert.ok(rms > 0.005 && rms <= 0.121, `${clip.file}: audible body without a loud sustained bed`);
    assert.ok(manifest.sources.some(source => source.id === clip.source));
  }
});
