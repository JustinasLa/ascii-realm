import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSpellSounds, playSpellSound } from '../src/audio/spells.js';
import { GameAudio } from '../src/audio/audio.js';
import { fakeRecordedAudio } from '../test-support/recorded-audio.js';

const url = '/assets/audio/spells/oseni/fire-test.wav';
const profile = { sounds: { cast: [{ kind: 'recording', url, gain: 0.45, rate: 0.9, delay: 0.1 }] } };
const event = { type: 'spell', presentation: profile, stage: 'cast', x: 3, y: 7 };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('recordings register while locked and deduplicate simultaneous decoding per context', async () => {
  const fake = fakeRecordedAudio(); let loads = 0;
  const loadBuffer = async () => { loads++; return { duration: 0.8 }; };
  fake.context.state = 'suspended';
  assert.equal(await prepareSpellSounds(fake.engine, [profile, profile], { loadBuffer }), false);
  assert.equal(loads, 0);
  fake.context.state = 'running';
  assert.deepEqual(await Promise.all([prepareSpellSounds(fake.engine), prepareSpellSounds(fake.engine)]), [true, true]);
  assert.equal(loads, 1);
  assert.equal(await prepareSpellSounds(fake.engine, profile), true);
  assert.equal(loads, 1);
});

test('prepared foley preserves a nonlooping recording, spatial SFX route and smooth boundaries', async () => {
  const fake = fakeRecordedAudio();
  await prepareSpellSounds(fake.engine, profile, { loadBuffer: async () => ({ duration: 0.8 }) });
  const [voice] = playSpellSound(fake.engine, event);
  const source = fake.nodes.find(n => n.kind === 'source');
  assert.equal(source.loop, false);
  assert.equal(source.buffer.duration, 0.8);
  assert.equal(source.starts[0], 10.1);
  assert.equal(source.playbackRate.calls[0].args[0], 0.9);
  assert.equal(fake.nodes.filter(n => n.kind === 'oscillator').length, 0);
  assert.deepEqual(fake.routes.map(({ bus, x, y }) => ({bus, x, y})), [{bus:'sfx', x:3, y:7}]);
  assert.deepEqual(fake.invalid, []);
  source.onended();
  assert.equal(voice.ended, true);
  voice.stop();
  assert.equal(fake.routes[0].disposals, 1);
});

test('owner cancellation before decoding prevents later playback', async () => {
  const fake = fakeRecordedAudio(), audio = new GameAudio({}, fake.engine), owner = {};
  let resolveBuffer;
  const prepared = prepareSpellSounds(fake.engine, profile, { loadBuffer: () => new Promise(resolve => { resolveBuffer = resolve; }) });
  await flush();
  const [voice] = audio.play({ ...event, owner });
  assert.equal(voice.ended, false);
  audio.play({type:'spell-stop', owner});
  resolveBuffer({duration:1}); await prepared; await flush();
  assert.equal(voice.ended, true);
  assert.equal(fake.nodes.length, 0);
  assert.equal(audio.effects.size, 0);
});

test('late decode and replaced contexts cannot play stale casts', async () => {
  for (const replaceContext of [false, true]) {
    const fake = fakeRecordedAudio(); let resolveBuffer;
    const prepared = prepareSpellSounds(fake.engine, profile, {loadBuffer: () => new Promise(resolve => {resolveBuffer=resolve;})});
    await flush(); const [voice] = playSpellSound(fake.engine, event);
    if (replaceContext) fake.engine.context = fakeRecordedAudio().context;
    else fake.context.currentTime += 1;
    resolveBuffer({duration:1}); await prepared; await flush();
    assert.equal(voice.ended, true); assert.equal(fake.nodes.length, 0);
  }
});

test('failed samples back off, retry, and do not replay the failed cast', async () => {
  const fake = fakeRecordedAudio(); let loads = 0;
  const loadBuffer = async () => { if (++loads === 1) throw new Error('offline'); return {duration:1}; };
  assert.equal(await prepareSpellSounds(fake.engine, profile, {loadBuffer}), false);
  const [voice] = playSpellSound(fake.engine, event);
  await flush(); assert.equal(voice.ended, true);
  await prepareSpellSounds(fake.engine); assert.equal(loads, 1);
  fake.context.currentTime += 5;
  assert.equal(await prepareSpellSounds(fake.engine), true);
  assert.equal(fake.nodes.length, 0);
  const [retry] = playSpellSound(fake.engine, event);
  assert.equal(retry.ended, false); retry.stop();
});

test('muted effects and external URLs never create recording voices', async () => {
  const fake = fakeRecordedAudio(); let loads = 0;
  await prepareSpellSounds(fake.engine, profile, {loadBuffer:async()=>{loads++; return {duration:1};}});
  fake.engine.muted = true;
  assert.deepEqual(playSpellSound(fake.engine, event), []);
  fake.engine.muted = false; fake.engine.volumes.sfx = 0;
  assert.deepEqual(playSpellSound(fake.engine, event), []);
  fake.engine.volumes.sfx = 0.8;
  const invalid = {sounds:{cast:[{kind:'recording',url:'https://example.com/track.wav'}]}};
  assert.deepEqual(playSpellSound(fake.engine, {...event,presentation:invalid}), []);
  assert.equal(loads, 1); assert.equal(fake.nodes.length, 0);
});

test('recording voices are bounded and pending/delayed sources stop with game pause', async () => {
  const fake = fakeRecordedAudio(), audio = new GameAudio({}, fake.engine);
  await prepareSpellSounds(fake.engine, profile, {loadBuffer:async()=>({duration:1})});
  const handles = Array.from({length:100},()=>audio.play({...event,owner:audio})[0]);
  assert.equal(handles.filter(h=>!h.ended).length,64);
  audio.pause();
  assert.ok(handles.every(h=>h.ended));
  assert.ok(fake.routes.every(r=>r.disposals===1));
});
