# Oseni recorded spell audio

All nine Oseni spells now use real fire and movement recordings. There are no oscillator, generated-noise, musical chime or bit-crushed layers in their recipes. Identity comes from physical material, transient timing and modest playback-rate variation.

| Spell | Physical sound design |
| --- | --- |
| Fire Shard | A bamboo air cut and torch ignition; breaking wood and coal on contact; quiet trailing embers |
| Meteor | Burning approach aligned to projectile release; real thunder with wood fracture and falling coal |
| Fire Breath | Air intake, torch ignition, sustained blowtorch flame; quieter coal contact and lingering embers |
| Fire Phoenix | Two cloth wingbeats through real flame; ignition and scattered feather-like cloth on rebirth |
| Oseni Glyph | Ember bed and fuel cracks gather into a timed seal ignition |
| Flight of the Gladiator (`temp-last-stand`) | Physical cloth/air movement and fire thrust, followed by a heavy grounded stamp |
| Fire Rain | An overhead fire rush with irregular falling coal; restrained recurring crackle |
| Blazing Barrage | Cadenced physical fire discharges and breaking coal; quieter repeated trail puffs |
| Rekindle | Small fuel catches and an ember bed returning to life; gentle heat on each restoration |

The eight mono PCM16 WAVs are 48 kHz, 0.436?2.55 seconds long, with peaks at or below 0.80. Processing is limited to decoding, mono downmix, clean crops, DC removal, short fades and gain normalization. The public high-quality MP3 previews are the inputs; these are not claimed to be lossless masters. No generated sound is added. Runtime layers use only `kind`, `url`, `gain`, `rate` and `delay`, with one to four layers per stage and restrained rate changes.

## Source recordings

All six sources are CC0 1.0, verified on their original Freesound pages:

- [Fire crackling in fireplace by Davor](https://freesound.org/people/Davor/sounds/382616/): real fireplace recorded on Zoom H1.
- [Blowtorch by rombart](https://freesound.org/people/rombart/sounds/197800/): real blowtorch recorded on Zoom H4n.
- [Swosh / Whoosh / Air Cut by qubodup](https://freesound.org/people/qubodup/sounds/60030/): bamboo stick swung through air, recorded on Zoom H2.
- [Wood Crack 5 by utsuru](https://freesound.org/people/utsuru/sounds/183450/): cracking wood recorded on Zoom H4N.
- [Cloth Flapping On A Clothesline Thickly by leonelmail](https://freesound.org/people/leonelmail/sounds/330638/): actual flapping fabric.
- [Thunder Clap And Rumble #1 by Kinoton](https://freesound.org/people/Kinoton/sounds/397952/): a real lightning strike recorded with DR-60D MkII and Mk 012 microphones.

[LICENSE.txt](../assets/audio/spells/oseni/LICENSE.txt) credits every source. [sources.json](../assets/audio/spells/oseni/sources.json) records exact download URLs, source hashes, crop positions, fades and output hashes. Rebuild with `python tools/render-spell-audio-oseni.py` (Python, NumPy, SciPy and ffmpeg).

## Validation and audition

Run `node --test test/audio-spells-oseni.test.js`. It verifies real-asset provenance, PCM integrity, sample rate, duration, headroom, clean endpoints, recipe bounds, runtime event mapping, SFX spatial routing, every rendered buffer, cleanup and silence while audio is suspended. Existing presentation tests retain geometry and gameplay checks with recording-based audio assertions.

The existing renderer maps cast visuals to `cast`, impact/aura visuals to `impact`, and other visuals to `pulse`. Recorded samples preload/cache and use the same positional SFX bus. Visual geometry and spell gameplay are unchanged.

[Open the Oseni audition page](./audio-oseni.html). Click a play control to unlock browser audio and hear individual stages.
