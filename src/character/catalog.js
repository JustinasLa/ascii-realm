// The character sheet's fixed choices and numbers: races, classes,
// attributes, genders and every limit the rules check. Plain frozen data, so
// the creator, the character menu, the docs and the lobby server can all
// read the same values.

const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

// Each race gives the same bonus to every attribute for now.
const RACE_BONUS = 3;

// Races in the order the creator shows them. `maxAge` caps the age a
// character can be made at; `colour` tints the race's name.
export const RACES = Object.freeze([
  { id: 'human', name: 'Human', colour: '#ffffff', maxAge: 110, lines: [
    'The most common race of Cerrith, found in every corner of the world.',
    'Flexible and adaptive, humans can turn their hand to any task well.'] },
  { id: 'elf', name: 'Elf', colour: '#5682f2', maxAge: 210, lines: [
    'Known for their beauty and long ears; they live twice as long as humans.',
    'Great hunters of the forests of Cerrith, often gifted in magic.'] },
  { id: 'orc', name: 'Orc', colour: '#87d65c', maxAge: 90, lines: [
    'Made by Arcanum experiments on humans; long enslaved, most now live free.',
    'A proud, often nomadic race known for their strength and greenish skin.'] },
  { id: 'goblin', name: 'Goblin', colour: '#87d65c', maxAge: 90, lines: [
    'Greenish skin from harsh lands; proud, communal and close to their kin.',
    'Known for their swiftness and cunning, and thought greedy and deceitful.'] },
  { id: 'dwarf', name: 'Dwarf', colour: '#c9a24f', maxAge: 160, lines: [
    'Rare since the Cataclysm nearly wiped them out; short, strong and bearded.',
    'Industrious mountain labourers who live in great underground cities.'] },
  { id: 'dryad', name: 'Dryad', colour: '#87d65c', maxAge: 210, lines: [
    'A rare blend of human and plant, each in harmony with a natural biome.',
    'Found where elemental magic is strong; peaceful and magically connected.'] },
  { id: 'oseni', name: 'Oseni', colour: '#d65c5c', maxAge: 160, lines: [
    'Red-skinned natives of the Fire Plane who stayed after invading Cerrith.',
    'A rigid caste-bound warrior people, often shunned and outlawed in Solmyrith.'] },
].map((race) => Object.freeze({ ...race, lines: Object.freeze(race.lines) })));

// The six attributes, in sheet order.
export const ATTRIBUTES = Object.freeze(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']);
export const ATTRIBUTE_NAMES = Object.freeze({ strength: 'Strength', dexterity: 'Dexterity',
  constitution: 'Constitution', intelligence: 'Intelligence', wisdom: 'Wisdom', charisma: 'Charisma' });

// What a race adds to each attribute.
export const raceBonus = () => Object.freeze(Object.fromEntries(ATTRIBUTES.map((key) => [key, RACE_BONUS])));

// Classes, one per character. For now a class is who the character is, not
// what they can wield.
export const CLASSES = Object.freeze([
  { id: 'archer', name: 'Archer', line: 'Deadly marksmen who deal steady damage from a distance and keep a safe position.' },
  { id: 'bard', name: 'Bard', line: 'Charismatic musicians who channel mana through music to bless allies and slow enemies.' },
  { id: 'warrior', name: 'Warrior', line: 'Mobile fighters who mix attacks and flexible skills to deal heavy damage at the front.' },
  { id: 'paladin', name: 'Paladin', line: 'Resolute soldiers who strengthen themselves and protect others, as duellists or support.' },
  { id: 'guardian', name: 'Guardian', line: 'Unyielding defenders who draw attention, absorb damage and push enemies around.' },
  { id: 'mage', name: 'Mage', line: 'The hardest path: mages build their own weapons from parts and cast spells from runes.' },
  { id: 'musketeer', name: 'Musketeer', line: 'Experts in guns and gadgets who build firearms to order, many of which pierce armour.' },
].map((entry) => Object.freeze(entry)));

// Gender is optional; a sheet without one shows `UNSET`.
export const GENDERS = Object.freeze([
  { id: 'male', name: 'Male' }, { id: 'female', name: 'Female' }, { id: 'other', name: 'Other' },
].map((entry) => Object.freeze(entry)));
export const UNSET = 'Unset';

export const raceOf = (id) => RACES.find((race) => race.id === id) ?? null;
export const classOf = (id) => CLASSES.find((entry) => entry.id === id) ?? null;
export const genderOf = (id) => GENDERS.find((entry) => entry.id === id) ?? null;

// Every number the rules use. Locks count from the character's creation;
// fields without a lock can always change.
export const RULES = Object.freeze({
  pool: 12, maxRank: 4, raceBonus: RACE_BONUS,
  minAge: 18,
  name: Object.freeze({ min: 3, max: 24 }),
  description: Object.freeze({ min: 32, max: 256 }),
  clues: Object.freeze({ min: 12, max: 48, most: 10, needed: 2, neededEvil: 4 }),
  slots: 3,
  switchCooldownMs: 4 * DAY,
  locks: Object.freeze({ race: DAY, class: 5 * DAY, age: 5 * DAY, attributes: 5 * DAY }),
});
