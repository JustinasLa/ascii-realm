import assert from 'node:assert/strict';
import test from 'node:test';
import { seithr } from '../src/spells/elements/seithr.js';
import { playSpellSound } from '../src/audio/spells.js';
import { runeScene } from '../test-support/spells.js';
import { fakeRecordedAudio } from '../test-support/recorded-audio.js';

const spells = await Promise.all(seithr.map(async id =>
  (await import(`../src/spells/definitions/${id}.js`)).default));
const supported = new Set(['kind', 'type', 'delay', 'duration', 'gain', 'attack', 'decay',
  'sustain', 'release', 'frequency', 'endFrequency', 'detune', 'cutoff', 'filterType',
  'Q', 'offset', 'playbackRate']);

for (const spell of spells) {
  test(`${spell.name}: every emitted stage plays authored Seithr voices and disposes them`, () => {
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
        assert.ok(layers?.length >= 3 && layers.length <= 8, `${event.stage} has a full audible recipe`);
        const fake = fakeRecordedAudio();
        const handles = playSpellSound(fake.engine, event);
        assert.equal(handles.length, layers.length, 'every authored voice starts');
        assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === event.x && route.y === event.y));
        assert.deepEqual(fake.invalid, [], 'Web Audio automation stays finite');
        assert.ok(fake.nodes.filter(node => ['source', 'oscillator'].includes(node.kind))
          .every(node => node.stops[0] > node.starts[0]));
        for (const handle of handles) handle.stop();
        assert.ok(handles.every(handle => handle.ended));
        assert.ok(fake.routes.every(route => route.disposals === 1), 'voices release their routes');
      }
    }
    assert.deepEqual([...stages].sort(), ['cast', 'impact', 'pulse'], 'real casts cover every sound-stage mapping');
  });

  test(`${spell.name}: layered recipes fit renderer, envelope and mix budgets`, () => {
    for (const [stage, layers] of Object.entries(spell.presentation.sounds)) {
      assert.ok(['cast', 'impact', 'pulse'].includes(stage), 'sound stage is consumed by casting');
      assert.ok(layers.some(layer => layer.kind === 'tone'), `${stage} has a pitched identity`);
      assert.ok(layers.some(layer => layer.kind === 'noise' && Number.isFinite(layer.cutoff)), `${stage} has filtered texture`);
      assert.ok(layers.reduce((sum, layer) => sum + layer.gain, 0) <= 0.45, `${stage} leaves mix headroom`);
      for (const layer of layers) {
        for (const field of Object.keys(layer)) assert.ok(supported.has(field), `${field} is supported`);
        for (const field of ['duration', 'gain', 'attack', 'decay', 'sustain', 'release']) {
          assert.ok(Number.isFinite(layer[field]), `${stage}.${field} is authored explicitly`);
        }
        assert.ok((layer.delay ?? 0) >= 0 && (layer.delay ?? 0) <= 2);
        assert.ok(layer.duration >= 0.01 && layer.duration <= 2.5);
        assert.ok(layer.gain > 0 && layer.gain <= 0.25);
        assert.ok(layer.attack >= 0.001 && layer.attack <= layer.duration / 2);
        assert.ok(layer.decay > 0 && layer.release >= 0.001);
        assert.ok(layer.attack + layer.decay + layer.release <= layer.duration + 1e-9,
          'authored envelope fits without renderer clamping');
        assert.ok(layer.sustain >= 0 && layer.sustain < 1, 'decay shapes the held body');
        if (layer.kind === 'tone') {
          assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(layer.type));
          assert.ok(layer.frequency >= 20 && layer.frequency <= 4000);
          assert.ok(layer.endFrequency >= 20 && layer.endFrequency <= 4000);
        }
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
