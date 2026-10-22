# Oseni spell audio

Nine individually authored fire spell voices share charcoal, low furnace pressure and solemn ritual resonance. Each spell has a separate `cast`, `impact` and `pulse` recipe in its presentation module. The existing audio renderer plays these procedural layers through the spatial SFX bus; no downloaded recordings or additional assets are required.

| Spell | Cast identity | Contact / recurring identity |
| --- | --- | --- |
| Fire Shard | Snapping charcoal jaws, low ignition punch, a muted hot needle | Brittle splinters and cooling hiss; short ember scrape in flight |
| Meteor | Furnace intake followed by a falling basalt growl at release | Two low detonation bodies, uneven settling coal; quiet ground-fire sighs |
| Fire Breath | Close intake, rough dragon throat and rolling pressure roar | Coal-bed thud with staggered cracks; short mouth-flare cough |
| Fire Phoenix | Ancestral bass calls between deep furnace wingbeats | Rebirth bloom and scorched-feather flecks; subdued chest and ember pulses |
| Oseni Glyph | Furnace drone, coarse iron inscription and a final coal ignition | Branding blow with inharmonic iron decay; a soft ward heartbeat |
| Flight of the Gladiator (`temp-last-stand`) | Cracked war horn and two laboured double heartbeats | Heavy bass stamp, answering beat and settling ash; paired pressure knocks |
| Fire Rain | Gathering cinder cloud, falling pellets and irregular coal landings | Cascading ash and burn texture; brief, quiet rain ticks |
| Blazing Barrage | Cadenced low combustion thumps alternating with scorched grit | Compact impact weight and ember texture; restrained volley pulses |
| Rekindle | Fragile coals breathing back into a low, solemn heartbeat | Smouldering renewal and soft recurring warmth |

Every layer specifies attack, decay, sustain and release. The recipes use three to six layers per stage, at most 0.25 gain per layer and 0.45 summed gain per cue. Repeated pulse textures are substantially quieter than primary casts. Low oscillators, restrained upper frequencies and filtered noise keep the family ominous without piercing whistles or bright arcade chimes.

`Spellcasting.present` maps cast visuals to `cast`, impacts and auras to `impact`, and other effect visuals to `pulse`. Existing cue throttling, routing, node cleanup, visual geometry and gameplay remain unchanged. The previously missing Blazing Barrage pulse now has an authored recipe.

## Validation and audition

Run `node --test test/audio-spells-oseni.test.js` for family-level coverage. It checks every exported Oseni spell, stage mapping, successful and rejected gameplay casts, spatial SFX rendering, node cleanup, suspended-audio behavior, distinct identities, authored envelopes and renderer bounds. Existing spell presentation suites continue to verify geometry, timing and gameplay. Legacy Glyph, Fire Rain and Barrage audio assertions are updated to the new dark palette while preserving their behavioral checks.

Open [the Oseni audition page](./audio-oseni.html) to hear individual spell stages in the browser. Audio requires a user interaction to unlock the browser audio context.
