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
  cuirass and crimson tabard, greaves and gauntlets, a greatsword on the back
  and a simulated cape. Every part is rasterised into glyphs with
  supersampling: outlines follow the silhouette with a moonlit rim, and each
  material (plate, mail, cloth, leather, brass) has its own glyph texture.
- **Animation.** Walk and run cycles driven by the ground actually covered, so
  planted feet stay planted, with hip sway, a steady head, leaning into turns
  and into speeding up or stopping. An idle stance that shifts its weight and
  looks around, then kneels to rest; blinking eyes and breath fogging in the
  cold air; jumping with a wind-up and landing squash; and sword play: draw,
  guard, a three-hit combo with glowing swing trails and an overhead chop that
  strikes sparks, shakes the camera and freezes for a beat on impact.
  Footsteps kick up dust and grass and leave prints in dirt and sand.
- **Nameplate.** The warrior's name floats above the helm; add `?name=...` to
  the URL to choose it.
- **Atmosphere.** Fireflies, a vignette, and zoom.
- **ASCII HUD.** Health and stamina bars, a compass and a nine-slot hotbar match
  the world's ASCII style. Running and sword strikes spend stamina;
  it recovers after a short delay. Hunger, thirst and temperature are planned
  for later.
- **Inventory and equipment.** A keyboard-controlled bag, seven-slot paper
  doll, item tooltips and a 40-unit carrying limit. Assign items to the hotbar,
  equip the greatsword, and use starter consumables to restore health or stamina.
  Opening the inventory blocks movement, jumping and attacks while the world
  keeps running.

## Running

No build step. Serve the folder with any static file server and open it:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

A browser with WebGL2 is required.

The rig, gait, inventory and HUD have unit tests (Node 18+, no dependencies):

```sh
npm test
```

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrow keys | Walk |
| `Shift` | Run |
| `Space` | Jump |
| `J` / left click | Strike with the selected, equipped greatsword (repeat for a combo) |
| `F` | Draw or sheathe the sword |
| `1`–`9` | Select a hotbar slot |
| `Q` / `Enter` | Use the selected hotbar item |
| Mouse wheel | Cycle hotbar slots |
| `Ctrl` + mouse wheel / `+` `-` | Zoom |
| `I` / `Tab` | Open or close the inventory |
| `Escape` | Close the inventory |
| `G`, with inventory open | Switch between bag and equipment |
| Arrow keys, with inventory open | Move through items in the selected pane |
| `Enter`, with inventory open | Use or equip a bag item, or unequip selected gear |
| `E`, with inventory open | Equip the selected bag item |
| `U`, with inventory open | Unequip the selected gear |
| `1`–`9`, with inventory open | Assign the selected bag item to a hotbar slot |

Select a consumable in the hotbar, then press `Q` or `Enter` to use it. Selecting
carried equipment in the hotbar equips it. The current items are a starter kit;
injury and pickup feedback is supported, while world enemies and item pickups
are planned for later.

## Layout

```
src/
  main.js            game loop and wiring
  core/              input, hashing, noise
  render/            glyph atlas, WebGL renderer, cell writers
  world/             terrain, grass and water shading, props, sky, reflections, fireflies, dust
  entities/          the warrior: skeleton, armour, materials, cape, combat, movement
  inventory/         items, bag, equipment, hotbar and carry weight
  ui/                ASCII HUD, inventory panel, tooltips and notifications
```
