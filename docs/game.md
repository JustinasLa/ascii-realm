# The game in detail

Everything ASCII Realm draws, animates and plays, system by system. For the
short version see the [README](../README.md).

- **Rune casting.** 42 rune spells across four elements: 9 Oseni (fire), 12
  Seithr (ice), 12 Cerrith (life) and 9 Mitlan (water and storm), from Fire
  Shard, Meteor and Rekindle to Frozen Tomb, Vine Wave, Maelstrom and
  Lightning. Hold the middle mouse button to open the rune wheel, point at a
  school and then at one of its runes, and let go: that rune stays bound to
  `R` until another is chosen, even across reloads. Aim with the cursor and
  press `R` or right click. Runes have no cooldown: any rune can be cast again
  at once while there is mana for it. The wheel shows each rune's mana cost and damage or
  healing, and binding a rune names it in a notice. Mana shows as the MP bar
  in the status frame.
  On touch screens, hold RUNES to open the wheel and tap CAST. Mana
  refills slowly a second after the last cast. Projectiles, waves, zones, shields, heals,
  status effects, summons and channels share one simulation that strikes the
  monsters in the world. Every rune has its own ASCII animation for casting,
  travel and impact, and its own layered recorded foley. Support spells
  such as Healing Orb or Mana Transfer need another player in range.
  Add `?spell=fire-shard` (or another rune's id) to start with that rune
  chosen. The [casting arena](casting-simulation.html) has stationary
  enemy and ally targets, a wall toggle, practice spells and manual time
  stepping. Class abilities are outside this batch. See
  [rune casting](spellcasting.md) and
  [spell presentations](spell-presentations.md).

- **One-pass WebGL2 renderer.** The CPU fills a cell buffer (glyph + colours);
  a fragment shader draws every glyph from a font atlas, so the screen can hold
  tens of thousands of characters at full frame rate.
- **Trees and rocks in finer letters.** Trees and boulders are drawn on a
  second, finer grid, two small characters across and down each cell, over a
  near-black silhouette. They read as dense masses of small letters with a hard
  edge against the grass, ringed by a thin outline of empty night that fades
  out where they meet the ground, so they stay planted in it. A trunk's foot is
  modelled as one solid with its roots and lit by the moon. Anything in front
  of them (the outlaw, grass, rain, fireflies) is still drawn over them, and
  over their outline, in painter's order. Their fine
  versions are baked by web workers once they come near the view; until a
  tree's is ready it is drawn in ordinary cells. Reflections stay in ordinary
  cells.
- **Infinite seeded world.** Lakes, shoreline, meadows, dirt paths and rocky
  outcrops from layered noise, generated in 64×64 chunks as you walk. Add
  `?seed=42` to the URL for a different world.
- **Rivers.** Streams rise on high ground and run downhill until they reach
  a lake or settle in a small pond, from a couple of rows wide at the spring
  to about a dozen further down. Each has a deep middle, shallows, a sandy
  bank and a damp valley floor, and the odd stone stands out of its wider
  reaches. Rivers never cross the starting ruins or the ground around them.
  Grass on the bank facing you stays low so it does not hide the water.
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
  shrubs grow between the widely spaced mature trees. Fine character strokes
  fan into layered sprays on uneven boughs, with curved stems, smaller side
  shoots, open pine whorls and willow curtains starting on individual branches.
  Trunks vary independently from slender stems to thick old trees. Mossy
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
  Rivers run: pale foam streaks travel downstream at the water's own speed,
  faster in the narrows and slower on bends and by the banks, with riffles
  over fast shallows, froth heaped on the outer bank of a bend, and a V-shaped
  wake and a slowly turning eddy behind each midstream stone. Leaves float
  down with the current, splash rings and spray are carried along, and lakes
  stay calm. Standing or wading in a river, you and any monster are gently
  carried downstream, about a quarter of a walking pace in the middle of an
  ordinary reach, more in the deep narrows; you can always wade upstream, and
  a jump lifts you clear of the push.
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
- **Nameplate.** The outlaw's name floats above the hood; add `?name=...` to
  the URL to choose it.
- **Atmosphere.** Fireflies, a vignette, and zoom.
- **Status frames and quick slots.** A party-style frame in the top-left
  corner shows the outlaw's name, segmented HP and MP bars and the satchel's weight.
  Nine quick slots sit along the bottom. Running and sword strikes have no stamina cost.
- **Inventory and equipment.** A keyboard-controlled satchel, a seven-slot
  equipment view drawn with the outlaw's own glyphs, item details, 24 bag slots
  and a 60 kg carrying limit. The bag starts empty, with a short sword equipped
  and assigned to quick slot 1. You can move the sword into the bag, equip it
  again and assign it to other quick slots. Clothes are part of the character;
  the torch is carried separately from the inventory. Opening the inventory
  blocks movement and attacks while the world, including enemies, keeps running.
- **Sword and scenery.** The short sword is the available weapon. Draw or
  sheathe it, chain cuts into a combo, lunge from a run, plunge from a jump or
  hold and release for a spinning slash. Three sword blows fell a tree,
  leaving a stump, and cuts mow tall grass. Felled trees and cut plants stay
  that way for the session, even after the land has been unloaded and generated
  again. Gathering, loose pickups and item drops are disabled; cutting plants
  produces no loot.
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
  with a splash.
- **Audio.** Recorded grass brushing and soft footfalls, procedural footsteps on other
  surfaces and movement effects,
  slowly breathing wind and grass rustle, quiet lakes, babbling rivers, distant birds and bugs,
  wildlife calls and rare firefly noise glints,
  with 42 original, mysterious RPG songs in 21 day/night pairs, using drifting
  choir, bowed tones, low drones, distant bells and a synthesized room reverb.
  Every sound has 25 shuffled variations; grass also shuffles its six recordings.
  Music rotates automatically through a season and weather playlist. Choose
  automatic seasons or Spring, Summer, Autumn or Winter in the Weather & seasons
  panel; winter quiets insects and frogs, while autumn brings out leaf rustle.
  Sword effects layer weathered steel, dry leather, low air rush and weighted
  impacts. Sound starts on your first key press or click;
  the Audio panel shows the current song, lets you skip, and saves mute and
  master, music, effects, sword, ambience and weather levels. See [audio notes](audio.md).
- **Weather.** Choose from 17 weather presets with matching sound and ASCII
  effects: slanted rain, falling snow and hail, blowing leaves and sand,
  drifting fog and branching lightning bolts. Storm strikes flash twice,
  light the ground, reflect in lakes and throw up spray on water. Thunder
  follows the same strike when sound is enabled. Press `L`, or use the Weather &
  seasons panel's Summon lightning button, to strike beside the player in any
  weather.
  Ground strikes ignite a fire on open, dry terrain. The flames grow after the
  bolt fades and leave a scorched patch; lake strikes make spray instead.
  Intensity controls particle density, wind, haze and water impacts. Rain and
  ice throw up lake spray and spreading rings; snow leaves small melt ripples.
  Gusts bend grass and roughen the water. Clear is the default; selection and
  intensity are saved. Effects also work with sound muted or before audio is
  enabled.
- **Ground fog.** Banks of mist made of pale `o` characters lie over the
  land in any weather and creep along with the wind, thinning to clear
  ground between them. The characters float free of the grid in several
  drifting layers that overlap and pulse, so thick fog piles up dense. Fog is
  never lost: anyone walking through it, player or monster, shoves the mist
  ahead of them aside into the fog around their path, where it piles up
  thicker and paler, and drags it along into the gap behind them in eddies;
  a troll parts a wider patch than a goblin. Spells push it too: a spell in
  flight cuts a narrow channel, casts, pulses and impacts throw it outward in
  a ragged ring, and lasting zones and auras whirl it around them. Standing still only
  nudges it, and over a few seconds the piles spread back out. The Fog
  preset rolls in thick, wide banks over a few seconds, and drizzle thickens
  them a little.
- **Skeletons.** The dead climb out of the ground a short way off, run at the
  player and hack at them with rusted swords; step back out of reach and the
  blow misses. Like the player they wade into lakes up to the knee, slowed and
  splashing, but they only ever rise on dry land. They are bones hung on the same animated 3D rig as the player,
  with ember eyes. Three sword cuts break one apart: each cut staggers it and
  knocks it back, and the last sends it crashing to the ground, where it lies
  before sinking away. Up to three are about at once, and another rises a few
  seconds after one falls. Wounds heal after a short breather; struck down, the
  player wakes where they began. `?skeletons=N` sets how many roam (0 for none).
- **Goblins.** Small, green and quick, with long ears and yellow eyes, goblins
  come running from further off, cackling once they spot the player. One darts
  in to stab with a notched dagger, skips back out of reach and circles before
  rushing in again. Cut once, it panics and flees squealing, then comes back for
  more; a second cut finishes it. They hit lighter than skeletons but more
  often, are nearly as fast as a running player, and wade like everyone else.
  Up to two are about at once; `?goblins=N` sets how many (0 for none).
- **Trolls.** Now and then a troll lumbers in: two and a half metres of mossy
  grey hide, hunched over broad shoulders, with a small tusked head and a stone
  club carried in both hands. It is slow enough to outrun, but it heaves the
  club up behind its head and crouches into a ground smash that hits twice as
  hard as a skeleton and shakes the earth where it lands; watch the long
  wind-up, get clear of the spot, then cut back. It shrugs off most cuts, reeling only from every third, flies
  into a rage (and a quicker pace) when badly hurt, and takes seven cuts to
  bring down, falling with a thud. One at a time; `?trolls=N` sets how many.
- **Elves.** A tall, pale archer in a green hooded tunic with long ears and a
  longbow. It never comes to blows: it keeps a few metres off, sidesteps
  between shots, then stands, draws and looses an arrow that leads a moving
  player. Arrows fly in a visible arc and stick where they land, so change
  direction once one is loosed to dodge it. Close in and it backs away, but
  not every moment; two cuts bring it down. One at a time; `?elves=N` sets how
  many.
  Wounded monsters show a segmented health bar over their heads.
- **Phone controls and performance.** A touch stick for walking/running, separate
  jump, sword and cast buttons, and zoom controls in portrait or landscape. They
  appear only when touch is the primary input, so touchscreen laptops and narrow
  desktop windows keep the keyboard and mouse layout. Rendering
  targets 60 fps, caps backing resolution, and lowers that resolution under
  sustained load without changing your zoom. Zoom stops at the furthest scale
  that still draws grass blades, swaying trees and reflections; a very wide
  view fills in newly seen ground over a few frames. Hidden tabs stop drawing
  and distant chunks are evicted.
- **Multiplayer lobbies.** Create a lobby and share its six-character code;
  friends enter the code to join the same seeded world. Movement, jumps, swings,
  rune casts, gear, weapons, nameplates and reflections are visible to everyone, and each
  friend's health appears in the party frames under your own. Players
  have distinct nameplate colours, and brief connection drops reconnect
  automatically. The lobby keeps working when its creator leaves.
