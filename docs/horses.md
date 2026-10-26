# Horses

A first look at horses: a saddled horse with a rider sitting it, standing
idle. There is no mounting, riding or travel yet, so horses don't appear in
the world unless asked for.

## What you see

- **The horse** is a rigged model playing its own idle: it breathes and
  swishes its tail, and every 8 to 20 seconds it shifts its weight and paws
  the ground once with a hind hoof. A horse being ridden never puts its head down to graze. The top of
  its back, where the saddle sits, stands 1.5 m high and its withers about
  1.6 m, a riding horse of 15 to 16 hands. It is 2.4 m from nose to rump.
- **The rider** is a stand-in dressed as a fresh outlaw: hood, cloak (taken
  up so it ends at the saddle) and the short sword at the hip. From the waist
  up they play the outlaw's own seated idle, breathing and shifting as they
  sit. Their legs are set astride the barrel with the feet resting level in
  the stirrups. The seat and the stirrups ride on the horse's back, so the
  rider moves with the horse's idle and the two always face the same way.
- Horse and rider stand on the horse's lowest hoof, cast one long shadow,
  push the ground fog aside and show in the water's reflections.
- **Grass** layers through the horse as it does round any figure. A horse is
  long, so it is drawn in bands, one for each ground row under it: grass
  rooted in front of the front hooves covers them, grass growing between the
  legs hides the hind hooves but not the front legs, and the rider's boots
  layer with the horse's barrel. The rider's own cells stand on the ground
  rows under the seat, so someone standing beside the horse is in front of
  or behind the rider as they are in front of or behind the saddle.
- Horses are drawn like the animals, a little dimmer than the player, so the
  player stays the brightest figure on screen. At most 4 are drawn (2 on
  phones), the nearest the player first; any others stand unseen.
- A horse with no rider shows no rider: it is drawn, shadowed and layered
  as the horse alone.
- A horse costs about what a deer does to draw. The rider is drawn from a
  coarser copy of the outlaw's body, which is never seen at a size where
  the difference shows, and horse and rider are each drawn in one go. A
  horse that has moved less than a pixel since it was last drawn keeps the
  cells it had.

The player walks through a horse, as through a deer. The rider is the
outlaw's figure until riding arrives, when the player takes the seat.

## URL parameters

| Parameter | Effect |
|---|---|
| `?horse=N` | stands N saddled horses by the spawn (0 to 4, default 0): the first 4 m east of it, each next 3.5 m further south-east, each a quarter turn round from the last |

With `?debug`, `game.horses.spawn({ x, y, heading, rider })` stands a horse
on the dry land nearest the point within 6 m (none out on a lake). `heading`
is in radians, 0 facing the camera and a quarter turn facing right; with
`rider: false` the horse stands bare, and now and then grazes.
`game.horses.list` lists them, and `game.horseFigures.flat = true` draws
each horse in one band at its hooves' row instead of banding it, for
comparison.

The horse model and its licence are listed in [credits](credits.md).

## Multiplayer

Horses are local to each player's game, like wildlife.
