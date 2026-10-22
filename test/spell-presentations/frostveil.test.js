import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import presentation from '../../src/spells/presentations/frostveil.js';
import spell from '../../src/spells/definitions/frostveil.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';

function points(stage, progress, radius = 2, heading = 0, life = presentation.duration) {
  const result = [];
  presentation.draw(Object.freeze({ stage, progress, age: progress * life,
    life, radius, heading }), (...point) => result.push(point));
  return result;
}

const lit = list => list.filter(p => p[4] > 0.05);
const of = (list, chars) => lit(list).filter(p => chars.includes(p[2]));
const mean = values => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
const BUDGET = { cast: 250, impact: 250, zone: 160, aura: 160, pulse: 90, projectile: 110 };

test('Frostveil gathers frost into a flashing eyelet, then drops and dissolves a threaded veil', () => {
  const knot = -2.35, motes = p => of(points('cast', p), '.+*');
  const reach = list => mean(list.map(([x, z]) => Math.hypot(x, z - knot)));
  assert.ok(motes(0.12).length >= 10, 'anticipation starts from a ring of frost motes');
  assert.ok(reach(motes(0.3)) < reach(motes(0.12)) * 0.7, 'motes spiral in towards the knot');
  const rays = p => of(points('cast', p), '-').filter(([, z]) => Math.abs(z - knot) < 0.05).length;
  assert.ok(rays(0.42) > rays(0.25) + 6, 'the knot flashes with horizontal rays when the motes arrive');
  const veil = p => of(points('cast', p), '|!:');
  const hem = p => Math.max(...veil(p).map(([, z]) => z));
  assert.ok(veil(0.85).length > 60, 'eleven fine threads form a dense curtain');
  assert.ok(hem(0.75) > hem(0.52) + 0.6, 'threads drop from the rod with easing');
  const rod = p => Math.max(...of(points('cast', p), '~').filter(([, z]) => Math.abs(z - knot) < 0.05).map(([x]) => Math.abs(x)));
  assert.ok(rod(0.7) > rod(0.44) + 0.5, 'the rod unrolls sideways from the knot');
  for (const glyph of ['<', '>', '/', '\\']) assert.ok(of(points('cast', 0.85), glyph).length, 'eyelets open in the veil');
  assert.ok(of(points('cast', 0.96), "'").length > of(points('cast', 0.8), "'").length + 15,
    'threads break into falling frost as the veil dissolves');
});

test('Frostveil keeps its drapes hanging straight down whatever the cast heading', () => {
  for (const stage of ['cast', 'zone', 'aura', 'pulse', 'impact']) {
    const upright = points(stage, 0.6), turned = points(stage, 0.6, 2, 1.1);
    const c = Math.cos(1.1), s = Math.sin(1.1);
    turned.forEach(([x, z, char], i) => {
      assert.equal(char, upright[i][2]);
      assert.ok(Math.abs(x * c + z * s - upright[i][0]) < 1e-9 && Math.abs(z * c - x * s - upright[i][1]) < 1e-9);
    });
  }
  const sideways = points('projectile', 0.02, 0.65, Math.PI / 2);
  assert.ok(sideways.some(p => p[2] === '-') && !sideways.some(p => p[2] === '|'),
    'streamer glyphs follow the screen direction of flight');
});

