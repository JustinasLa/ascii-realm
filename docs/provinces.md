# Provinces

The world is split into **provinces**, regions about 160 m across. Each has
one terrain: `land`, `water` or `bog`. Provinces don't change the ground yet.
They are the map later systems use to decide where things happen, by
province id.

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

A province is never bog when it holds spawn, or when any of 8 points 64 m
round spawn falls inside it. That keeps the starter ruins on meadow. The
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
