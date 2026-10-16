// Small, deliberately unnamed mechanics for exercising the simulation before
// individual TF rune definitions are installed.
const step = (op, args = {}, target) => ({ op, args, ...(target ? { target: { op: target, args: {} } } : {}) });
const make = (id, name, steps, nodes = {}) => ({ id, name, element: 'seithr', root: id,
  variants: [{ id: 'practice', kind: 'rune', params: { mana: 4, cooldown: 1 } }],
  nodes: { [id]: { steps }, ...nodes } });
export const practiceSpells = [
  make('practice-bolt', 'Practice · projectile', [step('projectile', { v: '40', mr: '20', hr: '0.5', onhit: 'impact' }, 'forward')],
    { impact: { steps: [step('mmodamage', { a: '12' })] } }),
  make('practice-shield', 'Practice · shield', [step('potion', { type: 'ABSORPTION', duration: '60', level: '2' }, 'self'), step('shield', { ms: '10' }, 'self')]),
  make('practice-freeze', 'Practice · freeze', [step('potion', { type: 'SLOW', duration: '60', level: '100' }, 'target')]),
  make('practice-heal', 'Practice · healing', [step('heal', { a: '12' }, 'self')]),
  make('practice-burn', 'Practice · damage over time', [step('aura', { auraname: 'burnt', d: '80', i: '20', ot: 'burn' }, 'target')],
    { burn: { steps: [step('mmodamage', { a: '6' })] } }),
];
