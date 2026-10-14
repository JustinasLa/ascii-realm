# ASCII Realm

A browser game rendered entirely in ASCII characters. Every frame is a grid of
coloured glyphs: grass is made of `\ | /` blades that sway in the wind, water is
streaked with `- ~ ≈` ripples and reflects whatever stands on the shore, and the
player is a hooded outlaw drawn from hundreds of shaded characters.

**Play:** https://justinasla.github.io/ascii-realm/

![An armoured warrior mid-swing on a moonlit lakeshore, reflected in the water](docs/screenshot.png)

For now it is a single outlaw exploring procedurally generated terrain.

## Features

- **One-pass WebGL2 renderer.** The CPU fills a cell buffer (glyph + colours);
  a fragment shader draws every glyph from a font atlas, so the screen can hold
  tens of thousands of characters at full frame rate.
- **Infinite seeded world.** Lakes, shoreline, meadows, dirt paths and rocky
  outcrops from layered noise, generated in 64×64 chunks as you walk. Add
  `?seed=42` to the URL for a different world.
- **Living grass.** Two- and three-row path verges blend into fuller meadows
  and lakeshore reeds, with blades up to five cells high.
  Fine blades, leafy tufts, curved grass, seed heads and dry gold patches give
  each meadow a different texture and palette.
  Rolling gusts move the tips more than the roots and catch them with a pale
  sheen. Planted boot soles press exact footprints into the grass for several
  seconds; repeated footfalls keep a worn route flattened longer. Sword swings
  push blades aside too. Shoreline stems sway in their reflections
  too. Dew twinkles in the undergrowth.
- **Living forests.** Eight distinct trees inspired by Minecraft's variety:
  oak, pale-barked birch, pine, tiered spruce, umbrella-shaped acacia, tall
  jungle trees, pink cherry groves and drooping willows near lakes. Mature
  trees tower over the warrior, with varied heights, irregular leaf clusters,
  branching trunks and shaded canopy pockets. Smaller saplings and walkable
  shrubs grow between the widely spaced mature trees. Trunks vary
  independently from slender stems to thick old trees. Mossy
  fallen logs, snapped bare trunks, exposed stumps, and beaver-gnawed wood
  with scattered chips add history to the forest; beaver damage stays near
  water. Fallen trunks block their full length, including across chunks.
  Layered foliage has shaded depth and moonlit edges; crowns rustle and gently
  sway with the grass, while trunks and roots stay planted. Leaves and blossoms
  drift down, and foliage thins around the warrior when it would hide them.
  Add `?season=spring`, `?season=autumn` or `?season=winter` for seasonal
  palettes and snow-tipped evergreens. Summer is the default; the season
  stays fixed until reload and can be combined with `?seed=42&season=autumn`.
- **Water.** Drifting ripple streaks, lapping foam, and a night sky (stars and
  the moon) mirrored in every lake. Walk or run through any lake: the water
  rises from your ankles to at most your knees, slows your stride, and hides
  the submerged boots. Each footfall throws up droplets and spreading rings;
  jumps, landings and sword impacts make larger splashes.
- **Reflections.** The wanderer, trees and boulders are mirrored about their own
  base, so the reflection only appears where it would actually reach the water,
  then sways and breaks into slivers with the swell.
- **The outlaw.** A lean, hooded archer in the mould of Robin Hood: a 3D
  skeleton posed every frame, turned to any heading and dressed in a pointed
  hood with a dagged shoulder cape and a shadowed face, a green wool tunic
  under a laced leather jerkin, hose, tall cuffed boots, bracers, a quiver of
  fletched arrows and a longbow across the back, a short sword on the hip and
  a simulated cloak. Every part is rasterised into glyphs with supersampling:
  outlines follow the silhouette with a moonlit rim, and each material (wool,
  leather, wood, feather, iron) has its own glyph texture.
- **Animation.** The player is a rigged 3D character playing professionally
  animated clips, drawn each frame into a small offscreen image from the
  game's camera angle and converted into shaded, outlined glyphs. Walk and
  jog clips are blended by speed and kept in step with the ground, so
  the feet keep pace with the body.
  An idle stance that shifts its weight and looks around, then kneels to
  rest; blinking eyes and breath fogging in the cold air; jumps from motion
  capture that suit the pace (a hop on the spot, a leap off one foot from a
  walk, a long split leap from a run), with jumps on the spot in a row
  turning into a forward spring and then a full turn, and a second press in
  the air for a trick: a back somersault on the spot, a spin from a walk and
  a barrel roll from a run; a skid to a halt from a sprint; and sword play:
  draw, guard, a combo (forehand, then backhand or uppercut, then an overhead
  chop that strikes sparks, shakes the camera and freezes for a beat on
  impact), a lunging thrust from a sprint, a plunging strike from the air and
  a charged spinning slash, all with glowing swing trails. Footsteps kick up
  dust and grass and leave prints in dirt and sand.
