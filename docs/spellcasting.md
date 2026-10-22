# Rune casting

The casting simulation is the prerequisite PR. Each rune adds one definition,
one catalog entry and its own behaviour test in a separate PR.

Holding the middle mouse button (or RUNES on touch) opens a two-stage rune
wheel, school then rune; the chosen rune is bound to `R` and remembered.
`R`, right click and the touch Cast action use the bound rune. The pointer
sets its heading; keyboard/touch casting follows the character's facing. Support
projectiles require another player to intercept them. Close support spells also
check the target's distance before consuming mana. The simulation arena provides
an ally so these spells can be exercised alone.

Definitions are derived from a read-only TFMCMain01 snapshot dated 2026-10-16:
MMOItems rune parameters, MythicLib handler bindings and the corresponding
MythicMobs gameplay graph. Source file names and a SHA-256 digest accompany each
definition. No credentials, live player data or Minecraft assets are included.
`tools/export-tf-spells.py` regenerates definitions from an existing local snapshot
(offline authoring only; requires PyYAML). Mitlan's Lightning is authored for
this game in the same graph format: a 0.6 s charge ring at the aimed point, then
one bolt on the foe nearest its centre (or the bare ground when the ring is
empty) for full damage and a short stun. Lightning then chains, nearest first,
to every other foe inside the ring or within 3 m of the last one struck, for
half damage. The chain is MythicMobs' `chain` mechanic (`bounces`,
`bounceradius`, `bouncedelay`, `onbounce`, `hittarget`, `hitplayers`) plus our
`originradius`, which also admits anything that close to the skill's origin.
Its `fakelightning` step reaches the host through `onLightning`, which the game
answers with the storm's recorded thunder.
Oseni's Rekindle is authored the same way: it heals the caster 10 at once, then
a `Rekindle` aura heals 4 more each second for four seconds, starting a second
after the cast (26 in all). It never touches allies or foes.

The runtime preserves configured modifiers, conditions, targeting, repeats,
delays, aura ticks, shields and status effects. Tick counts are converted to
seconds, and metres to the game's existing world coordinates. Motion uses the
game's collision/physics rules. Minecraft display models, particle clouds and
sound files are represented by bounded ASCII lights, rings, trails and existing
game audio. The game grants access to installed rune definitions directly; TF's
equipment, resonance, progression and class systems are outside this change.

The standalone arena and the real game instantiate the same `Spellcasting` class.
The arena's Practice entries exercise the primitives without installing a rune.
Its Pause/Advance controls, stationary enemy and wounded ally expose timings and
health/mana/shield changes. A spell link selects a specific rune through `?spell=`.

In lobbies the server relays allowlisted cast intent, not damage values or skill
code. Each client simulates the known definition against its local world, using
the other players' reported positions. As with the existing lobby, this is a
cooperative client simulation, not authoritative competitive combat.

Opening inventory, using UI controls, the scenery builder and debug freeze
suppress new gameplay casts. Respawn clears pending tasks, projectiles, zones,
auras, potion effects and temporary movement changes. Runtime queues have caps.

Validation: `npm test` plus the simulation page and the full game's browser
preview. Each rune's test asserts a concrete effect in a controlled scene.
