// Alloy forge ingredients, keyed by item id: type, value, tier, whether it can be
// the base, stats, required hits and crafting XP. The numbers are the game's own
// classic rules; Copper Ingot and Lapis Lazuli carry this game's defaults.
export const INGREDIENTS = Object.freeze({
  ironIngot: {
    type: 'metal', base: true, value: 2, tier: 1, names: 'metal', xp: 2,
    stats: { attackDamage: 3.5, bluntRating: 50, durability: 500 }, hits: { hit: 4, smallHit: 1 },
  },
  steelIngot: {
    type: 'metal', base: true, value: 4, tier: 2, names: 'metal', xp: 4,
    stats: { armour: 0.5, attackDamage: 4, bluntRating: 60, durability: 1000 }, hits: { hit: 5, smallHit: 2 },
  },
  bronzeIngot: {
    type: 'metal', base: true, value: 6, tier: 2, names: 'metal', xp: 5,
    stats: { armour: 0.75, attackDamage: 4.25, bluntRating: 65, durability: 1500 }, hits: { hit: 1, smallHit: 5 },
  },
  copperIngot: {
    type: 'metal', base: false, value: 2, tier: 1, names: 'metal', xp: null,
    stats: { attackDamage: 3, bluntRating: 40, durability: 250 }, hits: { hit: 2, smallHit: 2 },
  },
  rawTin: {
    type: 'crystal', base: false, value: 8, tier: 4, names: 'crystal', xp: null,
    stats: {
      durability: 30, projectileDamage: 0.5, physicalDamage: 0.5,
      projectileDamageReduction: 0.25, physicalDamageReduction: 0.25,
    },
    hits: { hit: 6, engrave: 4 },
  },
  lapisLazuli: {
    type: 'crystal', base: false, value: 2, tier: 1, names: 'crystal', xp: null,
    stats: { magicDamage: 2 }, hits: { smallHit: 3 },
  },
});
for (const ingredient of Object.values(INGREDIENTS)) {
  Object.freeze(ingredient.stats);
  Object.freeze(ingredient.hits);
  Object.freeze(ingredient);
}

export const TYPE_NAMES = Object.freeze({ metal: 'Metal', crystal: 'Crystal' });
// The catalyst types each base type takes.
export const COMBINATIONS = Object.freeze({ metal: Object.freeze(['metal', 'crystal']) });
// Discovery odds in %: base + perRootValue·√(total value) + the base's bonus, at most max.
export const ODDS = Object.freeze({ base: 2, perRootValue: 4, max: 85 });
export const BASE_BONUS = Object.freeze({ steelIngot: 8, bronzeIngot: 12 });
// A new alloy's stats stay within this factor of where each one started.
export const MAX_FACTOR = 1.2;
export const MAX_CATALYSTS = 4;

// The worked hit kinds; the family says which tools strike them.
export const HIT_KINDS = Object.freeze({
  hit: Object.freeze({ name: 'Hit', family: 'metal' }),
  smallHit: Object.freeze({ name: 'Small Hit', family: 'metal' }),
  etch: Object.freeze({ name: 'Etch', family: 'artisan' }),
  whittle: Object.freeze({ name: 'Whittle', family: 'artisan' }),
  engrave: Object.freeze({ name: 'Engrave', family: 'artisan' }),
  sew: Object.freeze({ name: 'Sew', family: 'other' }),
});

export const STAT_NAMES = Object.freeze({
  attackDamage: 'Attack Damage', bluntRating: 'Blunt Rating', durability: 'Durability', armour: 'Armour',
  physicalDamage: 'Physical Damage', projectileDamage: 'Projectile Damage', magicDamage: 'Magic Damage',
  physicalDamageReduction: 'Physical Damage Reduction', projectileDamageReduction: 'Projectile Damage Reduction',
});

// New alloys are named from their base's list first, then from the catalysts' lists.
export const ALLOY_NAMES = Object.freeze({
  metal: Object.freeze([
    'Ferranite', 'Blackiron', 'Bloodsteel', 'Ironshade', 'Grimcore', 'Starsteel', 'Vulcrite',
    'Dragonsmelt', 'Echosteel', 'Umbralloy', 'Abyssium', 'Tenebron', 'Nocturnite', 'Obscurium',
    'Celestium', 'Mythbane', 'Whitesilver', 'Lunathril', 'Ferrasteel', 'Ironclast', 'Steelcore',
    'Rustbane', 'Fabulite', 'Grayshard', 'Voidiron', 'Nethersteel', 'Blackcore', 'Ironveil',
    'Dreadmetal', 'Mythiron', 'Brightiron', 'Darksteel', 'Stygmetal', 'Abyssforge', 'Gloomiron',
    'Moonsteel', 'Gleamsteel', 'Mythsteel', 'Shinesilver', 'Shadowmyth', 'Aetherbound', 'Eclipsium',
  ]),
  crystal: Object.freeze([
    'Soulglass', 'Crystalflare', 'Voidshard', 'Frostgem', 'Sunshard', 'Stormcrystal', 'Shadowgem',
    'Flamequartz', 'Lunaglass', 'Embercryst', 'Brightshard', 'Nethercrystal', 'Skystone', 'Echoquartz',
    'Spiritshard', 'Mythcryst', 'Aetherglass', 'Mooncryst', 'Radiantcore', 'Darkgleam', 'Seastone',
    'Blazestone', 'Thundercryst', 'Bloodcrystal', 'Dreamshard', 'Celestite', 'Gloomgem', 'Crystalthorn',
    'Aurorite', 'Wraithcrystal', 'Glintstone', 'Phantomcore', 'Tideglass', 'Stormgem', 'Runestone',
    'Prismheart', 'Dreadcryst', 'Sunfang', 'Obsidianlight', 'Starcrystal',
  ]),
});

// The colours a new alloy is drawn in, shared by both name lists.
export const PALETTE = Object.freeze([
  'B0B3B5', '9DA3A6', '7E8C94', 'C2A583', '8C726A', '5F6B5F', '86918F',
  'D1C0A8', '6E777B', '9CA89A', 'C9BBA0', '758390', '918B84', 'A09C92',
  'B38D6E', '8FA8A3', '7A726F', '989C94', 'A98D83', '79858A', '879486',
  'BCB9AE', '9D7B6F', 'C4C1B7', '5E6568', 'A6B4AE', 'CBB99C', 'BBAEA5',
  '8F9A92', '716963', 'B7AA9C', '808B91', '9C948F', 'B3C2C0', '786A61',
  'AFA195', 'D4C4B4', '9CACA6', '675D57', '9098A0', '8B7F7A', 'DAD2C5',
  '889E9B', 'A77C63', '6D7875', 'B8B0AA', '9E8675', 'BFC9C8', 'A28E82',
]);
