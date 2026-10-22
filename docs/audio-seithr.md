# Seithr sound design

Each of the twelve spells was authored by a separate spell subagent. The common
palette is haunted glacier: low hollow pressure, strained ice, inharmonic crystal
fractures and frozen breath. Tone and filtered-noise layers use the existing SFX
bus, spatial routing, scheduling and voice cleanup. No audio assets or extra
timers are required.

| Spell | Audible identity |
| --- | --- |
| Silencing Shard | An inward breath collapses into a muted crystal fracture; contact swallows the remaining air. |
| Ice Shard | A deliberate single shard release, dry fracture and hollow settling ice. |
| Frost Bolt | Compressed icy breath launches quickly; contact scatters uneven crystal chips over a low body. |
| Ice Shield | Protective slabs lock at staggered intervals over deep glacial pressure; contact rings through the plate. |
| Ice Wave | A broad grinding front swells and rolls through irregular fractures. |
| Icicle Blitz | Rapid uneven icicle snaps over frozen breath, followed by a compact brittle contact. |
| Seithr Glyph | Uneven ice engraving over a buried chamber resonance, ending in a heavy freezing seal. |
| Cold Embrace | Closely spaced low tones beat beneath constricting spectral breath and a muffled closing fracture. |
| Glacial Fan | Staggered ice knives open across a sweeping scrape and frozen air. |
| Frostveil | A slowly unfurling curtain of filtered whisper and dark spectral undertones. |
| Frozen Tomb | Growing ice pressure and a deep coffin groan resolve into a heavy closing lid and crushing fracture. |
| Hailpiercer | Tension releases a dense piercing ice lance, followed by a compact strike and diminishing debris. |

Every spell provides separate `cast`, `impact` and `pulse` recipes. Runtime aura
events use `impact`; field/visual events use `pulse`. Quiet short pulses allow
repeated source effects to remain beneath the principal cast and contact cues.
All layers explicitly shape attack, decay, sustain and release. Stage gain sums
stay at or below 0.45; individual layers stay within the existing eight-layer,
0.25 gain, two-second delay and 2.5-second duration limits.

`test/audio-spells-seithr.test.js` casts every spell at close and distant targets,
collects every emitted sound stage, renders each through the audio engine mock,
checks SFX positions and route disposal, and validates supported fields, envelope
timing, mixing limits and independent arrangements. Existing spell presentation
tests continue to cover geometry, gameplay and typed sound routing.

Audition with the project's running server at
[Seithr sound preview](./audio-seithr.html).
