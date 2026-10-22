# Oseni: dark fire without burning sounds

Oseni uses short air gestures, muted contacts and rounded resonance. There are no fireplace, coal, ignition or blowtorch layers. Its weight lives in the low midrange rather than sub-bass, with softened upper frequencies and quiet repeat cues.

| Spell | Sound |
| --- | --- |
| Fire Shard | Quick inward draw, air snap and muted contact |
| Meteor | Reversed gathering swell, half-second release and compact heavy impact |
| Fire Breath | Low intake followed by moving air, without a sustained hiss |
| Fire Phoenix | Two cloth wingbeats and a rounded rebirth impulse |
| Oseni Glyph | Inward draw, timed seal closure and soft resonance |
| Flight of the Gladiator | Charge, winged launch, diving air cut and muffled landing |
| Fire Rain | Overhead swell with separated, muted falling contacts |
| Blazing Barrage | Three short discharges on the existing firing beats |
| Rekindle | Soft inward cloth movement, with gentle restoration pulses |

## Bank and mix

Seven mono PCM16 WAVs at 48 kHz range from 0.436 to 0.90 seconds. Third-order bandpass filtering places their low cutoffs at 170–260 Hz and their high cutoffs at 850–2400 Hz. Reversed crops supply the gathering gestures; cosine envelopes soften entries and shorten tails. Peak ceilings are 0.42–0.55, with a 0.12 RMS ceiling before the game's SFX gain. Runtime playback rates remain close to the original, and recurring pulse gains stay at or below 0.08.

The recordings are shaped from bamboo movement, fabric, muted wood contact and cropped thunder resonance. No synthetic tones or noise are added. The old fire bank is removed, rather than left as unused assets. Cast timing, visuals and spell mechanics are unchanged.

## Provenance and rebuild

The four existing CC0 source recordings remain credited in [LICENSE.txt](../assets/audio/spells/oseni/LICENSE.txt). [sources.json](../assets/audio/spells/oseni/sources.json) records source/download URLs, source hashes, crop positions, filtering, reversals, envelopes and output hashes. Public MP3 previews are the inputs, not lossless masters.

Rebuild with `python tools/render-spell-audio-oseni.py` (Python, NumPy, SciPy and ffmpeg). `--source-dir` selects the original download cache.

Run `node --test test/audio-spells-oseni.test.js test/audio-spell-recordings.test.js` for provenance, PCM integrity, mix bounds, event mapping, positional routing, cleanup and suspended-audio checks. The presentation tests cover the unchanged spell timing and geometry.

[Listen to each spell and stage](./audio-oseni.html). Playback starts only after pressing a button; Stop cancels the active cue.