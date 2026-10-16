// One entry is added by each spell PR. Class copies live with their rune.
import { oseni } from './elements/oseni.js';
import { seithr } from './elements/seithr.js';
import { cerrith } from './elements/cerrith.js';
import { mitlan } from './elements/mitlan.js';
export const spellIds = [...oseni, ...seithr, ...cerrith, ...mitlan];

export async function loadSpells() {
  return Promise.all(spellIds.map(async id => (await import(`./definitions/${id}.js`)).default));
}
