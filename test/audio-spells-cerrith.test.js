import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cerrith } from '../src/spells/elements/cerrith.js';
import { playSpellSound } from '../src/audio/spells.js';
import { GameAudio } from '../src/audio/audio.js';
import { runeScene } from '../test-support/spells.js';
import { fakeRecordedAudio } from '../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../test-support/spell-audio.js';

const spells = await Promise.all(cerrith.map(async id => (await import(`../src/spells/definitions/${id}.js`)).default));
const supported = new Set(['kind', 'url', 'gain', 'rate', 'delay']);
const base = '/assets/audio/spells/cerrith/';
const manifest = JSON.parse(await readFile(new URL(`..${base}sources.json`, import.meta.url), 'utf8'));
const files = new Set(manifest.crops.map(crop => `${base}${crop.file}`));

test('Cerrith foley files match their provenance manifest and retain clean full-rate PCM', async () => {
  assert.equal(manifest.sources.length, 7);
  assert.ok(manifest.sources.every(source => source.license === 'CC0-1.0' && source.source.startsWith('https://freesound.org/')));
  for (const crop of manifest.crops) {
    assert.ok(manifest.sources.some(source => source.id === crop.source));
    const bytes = await readFile(new URL(`..${base}${crop.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), crop.sha256, crop.file);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(20), 1, 'uncompressed PCM');
    assert.equal(bytes.readUInt16LE(22), 1, 'mono for positional routing');
    assert.equal(bytes.readUInt32LE(24), 48000, 'preserve physical detail at 48 kHz');
    assert.equal(bytes.readUInt16LE(34), 16);
    const count = bytes.readUInt32LE(40) / 2;
    assert.ok(count / 48000 >= 0.3 && count / 48000 <= 3);
    let peak = 0, sum = 0, energy = 0;
    for (let i = 0; i < count; i++) {
      const sample = bytes.readInt16LE(44 + i * 2) / 32768;
      peak = Math.max(peak, Math.abs(sample)); sum += sample; energy += sample * sample;
    }
    assert.ok(peak <= 0.85 && peak > 0.2, `${crop.file}: useful clean headroom`);
    assert.ok(Math.abs(sum / count) < 0.0001, `${crop.file}: no DC`);
    assert.ok(Math.sqrt(energy / count) > 0.005, `${crop.file}: non-silent recording`);
    assert.equal(bytes.readInt16LE(44), 0, 'entry boundary fades to zero');
    assert.equal(bytes.readInt16LE(44 + (count - 1) * 2), 0, 'exit boundary fades to zero');
  }
});

test('every Cerrith spell has unique, bounded layers for all emitted sound stages', () => {
  assert.equal(spells.length, 12);
  for (const stage of ['cast', 'impact', 'pulse']) {
    const signatures = new Set();
    for (const spell of spells) {
      if (stage === 'pulse' && spell.id === 'temp-quickshot') continue; // Leaf Arrow emits only launch and collision.
      const recipe = spell.presentation.sounds[stage], label = `${spell.id}/${stage}`;
      assert.ok(recipe.length >= 1 && recipe.length <= 4, `${label}: restrained recording layers`);
      assert.ok(recipe.reduce((sum, v) => sum + v.gain, 0) <= (stage === 'pulse' ? 0.3 : 1.2), `${label}: conservative total gain`);
      for (const voice of recipe) {
        assert.ok(Object.keys(voice).every(key => supported.has(key)), `${label}: supported voice fields`);
        assert.equal(voice.kind, 'recording', `${label}: real foley, no synthesis`);
        assert.ok(files.has(voice.url), `${label}: licensed recorded asset`);
        assert.ok(voice.gain >= 0.1 && voice.gain <= 0.8);
        assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2, `${label}: preserve natural source character`);
        assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
        for (const value of Object.values(voice)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
      }
      signatures.add(JSON.stringify(recipe));
    }
    assert.equal(signatures.size, spells.length - (stage === 'pulse' ? 1 : 0), `${stage}: individual spell signatures`);
  }
});

test('Cerrith cues use spatial SFX routing and dispose every layer including delayed sources', async () => {
  for (const spell of spells) {
    const fake = fakeRecordedAudio(), audio = new GameAudio({}, fake.engine), owner = {};
    await prepareRecordedSpellTest(fake, spell.presentation);
    const handles = [];
    for (const stage of Object.keys(spell.presentation.sounds)) {
      const rendered = audio.play({ type: 'spell', presentation: spell.presentation, stage, x: 7, y: 11, owner });
      assert.equal(rendered.length, spell.presentation.sounds[stage].length, `${spell.id}/${stage}`);
      handles.push(...rendered);
    }
    assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 7 && route.y === 11));
    assert.deepEqual(fake.invalid, []);
    assert.ok(fake.nodes.every(node => node.kind !== 'oscillator'), 'no oscillator fallback');
    assert.equal(fake.nodes.filter(node => node.kind === 'source').length, handles.length);
    audio.play({ type: 'spell-stop', owner });
    assert.ok(handles.every(handle => handle.ended));
    assert.ok(fake.routes.every(route => route.disposals === 1));
    assert.equal(audio.effects.size, 0);
    assert.equal(audio.spellEffects.size, 0);
    fake.context.state = 'suspended';
    const before = fake.nodes.length;
    assert.deepEqual(playSpellSound(fake.engine, { presentation: spell.presentation, stage: 'cast', x: 7, y: 11 }), []);
    assert.equal(fake.nodes.length, before, 'locked audio does not allocate');
  }
});

test('Cerrith presentation events map auras and zones to audible authored cues', async () => {
  for (const spell of spells) {
    const scene = runeScene(spell), events = [];
    scene.casting.onSound = event => events.push(event);
    const ctx = scene.casting.context(spell, scene.casting.variant(spell), scene.player);
    for (const [visualStage, audioStage] of [['cast', 'cast'], ['impact', 'impact'], ['aura', 'impact'], ['pulse', 'pulse'], ['zone', 'pulse']]) {
      if (spell.id === 'temp-quickshot' && !['cast', 'impact'].includes(visualStage)) continue;
      scene.casting.time += 1;
      scene.casting.present(ctx, scene.player, visualStage);
      const event = events.at(-1);
      assert.equal(event.type, 'spell');
      assert.equal(event.stage, audioStage, `${spell.id}/${visualStage}`);
      assert.equal(event.presentation, spell.presentation);
      const fake = fakeRecordedAudio();
      await prepareRecordedSpellTest(fake, spell.presentation);
      const handles = playSpellSound(fake.engine, event);
      assert.equal(handles.length, spell.presentation.sounds[audioStage].length);
      handles.forEach(handle => handle.stop());
    }
  }
});
