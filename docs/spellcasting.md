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

Definitions are generated from a read-only rune configuration snapshot dated
2026-10-16: MMOItems rune parameters, MythicLib handler bindings and the
corresponding MythicMobs gameplay graph. Each definition keeps a SHA-256
`checksum` of the configuration it was built from. No credentials, live player
data or Minecraft assets are included. `tools/export-rune-spells.py` regenerates
definitions from an existing local snapshot (offline authoring only; requires
PyYAML); it renames the snapshot's skill namespace to neutral `rune_` names
(`--namespace` overrides the detected one) and turns `VFX` summons into ASCII
visuals. Hand-authored definitions name visual-only summons `vfx_*`.
Mitlan's Lightning is authored for this game in the same graph format: a 0.6 s
charge ring at the aimed point, then
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
Oseni's Ring of Fire is authored the same way: a 3 m ring of flame follows the
caster for six seconds. Every half second, twelve times in all, each foe inside
it or within 0.75 m of its edge takes 3 damage and is set burning for three
seconds; burning deals 1 damage a second once the foe is out of the flames.
The 0.75 m margin is a skeleton's body, so a skeleton touching the flames
burns and a smaller foe can be caught just outside them. The caster and other
players are never hurt. The rune recharges for twenty seconds after each cast;
casting it sooner only says that it is still recharging. If the caster falls,
the ring goes out at once, though foes already burning burn out. When it ends
it leaves a scorch mark on the ground that fades within five seconds. It never
sets the grass or trees alight.

Mitlan's Mana Spring is a free toggle: cast once to gain 2 mana each second,
starting one second after activation, in addition to normal mana regeneration.
It follows the caster while moving or using other spells, caps at maximum mana,
and never stacks. Cast again to switch it off; respawning clears it. The rune
wheel shows its rate and active state. Its permanent aura and `tickdelay` are
authored extensions; existing rune auras keep their original timing and expiry.

The runtime preserves configured modifiers, conditions, targeting, repeats,
delays, aura ticks, shields and status effects. Tick counts are converted to
seconds, and metres to the game's existing world coordinates. Motion uses the
game's collision/physics rules. Minecraft display models, particle clouds and
sound files are represented by bounded ASCII lights, rings, trails and existing
game audio. The game grants access to installed rune definitions directly; rune
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
