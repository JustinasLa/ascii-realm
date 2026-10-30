# Provinces

The world is split into **provinces**, regions about 160 m across. Each has
one terrain: `land`, `water` or `bog`. Bog provinces have their own ground
(below). Provinces are also the map later systems use to decide where things
happen, by province id.

Provinces are a pure function of the world's seed, so nothing about them is
saved. A save that needs one stores its id.

## Layout

`src/world/provinces.js` builds them on a jittered grid of 160 m squares,
measured on the ground: a metre spans `SCALE / ASPECT` (about 21.7) columns
but only `SCALE × TILT` (6.5) rows, as for rivers.

- Each grid square `(i, j)` holds one seed point, somewhere in its middle
  half.
- A world cell belongs to the seed nearest it, once its position is warped
  by up to 24 m by two slow noise fields. Borders wander and never run
  straight.
- Because each seed keeps to its middle half, the nearest seed always lies in
  the 3×3 squares around the warped point, so a lookup checks only those nine.

## Ids

`idAt(x, y)` gives the province holding a cell (positions are floored to
cells). The id is `1 + szudzik(zigzag(i), zigzag(j))` for the seed's grid
square:

- positive, and different for every square;
- a safe integer far beyond the world's reach;
- `gridOf(id)` turns it back into `{ i, j }`.

Beyond 10 000 000 cells from the origin on either axis, `idAt` returns the
reserved id `0`: no province, terrain `land`, no heart and no neighbours.
Scans stop at that bound, so a province cut off by it has no neighbour `0`,
and one wholly past it is land with no heart, which `nearest` skips.

## Terrain

`terrain(id)` is worked out once per province, from a 7×7 lattice of
samples 32 m apart round its seed, keeping those that fall inside it. It
reads the seeded land as it is before rivers, without building chunks.

- **water:** more than half of the samples are lake water.
- **bog:** otherwise, with a chance that grows with the share of lake and
  shore samples and with how low the ground lies. About a tenth of the land
  provinces are bog, most of them by lakes. `MEAN_WEIGHT` scales the chance
  so the share comes out near 10% on seeds 1–5. No chance is above 60%.
- **land:** everything else.

A province is never bog when any of its cells lies within 64 m of spawn.
That disk is read exactly, row by row like `neighbours` (below), once per
world. That keeps the starter ruins on meadow. The
world's `bogs: false` option makes no province bog.

## Finding things

| Call | Gives |
|---|---|
| `heart(id)` | A cell well inside the province: the lattice sample whose ring of 8 probes stays inside at the largest of 8, 16 and 32 m, nearest the seed among equals. |
| `ringInside(id, x, y, m)` | Whether 8 probes on a ground circle of `m` metres round a cell are all in `id`. |
| `neighbours(id)` | The sorted ids of the provinces owning a cell 4-adjacent to one of `id`'s cells. |
| `nearest(terrain, x, y, rings = 16)` | The province of that terrain whose heart is nearest the cell, up to `rings` grid squares out (about 2.5 km), or `null`. |
| `edgePoint(id, from)` | Walking from the heart toward `from` in 2 m steps, the first cell with a border within 6 m. |

`neighbours` is exact on the cell grid. It scans the province's bounding box
row by row, but doesn't look at every cell. Each lookup also gives the gap
between the nearest two seeds, and no border comes nearer than half that gap
(in warped metres; the warp stretches distances by at most 2.44 times). So a
row is read in runs, skipping as far as that radius vouches for. Far from
the province, it skips as far as no cell of the province can lie. A
province's neighbours take about 2×10⁵ lookups the first time, about 50 ms,
and are kept after that.

## The world

`World` builds `world.provinces` once spawn is found. While spawn is being
looked for it is `null`, like `world.rivers`. Positions are world cells, as
everywhere else.

The world's provinces read the seeded land before any edits, rivers or ruins,
so their terrains don't change when the land is painted.

## Bogs

Deep in a bog province the meadow gives way to **bog** (terrain type 5,
`BOG`): a dark, olive floor of peat litter with clumps of moss, patches of wet
soil and the odd pale glint of standing water, under olive sedge. The meadow
thins into it across a ragged margin about half a screen wide, so a bog's
edge reads as a darker place you walk into. Bog grows, burns, sounds and is
walked like the meadow: fires spread across its sedge, glowcaps and fireflies
find it, and dust over it throws blade bits rather than grit.

`src/world/bogs.js` paints it as the chunk's last layer, after rivers:

- A 3×3 lattice of lookups over the chunk skips the rest when no bog province
  reaches it, as for most chunks.
- Otherwise each point of a lattice 8 columns by 2 rows apart (about 0.4 m by
  0.3 m, the world's own, so chunks agree) gets a **depth** `e`: the largest
  of 2, 4, … 12 m, tried from the smallest up, whose ring of 8 probes
  (`ringInside`) stays inside its bog. Rings within the lookup's safe radius
  pass without probing, so a bog's interior costs one lookup per point.
- A cell's **wetness** is `smooth(3, 9, e − 3n)`, with `n` slow noise, stored
  in `chunk.bog` (0–255). No cell within 3 m of the border is wet.
- Meadow still meadow after the rivers, with wetness above one half, becomes
  bog. A river's shore and water win over it.
- Sedge (grass style 6) grows where a hash falls under the wetness, plus
  0.35 on bog, so it is nearly all sedge on the bog and thins out over the
  margin.

Bogs are a drawing layer only. Each bog chunk keeps `landType`, its land
before rivers and bogs, and `preRiverTypeAt` reads it, so trees, rocks, veins
and groves are exactly where they are without bogs, with the same ids. A bog
chunk costs about as much to build as a meadow one once its province is
known.

The builder has a **Bog** brush, and `?bog` starts the game at the edge of
the nearest bog (see [running](running.md)).
