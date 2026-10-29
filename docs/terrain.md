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
come by unless the address asks for them (`?scene=hill&deer=4`). A page in a
lobby ignores the scene and plays on flat land, and creating or joining a
lobby from the scene first reloads the page onto flat land.

## How height is drawn

Height is only a lift on screen: ground `h` metres high is drawn
`h × 11.26` rows higher (at most 24 rows). That is the scale the character
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
- **Light.** Higher ground catches more moonlight and a slope falling toward
  the viewer less, so the crest reads as a lit line over a darker slope.
- **Grass** rooted on raised ground stands from its lifted root, so the
  crest's blades show against the lower land behind it. Reflections stay
  where the water is: water is never raised.
- **On the ground:** the player (figure, shadow and nameplate), props,
  campfires, torches, plants, glowcaps, hunt drops and river debris are drawn
  as high as the ground under their base, and so are a fire's or torch's
  light and sparks and a glowcap's glow.
- **Camera and aim.** The camera follows the player's lifted figure, and the
  cursor is read on the player's own height, so a click aims where it looks.

## Not raised yet

Wildlife, monsters and horses (the scene leaves them out), footprints and
grass tracks, tree shadows and moonbeams on raised ground, reflections next
to it, and the scenery builder's cursor. A prop is lifted by its base cell,
so on a slope its sides can sit a row off the ground.

## Walking on slopes

Every slope is walkable for now: height changes nothing about movement or
speed. How steep a slope may be before it needs a jump or blocks the way is
to be specified separately.
