# Scenery builder

The builder needs a desktop or tablet; it is unavailable on phones.

Press `B` to enter build mode and open the testing panel; press it again to return
to play. You can also open the panel by clicking its summary, then choose
**Start building**. Paint grass, dirt, shore, water or stone with terrain brushes,
or choose from the **Nature**, **Camp** and **Architecture** prop palettes: trees, pines, rocks,
bushes, stumps, logs, flowers, mushrooms, pale caps, reeds, crates, barrels, fences,
tents, campfires, signposts, furnaces and alloy forges. Flowers, mushrooms, pale caps and reeds are
decorative and can be walked through; the other props block movement. Adjust the brush radius or prop
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

## Standing stone

The **Nature** palette's **Standing stone** (`!`, after Rock) places a tall,
slender menhir that tapers to a slanted crown and leans slightly. It is drawn in
small letters on a dark silhouette like rocks, takes torch light on the flank that
faces it, and reflects in water below it. It is decorative but solid: it blocks
movement and arrows. It is damp, and glints in torchlight, only when placed on
a water cell; on a dry shore beside a pool it stays dry.

## Pale caps

The **Nature** palette's **Pale caps** (`m`, after Mushrooms) places a clump of
one to three rounded mushrooms with pale caps and teal undersides: a broad dome,
a taller leaning bell or a small round button, each in its own size. A smaller
cap beside the main one may stand in front of it or behind it. They are drawn in
small letters on a dark silhouette like rocks and trees, catch torch light on the
side facing it, and reflect in water below them. The teal gills and stems keep a
steady glow of their own colour at night but light nothing around them. They are
decorative: you can walk and shoot through them, and grass grows around them.
Use the scale slider to vary sizes when clustering them around tree roots.
In dense woods (`?woodland=dense`), the generated pale caps around trees
can be erased like other generated props, and **Reset scene** restores them.

Add `?builder` to the URL to open the panel automatically. With `?debug`, the
current scene is available as `window.game.builder.scene` for inspection.

## Stone ruins

Normal games start beside a ruin site: an arched gate with joined broken
walls at a gentle angle, three widely spaced pillars and fallen stone. Longer
low wall sections extend both flanks. An open forecourt and a dry path lead
from spawn through the slightly turned gate passage.
These are part of the generated map, so **Reset scene** restores them;
erasing them is undoable and their removal is retained by Save/Load.

The **Architecture** palette contains a stone gate, battlement tower, short,
broken and tall columns, low and broken walls, and small and large rubble.
The gate's two piers block movement while its centre is walkable. The tower
is solid. These are outdoor scenery props: there are no functional doors or
interiors. Placement, scale, variation, save/load and undo work as for other props.

Choose **Add stone ruins** in the builder's **Test scene** section to add twelve
props covering all nine kinds around the current view centre. The preset has a
foreground of monumental columns and fallen stone, an open melee court, and
a gate, tower and wall fragments farther north. It has
narrow worn paths north, south and sideways. Grass grows around scattered paving;
small bare patches surround the stone bases. It prepares dry local ground
and removes generated obstacles, including fallen trunks extending into the site.
Terrain and props outside the site are retained. If a placed prop overlaps the
site, placement is refused: pan to an empty area and try again. Terrain changes
inside the site are intentional and are restored by undo.

The entire preset is one undo step, including terrain and generated-prop
removals. Save locally or export JSON to retain it. Opening `?scene=ruins` adds
the same preset at the starting view and opens build mode automatically;
`?scene=ruins&debug` also exposes the debug state. It does not overwrite a local
save. A site's prop variations are stable for its world seed and position.
The direct ruin preview uses a dense green meadow, low fog and a wider view,
following the video reference. Other worlds keep their normal vegetation.
Use `?scene=ruins&play` to start directly in play with the builder panel closed.

To test the scene:

1. Open `?scene=ruins&debug` and press `B` to play. The initial player position is
   inside the court. Follow the path north through the centre of the gate, then approach
   each stone pier and confirm it blocks movement. Circle the columns, tower
   and wall fragments, checking that the player draws in front of or behind
   their bases appropriately.
2. Open **Weather & seasons**, choose **Foggy stillness**, and increase **Intensity**.
   Walk through the arch and across the court to inspect fog around the masonry
   and the wake left by movement. The preview starts in fog; adding a preset
   with the builder button keeps the current weather settings.
3. Move and swing the sword in the open court. For enemies, add `&skeletons=2`
   to the preview URL. Check that melee movement and dodging remain possible
   through the central route and around the broken columns and rubble.
4. Return to building with `B`; undo once to restore the previous scene, then
   redo. Save locally, reset, and load to check that the ruins and open gate
   collision return with the same shapes and colours.

When placing a second site after panning, the existing builder's return-to-play
behaviour keeps the player near their previous position; travel to the new site
to test it. Use the direct preview URL for a ruin at the starting player location.
