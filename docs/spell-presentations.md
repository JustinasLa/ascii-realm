# Spell presentations

Rune gameplay remains in `src/spells/definitions`. A rune opts into authored
animation and authored sound by importing its own default profile from
`../presentations/<spell-id>.js` and adding `presentation` to the definition.
Unconverted runes and practice spells retain their existing generic effects.

A profile exports `{ id, duration, draw(effect, plot, glow), sounds }`. `duration` is the
casting animation lifetime in seconds. `draw` is a pure, clock-driven function:

- `effect.stage` is `cast`, `impact`, `pulse`, `aura`, `zone`, or `projectile`.
- `age`, `life`, and `progress` describe the effect clock; progress is clamped to
  0–1. Projectile age/life describe its travel rather than the casting flash.
- `radius` uses metres; `heading` uses radians.
- `plot(x, z, char, [r, g, b], brightness = 1)` accepts local metre coordinates.
  The adapter rotates them to the effect heading around its world origin.
- `glow(x, z, k, reach = 1)` is optional. It lights the ground around a local
  point the way campfires and torches do, flicker included, for `k` above 0,
  and shades it for `k` below 0, without replacing any glyph. `k` is clamped to
  -1 to 1, `reach` to 0.2–3 metres, and calls under 0.01 are dropped. Each
  effect may glow 32 times, and the frame 128 times. The casting arena has no
  light, so glow does nothing there.
- `seed` is one number shared by every effect of a cast (an impact also mixes
  in where it landed), so a moving effect and what it leaves behind can flicker
  alike. `vx` and `vy` are a following effect's smoothed speed in metres a
  second, east and down the screen, capped at 12; they are 0 for effects that
  stay put.

A profile with `keepScenery: true` never covers the small letters of trees and
rocks on the fine grid: its glyphs on those cells are dropped, so its flames
pass behind scenery, while glow still lights it.

Author materially different geometry and timing for each rune. The adapter caps
each effect at 256 plotted glyphs, projectiles at 128, and the frame at 4096.
Only finite coordinates within 48 local metres are accepted. Colors and light
are clamped. Profiles must use bounded loops and must not allocate timers.

`sounds.cast` and `sounds.impact` are arrays of layered voice specifications;
`sounds.pulse` is optional. Natural foley layers use `kind: 'recording'`, a
local `url` under `/assets/audio/spells/<family>/`, `gain` (up to 0.8), `rate`
(0.75 to 1.2), and `delay` (up to two seconds). Recordings retain their own
transients and tails, with small boundary fades. Source clips are limited to
12 seconds and are decoded once per audio context. Keep source credits and
processing provenance alongside each family's assets.

The adapter also accepts legacy `tone` and `noise` voice options; those layers
remain limited to 2.5 seconds and 0.25 gain. Up to eight layers play per cue
on the existing SFX bus. Impact cues are limited to one per 120 ms per
spell, pulse cues to one per 280 ms. Rejected casts emit no cue.

`Spellcasting.present` connects source visuals, successful casts, damage,
healing, wards, zones, and summons to the profile. Projectiles use the same
profile directly while moving. `SpellEffects.paint` is shared by the game and
the standalone casting arena; the arena exposes mute and effects volume and
unlocks audio from its Cast/R gesture.

Reset, death, hiding, and pause discard presentation effects and stop scheduled
spell voices. Presentation changes never alter rune damage, targeting, cost,
status duration, or projectile collision.
