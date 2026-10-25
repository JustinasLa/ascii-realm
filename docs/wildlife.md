# Wildlife

Deer and rabbits live on the land round the player. They graze, stroll and
watch, and they run from the player, friends and monsters, and from loud
noises. They can be hunted for hide, meat and bone.

## Where they live

The world is divided into regions 8 chunks across and 2 chunks down, about
24 m by 20 m. The seed decides whether each region holds a deer herd, a
group of rabbits or nothing. The chance depends on the region's habitat,
which is read from the same forest field that places the trees. The region
is sampled at nine points and takes the most common kind of land:

| Habitat | Forest field | Deer herd | Rabbits |
|---|---|---|---|
| Meadow | up to 0.42 | 25 % | 35 % of the rest |
| Forest edge | 0.42 to 0.54 | 30 % | 12 % of the rest |
| Woodland | above 0.54 | 12 % | none |
| Water | more than 4 of 9 samples in a lake, on a shore or in a river | none | none |

A region holds one group at most: 2 to 4 deer, or 2 to 3 rabbits. In a deer
herd there is a 35 % chance that a stag leads it; the rest are hinds. The habitat
comes from the seed alone (terrain noise and river lines), so a region rolls
the same group every time, whichever chunks happen to be loaded.

A region's group appears when its home lies 12 to 48 m from the player.
Every animal is placed off screen, on loaded, open and dry ground (rabbits
also keep off the shore), so animals never appear in view and spawning never
generates land. A group is let go once every member is more than 64 m from
the player. Its region then rests for 30 seconds, and after that the group
can appear at its home again. Nothing about animals is saved.

At most 10 animals live at once: no more than 8 deer and 6 rabbits. A group
that doesn't fit waits and tries again. At most 6 animals are drawn (4 on
phones), the nearest first.

## How they behave

Calm animals take turns to stand, graze and stroll:

- **Standing** lasts 3 to 9 seconds for deer (2 to 6 for rabbits). Now and then a deer looks round.
- **Grazing**: deer graze for 6 to 14 seconds with their heads down and lift
  them every few seconds to look about. Rabbits sit and nibble.
- **Strolling**: deer walk 3 to 8 m to an open, dry spot; rabbits lope 0.6
  to 2.5 m in short bursts with pauses between. A member that falls more than 6 m
  behind its leader (4 m for rabbits) heads back to it. Herd mates keep a
  little room between them.

Animals shy from the player, friends and living monsters:

| | Deer | Rabbits |
|---|---|---|
| Looks up at something moving within | 10 m | 7 m |
| Bolts from anything within | 5 m | 3.5 m |
| Bolts from a runner within | 9 m | 6 m |
| Hears noises within | 30 m | 18 m |

Something standing still is noticed only at half the distance, which is
already close enough to bolt. A watching animal stops and turns to face the
threat. If the threat comes no
closer for 4 seconds, it goes back to what it was doing.

**Deer bolt together.** The first to bolt sets the herd's line of flight,
away from the threat and toward open, dry ground. The others follow within
0.1 to 0.4 seconds each, so the alarm ripples through the herd. They gallop at
5.8 m/s, half again as fast as the player's run, for 4 to 7 seconds, or until
they are 30 m clear. Then they slow to a trot, walk and stand. For 10 seconds
afterwards they settle, noticing things only at half the usual distance. A fleeing deer will wade a shallow stream, and
the current carries it downstream as it does the player. Calm deer never
enter water.

**Rabbits scatter.** Each rabbit in a group runs its own way, about 60° apart,
and jinks every 0.4 to 0.8 seconds while still heading away. It runs at
4 m/s for 2 to 4 seconds, or until it is 16 m clear, then freezes, sitting
upright on guard for 2 to 4 seconds, before it settles. Rabbits never go
onto water or the shore.

## Noises

Loud noises make animals bolt from where the noise came from. Animals up to
twice as far away look toward it.

| Noise | Heard within |
|---|---|
| A sword cut | 20 m |
| A slam, spin or heavy landing | 30 m |
| A monster or animal hurt or slain | 20 m |
| An arrow or spear landing | 4 m |
| A rune being cast | 30 m |
| A rune's impact | 40 m |
| Lightning, from the sky or a rune | 60 m |
| A sprinting footstep | 10 m |

An animal never hears farther than its own range (30 m for deer, 18 m for
rabbits).

## Hunting

Sword cuts, arrows, thrown spears and javelins all wound animals. Spells
scare them but don't wound them yet.

