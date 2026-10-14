# Scene density

The ten supplied reference clips were reviewed at six points across each
timeline. The recurring outdoor composition is detailed vegetation islands,
trees, structures and reflections separated by dark, quiet ground. A dense
patch can fill part of the view while nearby ground stays open. The dungeon
clip leaves even more empty space around the small illuminated area. Combat
clips add local characters, webs and fire without uniformly texturing the
whole background.

The water clips keep reflections readable on calm water, with horizontal
wave bands and oval disturbance rings. The grass physics and corrected-ripple
clips show full blades within distinct patches, thinning toward their edges.
These guide spacing; they are not a target to reproduce every reference
scene or fill every screen cell.

## Changes

- Water keeps coherent, irregular swell bands and caches the calm gaps.
  Shore foam, shallow beds, lily pads, fish rises and reflections remain.
- Grass retains about one fifth of the previous roots in broad islands.
  Patch interiors keep the previous tuft density, blade height, flowers and
  wind animation; edges fade into open ground.
- Contact follows actual roots, so feet, the body and sword wakes do not
  paint flattened grass into empty patches.

The procedural masks use world coordinates and the world seed, so they stay
fixed when moving, crossing chunk boundaries, editing terrain or revisiting.

## Validation

Across 25 chunks per seed for seeds 1, 19 and 42, grass roots fell from 62,345
to 12,384 (19.9% retained). Individual regions vary with the patch layout.
Across 67,655 water cells in those chunks, 36,470 remain animated (53.9%),
and surface marks at time zero fell from 97.7% to 43.9%, including the richer
shorelines and shallow beds. The spawn lake alone has marks in 20.6% of its
water cells at time zero.

The tests cover density, clear patch gaps, contact on surviving roots,
deterministic regeneration, changing waves, shore cache invalidation, floating
pads and reflection layering. Run `npm start` to inspect the game locally.

All 727 application tests pass, including the updated portrait, landscape,
desktop and meadow snapshots for movement, attacks and jumps.

## ASCII grass

Grass poses now draw ordinary font characters: `|`, `/` and `\` for standing
or leaning stalks, an apostrophe for short tips, and `_` or `-` for flattened
stalks. Flower stems use the same heading characters. Overlapping blades
resolve to one character per cell.

The root layout and physical curves still drive wind, body parting, sole
contacts, sword wakes, persistent trampling, recovery and reflections. The
browser verified exact pixel matches between six representative grass poses
and the corresponding font glyphs, and verified contact changes the rendered
pose before it recovers fully.
