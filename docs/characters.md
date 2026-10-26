# Characters

A character sheet describes who the player is: name, gender, race, age and
birthday, class, attributes, description and clues. Each browser keeps up
to three characters, one of them active. The rules and the saved roster
live in `src/character/`. Nothing in play uses them yet: the outlaw, the HUD
name and the lobby name are unchanged, and the roster can be reached only
from the console with `?debug`, as `game.characters`.

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
an accent mark is one. Curly apostrophes (as phones type them) become
straight ones, and names are stored in composed Unicode form (NFC), so
"Zoë" typed two ways is the same name. No two of the player's characters
may share a name, ignoring case.

Gender is Male, Female, Other or unset (shown as "Unset").

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

## The roster

Characters are saved in `localStorage` under `ascii-realm-characters`, as a
versioned record (`v: 1`) of up to three characters and the active one's
id. Each character has an id, its creation time, the time it was last
switched to, the sheet and a skin slot (empty, meaning today's outfit).

- **Switching** the active character is allowed 4 days after the last
  switch. `?debug` skips the wait.
- **Creating** a character makes it active, so once a character exists, a
  new one counts as a switch and waits for the same cooldown. A fourth
  character is refused.
- **Storage that fails** (private browsing, a full disk) is ignored: the
  characters last for the visit, and the next write that works saves every
  change made meanwhile.
- **A corrupt record** gives an empty roster. A character that is broken
  beyond repair is dropped; one that only breaks a rule (say, after a rule
  change) is kept and reported when it is next edited.
- **A record from a newer version** of the game is left untouched and the
  roster refuses changes, rather than overwrite it.
- **Other tabs:** the roster re-reads the record before each change and when
  another tab saves, so changes made one after another in several tabs all
  survive. Two tabs changing at the same instant can lose one change: the
  last write wins.
- **The old lobby name** (`ascii-realm-name`) is offered as the first
  character's name if it is a valid name. The roster never writes or
  deletes it.

Times come from the device clock, so changing the clock moves the locks and
the cooldown.
