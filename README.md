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
- **Item collection.** Loose resources bob and glint above the ground and reflect
  in water. Seeded chunks scatter granite, basalt or limestone stones to
  match the local rock layer, sticks under trees, flint, berries, mushrooms,
  reeds and clay by the shoreline. Walk over items to pick them up; nearby loot
  pulls toward you, and `E` picks up or gathers from a bush or tall grass. Strike
  a tree three times for logs, or cut tall grass for straw and plant fibre.
  Stationary pickups make the warrior crouch and grab. A soft pickup sound is
  enabled by your first key press or click.
- **Berry bushes.** Leafy shrubs with bright ripe berries grow throughout the
  meadows, including one near the starting clearing. Press `E` nearby to pick
  4–7 wild berries for your food supplies. Picked bushes keep their branches
  and leaves; excess berries stay on the ground when your bag is full.
- **Bag.** Open the 24-slot inventory with `I` or `Tab` to see stack counts,
  item details and carried weight. Its 40 kg limit leaves excess loot on the
  ground. Select a slot and press `Q` to drop one item. Collected resources,
  harvested plants and dropped items keep their state when you revisit a chunk
  during the current session; reloading starts a fresh world and bag.
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

## Running

No build step. Serve the folder with any static file server and open it:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

A browser with WebGL2 is required.

The rig, gait, inventory and item collection have unit tests (Node 18+, no dependencies):

```sh
npm test
```

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrow keys | Walk |
| `Shift` | Run |
| `Space` | Jump |
| `J` / left click | Strike (repeat for a combo), chop nearby trees or cut tall grass |
| `F` | Draw or sheathe the sword |
| `E` | Pick up a nearby item or gather from a bush or tall grass |
| `Q` | Drop one item from the selected bag slot |
| `I` / `Tab` | Open or close the bag |
| `Escape` | Close the bag |
| Arrow keys / click, with bag open | Select a bag slot |
| `1`–`9` | Select one of the first nine bag slots |
| `M` | Mute or unmute pickup sounds |
| Mouse wheel / `+` `-` | Zoom |

Walking over loose items picks them up automatically. After dropping an item,
`E` recovers it within reach after a one-second delay. Automatic pickup of drops
requires stepping clear of pickup range and returning. Opening the bag blocks
movement, combat and pickups while the world continues running.

## Layout

```
src/
  main.js            game loop and wiring
  core/              input, hashing, noise
  inventory/         shared item registry, stack transfers and carry weight
  render/            glyph atlas, WebGL renderer, cell writers
  world/             terrain, resources, harvesting, props, reflections and atmosphere
  entities/          the warrior: skeleton, armour, materials, cape, combat, movement
  ui/                bag and collection notifications
  audio/             pickup sound cue
```

Collection uses the shared `Inventory` and `ITEMS` registry APIs for the planned
HUD and inventory feature. `Inventory.add(id, count)` returns the quantity that
fits, so partial pickups preserve the remainder on the ground. Item definitions
include glyph, colour, stack limit, weight and tags.
