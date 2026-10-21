# Spell presentations

Rune gameplay remains in `src/spells/definitions`. A rune opts into authored
animation and synthesized sound by importing its own default profile from
`../presentations/<spell-id>.js` and adding `presentation` to the definition.
Unconverted runes and practice spells retain their existing generic effects.

A profile exports `{ id, duration, draw(effect, plot), sounds }`. `duration` is the
casting animation lifetime in seconds. `draw` is a pure, clock-driven function:

- `effect.stage` is `cast`, `impact`, `pulse`, `aura`, `zone`, or `projectile`.
- `age`, `life`, and `progress` describe the effect clock; progress is clamped to
  0–1. Projectile age/life describe its travel rather than the casting flash.
- `radius` uses metres; `heading` uses radians.
- `plot(x, z, char, [r, g, b], brightness = 1)` accepts local metre coordinates.
  The adapter rotates them to the effect heading around its world origin.

Author materially different geometry and timing for each rune. The adapter caps
each effect at 256 plotted glyphs, projectiles at 128, and the frame at 4096.
Only finite coordinates within 48 local metres are accepted. Colors and light
are clamped. Profiles must use bounded loops and must not allocate timers.

`sounds.cast` and `sounds.impact` are arrays of layered voice specifications;
`sounds.pulse` is optional. Each layer uses `kind: 'tone' | 'noise'` and the
existing Web Audio voice options: duration, gain, delay, frequency,
endFrequency, type, cutoff, filterType, attack, and release. Up to eight layers
play per cue on the existing SFX bus. Each layer lasts at most 2.5 seconds
and starts within two seconds. Impact cues are limited to one per 120 ms per
spell, pulse cues to one per 280 ms. Rejected casts emit no cue.

`Spellcasting.present` connects source visuals, successful casts, damage,
healing, wards, zones, and summons to the profile. Projectiles use the same
profile directly while moving. `SpellEffects.paint` is shared by the game and
the standalone casting arena; the arena exposes mute and effects volume and
unlocks audio from its Cast/R gesture.

Reset, death, hiding, and pause discard presentation effects and stop scheduled
spell voices. Presentation changes never alter TF damage, targeting, cost,
status duration, or projectile collision.
