import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import profile from '../../src/spells/presentations/temp-glacial-fan.js';
import spell from '../../src/spells/definitions/temp-glacial-fan.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { prepareRecordedSpellTest } from '../../test-support/spell-audio.js';
import { runeScene } from '../../test-support/spells.js';

function points(stage, progress = 0.4, heading = 0, { life = profile.duration, radius = 1 } = {}) {
  const output = [];
  profile.draw({ stage, progress, age: progress * life, life, radius, heading },
    (...p) => output.push(p));
  return output;
}
const lit = frame => frame.filter(p => p[4] > 0.05);
const reach = frame => Math.max(0, ...frame.map(p => Math.hypot(p[0], p[1])));
const at = seconds => seconds / profile.duration;
const white = p => String(p[3]) === '255,255,255';
const SLASHES = new Set(['/', '\\', '|', '-']);

test('Glacial Fan gathers frost, sweeps five blades open left to right and hurls them in volley order', () => {
  assert.equal(spell.presentation, profile);
  const motes = seconds => lit(points('cast', at(seconds))).filter(p => p[2] === '.' || p[2] === '+');
  const spread = frame => frame.reduce((sum, p) => sum + Math.hypot(p[0], p[1] - 0.3), 0) / frame.length;
  assert.ok(motes(0.03).length > 8 && reach(lit(points('cast', at(0.03)))) < 1.7, 'anticipation precedes the blades');
  assert.ok(spread(motes(0.03)) > spread(motes(0.1)) * 2, 'frost motes spiral into a seed in front of the caster');
  const late = lit(points('cast', at(0.22)));
  assert.ok(reach(late) > 2, 'blades unfold well beyond the gathering point');

  const sweep = lit(points('cast', at(0.14)));
  const side = (frame, sign) => reach(frame.filter(p => p[0] * sign > 0.3));
  assert.ok(side(sweep, -1) > side(sweep, 1) + 0.4, 'the left blade unfolds first, matching the -45 degree first shot');

  const open = lit(points('cast', at(0.3)));
  const angles = open.filter(p => Math.hypot(p[0], p[1]) > 1).map(p => Math.atan2(p[0], p[1]));
  assert.ok(Math.min(...angles) < -0.7 && Math.max(...angles) > 0.7, 'the fan spans the full 90 degree volley');
  assert.ok(open.every(p => p[1] > -0.2), 'the fan opens forward');
  assert.ok(open.filter(p => SLASHES.has(p[2])).length > 60, 'blades are outlined with faceted edges, not loose dots');
  assert.ok(open.some(p => p[2] === ':' && p[4] < 0.5), 'blade bodies carry a dim frosted fill');

  const release = points('cast', at(0.23));
  assert.ok(release.some(p => p[2] === '@' && white(p) && p[4] > 0.8 && p[0] < 0), 'the first release flashes white at its root');
  const flying = lit(points('cast', at(0.45)));
  assert.ok(side(flying, -1) > side(flying, 1) + 0.3, 'released left blades streak outward before the right ones');
  const lastHeld = lit(points('cast', at(0.6))).filter(p => p[0] > 0.6 && SLASHES.has(p[2]) && p[4] > 0.5);
  assert.ok(lastHeld.length > 8, 'the rightmost blade is still held until the end of the volley');

  const fading = lit(points('cast', 0.9));
  assert.ok(fading.length < lit(points('cast', 0.3)).length / 4, 'the cast dissolves into a sparse rime');
  assert.ok(fading.every(p => [".", "'", '+'].includes(p[2])), 'only drifting frost motes remain at the end');
});

