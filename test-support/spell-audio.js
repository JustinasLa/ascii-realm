import { prepareSpellSounds } from '../src/audio/spells.js';
import { loadTestRecording } from './recorded-audio.js';

/** Prime real file metadata in the fake Web Audio harness without networking. */
export async function prepareRecordedSpellTest(fake, presentation) {
  return prepareSpellSounds(fake.engine, presentation, {
    loadBuffer: path => loadTestRecording(new URL('..' + path, import.meta.url)),
  });
}
