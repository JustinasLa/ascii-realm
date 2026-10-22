# Mitlan: distinct voices, less wet

Each spell has dedicated recordings and phrasing. The earlier shared cloth swell and wood hit made the family too similar; changing gain and pitch was insufficient. No recordings are now shared between Mitlan spells, and the seven revised casts use different foreground source materials. Boiling, splashing, gurgling and droplets are absent.

| Spell | Identity | Material and phrasing |
| --- | --- | --- |
| Tide Shard | Narrow cut, sharp tick | Bamboo movement and a high, dry wood transient; 0.16-0.24-second clips |
| Bubble Shard | Taut membrane, hollow double-pop | Filtered timber strain, with an uneven two-part release |
| Scalding Wave | Continuous airy pressure | Recorded breath builds into a soft release, with no percussion |
| Tidal Shield | Bowing shell, firm knock | Low-mid timber cavity resonance; one contact rather than a double-pop |
| Mitlan Glyph | Three strokes, three marks | Fine leaf texture and branch transients, rising through three short gestures |
| Crashing Wave | Broad shove, granular impact | Jacket movement and a ground impact, followed by a short recoil |
| Maelstrom | Turning wind, inward collapse | Forest wind with three amplitude lobes, then a reversed fold |
| Drowning Prison | Enclosing pressure | Muted cloth folds and compact wood contact |
| Lightning | Air charge, short thunder | Bamboo air movement and a recorded thunderclap |

Nineteen mono PCM16 clips remain at 44.1 kHz. Most last 0.14-0.96 seconds; thunder ends after 1.4 seconds. Offline bandpass filtering, selective reversal, shaped fades and amplitude modulation give the materials different contours. Peaks are capped at 0.46-0.58, RMS at 0.11, recurring pulse gains at 0.07 and combined stage gains at 0.65. No synthetic noise or tonal layers are added.

Spell visuals, timing, damage and control effects remain unchanged. The preview's **Compare casts** button plays the nine casts in sequence; Stop or selecting another cue cancels the sequence, including during loading.

## Provenance and rebuild

Twelve CC0 source recordings supply the materials. [LICENSE.txt](../assets/audio/spells/mitlan/LICENSE.txt) and [sources.json](../assets/audio/spells/mitlan/sources.json) retain source links, downloads, hashes, crop times, filter settings, reversal, modulation and output hashes. Freesound inputs are MP3 previews; thunder uses its original OGG.

Rebuild with `python tools/render-spell-audio-mitlan.py --sources PATH_TO_SOURCE_CACHE` using Python, NumPy, SciPy and ffmpeg. Missing sources download from their documented URLs.

Run `node --test test/audio-spells-mitlan.test.js` for sample integrity, provenance, source separation, restrained levels, runtime routing and cancellation. Spell presentation tests cover audio phrasing and gameplay.

[Compare the sounds](audio-mitlan.html) or [try the game](../).