test('Glacial Fan shots are slender shards with a shimmering wake', () => {
  const shot = points('projectile', 0.4, 0, { life: 0.32, radius: 0.65 });
  const body = shot.filter(p => p[1] > -0.4), wake = shot.filter(p => p[1] <= -0.4);
  const width = Math.max(...body.map(p => Math.abs(p[0]))), depth = Math.max(...body.map(p => p[1])) - Math.min(...body.map(p => p[1]));
  assert.ok(depth > width * 5, 'the shard is long and narrow along its flight');
  const tip = body.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.equal(tip[2], '*', 'a bright glint leads the shard');
  assert.ok(tip[4] >= Math.max(...body.map(p => p[4])) - 1e-9);
  assert.ok(wake.length >= 12 && wake.some(p => p[2] === ':') && Math.min(...wake.map(p => p[1])) < -1);
  assert.ok(shot.length <= 110, 'shots stay lean');
  const later = points('projectile', 0.6, 0, { life: 0.32, radius: 0.65 });
  assert.notDeepEqual(wake, later.filter(p => p[1] <= -0.4), 'the frost wake streams continuously');
});

test('Glacial Fan hits flash white, burst into a forward crystal star and shatter into chips', () => {
  const flash = points('impact', 0.12, 0, { life: 0.6 });
  assert.ok(flash.some(p => p[2] === '@' && white(p) && p[4] > 0.6 && Math.hypot(p[0], p[1]) < 1e-9));
  assert.equal(flash.filter(p => p[2] === '*').length, 8, 'eight crystal spikes');
  const ahead = Math.max(...flash.map(p => p[1])), behind = -Math.min(...flash.map(p => p[1]));
  assert.ok(ahead > behind + 0.2, 'the starburst is thrown along the shot direction');
  const shattered = lit(points('impact', 0.6, 0, { life: 0.6 }));
  assert.ok(!shattered.some(p => p[2] === '@' || p[2] === '*'), 'spikes and flash are gone');
  const chips = shattered.filter(p => SLASHES.has(p[2]));
  assert.ok(chips.length >= 20, 'chips tumble away');
  assert.ok(reach(chips) > reach(lit(flash)) * 1.2, 'chips fly beyond the spikes');
  assert.ok(Math.max(...chips.map(p => p[4])) < Math.max(...flash.map(p => p[4])), 'chips cool as they fly');
});

test('Glacial Spikes pulse erupts crystals in the gaps between fan blades', () => {
  const frame = points('pulse', 0.35, 0, { life: 0.6, radius: 2 });
  const tips = frame.filter(p => p[2] === '*');
  assert.equal(tips.length, 8);
  for (const p of tips) {
    const slot = Math.atan2(p[0], p[1]) / (Math.PI / 16);
    assert.ok(Math.abs(slot - Math.round(slot)) < 0.05 && Math.abs(Math.round(slot)) % 2 === 1, 'tips sit between blade angles');
  }
  assert.ok(frame.length <= 90);
  const retract = lit(points('pulse', 0.85, 0, { life: 0.6, radius: 2 }));
  assert.ok(retract.length < lit(frame).length / 2, 'spikes melt back down');
});

test('all Glacial Fan stages stay deterministic, bounded, atlas compatible, and fade away', () => {
  const budget = { cast: 256, impact: 200, projectile: 110, pulse: 90, aura: 160, zone: 160 };
  for (const stage of Object.keys(budget)) {
    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const frame = points(stage, progress);
      if (progress > 0 && progress < 0.8) assert.ok(lit(frame).length > 10, `${stage} is visible mid-life`);
      assert.ok(frame.length <= budget[stage], `${stage} respects the draw budget (${frame.length})`);
      assert.ok(frame.every(p => p.length === 5 && Number.isFinite(p[0]) && Number.isFinite(p[1])
        && Math.abs(p[0]) < 5 && Math.abs(p[1]) < 5 && /^[\x20-\x7e]$/.test(p[2])
        && p[3].length === 3 && p[3].every(c => Number.isFinite(c) && c >= 0 && c <= 255)
        && Number.isFinite(p[4]) && p[4] >= 0 && p[4] <= 1));
      if (progress === 1) assert.ok(frame.every(p => p[4] === 0), `${stage} fades completely`);
      assert.deepEqual(frame, points(stage, progress), 'no random geometry or persistent state');
      // The runtime owns rotation: geometry, colour and light ignore heading;
      // only the edge glyph is re-picked so slashes follow the on-screen slope.
      const turned = points(stage, progress, 1.7);
      assert.deepEqual(turned.map(p => [p[0], p[1], p[3], p[4]]), frame.map(p => [p[0], p[1], p[3], p[4]]));
      assert.ok(turned.every((p, i) => p[2] === frame[i][2] || (SLASHES.has(p[2]) && SLASHES.has(frame[i][2]))));
    }
  }
  for (const stage of ['projectile', 'impact', 'pulse']) {
    const life = stage === 'projectile' ? 0.32 : stage === 'impact' ? 0.6 : 0.3;
    assert.ok(points(stage, 1, 0, { life, radius: 0.6 }).every(p => p[4] === 0), `${stage} fades at gameplay life`);
  }
});

