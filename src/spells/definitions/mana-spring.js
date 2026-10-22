// Authored for ASCII Realm in the rune graph format.
import presentation from '../presentations/mana-spring.js';

const self = { op: 'self', args: {} };
export default {
  id: 'mana-spring', name: 'Mana Spring', element: 'mitlan',
  description: 'Toggle passive regeneration: +2 mana per second until switched off or respawn. No mana cost.',
  root: 'mana_spring', supportive: true, toggleAura: 'Mana_Spring', presentation,
  variants: [{ id: 'rune', kind: 'rune', trigger: 'CAST', root: 'mana_spring',
    params: { mana: 0, mana_regen: 2 } }],
  nodes: {
    mana_spring: {
      conditions: ['hasaura{aura=Mana_Spring} castinstead Mana_Spring_STOP'],
      steps: [
        { op: 'aura', args: { auraname: 'Mana_Spring', permanent: 'true', i: '20', tickdelay: '20', ot: 'Mana_Spring_TICK' }, target: self },
        { op: 'actionmessage', args: { m: 'Mana Spring active: +2 mana per second. Cast again to stop.' }, target: self },
      ],
    },
    mana_spring_tick: { steps: [
      { op: 'command', args: { c: 'mmocore admin resource-mana give <caster.name> <modifier.mana_regen>' }, target: self },
      { op: 'visual', args: { shape: 'ward', radius: '0.65', life: '0.65' }, target: self },
    ] },
    mana_spring_stop: { steps: [
      { op: 'auraremove', args: { aura: 'Mana_Spring' }, target: self },
      { op: 'actionmessage', args: { m: 'Mana Spring inactive.' }, target: self },
    ] },
  },
  source: { authored: 'ASCII Realm 2026-10-22' },
};
