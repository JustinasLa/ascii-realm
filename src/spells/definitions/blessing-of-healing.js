import presentation from '../presentations/blessing-of-healing.js';

// Gameplay derived from TF's configured rune/class ability.
export default {
  presentation,
  "id": "blessing-of-healing",
  "name": "Blessing of Healing",
  "element": "cerrith",
  "root": "blessing_of_healing",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 25.0,
        "mana": 10.0,
        "heal": 12.0
      },
      "root": "blessing_of_healing",
      "trigger": "CAST"
    }
  ],
  "supportive": true,
  "nodes": {
    "blessing_of_healing": {"steps":[{"op":"aura","args":{"auraname":"BHealing_Active","ot":"Blessing_Of_Healing_MANA","d":"99999","i":"20"},"target":{"op":"self","args":{}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG","hasaura{aura=BHealing_Active} castinstead Blessing_Of_Healing_STOP"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "blessing_of_healing_stop": {"steps":[{"op":"auraremove","args":{"aura":"BHealing_Active"},"target":{"op":"self","args":{}}},{"op":"auraremove","args":{"aura":"BHealing_Jump"},"target":{"op":"self","args":{}}},{"op":"potionclear","args":{"type":"SLOW"},"target":{"op":"self","args":{}}}]},
    "blessing_of_healing_mana": {"steps":[{"op":"setvariable","args":{"var":"caster.tfmc_mana","type":"FLOAT","value":"%mmocore_mana%"},"target":{"op":"self","args":{}}},{"op":"skill","args":{"s":"Blessing_Of_Healing_ACTIVE"}}]},
    "blessing_of_healing_active": {"steps":[{"op":"projectile","args":{"ontick":"Blessing_Of_Healing_TICK","onhit":"Blessing_Of_Healing_HIT","v":"100","i":"1","hr":"2","vr":"2","mr":"64","hnp":"true","syo":"1.5","tyo":"1.5"},"target":{"op":"forward","args":{"f":"20","y":"0"}}},{"op":"potion","args":{"type":"SLOW","duration":"20","level":"100","hasparticles":"false"},"target":{"op":"self","args":{}}},{"op":"onjump","args":{"auraname":"BHealing_Jump","ce":"true","d":"20","cancelondeath":"true","cancelonquit":"true","cancelonchangeworld":"true"},"target":{"op":"self","args":{}}},{"op":"command","args":{"c":"mmocore admin resource-mana take <caster.name> 2"},"target":{"op":"self","args":{}}}],"conditions":["variableinrange{var=caster.tfmc_mana;value=2to999999} orElseCast Blessing_Of_Healing_STOP"]},
    "blessing_of_healing_tick": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "blessing_of_healing_hit": {"steps":[{"op":"skill","args":{"s":"Blessing_Of_Healing_HEAL"}},{"op":"randomskill","args":{"s":"Blessing_Of_Healing_FX_1"}}]},
    "blessing_of_healing_heal": {"steps":[{"op":"heal","args":{"a":"<modifier.heal>"},"target":{"op":"playersnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}}]},
    "blessing_of_healing_fx_1": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"3","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_cerrith_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "c9f405f18142629574b33481eadbd1e219bd9e0ed27d41487977509c68af4129"}
};