test('every stage stays inside the 48 m coordinate contract at the largest radius', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura']) {
    for (const radius of [0.1, 1, 3, 10, 22, 30, 40]) {
      for (const life of [0.3, 0.6, profile.duration, 3]) {
        for (let i = 0; i <= 100; i++) {
          const frame = points(stage, i / 100, 0.7, { life, radius });
          assert.ok(frame.every(p => Math.abs(p[0]) <= 48 && Math.abs(p[1]) <= 48 && Math.hypot(p[0], p[1]) <= 48),
            `${stage} at radius ${radius}, progress ${i / 100} stays within 48 m`);
        }
      }
    }
  }
  assert.ok(reach(points('impact', 0.5, 0, { life: 0.6, radius: 40 })) > 20, 'large impacts still read as large');
});

test('draw is reentrant: a nested draw at another heading does not disturb the outer frame', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura']) {
    const effect = { stage, progress: 0.3, age: 0.3 * profile.duration, life: profile.duration, radius: 1, heading: 0 };
    const expected = [], actual = [];
    profile.draw(effect, (...p) => expected.push(p));
    profile.draw(effect, (...p) => {
      if (actual.length === 0) profile.draw({ ...effect, stage: 'projectile', heading: Math.PI / 2 }, () => {});
      actual.push(p);
    });
    assert.deepEqual(actual, expected, `${stage} is unaffected by a nested draw`);
  }
});

test('slashes follow the on-screen slope of a blade whatever the heading', () => {
  const edges = heading => points('projectile', 0.5, heading, { life: 0.32, radius: 0.65 })
    .filter(p => p[1] > -0.3 && SLASHES.has(p[2])).map(p => p[2]);
  assert.ok(edges(0).filter(c => c === '|').length > edges(0).length / 2, 'a shot flying down the screen is vertical');
  assert.ok(edges(Math.PI / 2).every(c => c === '-'), 'a shot flying across the screen is horizontal');
});

