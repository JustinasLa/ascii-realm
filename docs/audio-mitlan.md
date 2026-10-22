# Mitlan: currents and pressure, less wet

Mitlan uses smooth inward movement, compact hollow impacts and soft pressure folds. Close bubbling, boiling, falling droplets, wading sounds and hard bucket-splash attacks are removed. A quiet filtered wash tail hints at water beneath a few larger spells, without dominating the cast.

| Spell | Sound |
| --- | --- |
| Tide Shard | Light current gathering, quick release and dry shell contact |
| Bubble Shard | Enclosed pressure swell and uneven air gestures |
| Scalding Wave | Air gathering and a forward current, without boiling |
| Tidal Shield | Broad inward wrap followed by a hollow shove |
| Mitlan Glyph | Drawing and folding current before a compact release |
| Crashing Wave | Dry crest impact with a short, faint returning wash |
| Maelstrom | Staggered inward folds; water sits behind the movement |
| Drowning Prison | Enclosing pressure and quiet repeated folds, without gurgling |
| Lightning | Air charge and compact thunder; no rain layer |

The seven mono PCM16 clips remain at 44.1 kHz. Most last 0.436–0.85 seconds; thunder ends after 1.4 seconds. Offline bandpass filtering, reversal on gathering cues and shaped fades suppress sharp wet transients and avoid long tails. Peaks are limited to 0.40–0.58, RMS to 0.11 (0.05 for the wash), and recurring pulse gains to 0.07. The wash is mixed at gain 0.08 or less.

Mitlan is lighter and smoother than Oseni: higher air detail, rounded pressure and less impact weight. Spell definitions, visual choreography, damage and control effects are unchanged.

## Provenance and rebuild

Five existing CC0 recordings supply bamboo movement, cloth, wood contact, a splash decay and thunder. [LICENSE.txt](../assets/audio/spells/mitlan/LICENSE.txt) and [sources.json](../assets/audio/spells/mitlan/sources.json) retain original source links, downloads, hashes, crop times, filter settings, reversal and output hashes. Freesound inputs are MP3 previews; thunder uses its original OGG. No generated noise or oscillator layers are added.

Rebuild with `python tools/render-spell-audio-mitlan.py --sources PATH_TO_SOURCE_CACHE` using Python, NumPy, SciPy and ffmpeg. Missing source recordings download from their documented URLs.

Run `node --test test/audio-spells-mitlan.test.js` for sample integrity, provenance, restrained levels, runtime routing and cancellation. The spell presentation tests verify timing and unchanged gameplay.

[Listen to the Mitlan sound preview](audio-mitlan.html) or [try the game](../).