| | Deer (hind or stag) | Rabbit |
|---|---|---|
| Health | 40 | 3 |
| Drops | Deer Hide 1–2 (80 %), Raw Venison 1–2 (90 %), Bone 1 (50 %) | Raw Rabbit 1–2 (20 %) |
| Body lies for | 20 s, then sinks over 2.5 s | 8 s, then sinks over 1.5 s |

**Hits.** A sword cut hits an animal in the weapon's reach in front of the
player (all round for a spin), as it does monsters, and does the same damage.
An arrow, spear or javelin strikes the first animal whose body it passes,
up to the top of its back and head (1.6 m for deer, 0.45 m for rabbits). Its damage
grows with the draw, from 35 % of the weapon's damage at the weakest to all
of it at full draw: the longbow does 8 to 22. Two full-draw arrows bring down a
deer, and any arrow brings down a rabbit. An arrow that strikes is used up.
A thrown spear or javelin drops at the animal's feet, to be picked up again.
On touch screens, STRIKE turns toward the nearest animal ahead as well as
toward monsters, for the sword and for the bow's aim.

After a hit an animal is hurt for 0.5 s. In that time another blow lands
only if it is harder than the last, and then only by the difference.

**Wounded.** A struck deer flinches: it stands for 0.35 s in the hit
reaction for the side the blow came from, turning toward it, then bolts away
from whoever struck it. The herd follows, as for any bolt. A deer already in flight
keeps running, for at least 4 s more. A struck rabbit bolts at once. The
body flashes white for a moment on each hit, and the damage shows as a number.
A wounded animal isn't slowed.

**Misses.** An arrow or spear landing within 4 m of an animal makes it
bolt; one landing within 8 m makes it look up.

**Death.** At 0 health the animal falls, playing its own death animation
once and holding the last pose (a rabbit then lies in its dead pose). The
rest of the herd runs from the killer. If the leader falls, the next member
leads. Bodies don't move, aren't frightened, don't push the fog and don't
take a place under the caps. They lie for a while and then sink into the
ground like fallen monsters.

**Drops** are rolled when the animal dies and laid at once, each stack on its
own spot of dry, open ground 1.2 to 3 m from where the animal stood, clear of
the fallen body, and reachable from it. A body in water drops its stacks on
the nearest bank within 3 m, or else beside the hunter. Stacks never land in water. The player picks them up by
walking over them, or with TAKE on touch screens, after half a second. A full
bag leaves them lying. Stacks are lost after 5 minutes. At most 48 lie about
at once, and past that the oldest go first. Raw meat has no use yet.

**Smaller herds.** Each region counts its kills for the session. When its
herd comes back, it is short of those it lost, and without a stag if the stag
was killed. A region whose whole herd was killed stays empty. Kills and drops
aren't saved.

Hunt drops are kept apart from other loose items on the ground. When loose
items get a shared store, the drops can move into it.

## Looks

Deer, stags and rabbits are rigged models that play their own animations
(standing, looking, grazing, walking, galloping and running, flinching and
falling, and for rabbits sitting, guarding and lying dead). Like the player and the monsters, they are rendered
from the game's camera and turned into character cells with an outlined
silhouette. Animals are drawn a little dimmer than monsters, so the player
stays the brightest thing on screen. A gait's animation speeds up with the
animal's pace, so the hooves and paws stay planted. Each animal casts a long
shadow, pushes the ground fog aside, shows in the water's reflections, and
breaks the surface where its legs wade. The models and their licences are
listed in [credits](credits.md).

## URL parameters

| Parameter | Effect |
|---|---|
| `?deer=N` | at most N deer at once (0 to 8, default 8) |
| `?rabbits=N` | at most N rabbits at once (0 to 8, default 6) |
| `?animals=0` | no wildlife at all |

With `?debug`, `game.animals` lists the animals (`list`) and herds
(`herds`). `game.animals.spawn('deer' | 'rabbit', { x, y, count, variant })`
places a group at once, wherever asked, and keeps it however far the player
goes. `game.animals.calm()` settles every animal. `game.animals.hurt(i, damage)`
deals a blow (lethal by default) to the animal at index `i`, and
`game.huntDrops.all()` lists the stacks lying about.

## Multiplayer

Wildlife is simulated by each player's game, like monsters. Everyone in a
lobby shares the seed, so herds start in the same places, but their
movement isn't synchronised. Hunting is local too: a kill and its drops
happen only in the hunter's game.