- **Nameplate.** The warrior's name floats above the helm; add `?name=...` to
  the URL to choose it.
- **Atmosphere.** Fireflies, a vignette, and zoom.
- **Campfires.** Flickering ASCII flames above charred logs and a stone ring,
  drifting smoke, rising embers, warm light on the surroundings and rippling
  lake reflections. Fires start small and grow brighter over about 20 seconds,
  with their glow and crackling building together. The same gusts that sway
  the grass bend the flames, including wind from the weather settings;
  sustained strong wind weakens and extinguishes
  them, while brief gusts let them recover. One waits beside the spawn clearing.
  Press `C` to build another on open, dry ground, or put out the nearest fire
  within reach.
  Extinguished fires leave a persistent patch of scorched grass and ash.
  Sword cuts bend the flames and scatter embers; walking, running, skidding,
  jumping and landing stir the fire according to their force. Heavy or repeated
  contacts can smother it, with flying coals and ash lingering after it goes out.
  Nearby fires crackle through the Ambience volume control.
- **Fire torch.** Start with a lit torch in your free hand. Its flickering flame
  lights the player and nearby terrain, follows the hand while moving and
  jumping, and reflects in water. Press `T` to stow it or draw a fresh torch;
  `G` throws it in the direction you face. It tumbles through the air and
  starts a ground fire when it lands on dry, open terrain. Water puts it out
  with a splash. The carried-item hint stays visible after the movement hint
  fades.
- **Audio.** Recorded grass brushing and soft footfalls, procedural footsteps on other
  surfaces and movement effects,
  slowly breathing wind and grass rustle, quiet lakes, distant birds and bugs,
  wildlife calls and rare firefly noise glints,
  with 42 original, mysterious RPG songs in 21 day/night pairs, using drifting
  choir, bowed tones, low drones, distant bells and a synthesized room reverb.
  Every sound has 25 shuffled variations; grass also shuffles its six recordings.
  Music rotates automatically through a season and weather playlist. Choose
  automatic seasons or Spring, Summer, Autumn or Winter in the Audio panel;
  winter quiets insects and frogs, while autumn brings out leaf rustle.
  Sword effects layer weathered steel, dry leather, low air rush and weighted
  impacts. Sound starts on your first key press or click;
  the Audio panel shows the current song, lets you skip, and saves mute and
  master, music, effects, sword, ambience and weather levels. See [audio notes](docs/audio.md).
- **Weather.** Choose from 17 weather presets with matching sound and ASCII
  effects: slanted rain, falling snow and hail, blowing leaves and sand,
  drifting fog and branching lightning bolts. Storm strikes flash twice,
  light the ground, reflect in lakes and throw up spray on water. Thunder
  follows the same strike when sound is enabled. Press `L`, or use the Audio
  panel's Summon lightning button, to strike beside the player in any weather.
  Ground strikes ignite a fire on open, dry terrain. The flames grow after the
  bolt fades and leave a scorched patch; lake strikes make spray instead.
  Intensity controls particle density, wind, haze and water impacts. Rain and
  ice throw up lake spray and spreading rings; snow leaves small melt ripples.
  Gusts bend grass and roughen the water. Clear is the default; selection and
  intensity are saved. Effects also work with sound muted or before audio is
  enabled.
- **Phone controls and performance.** A touch stick for walking/running, separate
  jump and sword buttons, and zoom controls in portrait or landscape. Rendering
  targets 60 fps, caps backing resolution, and lowers that resolution under
  sustained load without changing your zoom. Zoom far out for an overview of
  the land: cells shrink to dots of colour, meadows and trees are drawn without
  their animation, and newly seen ground fills in over a few frames. Hidden tabs stop drawing and distant chunks are evicted.

## Running

No build step. Serve the folder with any static file server and open it:

```sh
python -m http.server 8000
# then open http://localhost:8000
```

A browser with WebGL2 is required.

To play this checkout on a phone on the same Wi-Fi, open
`http://<computer-LAN-IP>:8000` on the phone after starting the server.

Gameplay, input, rendering equivalence, memory bounds and frame budgets have
tests (Node 18+, no dependencies):

```sh
npm test
```

