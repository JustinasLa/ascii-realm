# Saves

The game doesn't save play yet. This page describes the save format and the
store that saving is built on (`src/save/format.js` and `src/save/store.js`).

## Keys

Each world has its own records in `localStorage`. A world is its seed, plus
`-dense` for dense woods (`1`, `1-dense`); a save is never read on another
world.

| Key | Holds | Cap |
|---|---|---|
| `ascii-realm-save-<world>` | the realm record: bodies, piles and the clock | 256 Ki characters |
| `ascii-realm-edits-<world>` | the edits record: changes to the land, per chunk | 1 Mi characters |
| `<key>-corrupt` | the text of the last record that couldn't be read | |

There is one save per world, with no numbered slots. The wallet, furnaces,
alloy book, characters and builder scenes keep their own keys.

## Records

Both records start with the same envelope: `v` (the format version), `game`
(`'ascii-realm'`), `kind` (`'realm'` or `'edits'`), `rev` (one higher on
every write), `savedAt`, `features` and `world` (`{ seed, woodland }`).

The realm record holds:

- `bodies`: up to 8, keyed by character id, or `outlaw` when no character
  is played. A body has its place (`x`, `y`, in cells), `heading`, `health`,
  `stamina`, `respawn` (`null` for the world spawn), `bag` (24 slots, then up
  to 40 stacks waiting for room) and `worn` (one entry per equipment slot).
- `active`: the body last played, or `null`.
- `piles`: up to 16 dropped bags, each with an `id`, `owner`, place, `at`
  and up to 40 stacks.
- `clock`: `{ day, tick }` with a tick below 24000, or `null`.

Every stack has the bag's own shape: `{ id, count }` plus the stack's own
properties (material, alloy, inputs, forging).

The edits record holds `chunks`, keyed `"cx,cy"`, each a list of edits
`[type, target, value?]`. A type has up to 16 characters, a target is a
number or up to 64 characters, and a value is plain JSON at most four levels
deep and 2048 characters long.

## Versions

- Filling a reserved field or adding an optional one keeps the version and
  raises `features`. A build that reads more features than it knows plays the
  save but never writes over it.
- Changing what a field means, its unit or its shape raises the version, with
  an upgrade step in `MIGRATIONS` from the version before. Older records are
  upgraded as they are read.
- A record from a newer version is left alone and the store turns read-only.
- Fields a build doesn't know are kept and written back.

## Damaged records

Reading never throws. A record that isn't JSON, isn't this game's, is the
wrong kind, has no valid version or names another world reads as corrupt.
Its text is copied to `<key>-corrupt` first and stays there, and the record
counts as missing. Inside a sound record each broken body, pile, stack or edit is
dropped on its own and counted, a stack of an item that no longer exists is
dropped, and an over-full stack is cut to its limit. A body whose place is
missing keeps its bag.

## Writing

- One tab writes a world at a time. The writer holds the world's Web Lock
  for the life of the page; other tabs read only. Without Web Locks the rule
  below is the only guard, and two tabs writing at the same instant can
  still both get through.
- A write goes through only when the stored `rev` is the one this page last
  wrote or claimed. A page that has only read a save must claim it before it
  writes, and a page that claimed it loses the right as soon as another tab
  writes.
- A page hidden with `pagehide` lets the lock go, even mid-claim; back from
  the back/forward cache it asks again, and turns stale if another tab saved
  meanwhile, until it claims again.
- A record over its cap is refused before storage is touched. A full or
  blocked storage is reported, never fixed by deleting other keys, and the
  previous record stays as it was.
- A paused store writes nothing for the rest of the page.
- Code that saves keeps it out of the frame: a timed save waits for an idle
  moment, and only the save as the page hides runs at once.
