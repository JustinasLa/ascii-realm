# Contained and spreading fire

Campfires keep their stone hearth and never ignite nearby vegetation.
Thrown torches and lightning create finite ground fires with no stone ring.
A torch can briefly burn on empty dry ground using its own fuel; lightning
needs combustible vegetation to sustain a fire.

Spread follows touching fuel cells in four directions. Tall grass uses the
existing patch and clump fields, with gaps, paths, rocks, water and already
burned ground interrupting the chain. Trees and resource clumps are single
fuel objects, connected through their ground footprints. A nearby object
across an empty gap is never ignited by proximity or flying embers.

Each burning cell has a short life. Fresh grass sustains the advancing
front until its entire connected clump is consumed, including clumps
larger than 384 cells. Visible fringe blades join the front too, so no green
edge is left behind. Gaps and barriers still stop it. Heat is lost when
crossing into or out of wood and other objects, with at most 384 such
objects per incident. Processing is limited to 256 events per frame;
unfinished work carries into later frames instead of leaving part of a
clump unburned. The visible fronts share the existing 24-fire render budget.
Wind and player contact can extinguish the incident before it consumes all
its fuel. When the connected fuel is exhausted, its flames disappear.

Burned grass leaves exact, persistent ash marks. Trees darken while burning
and leave charred stumps when consumed, with no surviving canopy or blocking
trunk. Burn state persists across chunk eviction, and consumed resource
plants lose their foliage and stay unavailable for gathering. Picking
berries leaves combustible bush foliage intact. Green footprint mats are removed
from burned ground.

Validation covers containment, gaps and barriers, overlapping incidents,
fuel exhaustion, heat and render budgets, different frame sizes, wind,
smothering, terrain changes, footprints and persistent tree/grass damage.
Run `npm test` and use `C` for a campfire, `G` to throw a torch, and `L` to
summon lightning in the game.
