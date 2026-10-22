# Mitlan recorded spell sound design

Mitlan spells now use real water and storm recordings exclusively. Weight comes
from physical water displacement, splashing, close bubbling and recorded thunder.
There are no oscillator notes, pitch sweeps or synthesized noise layers. Subtle
playback-rate changes preserve the identity of the recorded material.

| Spell | Recorded material and phrasing |
| --- | --- |
| Tide Shard | Quick creek-water lift, compact wet strike and falling droplets. |
| Bubble Shard | Irregular close bubbles, droplets and displaced water; a wet strike ruptures the bubble. |
| Scalding Wave | Close-miked boiling leads into a rush, with bubbling after the impact. |
| Tidal Shield | Lifted water spreads into broad wash, then shoves as a physical splash. |
| Mitlan Glyph | Measured displacement and bubbling inscription give way to a geyser-like splash. |
| Crashing Wave | A full recorded splash breaks and retreats into returning wash. |
| Maelstrom | Staggered wash and bubbles emphasize repeated movement and churning water. |
| Drowning Prison | Water encloses the target with close bubbling and quiet trapped-air ticks. |
| Lightning | Rain precedes a real thunderclap and its naturally rolling tail. |

All three emitted audio stages (cast, impact, pulse) are authored for each spell.
Aura application uses impact; zones and visual ticks use pulse. Ongoing ticks
are quieter than casts and hits. The spatial SFX bus, preloaded recording cache
and owner cancellation handle sound lifecycle. Visual geometry, rune definitions,
damage and control effects are unchanged.

## Sources and processing

Nine mono 44,100 Hz PCM16 clips retain broadband detail: seven water textures,
rain and thunder. All five source recordings are CC0:

- [Walking through water](https://freesound.org/people/rosenberg3/sounds/627004/) by rosenberg3.
- [Water splash, emptying a bucket 2](https://freesound.org/people/wormer2/sounds/415670/) and [take 3](https://freesound.org/people/wormer2/sounds/415669/) by wormer2.
- [Boiling water.wav](https://freesound.org/people/xenognosis/sounds/137229/) by xenognosis, recorded close to a pot with an H4 Zoom.
- [Rain + Long Thunder](https://opengameart.org/content/rain-long-thunder) by WuxiaScrub.

Freesound inputs are public HQ MP3 previews; thunder uses the original OGG.
Processing only crops, converts to mono, removes DC, fades edit boundaries and
balances peaks below 0.85. It adds no generated sound, filtering, reversal,
compression or looping. Water clips last 0.56-2.68 seconds; thunder lasts 4.8
seconds. Playback rates stay between 0.75 and 1.2; combined stage gain is at
most 1.2.

Exact source licenses, hashes, crop timings and fades are recorded in
assets/audio/spells/mitlan/sources.json and LICENSE.txt. Reproduce with
Python/numpy and ffmpeg:

```sh
python tools/render-spell-audio-mitlan.py --sources PATH_TO_SOURCE_CACHE
```

Missing sources download from their documented URLs. Tests check PCM sample
rate, DC, unclipped peaks, audible signal and click-free endpoints. Family tests
also exercise every stage through real rune casts, recording-only recipes,
provenance, spatial routing, silent rejected casts and delayed-tail cancellation.

Listen in [the Mitlan sound archive](audio-mitlan.html), or cast spells in
[the casting simulator](casting-simulation.html).
