# Cerrith recorded spell sound design

Cerrith now uses recorded physical materials throughout: creaking timber, twisting branches, falling leaves, heavy wood, cloth moving through air, water, and a dirt landing. Every stage plays real foley. There are no oscillator notes, synthesized noise layers, arpeggios, or bit-crushed effects in the Cerrith recipes.

Audition the current recipes in [the Cerrith sound preview](audio-cerrith.html). Individual stages expose their material identity; the game simulation demonstrates the actual cast and repeated-effect cadence.

| Spell | Recorded sound identity |
| --- | --- |
| Healing Orb | Airy foliage gathers around cloth breath and gentle liquid; arrival unfolds leaves around a small water touch. |
| Shielding Orb | Timber creaks as bark armor opens; hollow wood and snapping branches close the ward. |
| Leaf Arrow (`temp-quickshot`) | Immediate branch snap, jacket-air sweep, and leaf wake; wood and dirt absorb the collision. |
| Hand Cure | Close cloth movement and a small liquid touch suggest a restrained, tactile healing ritual. |
| Blessing of Swiftness | Quickly spaced cloth-air sweeps and leaves carry the forward movement. |
| Earth Spike | Roots strain before branches split and dirt and heavy wood erupt. |
| Cerrith Glyph | Measured wooden contacts plant a grounded seal beneath roots and foliage. |
| Restoration | Slow water and falling leaves spread through a rooted sanctuary. |
| Vine Wave | Twisted branches, sweeping cloth air, and dragging leaves form a flexible binding wave. |
| Blessing of Healing | Gentle liquid and cloth breathing mark the channel, with restrained leaf responses. |
| Mana Transfer | Flowing water passes between two close cloth movements, suggesting energy traveling through a natural conduit. |
| Woodland Anvil (`temp-shock-wave`) | Heavy recorded wood and dirt create a delayed physical hammer strike and settling aftershock. |

## Provenance and reproducibility

Seven CC0 sources were verified on their original Freesound pages. [LICENSE.txt](../assets/audio/spells/cerrith/LICENSE.txt) credits every author and source. [sources.json](../assets/audio/spells/cerrith/sources.json) records original preview URLs, SHA-256 hashes, exact excerpt boundaries, output hashes, and target peaks. Public HQ MP3 previews were used; the recordings are not claimed to be lossless originals.

The twelve exported samples are mono 48 kHz, 16-bit PCM, 0.55?1.62 seconds long, with peaks no higher than 0.82. Processing is limited to mono resampling, 28 Hz subsonic filtering, DC removal, 4 ms entry and 55 ms exit fades, and linear peak balancing. Natural attacks, grain, and decay remain. No generated content, artificial reverb, compression, or reversed audio is added.

Rebuild with `python tools/render-spell-audio-cerrith.py` using Python, numpy, scipy, and ffmpeg. The script downloads the public source previews into the system temporary directory, verifies source hashes, and recreates the assets and attribution file. Source names accurately identify their origin: the root creak is actual floor timber; the air/breath texture is cloth, not a human voice; the earth impact is a body landing on dirt.

## Runtime and mix

Recipes use the shared recording player and positional SFX bus. Each stage has one to four recording layers, with total gain at most 1.2; repeated pulses stay at or below 0.3. Playback rates stay within 0.75?1.2 so the physical sources retain their identity. Cached sample loading and existing owner cancellation cover delayed and active sounds. Volume, mute, pause, reset, and death behavior remain shared with the game.

`Spellcasting.present()` maps casts to `cast`, impacts and auras to `impact`, and pulse/zone visuals to `pulse`. Leaf Arrow emits only cast and collision cues. Projectile drawing never starts a new sound every animation frame.

## Validation

`test/audio-spells-cerrith.test.js` checks the licensed sample manifest, WAV hashes, 48 kHz PCM, headroom, DC and edit boundaries, complete recipe coverage, absence of synthesis, conservative layer/gain/rate limits, spatial routing, owner cancellation, locked audio, and stage mapping. Existing spell presentation and rune suites retain visual and gameplay assertions; audio-specific expectations test the actual recorded assets and timing.

All family checks plus the twelve spell presentation and twelve rune suites pass together: 116 tests. Rebuilding the samples twice produces identical WAV checksums.
