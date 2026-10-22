# Mitlan spell sound design

Mitlan uses the weight of deep water: pressure changes, submerged resonance,
churning surf and muffled ruptures. Lightning carries the same weight into a
storm. Each spell was authored by its own spell agent and has separate cast,
impact and pulse recipes in its existing presentation module.

| Spell | Character and timing |
| --- | --- |
| Tide Shard | A compact rising pressure draw releases a descending spear through narrow surf; a wet crack becomes a hollow implosion and drowned wake. |
| Bubble Shard | Detuned hollow pressure drops buckle at uneven intervals; a second smaller collapse and wet grit follow the first rupture. |
| Scalding Wave | A cauldron-deep swell and irregular boiling beads lead into muffled steam; burn ticks land as wet bass slaps. |
| Tidal Shield | Dragging surf gathers into a heavy liquid bulwark, then seals with a submerged knock; impacts shove outward as low pressure waves. |
| Mitlan Glyph | Staggered ritual strokes carve a drowned seal through silt; activation erupts as a heavy geyser over collapsing bass and undertow. |
| Crashing Wave | A broad, looming pressure swell breaks into a bass-water slam; delayed foam and the retreating wake distinguish it from boiling water. |
| Maelstrom | Staggered suction and hollow currents spiral into an abyssal whirlpool; its inward collapse contrasts with the outward breakers. |
| Drowning Prison | A submerged gong and oxygen bubbles become a constricting enclosure; rounded pressure closes and subdued hold ticks sustain the confinement. |
| Lightning | Oppressive electrical tension precedes a ragged thunderclap and delayed rolling bass thunder. |

The recipes use only the existing Web Audio tone and filtered-noise voices.
Every layer has explicit attack, decay, sustain and release settings; envelope
segments fit their durations without relying on renderer clamping. Whole-stage
gain totals stay below 0.45, individual layers stay below 0.25, and no stage
exceeds the renderer's eight-layer budget. Repeating pulse cues are restrained
so ongoing visual effects do not compete with casts and hits.

The casting runtime emits three sound stages: `cast`, `impact` (including aura
application), and `pulse` (including zone and visual effects). All nine spells
cover all three. No visual geometry, gameplay definitions, timing, damage,
control effects, routing or audio-engine code changes are required.

`test/audio-spells-mitlan.test.js` renders every authored stage with the recorded
audio harness, checks voice/envelope budgets and supported fields, exercises all
three stages through actual rune casts, verifies rejected casts stay silent,
and checks spatial SFX routing and cancellation of delayed layers. Existing
spell tests retain their visual and gameplay assertions; audio assertions now
describe these darker sounds.

Listen to each stage in [the Mitlan sound archive](audio-mitlan.html), or cast
the spells in [the casting simulator](casting-simulation.html).
