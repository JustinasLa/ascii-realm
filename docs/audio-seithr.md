# Seithr sound design

Each of the twelve spells was authored by a separate spell subagent. The common
palette uses recorded ice fields, lake fractures, hydrophone ice creaks, snow
crushes, physical breath and outdoor wind. Every layer plays recorded foley;
there are no oscillator or generated-noise layers. The existing positional SFX
bus plays short, subtly varied arrangements of those physical details.

Ten mono 48 kHz PCM16 clips come from six real recordings. The downloaded sources
are Freesound high-quality MP3 previews, not lossless originals. Processing is
limited to cropping, mono downmixing, DC/infrasonic removal, short fades and peak
normalization. Sources, artist credits, licenses, hashes and crop positions are
in [the source manifest](../assets/audio/spells/seithr/sources.json) and
[license credits](../assets/audio/spells/seithr/LICENSE.md). Five sources use CC0;
the snow recording by luminadii uses CC BY 4.0 and is credited there.

Rebuild with `python tools/render-spell-audio-seithr.py` (numpy, scipy and ffmpeg).

| Spell | Audible identity |
| --- | --- |
| Silencing Shard | An inward breath collapses into a muted crystal fracture; contact swallows the remaining air. |
| Ice Shard | A deliberate single shard release, dry fracture and hollow settling ice. |
| Frost Bolt | Compressed icy breath launches quickly; contact scatters uneven crystal chips over a low body. |
| Ice Shield | Protective slabs lock at staggered intervals over deep glacial pressure; contact rings through the plate. |
| Ice Wave | A broad grinding front swells and rolls through irregular fractures. |
| Icicle Blitz | Rapid uneven icicle snaps over frozen breath, followed by a compact brittle contact. |
| Seithr Glyph | Uneven ice engraving over a buried chamber resonance, ending in a heavy freezing seal. |
| Cold Embrace | Constricting physical breath, close ice creaks and muffled snow compression. |
| Glacial Fan | Staggered ice knives open across a sweeping scrape and frozen air. |
| Frostveil | A slowly unfurling curtain of outdoor wind and close breath. |
| Frozen Tomb | Growing ice pressure and a deep coffin groan resolve into a heavy closing lid and crushing fracture. |
| Hailpiercer | Tension releases a dense piercing ice lance, followed by a compact strike and diminishing debris. |

Every spell provides separate `cast`, `impact` and `pulse` recipes. Runtime aura
events use `impact`; field/visual events use `pulse`. Quiet short pulses allow
repeated source effects to remain beneath the principal cast and contact cues.
Each stage has one to four recording layers, with gain sums at or below 1.2.
Playback rates stay between 0.75 and 1.2, preserving recognizable physical detail;
short fades prevent clicks. Individual source clips last 0.32 to 2.5 seconds and
peak below 0.8. The engine preloads and caches the decoded files and cancels
pending or playing voices when their owner stops.

`test/audio-spells-seithr.test.js` casts every spell at close and distant targets,
collects every emitted sound stage, renders each through the audio engine mock,
checks SFX positions and route disposal, and validates supported fields,
recording-only recipes, file integrity, PCM resolution, clean endpoints, source
licenses, mixing limits and independent arrangements. Existing spell presentation
tests continue to cover geometry, gameplay and typed sound routing.

Audition with the project's running server at
[Seithr sound preview](./audio-seithr.html).
