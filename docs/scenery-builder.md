# Scenery builder

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
