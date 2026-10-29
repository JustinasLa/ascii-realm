# Raised terrain

The land is a flat grid of ground cells. Raised ground is a first prototype,
shown only in a developer scene for now; the normal world stays flat.

## The hill scene

Open `?scene=hill` (add `&debug` for the `game` debug object). Round the
spawn point it raises:

- a **ridge** across the land about 24 rows north of spawn, 1.6 m high, with
  a 3 m slope down toward the viewer and a 2 m slope down behind it to lower
  meadow. Its crest wanders a little and it tapers off at both ends;
- a **knoll** east of spawn, about 6 m across and 1 m high, that joins the
  ridge's foot as a spur;
- a tree and two rocks standing on the knoll.

The scene is the same every time for a given seed. It has no rivers or
ruins, its grass is the lush meadow, and no monsters, animals, birds or fish
come by unless the address asks for them (`?scene=hill&deer=4`, `&horse=1`). A page in a
lobby ignores the scene and plays on flat land, and creating or joining a
lobby from the scene first reloads the page onto flat land.

## How height is drawn

Height is only a lift on screen: ground `h` metres high is drawn
`h × 11.26` rows higher (at most 24 rows) from the usual camera, 30° above
the horizon; in general a metre rises `6.5 × cot(pitch)` rows (see
[Camera pitch](#camera-pitch-developer)). That is the scale the character
uses for a jump, so the ground, the player and the props on it agree.
Heights are smooth, rounded to whole rows, not stepped in blocks. Water and
shore are never raised, even inside the hill, and ground painted over with
water drops flat.

- **Ground.** After the flat ground is drawn, each raised ground row is
  drawn again in painter's order among the sprites: its top its lift higher,
  then the slope it uncovers down to the row in front. A ridge in front hides
  the feet of whoever stands behind it and the small letters of a prop there.
  Slope rows take a neighbouring column's letter, so no letter repeats
  straight down a slope, and a drop steeper than two rows a row shows earth.
  A cell whose own flat row is on screen is copied from there, as it stood
  before any sprite was drawn, so whatever was laid on that ground rises
  with it and runs on down its slope: shadows, footprints, grass tracks,
  the trees' night shade and moonbeams, and dew. A cell lifted in from
  below the screen shows its bare ground.
- **Light.** Higher ground catches more moonlight and a slope falling toward
  the viewer less, so the crest reads as a lit line over a darker slope.
- **Grass** rooted on raised ground stands from its lifted root, so the
  crest's blades show against the lower land behind it. Reflections stay
  where the water is: water is never raised.
- **On the ground:** the player (figure, shadow and nameplate), monsters
  (and their health bars), animals, birds on the ground, horses and their
  riders, props, campfires, torches, plants, glowcaps, hunt drops and river
  debris are drawn as high as the ground under their base, and so are a
  fire's or torch's light and sparks and a glowcap's glow. A ridge in front
  hides their feet. A bird in the air flies over the ground under it.
- **Camera and aim.** The camera follows the player's lifted figure. The
  way a click turns the player is read on the player's own height, so a
  click beside the figure cuts that way; a shot, throw or spell lands on
  the ground drawn under the cursor, where a foe standing there is.
- **Scenery builder.** The builder's brush and ghost prop sit on the ground
  drawn under the pointer: the nearest raised top or slope there, else the
  flat ground.

## Camera pitch (developer)

A developer tool for looking at the land from other angles. It stays out of
normal play: the game is drawn from one fixed camera.

- **Use.** Add `&pitch=25` to `45` (degrees above the horizon) to an address
  with `?debug`, e.g. `?debug&scene=hill&pitch=45`. With `?debug`, `[` lowers
  the camera 5° toward the horizon, `]` raises it 5° and `\` puts it back at
  30°; `game.setPitch(deg)` does the same from the console, also on a phone.
  The pitch is rounded to a whole degree and kept in range, and anything else
  means 30°. Each change shows "Camera pitch N°". Nothing is saved. Friends
  are drawn from the usual angle, so a lobby page ignores it, and joining a
  lobby puts the camera back at 30° until you leave. It combines with zoom.
- **What it changes.** Ground depth stays the same at every pitch (6.5 rows a
  metre); only how far height rises changes. Raised ground is lifted again:
  the ridge is 22 rows tall at 25°, 18 at 30° and 10 at 45°, so a low camera
  hides more behind it and a high one sees over it. Everything standing on
  the ground goes with it. The 3D outlaw, monsters, animals, birds, fish
  and horses with their riders are rendered by their cameras at the new
  angle, so at 45° you see more of the top of the hood, and a jump or a
  bird's flight rises in proportion, as do arrows and thrown torches in the
  air. The camera keeps aiming at the figure's middle, so a pitch change
  swings the view round the player.
- **What it leaves alone.** Movement, collision and aim work on the ground,
  so they are the same at every pitch; close swings are aimed from the hips
  as drawn, and a thrown torch or arrow lands where it would from 30°.
  Trees, rocks, grass blades, the shape-built figure, friends, spells,
  weather, arrows stuck where they struck and the length of a torch keep
  the 30° drawing. Because ground depth cannot change, upright things come
  out shorter than a true view from that angle would show them, ×0.71 at
  45°, and taller, ×1.18, at 25°; at 45° the outlaw and the creatures are
  drawn a little over half as tall as at 30° and read squat. The range stops
  at 25° so the hill never lifts past 24 rows.
- **No turning round.** The camera only tilts; it does not orbit round the
  vertical. Chunks, props and the controls all face the screen, so turning
  the world would need another renderer.

## Not raised yet

Reflections: the grass on raised ground and whatever stands there are
mirrored in the water as if the ground were flat. A lobby plays on flat
land, so friends are never raised. A prop is lifted by its base cell, so on
a slope its sides can sit a row off the ground.

## Walking on slopes

Every slope is walkable for now: height changes nothing about movement,
speed or falling, so the player walks over the ridge as over flat land.

Rules for climbing are planned but not built yet. For each metre walked, a
rise of up to 0.6 m is a step, a rise of up to 1.25 m needs a jump, and
anything steeper blocks the way. Any drop can be walked down, but a fall of
more than 3 m costs a point of health for every metre beyond 3. Slopes will
not change walking speed.
