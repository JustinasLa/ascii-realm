// The nine instruments as off-hand items, built from the instrument table so
// ids, names and ranges never drift apart.
import { INSTRUMENT_IDS, INSTRUMENTS, noteRange, secondLayer } from '../audio/instruments.js';

const CARRY = 'Carry it in the off hand to play.';

// glyph, ground glyph, colour, weight (kg), material tag, material, how it
// sounds, description.
const details = {
  accordion: ['[#]', '#', [168, 58, 52], 4.5, 'wood', 'Wood and leather', 'Free reeds',
    'A bellows box of paired reeds that sigh and beat.'],
  bagpipe: ['Y', 'Y', [120, 96, 140], 2.5, 'hide', 'Hide and wood', 'Chanter and drone',
    'A chanter and drone on a hide bag.'],
  celticHarp: ['|>', 'P', [198, 152, 92], 4, 'wood', 'Wood and brass', 'Plucked strings',
    'A small framed harp with bright brass-wound strings.'],
  dulcimer: ['=', '=', [150, 108, 70], 3, 'wood', 'Wood and iron', 'Hammered strings',
    'A trapezoid of strings struck with two light hammers.'],
  flute: ['-o', '-', [228, 220, 196], 0.3, 'bone', 'Bone', 'Breath',
    'A slim bone flute.'],
  kalimba: ['[u]', 'u', [206, 194, 160], 0.4, 'wood', 'Wood and iron', 'Tines',
    'Iron tines on a wooden box, plucked with the thumbs.'],
  lute: ['Q', 'Q', [176, 128, 74], 1.5, 'wood', 'Wood and gut', 'Plucked strings',
    'A pear-bodied lute with paired gut strings.'],
  trumpet: ['=<', 'T', [214, 170, 72], 1.2, 'brass', 'Brass', 'Brass',
    'A brass trumpet with a flared bell.'],
  vielle: ['8', '8', [140, 84, 52], 1.8, 'wood', 'Wood and gut', 'Bowed strings',
    'A five-string fiddle played with a bow.'],
};

export const INSTRUMENT_ITEMS = INSTRUMENT_IDS.map(id => {
  const [glyph, groundGlyph, colour, weight, tag, material, voice, description] = details[id];
  const { name } = INSTRUMENTS[id];
  return {
    id,
    name,
    // Short enough for the equipment slot label.
    shortName: name.split(' ').pop(),
    glyph,
    groundGlyph,
    colour,
    tags: ['equipment', 'instrument', tag],
    description: `${description} ${CARRY}`,
    stats: { material, voice, notes: noteRange(id),
      shift: secondLayer(id) === 'chords' ? 'Chords' : 'Notes 9-16' },
    weight,
    stackLimit: 1,
    equipmentSlot: 'offHand',
  };
});
