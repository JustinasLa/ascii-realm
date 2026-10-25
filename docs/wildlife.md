# Wildlife

Deer and rabbits live on the land round the player. They graze, stroll and
watch, and they run from the player, friends, monsters and wolves, and from
loud noises. They can be hunted for hide, meat and bone. Wolf packs roam the
woods and forest edges, hunting the deer, the rabbits and the player. Flocks
of wood pigeons feed in the meadows and lift off as you come near, and fish
swim in the lakes and dart away from you.

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
that doesn't fit waits and tries again.

## How they behave

Calm animals take turns to stand, graze and stroll:

- **Standing** lasts 3 to 9 seconds for deer (2 to 6 for rabbits). Now and then a deer looks round.
- **Grazing**: deer graze for 6 to 14 seconds with their heads down and lift
  them every few seconds to look about. Rabbits sit and nibble.
- **Strolling**: deer walk 3 to 8 m to an open, dry spot; rabbits lope 0.6
  to 2.5 m in short bursts with pauses between. A member that falls more than 6 m
  behind its leader (4 m for rabbits) heads back to it. Herd mates keep a
  little room between them.

Animals shy from the player, friends, living monsters and wolves:

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
5.8 m/s, a little faster than the player's run, for 4 to 7 seconds, or until
they are 30 m clear. Then they slow to a trot, walk and stand. A deer that
keeps bolting, with wolves on its heels, tires after 6 seconds of flat-out
running to three quarters of its pace, and gets its breath back at half the
rate it lost it. For 10 seconds
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
rabbits, 30 m for birds and 12 m for fish, as water dulls sound). Birds take
off from an arrow or spear landing within 6 m.

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

## Wolves

Wolves hunt in packs of 2 to 4. The game's wolves come after the player as
well as the deer and rabbits.

### Where packs live

Packs have their own regions, each 2 by 2 animal regions (about 47 m by
39 m). A pack region takes the most common habitat of its four regions;
regions of water don't count, and three or more of them leave no pack.

| Habitat | Pack |
|---|---|
| Meadow | none |
| Forest edge | 20 % |
| Woodland | 25 % |

A pack appears like a herd: its home 12 to 48 m away, every wolf off screen
on loaded, open, dry ground, and a 30 s rest for a region after its pack is
let go. Only one pack lives at a time, with at most 4 wolves (`?wolves=N`).
Wolves don't count toward the 10 prey animals. A pack isn't let go while it
is after the player and any wolf is within 64 m. A pack that has run off is
let go as soon as it is out of view and more than 30 m away.

### The hunt

- **Roaming.** The leader strolls to spots within 20 m of home and the rest
  follow. Wolves stand, look round and walk; they never graze.
- **Choosing.** A pack takes the player within 20 m of any wolf, or a deer or
  rabbit within 24 m. A rabbit counts as a fifth nearer than it is. The
  player within 12 m wins over any prey.
- **Stalking.** The wolves walk in at 0.8 m/s, side by side, heads held low.
  At 9 m from the player they **surround** them. At 9 m from prey, or when
  the prey bolts, they **chase**. A stalk lasts 12 s at most.
- **Surrounding.** Each wolf takes a place on a ring 4.5 m round the player,
  in the order they stand round them, starting from the far side. Wolves far
  from their place run round the ring to it, and wait there snarling. Once
  every wolf is in place, or after 4 s, the pack **hunts**.
- **Hunting.** The ring turns slowly round the player (0.35 rad/s). Two
  wolves at most go in at once, the one most nearly behind the player first;
  with nobody behind for 2.5 s, any wolf may go. A wolf runs in, bites,
  and skips back to its place.
- **Chasing.** A player running faster than a brisk walk and out past the
  ring is chased by the whole pack, at 6.4 m/s, faster than the player's
  sprint and a bolting deer. Once the player stops, the ring forms again.
  Fleeing prey is run down to the end, every wolf in reach biting.
- **Feeding.** When the pack's prey dies, every wolf eats at the body for
  15 s, which lies at least 17 s, and the pack makes its home there. A player
  who comes within 8 m of a feeding pack is surrounded at once.
- **Giving up.** A pack drops its quarry when it gets more than 32 m from
  every wolf, after a 12 s chase of the player (25 s for prey) without a bite
  landing, or when chasing the player leads it more than 55 m from home. It
  then takes nothing new for 10 s as it heads home.

