# Saves

Play is saved on this device, one save per world, and picked up again when
the page next opens. This page describes when the game saves and what it
says (`src/save/session.js`), the save format and the store that reads and
writes it (`src/save/format.js` and `src/save/store.js`), and how a body
moves between the game and a save (`src/save/body.js`). With `?debug`,
`game.save.now()` saves by hand, `game.save.tick()` runs an autosave,
`game.save.restore()` continues again, `game.save.read()` and
`game.save.claim()` reach the store and `game.save.saveSession` is the
session.

## Saving and Continue

- **Continue.** A page that opens on a world with a save picks it up at
  once: the active character's body (place, vitals, bag and worn gear) and
  the time of day come back. The world holds still until they have. A
  character with no body in the save sets out with the starter kit at the
  world spawn. Nothing is written until the save has been picked up. A
  page hidden before its Continue finished continues when it comes back
  from the back/forward cache.
- **When it saves.** Every minute while the page is shown, at an idle
  moment; at once as the page hides or closes; after a defeat, with the body
  woken at spawn; just before joining a lobby; after a character switch; and
  by hand with the Game panel's **Save now** or the phone menu's **Save
  game**. The Game panel's line tells when it last saved, or why it doesn't.
- **Notices.** A short toast says when a save by hand lands, and when a save
  fails: storage full, the save too big, or another error. Each failure is
  said once until a save lands again; a save by hand always answers. As the
  page opens it also says when storage can't be reached, when the save
  couldn't be read (it starts fresh and keeps the old text aside), when some
  saved things couldn't be read, and when the save comes from a newer
  version (it plays on but never saves). A world open in another tab is
  played here without saving; if another tab saves the world after this page
  continued it, this page stops saving and says to reload. A notice raised
  while the character creator or the phone's play card is up waits until
  it closes.
- **Lobbies.** Joining a lobby saves first and says whether that worked;
  lobby play is never saved.
- **Address options.** `?instruments` puts instruments in the bag only of a
  game that starts fresh, `?time=` beats a saved time of day, and `?nogate`
  neither continues nor saves.

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

## What a body holds

A body is one character's place, `heading`, `health` and `stamina`, the 24
bag slots and the worn gear, each stack copied in the bag's own shape. It
leaves out what a reload resets: a mount, a swing, a jump or a spell under
way, and mana. The skin belongs to the character, and the pouch stays the
browser's own.

- **Whose body.** Each body is filed under the character it was played as,
  or `outlaw`. When the active character has changed by the time of a save
  (in another tab, or by creating one), the body being played is filed
  under its own character first, and the active character's body is put on,
  or the starter kit (a short sword and a stone pickaxe) at the world spawn
  when they have none. When that save is refused, the page keeps the body it
  filed and puts it into the next save that lands, even one of a save it
  claimed from another tab meanwhile; that tab's other bodies stay as stored.
- **Keeping old bodies.** Saving drops the bodies of characters that no
  longer exist, keeps `outlaw`, and past 8 drops the oldest. Fields of a
  stored body that this build doesn't know are kept.
- **Putting a body back.** The bag and worn gear are emptied, then filled in
  place. Bag stacks keep their slots and stacks waiting for room go where a
  pickup would. Gear that no longer fits its slot is worn in another free
  slot of its kind or goes in the bag, and a two-handed weapon sends the off
  hand to the bag. What finds no room is lost and counted, and the load may
  be over the weight limit. Putting a body back makes no pickup sounds.
- **Where it wakes.** At its saved place, facing the same way, with its
  health (at least 1) and stamina. A place that is missing, out of bounds or
  no longer walkable wakes at the world spawn instead, and a body saved
  fallen wakes there with full health and stamina.

Lobby pages and the hill and ruins scenes build no store. Joining a lobby
stops saving for the rest of the page, even after leaving it: a lobby moves
the same player, and the solo save takes up again on the next page load.

## Versions

`features` counts the optional additions a build knows: 1 is the base
format, 2 fills the realm's `clock`.

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
- Saving stays out of the frame: the autosave and the saves after a defeat
  or a character switch wait for an idle moment, and only the saves as the
  page hides, before a lobby and by hand run at once.