test('Glacial Fan sweeps recorded breath, staggered physical scuffs and ice grains into a natural fracture', async () => {
  const cast = profile.sounds.cast;
  assert.ok(cast[0].url.endsWith('/cold-breath.wav'), 'recorded breath carries the whole opening fan');
  assert.deepEqual(cast.slice(1).map(v => v.url.split('/').at(-1)), ['snow-scuff.wav', 'ice-grit.wav', 'ice-crack.wav']);
  assert.ok(cast.every((v, i) => !i || v.delay > cast[i - 1].delay), 'physical ice cuts sweep in volley order');
  assert.ok(cast.at(-1).delay >= 0.4 && cast.at(-1).delay <= 0.65, 'the fracture accompanies the later blades');
  assert.ok(profile.sounds.impact[0].url.endsWith('/ice-crack.wav'));
  assert.equal(profile.sounds.impact[0].delay, 0, 'contact gets an immediate natural fracture');
  assert.ok(profile.sounds.impact[1].delay > 0, 'loose grains settle after contact');
  assert.equal(profile.sounds.pulse.length, 1);
  assert.ok(profile.sounds.pulse[0].url.endsWith('/ice-tick.wav'));
  assert.ok(profile.sounds.pulse[0].gain >= 0.1 && profile.sounds.pulse[0].gain <= 0.18);

  const provenance = JSON.parse(await readFile(new URL('../../assets/audio/spells/seithr/sources.json', import.meta.url)));
  for (const recipe of Object.values(profile.sounds)) {
    assert.ok(recipe.length >= 1 && recipe.length <= 4);
    assert.ok(recipe.reduce((sum, v) => sum + v.gain, 0) <= 1.2);
    for (const layer of recipe) {
      assert.equal(layer.kind, 'recording', 'no synthesized oscillators or noise beds');
      assert.deepEqual(Object.keys(layer).sort(), ['delay', 'gain', 'kind', 'rate', 'url']);
      assert.ok(layer.gain >= 0.1 && layer.gain <= 0.8);
      assert.ok(layer.rate >= 0.75 && layer.rate <= 1.2 && layer.delay >= 0 && layer.delay <= 2);
      const clip = provenance.clips.find(c => layer.url === '/assets/audio/spells/seithr/' + c.file);
      assert.ok(clip, 'each layer has local recording provenance');
      const source = provenance.sources.find(source => source.id === clip.sourceId);
      assert.ok(source && source.provenance && source.page && source.licenseUrl);
      assert.ok(['CC0-1.0', 'CC-BY-4.0'].includes(source.license));
      const bytes = await readFile(new URL('../..' + layer.url, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), clip.sha256, 'playback asset matches its sourced recording');
    }
  }
  for (const [stage, recipe] of Object.entries(profile.sounds)) {
    const fake = fakeRecordedAudio();
    assert.equal(await prepareRecordedSpellTest(fake, profile), true);
    const handles = playSpellSound(fake.engine, { presentation: profile, stage, x: -8, y: 5 });
    assert.equal(handles.length, recipe.length);
    const cuts = fake.nodes.filter(n => n.kind === 'source');
    assert.equal(cuts.length, recipe.length);
    assert.equal(fake.nodes.filter(n => n.kind === 'oscillator').length, 0);
    assert.deepEqual(fake.allocations, [], 'no generated noise buffers');
    cuts.forEach((node, i) => {
      assert.equal(node.buffer.id, recipe[i].url.split('/').at(-1));
      assert.equal(node.starts[0], fake.context.currentTime + recipe[i].delay);
      assert.equal(node.playbackRate.calls[0].args[0], recipe[i].rate);
      assert.equal(node.loop, false);
    });
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === -8 && r.y === 5));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(h => h.stop());
    assert.ok(handles.every(h => h.ended));
    assert.ok(fake.routes.every(r => r.disposals === 1));
  }
});

test('a real Glacial Fan cast renders this profile and emits typed cast/impact cues without sword sounds', () => {
  const scene = runeScene(spell, { range: 6 }), events = [];
  scene.casting.onSound = event => events.push(event);
  const mana = scene.casting.state(scene.player).mana;
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.casting.state(scene.player).mana, mana - 8);
  assert.equal(scene.castWithoutMana().ok, false, 'an empty mana pool rejects repeat casts');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  scene.advance(0.05); // The cast fan starts transparent and opens into view.
  const castEffect = scene.casting.effects.list.find(e => e.stage === 'cast');
  assert.equal(castEffect.presentation, profile);
  const actual = [], expected = [];
  scene.casting.effects.paint((...p) => actual.push(p));
  paintPresentation(profile, castEffect, (...p) => {
    if (p[4] > 0) expected.push(p);
  });
  assert.ok(expected.length > 0, 'the cast fan has visible authored geometry');
  assert.deepEqual(actual.slice(-expected.length), expected, 'the runtime paints authored fan geometry after the source summon cue');
  scene.advance(0.05);
  assert.ok(scene.casting.projectiles.length > 0);
  const inFlight = [];
  scene.casting.effects.paint((...p) => inFlight.push(p), scene.casting.projectiles);
  assert.ok(inFlight.some(p => p[2] === ':'), 'real shots render the authored frost trail');
  scene.advance(1.25);
  assert.ok(scene.monsters.events.some(e => e.type === 'hurt' && e.amount === 16), 'rune damage is preserved');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === profile && e.spellId === spell.id));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
});