Run `npm run bench` for the repeatable CPU benchmark. Measurements, browser
checks and reproduction instructions are in [docs/performance.md](docs/performance.md).

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / arrow keys | Walk |
| `Shift` | Run |
| `Space` | Jump; again in the air for a trick (a barrel roll when running) |
| `J` / left click | Strike: repeat for a combo, sprint for a thrust, jump for a plunge |
| Hold `J` / left click | Charge, then release for a spinning slash |
| `F` | Draw or sheathe the sword |
| `T` | Stow the torch or draw a fresh lit torch |
| `G` | Throw the carried torch in the direction faced; dry ground ignites on landing |
| `C` | Build a campfire on dry ground, or extinguish a nearby fire |
| `M` | Mute or unmute all sound |
| `N` / Audio panel's Skip song button | Switch to the next pair in the current season and weather playlist |
| Audio panel's Season | Follow automatic seasons or choose Spring, Summer, Autumn or Winter for music and ambience |
| Audio panel's Weather / Intensity | Choose Clear or one of 17 weather presets and adjust sound and visual intensity |
| `L` / Audio panel's Summon lightning button | Summon a nearby lightning strike for testing in any weather |
| Audio panel's Weather slider | Adjust weather volume; Ambience and Master also affect it |
| Mouse wheel / `+` `-` | Zoom |
| `B` | Enter the Scenery builder, or return to play and close its panel |

## Scenery builder

Press `B` to enter build mode and open the testing panel; press it again to return
to play. You can also open the panel by clicking its summary, then choose
**Start building**. Paint grass, dirt, shore, water or stone with terrain brushes,
or choose from the **Nature** and **Camp** prop palettes: trees, pines, rocks,
bushes, stumps, logs, flowers, mushrooms, reeds, crates, barrels, fences, tents,
campfires and signposts. Flowers, mushrooms and reeds are decorative and can be
walked through; the other props block movement. Adjust the brush radius or prop
scale in the panel and preview props before placing them; the eraser removes
props only. Every placement gets a fresh variation in shape, proportions and
color; rocks also vary their outline, mineral colors and moss. The preview shows
the variation you will place, and saving or undoing preserves its appearance.
While building, `W A S D` pans the view and normal player movement
is paused. With the canvas or page body focused, `Enter` applies the selected
tool at the centre of the view.

Each stroke can be undone with `Ctrl`/`Cmd` + `Z` and redone with
`Ctrl`/`Cmd` + `Shift` + `Z` or `Ctrl` + `Y`. **Save** and **Load** keep scenery
locally for the current world seed. JSON export and import let you transfer a
scene; imports must match the current seed. **Reset scene** restores the
generated world and can be undone.

Add `?builder` to the URL to open the panel automatically. With `?debug`, the
current scene is available as `window.game.builder.scene` for inspection.

On a phone, drag the left pad to walk and push it to the outer edge to run.
Use **JUMP**, **STRIKE**, and **DRAW** with your other thumb; repeated strikes
chain a combo. The upper **− / +** buttons zoom. Controls support multiple
fingers and reset when a touch is cancelled or the page is backgrounded.

## Layout

```
src/
  main.js            game loop and wiring
  core/              input, hashing, noise
  editor/            scenery builder controls, scene history and persistence
  audio/             lazy Web Audio engine, sampled grass steps, effects, weather, ambience and music
  render/            glyph atlas, WebGL renderer, cell writers
  world/             terrain, grass and water shading, props, sky, reflections, fireflies, campfires, dust
  entities/          the outlaw: skeleton, clothing, materials, cloak, combat, movement
```

## Credits

Walk and run motion from the [CMU Graphics Lab Motion Capture
Database](http://mocap.cs.cmu.edu/) (subjects 8 and 9; jumps and tricks
from subjects 13, 56, 75, 88, 90 and 127), via the BVH
conversion by Bruce Hahne ([cgspeed](https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture/the-daz-friendly-bvh-release-of-cmus-motion-capture-database)).
The database was created with funding from NSF EIA-0196217.

The player character and its idle, walk, jog, jump and sword animations are
from Quaternius' [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html)
(CC0), rendered with [three.js](https://threejs.org/) (MIT, vendored in
`vendor/three`).

Grass footsteps use six excerpts from gabytoledosci's recorded
[Walking on grass.wav](https://freesound.org/people/gabytoledosci/sounds/398266/),
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
The adapted WAV files are served locally from `assets/audio/grass`; see their
[provenance and conversion notes](assets/audio/grass/LICENSE.txt).
