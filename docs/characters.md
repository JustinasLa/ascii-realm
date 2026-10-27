# Characters

A character sheet describes who the player is: name, gender, race, age and
birthday, class, attributes, description and clues. Each browser keeps up
to three characters, one of them active. The rules, the skins and the saved
roster live in `src/character/`. A first visit opens the
[creator](#the-creator). The active character is played everywhere: its name
in the HUD, over the outlaw, in the inventory and in lobbies, and its skin on
the outlaw and the inventory portrait. Its sheet shows on the inventory's
[Character page](#the-character-menu). Making more characters, switching and
editing can be reached only from the console with `?debug`, as
`game.characters`, for now.

## Races

Each race has a maximum age at creation. Every race gives +3 to each
attribute.

| Race | Maximum age | |
|---|---|---|
| Human | 110 | The most common race of Cerrith, flexible and adaptive. |
| Elf | 210 | Long-eared, long-lived hunters of the forests, often gifted in magic. |
| Orc | 90 | Made by Arcanum experiments on humans; proud, strong and often nomadic. |
| Goblin | 90 | Green-skinned, communal, swift and cunning. |
| Dwarf | 160 | Rare since the Cataclysm; short, strong mountain labourers. |
| Dryad | 210 | A blend of human and plant, at home where elemental magic is strong. |
| Oseni | 160 | Red-skinned natives of the Fire Plane, a caste-bound warrior people. |

The full two-line descriptions are in `src/character/catalog.js`.

## Classes

Archer, Bard, Warrior, Paladin, Guardian, Mage and Musketeer. A character
has exactly one. For now the class is identity only: every class carries
the same sword, bow and runes.

## Attributes

Strength, dexterity, constitution, intelligence, wisdom and charisma. A new
character spends exactly 12 points on ranks. Ranks are bought in order, and
the n-th rank of one attribute costs 2^(n-1) points:

| Rank | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Cost of that rank | 1 | 2 | 4 | 8 |
| Total spent | 1 | 3 | 7 | 15 |

So 12 points reach rank 3 at most. Each rank adds 1. An attribute's total is
the race bonus plus the ranks (plus trait modifiers, once traits exist), and
never below 0. Attributes have no effect on play yet.

## Name and gender

A name starts with a letter in any alphabet, followed by letters, combining
marks, spaces, apostrophes, hyphens and full stops. It is 3 to 24 letters
long after trimming, counted as a reader sees them, so `ë` or a letter with
an accent mark is one. Browsers without `Intl.Segmenter` count combining
marks, emoji, flags, Indic conjuncts and Hangul the same way. Curly apostrophes (as phones type them) become
straight ones, and names are stored in composed Unicode form (NFC), so
"Zoë" typed two ways is the same name. No two of the player's characters
may share a name, ignoring case.

Gender is Male, Female, Other or unset (shown as "Unset").

Lobbies use the same rule. A page joins under its active character's name,
and the lobby server checks it again with this rule (dropping control and
format characters first), so a name in any alphabet joins as it is written;
any other name joins as Wanderer. Names another player's page receives are
shown as the server sent them, as text.

## The realm calendar, age and birthday

The realm year is the real year less 1647, so 2026 is 379 AE. Dates keep the
real day and month and are shown as `DD.MM.YYYY AE`, for example
`02.10.351 AE`. "Today" is the player's local date. Real leap years never
fall on realm leap years, so a real 29 February is 28 February in the realm.

The sheet stores a birthday, not an age, so characters grow older in real
time. A character is made at an age from 18 to the race's maximum. Choosing
an age picks a birthday that gives it: the day within that year-long window
comes from an FNV-1a 32-bit hash of `<character id>:<age>`, so the same age
always gives the same birthday. A typed birthday (`DD.MM.YYYY` or
`DD/MM/YYYY`) is accepted when it is a real date and gives an age in range.
Someone born on 29 February turns a year older on 1 March in other years.

A character who has aged past the race's maximum keeps their age. The
maximum applies only when the character is made or the age is changed.

## Description and clues

The description is 32 to 256 characters after trimming.

Clues are how others recognise the character: looks, smell, habits. A
character needs at least 2 (evil characters will need 4, once evil traits
exist) and may have at most 10. Each is 12 to 48 characters after trimming,
and no clue may repeat another, ignoring case. Clues are checked one at a
time in the order written, and the first problem found is the one reported.

## Change locks

Some choices close a while after the character is made, counted from its
creation:

| Field | Can change for |
|---|---|
| Race | 24 hours |
| Class, age (and so the birthday), attributes | 5 days |
| Name, gender, description, clues, skin | always |

A change is checked only against the rules of the fields it changes.

## The creator

The creator makes a character a page at a time, in a panel beside the live
world: Welcome, Character creation, then Name, Class, Race, Age, Attributes,
Description, Clues, Skin and a Summary. Info pages have Continue only. The
eight steps show "Step n of 8", and Next stays dimmed until the step passes
its rule, whose message shows under it. A race dresses the outlaw in its
skin tone until the player picks a tone on the Skin step. The age starts at 18, and a typed age or birthday must be valid before
Next. A race changed later keeps the age, so the Age step and the Summary's
final check of every step report an age past the new maximum.

The Description step counts the trimmed text against 32 to 256 characters,
takes one paragraph (Enter continues) and offers an optional gender. Clues
are added one at a time with **Add**, each checked as it is added, and
removed with **Remove**; at ten the field closes. While a clue is typed,
Enter, a phone keyboard's Done and Next all add it instead of moving on.
Screen readers read each count with its field and announce it once typing
pauses.

The Skin step is optional and always passes. It offers the six
[presets](#skins), a swatch group for each region (the legend names the
pick, marked `[ ]`) and the **Hood up**, **Jerkin** and **Cloak** switches.
Every pick repaints the outlaw at once; an outfit that matches no preset
reads "Custom". While the skin tone or hair is picked the preview lowers the
hood, so the face shows; the saved skin keeps its own hood. Below the
outlaw, on every page, **‹** and **›** turn it an eighth of a turn, and a
drag across the free area around it turns it a degree per pixel, its feet
planted where it stands. Play starts facing the way it was turned.

The Summary lists every row, the skin as its preset (or Custom), tone, hair
and any layers off, with an **Edit** that opens its step and comes
back with **Save and review**. It checks every step again: failing steps are
listed with **Review** links and block **Create character**, as does a
roster that can't take a character now (the cooldown shows when it opens).
Create saves the character, makes it active and starts play in the same
tap: sound starts, and phones go full screen and keep the screen awake.

Start-up opens the creator instead of play while the roster is empty and a
character can be made; `?creator` always opens it, and `?nocreator` or
`?nogate` never do. While it is open the camera zooms in and frames the
outlaw beside the desktop and landscape panel, or above the portrait sheet,
and comes back afterwards (it snaps with reduced motion). Trees, rocks and
ruins in front of the outlaw that would hide it are left out until play
starts, wherever it stands, since the player can't step clear. On phones the
panel keeps above the on-screen keyboard. The rest of the screen is inert,
every key stays in the panel (Esc doesn't close it), monsters and animals
hold still, nothing can hurt the player, and a lobby join waits for Create.
If the new character couldn't be saved, that join is dropped with a notice:
a lobby on another world reloads the page, which would lose it.
A draft isn't saved: a reload starts again.

## The character menu

The inventory has page tabs: **Inventory** and **Character**. With the
inventory open, `C` turns to the next page, and the arrow keys, Home and End
move along the focused tabs. On phones the menu's Inventory row reaches them.

The **Character** page shows the active character's sheet: name, gender,
age, birthday, race (in its colour), description, class, the six attribute
totals with the race's bonus, and the clues. Under the race, class, age and
attributes a note says when the choice locks ("Locks in 3d 4h") or since
when it has been locked ("Locked since" the date). A `?name=` visit says the
name it shows instead. In a lobby the page says that a new name or character
shows to the others at the next join, and a roster that can't save says why.
With no character (say with `?nocreator` on a fresh profile) it reads "You
have no character yet."

A change another tab saves to the roster shows here at once: the name in the
HUD, over the outlaw and in the inventory, the skin and the Character page.

## The roster

Characters are saved in `localStorage` under `ascii-realm-characters`, as a
versioned record (`v: 1`) of up to three characters and the active one's
id. Each character has an id, its creation time, the time it was last
switched to, the sheet and a skin slot (empty, meaning today's outfit). A
skin is repaired by `cleanSkin` whenever it is stored or read, so a stored
skin is always well formed.

- **Switching** the active character is allowed 4 days after the last
  switch. `?debug` skips the wait.
- **Creating** a character makes it active, so once a character exists, a
  new one counts as a switch and waits for the same cooldown. A fourth
  character is refused.
- **Storage that fails** (private browsing, a full disk) is ignored: the
  characters last for the visit, and the next write that works saves every
  change made meanwhile. Before that write the roster reads the record
  again. If another tab saved meanwhile, the characters changed here replace
  their stored copies and the rest are kept. If the two no longer fit (a
  name taken or the slots full), nothing is written and the changes stay for
  the visit. `saveError` says why changes aren't being saved.
- **A corrupt record** gives an empty roster. A character that is broken
  beyond repair is dropped; one that only breaks a rule (say, after a rule
  change) is kept and reported when it is next edited.
- **A record from a newer version** of the game is left untouched and the
  roster refuses changes, rather than overwrite it, even when it is saved
  while this tab's writes are failing.
- **Other tabs:** the roster re-reads the record before each change and when
  another tab saves, so changes made one after another in several tabs all
  survive. Two tabs changing at the same instant can lose one change: the
  last write wins.
- **The old lobby name** (`ascii-realm-name`) is offered as the first
  character's name if it is a valid name. Nothing writes or deletes it any
  more: the lobby form that saved it is gone.

Times come from the device clock, so changing the clock moves the locks and
the cooldown.

## Skins

A skin is how the character's outlaw looks. Like a skin on a fixed player
model it repaints the outlaw's existing regions and never changes the model,
its proportions, its animations, its stride or how its feet plant. Both the
rigged outlaw and the shape-built figure (the inventory portrait, friends,
and the stand-in shown before the model loads) are painted from the same
skin (`src/character/skin.js`).

| Layer | Regions |
|---|---|
| Base | skin tone, hair, shirt (linen), hose |
| Outer | hood, jerkin, tunic sleeves, bracers and gloves, boots, cloak |

The hood, the jerkin and the cloak can each be taken off, like a player
model's skin-part switches, and the base layer shows beneath: hood down
shows the face and cropped hair instead of the hood and its shoulder cape,
jerkin off shows the linen shirt on the body and sleeves, and cloak off
leaves the back bare. The gloves take the bracers' colour and the boot cuffs
the boots'; the belt, pouch, scabbard and grips stay plain leather. Under a
raised hood the rigged outlaw's face is in shadow, so the skin tone shows
with the hood down, or on the jaw of the shape-built figure.

Each region takes a colour from a small palette:

| Palette | Regions | Swatches |
|---|---|---|
| Tones | skin tone | fair, weathered, tan, deep, dark, olive, fern, sage, ember, rust |
| Hair | hair | umber, black, chestnut, auburn, flax, grey, white |
| Linen | shirt | undyed, oat, grey, dun |
| Wool | hose, hood, sleeves, cloak | ash, charcoal, umber, pewter, Lincoln green, moss, peat, night, oxblood, heather |
| Leather | jerkin, bracers, boots | tan, saddle, brown, dark, black, russet, grey |

No outer-layer colour, the gloves, cuffs and cloak lining included, is
brighter (Rec. 709 luma) than 1.25 times today's hood, so the outlaw still
reads as a dark shadow against the grass; a test checks every swatch. The
base layer may be lighter, as today's linen already is.

Orcs and goblins start with the green olive and fern tones, dryads with
sage and the Oseni with the red ember (`toneForRace`); the player may change
it.

Six presets are starting points: **Outlaw** (today's look, the default),
**Greenwood**, **Nightrunner**, **Drover** (hood down), **Pilgrim** and
**Reaver** (no cloak). A preset sets the outfit and layers and keeps the
character's tone and hair.

A character with no saved skin wears today's outlaw, exactly as before
skins. For now friends in a lobby see everyone as today's outlaw: skins are
not sent to other players yet. With `?debug`, `game.setSkin('drover')` or
`game.setSkin({ tone: 'olive', layers: { hood: false } })` dresses the
outlaw for a screenshot without saving it, and `game.skins` lists the
presets and palettes.

A skin is saved as a record with its own version, `v: 1`, one swatch id per
region and the three layer switches. A swatch id that isn't known, a value
of the wrong type or a missing field takes the default for that field
alone, and unknown keys are dropped. A later change to skins that an older
version of the game can't read back without losing something (more skins
per character, or a new required field) must raise the roster's version
and add a migration, so older versions leave the record alone rather than
drop data. New swatch ids need no new version only if an older version
resetting them to the default is acceptable.