test('Frostveil flies as an eyelet with streamers, parts curtains on contact and hangs a breathing veil', () => {
  const flight = points('projectile', 0.02, 0.65);
  assert.ok(of(flight, '<>').every(([x, z]) => Math.abs(x) < 0.3 && Math.abs(z) < 0.1), 'the eyelet leads');
  assert.ok(of(flight, '|').length >= 6 && of(flight, '|').every(([, z]) => z < -0.2), 'streamers trail behind');
  assert.ok(of(flight, ':.').some(([, z]) => z < -1.2), 'streamers thin out into a long wake');
  const curtain = p => mean(of(points('impact', p), '|:').map(([x]) => Math.abs(x)));
  assert.ok(curtain(0.6) > curtain(0.1) + 0.4, 'impact parts the curtains');
  const shards = p => Math.max(...of(points('impact', p), '/\\-|').map(([x, z]) => Math.hypot(x, z + 0.9)));
  assert.ok(shards(0.4) > shards(0.05), 'shards burst outward');

  const zone = (p, life = 8) => points('zone', p, 4, 0, life);
  const rod = list => Math.max(0, ...of(list, '-~').filter(([, z]) => z < -1.7).map(([x]) => Math.abs(x)));
  assert.ok(rod(zone(0.08)) > rod(zone(0.02)) + 0.6, 'the zone rod unrolls from the centre');
  assert.ok(of(zone(0.5), '|!:').length >= 60, 'thirteen threads hang below the rod');
  assert.ok(of(zone(0.5), '<>').length >= 3, 'eyelets are woven into the hanging veil');
  assert.ok(lit(zone(0.5)).some(([x, z]) => Math.abs(Math.hypot(x, z) - 4) < 0.05), 'a frost ring marks the field');
  assert.notDeepEqual(zone(0.5), zone(0.6), 'the veil sways while it lasts');

  const ring = p => Math.max(...lit(points('pulse', p, 6, 0, 0.25)).map(([x, z]) => Math.hypot(x, z)));
  assert.ok(ring(0.7) > ring(0.15), 'pulses sweep a ring outward to the edge of the silence');
  const hoop = p => mean(of(points('aura', p, 1), '-/\\|').map(([, z]) => z));
  assert.ok(hoop(0.8) > hoop(0.2) + 0.6, 'a frost hoop slides down over the silenced target');
  assert.ok(of(points('aura', 0.2, 1), '=').length === 1 && !of(points('aura', 0.7, 1), '=').length,
    'a sealed eyelet marks the silence and then fades');
});

test('Frostveil stays deterministic, finite, ASCII, bounded and fades in every runtime stage', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const radius of [1, 4, 10, 40]) {
      for (const p of [0, 0.05, 0.2, 0.42, 0.7, 0.9, 1]) {
        const result = points(stage, p, radius);
        assert.ok(result.length > 0 && result.length <= BUDGET[stage], `${stage} ${p} plotted ${result.length}`);
        assert.deepEqual(result, points(stage, p, radius));
        for (const [x, z, char, color, brightness] of result) {
          assert.ok([x, z, brightness, ...color].every(Number.isFinite));
          assert.ok(Math.abs(x) < 48 && Math.abs(z) < 48);
          assert.match(char, /^[\x20-\x7e]$/);
          assert.ok(color.every(c => c >= 0 && c <= 255));
          assert.ok(brightness >= 0 && brightness <= 1);
          if (p === 1) assert.equal(brightness, 0);
        }
      }
    }
    assert.notDeepEqual(points(stage, 0.2), points(stage, 0.7));
  }
});

