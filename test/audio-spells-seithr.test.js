import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepareRecordedSpellTest } from '../test-support/spell-audio.js';
import { seithr } from '../src/spells/elements/seithr.js';
import { playSpellSound } from '../src/audio/spells.js';
import { runeScene } from '../test-support/spells.js';
import { fakeRecordedAudio } from '../test-support/recorded-audio.js';

const spells = await Promise.all(seithr.map(async id =>
  (await import(`../src/spells/definitions/${id}.js`)).default));
const supported = new Set(['kind', 'url', 'gain', 'rate', 'delay']);
const assetRoot = new URL('../assets/audio/spells/seithr/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('sources.json', assetRoot), 'utf8'));
const files = new Set(manifest.clips.map(clip => '/assets/audio/spells/seithr/' + clip.file));

for (const spell of spells) {
  test(`${spell.name}: every emitted stage plays authored Seithr recordings and disposes them`, async () => {
    const stages = new Set();
    // Close targets exercise projectiles and shields; distant targets exercise
    // the actual landing areas of glyphs, fields and Frozen Tomb.
    for (const range of [3, 18, 20]) {
      const scene = runeScene(spell, { range });
      scene.foe.health = scene.foe.maxHealth = 1000;
      const events = [];
      scene.casting.onSound = event => events.push(event);
      assert.equal(scene.cast().ok, true);
      scene.advance(15);
      for (const event of events.filter(event => event.type === 'spell')) {
        assert.equal(event.presentation, spell.presentation);
        if (stages.has(event.stage)) continue;
        stages.add(event.stage);
        const layers = event.presentation.sounds[event.stage];
        assert.ok(layers?.length >= 1 && layers.length <= 4, `${event.stage} has a full audible recipe`);
        const fake = fakeRecordedAudio();
        assert.equal(await prepareRecordedSpellTest(fake, spell.presentation), true);
        const handles = playSpellSound(fake.engine, event);
        assert.equal(handles.length, layers.length, 'every authored voice starts');
        assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === event.x && route.y === event.y));
        assert.deepEqual(fake.invalid, [], 'Web Audio automation stays finite');
        assert.equal(fake.nodes.filter(node => node.kind === 'oscillator').length, 0);
        assert.equal(fake.allocations.length, 0, 'no generated noise buffer');
        assert.ok(fake.nodes.filter(node => node.kind === 'source')
          .every(node => node.stops[0] > node.starts[0]));
        for (const handle of handles) handle.stop();
        assert.ok(handles.every(handle => handle.ended));
        assert.ok(fake.routes.every(route => route.disposals === 1), 'voices release their routes');
      }
    }
    assert.deepEqual([...stages].sort(), ['cast', 'impact', 'pulse'], 'real casts cover every sound-stage mapping');
  });

  test(`${spell.name}: recipes use only licensed recordings within playback limits`, () => {
    for (const [stage, layers] of Object.entries(spell.presentation.sounds)) {
      assert.ok(['cast', 'impact', 'pulse'].includes(stage));
      assert.ok(layers.length >= 1 && layers.length <= 4);
      assert.ok(layers.reduce((sum, layer) => sum + layer.gain, 0) <= 1.2, `${stage} leaves mix headroom`);
      for (const layer of layers) {
        assert.equal(layer.kind, 'recording', 'Seithr never falls back to synthetic voices');
        assert.ok(files.has(layer.url), 'recording has a licensed provenance entry');
        for (const field of Object.keys(layer)) assert.ok(supported.has(field), `${field} is supported`);
        assert.ok(Number.isFinite(layer.gain) && layer.gain >= 0.1 && layer.gain <= 0.8);
        assert.ok((layer.rate ?? 1) >= 0.75 && (layer.rate ?? 1) <= 1.2);
        assert.ok((layer.delay ?? 0) >= 0 && (layer.delay ?? 0) <= 2);
      }
    }
  });
}

test('each Seithr spell has a distinct cast, contact and pulse arrangement', () => {
  for (const stage of ['cast', 'impact', 'pulse']) {
    assert.equal(new Set(spells.map(spell => JSON.stringify(spell.presentation.sounds[stage]))).size,
      seithr.length, `${stage} cues are independently authored`);
  }
});


test('Seithr physical foley assets retain full-band PCM detail, clean ends and source provenance', async () => {
  assert.ok(manifest.sources.length >= 4);
  for (const source of manifest.sources) {
    assert.ok(['CC0-1.0', 'CC-BY-4.0'].includes(source.license));
    assert.match(source.page, /^https:\/\/freesound\.org\//);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
  for (const clip of manifest.clips) {
    const bytes = await readFile(new URL(clip.file, assetRoot));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256, clip.file);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
    assert.equal(bytes.readUInt16LE(20), 1, 'uncompressed PCM');
    assert.equal(bytes.readUInt16LE(22), 1, 'mono spatial foley');
    assert.ok(bytes.readUInt32LE(24) >= 44100, 'full-rate audio');
    assert.equal(bytes.readUInt16LE(34), 16);
    const count = bytes.readUInt32LE(40) / 2;
    assert.ok(count / bytes.readUInt32LE(24) >= 0.3 && count / bytes.readUInt32LE(24) <= 3);
    let peak = 0, power = 0, dc = 0;
    for (let i = 0; i < count; i++) {
      const sample = bytes.readInt16LE(44 + i * 2) / 32768;
      peak = Math.max(peak, Math.abs(sample)); power += sample * sample; dc += sample;
    }
    assert.ok(peak <= 0.85 && Math.sqrt(power / count) > 0.005, 'audible recording with headroom');
    assert.ok(Math.abs(dc / count) < 0.003, 'no meaningful DC bias');
    assert.equal(bytes.readInt16LE(44), 0, 'fade starts silently');
    assert.equal(bytes.readInt16LE(44 + (count - 1) * 2), 0, 'fade ends silently');
    assert.ok(manifest.sources.some(source => source.id === clip.sourceId));
  }
});
