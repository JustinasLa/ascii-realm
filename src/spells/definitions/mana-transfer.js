// Gameplay derived from TF's configured rune/class ability.
import presentation from '../presentations/mana-transfer.js';

export default {
  presentation,
  "id": "mana-transfer",
  "name": "Mana Transfer",
  "element": "cerrith",
  "root": "mana_transfer",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 1.0,
        "mana": 4.0
      },
      "root": "mana_transfer",
      "trigger": "CAST"
    }
  ],
  "supportive": true,
  "nodes": {
    "mana_transfer": {"steps":[{"op":"aura","args":{"auraname":"Mana_Transfer_Active","ot":"Mana_Transfer_MANA","d":"99999","i":"20"},"target":{"op":"self","args":{}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG","hasaura{aura=Mana_Transfer_Active} castinstead Mana_Transfer_STOP"],"targetConditions":["isPlayer true","distance{d=<2} true"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "mana_transfer_stop": {"steps":[{"op":"auraremove","args":{"aura":"Mana_Transfer_Active"},"target":{"op":"self","args":{}}},{"op":"auraremove","args":{"aura":"Mana_Transfer_Jump"},"target":{"op":"self","args":{}}},{"op":"potionclear","args":{"type":"SLOW"},"target":{"op":"self","args":{}}}]},
    "mana_transfer_mana": {"steps":[{"op":"setvariable","args":{"var":"caster.tfmc_mana","type":"FLOAT","value":"%mmocore_mana%"},"target":{"op":"self","args":{}}},{"op":"skill","args":{"s":"Mana_Transfer_ACTIVE"}}]},
    "mana_transfer_active": {"steps":[{"op":"skill","args":{"s":"Mana_Transfer_TARGET"},"target":{"op":"target","args":{}}},{"op":"potion","args":{"type":"SLOW","duration":"20","level":"100","hasparticles":"false"},"target":{"op":"self","args":{}}},{"op":"onjump","args":{"auraname":"Mana_Transfer_Jump","ce":"true","d":"20","cancelondeath":"true","cancelonquit":"true","cancelonchangeworld":"true"},"target":{"op":"self","args":{}}}],"conditions":["variableinrange{var=caster.tfmc_mana;value=2to999999} orElseCast Mana_Transfer_STOP"]},
    "mana_transfer_target": {"steps":[{"op":"command","args":{"c":"mmocore admin resource-mana take <caster.name> 2"}},{"op":"command","args":{"c":"mmocore admin resource-mana give <target.name> 2"}},{"op":"potion","args":{"type":"SLOW","duration":"20","level":"100","hasparticles":"false"}},{"op":"onjump","args":{"auraname":"Mana_Transfer_Jump","ce":"true","d":"20","cancelondeath":"true","cancelonquit":"true","cancelonchangeworld":"true"}}],"conditions":["hasaura{aura=Silenced} castinstead Mana_Transfer_STOP"],"targetConditions":["isPlayer orElseCast Mana_Transfer_STOP","distance{d=<2} orElseCast Mana_Transfer_STOP","hasaura{aura=Mana_Transfer_Active} castinstead Mana_Transfer_STOP"]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_cerrith_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "c9f405f18142629574b33481eadbd1e219bd9e0ed27d41487977509c68af4129"}
};
