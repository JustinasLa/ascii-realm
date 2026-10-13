# ASCII Realm

A browser game rendered entirely in ASCII characters. Every frame is a grid of
coloured glyphs: grass is made of `\ | /` blades that sway in the wind, water is
streaked with `- ~ ≈` ripples and reflects whatever stands on the shore, and the
player is an armoured warrior drawn from hundreds of shaded characters.

**Play:** https://justinasla.github.io/ascii-realm/

![An armoured warrior mid-swing on a moonlit lakeshore, reflected in the water](docs/screenshot.png)

For now it is a single warrior exploring procedurally generated terrain.

## Features

- **One-pass WebGL2 renderer.** The CPU fills a cell buffer (glyph + colours);
  a fragment shader draws every glyph from a font atlas, so the screen can hold
  tens of thousands of characters at full frame rate.
- **Infinite seeded world.** Lakes, shoreline, meadows, dirt paths and rocky
  outcrops from layered noise, generated in 64×64 chunks as you walk. Add
  `?seed=42` to the URL for a different world.
- **Living grass.** Blades lean with rolling gusts, flash lighter where the wind
  catches them, part around your feet, and hide twinkling dew drops.
- **Water.** Drifting ripple streaks, lapping foam, and a night sky (stars and
  the moon) mirrored in every lake.
- **Reflections.** The wanderer, trees and boulders are mirrored about their own
  base, so the reflection only appears where it would actually reach the water,
  then sways and breaks into slivers with the swell.
- **The warrior.** A 3D skeleton posed every frame, turned to any heading and
  dressed in armour: horned great helm with glowing eyes, layered pauldrons,
  cuirass and crimson tabard, greaves and gauntlets, selectable weapons
  and a simulated cape. Every part is rasterised into glyphs with
  supersampling: outlines follow the silhouette with a moonlit rim, and each
  material (plate, mail, cloth, leather, brass) has its own glyph texture.
- **Animation.** Walk and run cycles driven by the ground actually covered, so
  planted feet stay planted, with hip sway, a steady head, leaning into turns
  and into speeding up or stopping. An idle stance that shifts its weight and
  looks around, then kneels to rest; blinking eyes and breath fogging in the
  cold air; jumping with a wind-up and landing squash; and weapon movesets with
  drawing, sheathing, combos, charged attacks and coloured swing trails.
  Footsteps kick up dust and grass and leave prints in dirt and sand.
- **Nameplate.** The warrior's name floats above the helm; add `?name=...` to
  the URL to choose it.
- **Atmosphere.** Fireflies, a vignette, and zoom.

## Running

No build step. Serve the folder with any static file server and open it:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

A browser with WebGL2 is required.

The rig, gait, weapons, combat, input and world effects have unit tests
(Node 18+, no dependencies):

```sh
npm test
```

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrow keys | Walk |
| `Shift` | Run |
| `Space` | Jump |
| `J` / left click | Tap to strike; repeat for a combo; hold and release to charge an attack |
| `K` / right mouse button | Hold to block with sword and shield; raising the shield opens a brief parry window |
| `F` | Draw or sheathe the selected weapon |
| `1`–`9` | Select a weapon in the order listed below |
| `[` / `]` | Previous / next weapon |
| `M` | Next weapon material |
| Mouse wheel / `+` `-` | Zoom |

The Weapon and Material selectors in the HUD can also be used with the mouse
or keyboard (`Tab` to focus them).

## Weapons

| Key | Weapon | Moves |
| --- | --- | --- |
| `1` | Greatsword | Broad cuts, an overhead finisher and a charged cleave |
| `2` | Sword & shield | One-handed cuts, blocking and a timed parry |
| `3` | Battle axe | Chopping attacks that can fell trees |
| `4` | War hammer | Slow, heavy swings and a ground slam |
| `5` | Spear | Long-reach thrusts and a charged overarm throw |
| `6` | Dagger | Fast combos and a backstab strike |
| `7` | Bow | Full draw, cursor aiming and released arrows |
| `8` | Staff | Sweeps and a charged magic shot |
| `9` | Javelin | Thrusts and a charged throw |

Each weapon has its own light combo, sprint attack, air attack and charged
attack, ASCII shape, swing-trail colour and sheathed position. Attack while
running or airborne to use its sprint or air move. With the spear, hold `J`
or left click and release to throw; a quick tap still thrusts.

With the bow, hold `J` or left click to pull the string fully back, aim with
the cursor, then release. The warrior turns toward the cursor, and arrows
land at its position on the ground unless an obstacle intercepts them.
Spear and javelin throws and staff shots follow the warrior's facing direction;
walk in the direction you want to aim them.

Choose **stone → copper → bronze → iron → steel** with `M` or the Material
selector (steel is the default). Material tiers change damage, attack timing,
stamina cost, weight and colour. All tiers are freely selectable in this
prototype; crafting and metallurgy are separate work.

Attacks spend stamina, and holding the shield drains it. Watch the HUD's
Stamina meter: it recovers between actions, and attacks require enough stamina
to start. Weapon and material changes are ignored while drawing, sheathing,
attacking, charging or blocking.

Axe strikes can fell trees and clear their collision for the current session.
Reloading restores the generated world. Arrows, spears and thrown javelins travel
through the world and hit terrain or obstacles. There are no enemies or
harvested resources yet.

## Layout

```
src/
  main.js            game loop and wiring
  core/              input, hashing, noise
  render/            glyph atlas, WebGL renderer, cell writers
  world/             terrain, grass and water shading, props, sky, reflections, fireflies, dust
  entities/          the warrior: skeleton, armour, materials, weapons, cape, combat, movement
```