Deer and rabbits fear wolves as they fear the player: a stalking wolf is
noticed at 10 m and bolted from at 5 m; a running one is bolted from at 9 m.

### The bite

A bite takes 1 s. The wolf turns toward its quarry as it winds up, then
commits, lunging in. Its jaws close 0.29 s in, the moment the clip's muzzle
reaches furthest forward. The bite lands once if the quarry is still within
1.5 m (plus the prey's body) and within about 57° of the wolf's heading.
Like a monster's blow, it misses a player in the air: jump or roll over it.

- On the player it does **10** damage, with a screen shake and a thud.
- On prey it does 12: a deer takes four bites, a rabbit one. A deer bitten
  bolts as when struck.

A wolf waits 1.4 s after a bite before the next. Four wolves against a
player standing still deal about 5 to 6 health a second.

### Fighting back

The sword, arrows, spears and javelins wound wolves as they do deer.

| | Wolf |
|---|---|
| Health | 40: two sword cuts or two full-draw arrows |
| Drops | Wolf Pelt 1 (80 %), Bone 1 (50 %) |
| Body lies for | 20 s, then sinks over 2.5 s |

- A struck wolf flinches for 0.25 s, standing still. A bite it was winding up
  is lost, so a well-timed cut stops a lunge.
- Any hit from the player sets the whole pack on them at once, past the
  stalk, even from range.
- Below half health a wolf slinks off, running away for 3 to 5 s, then
  rejoins the ring. It does this once.
- When half the pack is dead, or the leader with two or fewer left, the pack
  runs from the player for 8 s. For 90 s after that, a pack from that region
  leaves the player alone unless struck, even after it has been let go and
  come back.
- Each region's pack comes back short of the wolves killed this session.
- A sword cut's noise doesn't scare wolves off. A wolf's hurt and death cries
  are heard by other animals.
- "Wolf slain" shows when one dies. Animals killed by wolves drop nothing.
- When the player is struck down, packs let them be and go home.

Spells don't wound wolves yet.

### Water and ground

Wolves cross shallow water only on the hunt, in a chase, running off or
slinking off hurt; roaming, stalking or feeding, they keep out of it. A wolf
in the water when the hunt ends wades to the nearest bank. Like other
animals, wolves never step onto land that isn't loaded.

Wolves and monsters ignore each other.

## Birds

Flocks of 3 to 6 wood pigeons feed on the ground. Each region may hold a
flock as well as a herd, rolled from the seed on its own: 35 % in a meadow,
25 % at the forest edge, 8 % in woodland and none on water. Flocks appear and
are let go by the same rules as herds (12 to 48 m off and out of view, on
loaded, open, dry ground off the shore; let go beyond 64 m, then a 30 s
rest), at most 2 flocks and 8 birds at once.

- **Feeding.** Birds never walk. They stand, bobbing their heads and looking
  about. Every 8 to 20 s one bird of the flock (never two at once) flutters
  0.6 to 3.5 m to a free spot near the others, rising off its feet on the
  takeoff and coming down on the landing.
- **Watching.** A threat moving within 9 m (4.5 m if it stands still) makes
  a bird face it for a few seconds.
- **Lift-off.** The player, a friend, a monster or a wolf within 6 m (10 m
  if running), a loud noise, or a shaft landing within 6 m puts the whole
  flock up: one bird rises, and the rest follow within a quarter of a
  second. Each plays its takeoff, leaves the ground part way through it and
  climbs at 2.4 m/s away from the threat.
- **Flight.** The flock picks open, dry ground 25 to 45 m off, within 60
  degrees of straight away, with room for every bird at least 0.5 m from the
  next, and flies there at about 8 m/s and 4 to 7 m up, each bird keeping its
  own place, apart from, along with and toward its neighbours. Birds flap
  while climbing or slow and glide at cruise, their bodies pitching with the
  climb. Near the spot they come down, each to its own place, usually within
  2 m (further along a narrow bank or round props), touching down as their
  landing animation does, and feed again. For 20 s after landing the flock's senses are halved. With no
  open ground in reach it flies on and away, and is let go once far off; it
  is back at home after the rest.
- A flying bird is drawn over trees and grass, mirrored in the lakes it
  crosses; its shadow fades out by 2 m up.

## Fish

Schools of 3 to 5 fish live in still lake water. A region rolls a school
(70 %) only if at least 3 of its 9 samples are lake rather than river, and
the school's home is the nearest spot to a seeded point that is open lake
water: at least 0.15 m deep, at least 0.6 m from anything else, with no
river line within a cell and no current. The search waits until every
chunk it reads is loaded, its search box plus the 0.6 m ring round each
spot in it, so a school's home is the same whatever order chunks load in.
Schools appear and are let go like herds, at most 2
schools and 8 fish at once.

- **Schooling.** The leader swims 1 to 5 m at a time to a spot it can reach
  in a straight line over open water, then pauses for 1 to 4 s; the others
  follow behind and beside it. Fish swim 0.08 to 0.3 m down, never within
  0.05 m of the bed, and never leave open lake water: a fish turned toward
  the shore or a river slides along the edge or stops.
- **Darting.** The player or a friend within 4 m (7 m if running, 6 m if
  wading), a shaft landing within 4 m, or a loud noise within 12 m sends the
  whole school darting apart, each fish on its own line away at 2.6 to
  3.6 m/s for up to 0.7 s. A shallow-swimming fish breaks the surface in a
  small ring three times in ten. They glide to a stop, hold still for 3 to
  6 s, then school again; the leader doesn't wander off for 6 s.
- Fish are drawn under the water: a soft smudge of marks with no outline,
  their colour sunk toward the water's the deeper they swim, shown only on
  plain water. The swell's marks, glints, lily pads, foam, rings,
  reflections and everything else on the surface stay over them.

Birds and fish can't be hunted or caught yet: arrows pass through them,
they are never a target, and they drop nothing.

## Looks

Deer, stags, rabbits and wolves are rigged models that play their own
animations (standing, looking, grazing, walking, galloping and running,
flinching and falling; for rabbits sitting, guarding and lying dead; for
wolves biting, eating and walking with the head low while stalking, the
head-low animation moving only the neck and head). Like the player and the monsters, they are rendered
from the game's camera and turned into character cells with an outlined
silhouette. Animals are drawn a little dimmer than monsters, so the player
stays the brightest thing on screen. A gait's animation speeds up with the
animal's pace, so the hooves and paws stay planted. Each animal casts a long
shadow, pushes the ground fog aside, shows in the water's reflections, and
breaks the surface where its legs wade. At most 6 animals are drawn (4 on
phones): first wolves within 25 m that are stalking, ringing, chasing or
biting, then animals in flight, then the nearest. The wood pigeon plays its
own standing idle, takeoff, flapping, gliding and landing; the fish plays
its swim, faster as it speeds up and fastest in a dart. Birds and fish have
their own cap of 8 drawn (4 on phones), so they never take an animal's
place: birds taking off or flying within 20 m first, then darting fish,
then the nearest. They are drawn in the same pass as the animals, and only
those drawn (or, on a desktop, just off screen) are posed each frame. The
models and their licences are listed in [credits](credits.md).

## URL parameters

| Parameter | Effect |
|---|---|
| `?deer=N` | at most N deer at once (0 to 8, default 8) |
| `?rabbits=N` | at most N rabbits at once (0 to 8, default 6) |
| `?wolves=N` | at most N wolves at once (0 to 8, default 4; one pack at most 4) |
| `?birds=N` | at most N birds at once (0 to 8, default 8) |
| `?fish=N` | at most N fish at once (0 to 8, default 8) |
| `?animals=0` | no wildlife at all, birds and fish included |

With `?debug`, `game.animals` lists the animals (`list`) and herds
(`herds`). `game.animals.spawn('deer' | 'rabbit' | 'wolf', { x, y, count, variant })`
places a group at once, wherever asked, and keeps it however far the player
goes. `game.animals.calm()` settles every animal. `game.animals.hurt(i, damage)`
deals a blow (lethal by default) to the animal at index `i`, and
`game.huntDrops.all()` lists the stacks lying about.
`game.animals.disengage()` calls every pack off.
`game.birds.spawn({ x, y, count, airborne })` places a flock (feeding on the
open ground there, or already in the air), and `game.fish.spawn({ x, y, count })`
a school on the open water nearest the point within 6 m; both use the game's
own world and keep their group however far the player goes. `game.birds.calm()` and `game.fish.calm()` settle them, and
`game.birds.list` and `game.fish.list` list them.

## Multiplayer

Wildlife is simulated by each player's game, like monsters. Everyone in a
lobby shares the seed, so herds start in the same places, but their
movement isn't synchronised. Hunting is local too: a kill and its drops
happen only in the hunter's game. Wolves hunt only the local player and
animals; a friend's figure is neither their quarry nor a threat to them.