test('Frostveil unfurls recorded wind and breath with quiet ice field pulses', async () => {
  const { cast, impact, pulse } = presentation.sounds;
  const name = voice => voice.url.split('/').at(-1);
  assert.deepEqual(cast.map(name), ['wind-swell.wav', 'cold-breath.wav', 'ice-grit.wav']);
  assert.ok(cast[0].delay < cast[1].delay && cast[1].delay < cast[2].delay,
    'outdoor wind opens before the breath and subtle close creak');
  assert.ok(cast[0].gain > cast[1].gain && cast[1].gain > cast[2].gain);
  assert.deepEqual(impact.map(name), ['snow-scuff.wav', 'cold-breath.wav', 'wind-swell.wav']);
  assert.ok(impact[0].delay < impact[1].delay && impact[1].delay < impact[2].delay,
    'the soft settling scuff gives way to breath and lingering wind');
  assert.equal(pulse.length, 1, 'dense field repeats have one recording only');
  assert.equal(name(pulse[0]), 'ice-tick.wav');
  assert.equal(pulse[0].gain, 0.1);
  assert.ok(0.32 / pulse[0].rate + pulse[0].delay < 0.28, 'pulse ends before the next cue gate');

  const manifest = JSON.parse(await readFile(new URL('../../assets/audio/spells/seithr/sources.json', import.meta.url)));
  for (const [stage, voices] of Object.entries(presentation.sounds)) {
    assert.ok(voices.length >= 1 && voices.length <= 4);
    assert.ok(voices.reduce((sum, voice) => sum + voice.gain, 0) <= 1.2);
    for (const voice of voices) {
      assert.deepEqual(Object.keys(voice).sort(), ['delay', 'gain', 'kind', 'rate', 'url']);
      assert.equal(voice.kind, 'recording');
      assert.ok(voice.gain >= 0.1 && voice.gain <= 0.8);
      assert.ok(voice.rate >= 0.75 && voice.rate <= 1.2);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.match(voice.url, /^\/assets\/audio\/spells\/seithr\/[a-z-]+\.wav$/);
      const clip = manifest.clips.find(item => item.file === name(voice));
      assert.ok(clip, `${name(voice)} has source provenance`);
      const source = manifest.sources.find(item => item.id === clip.sourceId);
      assert.ok(source?.provenance && source?.artist && source?.licenseUrl);
      assert.ok(['CC0-1.0', 'CC-BY-4.0'].includes(source.license));
      const bytes = await readFile(new URL('../..' + voice.url, import.meta.url));
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256);
    }
    const fake = fakeRecordedAudio();
    assert.equal(await prepareRecordedSpellTest(fake, presentation), true);
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 4, y: 7 });
    assert.equal(handles.length, voices.length);
    const sources = fake.nodes.filter(node => node.kind === 'source');
    assert.equal(sources.length, voices.length);
    sources.forEach((source, index) => {
      assert.equal(source.buffer.id, name(voices[index]));
      assert.deepEqual(source.starts, [fake.context.currentTime + voices[index].delay]);
      assert.equal(source.playbackRate.calls[0].args[0], voices[index].rate);
      assert.equal(source.loop, false);
    });
    assert.ok(!fake.nodes.some(node => node.kind === 'oscillator' || node.kind === 'filter'));
    assert.deepEqual(fake.allocations, [], 'no generated noise buffers');
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 4 && r.y === 7));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(h => h.stop());
    assert.ok(handles.every(handle => handle.ended));
    assert.ok(fake.routes.every(route => route.disposals === 1));
  }
});

test('the real Frostveil rune renders its profile and sends typed spell cues while retaining silence gameplay', () => {
  assert.equal(spell.presentation, presentation);
  const scene = runeScene(spell, { range: 20 }), sounds = [];
  scene.casting.onSound = event => sounds.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false);
  assert.equal(sounds.filter(e => e.stage === 'cast').length, 1);
  const launch = [];
  scene.casting.effects.paint((...p) => launch.push(p), scene.casting.projectiles);
  assert.ok(launch.some(p => p[2] === '|') && launch.some(p => p[2] === '<'));
  assert.ok(scene.casting.projectiles.every(p => p.ctx.spell.presentation === presentation));
  scene.advance(2);
  assert.ok(scene.aura(scene.foe, 'Silenced'));
  assert.equal(scene.foe.health, 100);
  assert.ok(sounds.some(e => e.stage === 'impact'));
  assert.ok(sounds.some(e => e.stage === 'pulse'));
  assert.ok(sounds.every(e => e.type === 'spell' && e.presentation === presentation));
  assert.ok(sounds.every(e => !['draw', 'slam'].includes(e.type)));
  const field = [];
  scene.casting.effects.paint((...p) => field.push(p), scene.casting.projectiles);
  assert.ok(field.some(p => p[2] === '|') && field.some(p => p[2] === '>'));
});
