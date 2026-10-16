// One entry is added by each spell PR. Class copies live with their rune.
export const spellIds = [];

export async function loadSpells() {
  return Promise.all(spellIds.map(async id => (await import(`./definitions/${id}.js`)).default));
}
