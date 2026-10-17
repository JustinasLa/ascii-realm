import presentation from '../presentations/hand-cure.js';

// Gameplay derived from TF's configured rune/class ability.
export default {
  presentation,
  "id": "hand-cure",
  "name": "Hand Cure",
  "element": "cerrith",
  "root": "hand_cure",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 15.0,
        "mana": 6.0,
        "heal": 18.0
      },
      "root": "hand_cure",
      "trigger": "CAST"
    }
  ],
  "supportive": true,
  "nodes": {
    "hand_cure": {"steps":[{"op":"potion","args":{"type":"SLOW","duration":"20","level":"100","hasparticles":"false"},"target":{"op":"self","args":{}}},{"op":"onjump","args":{"ce":"true","d":"20","cancelondeath":"true","cancelonquit":"true","cancelonchangeworld":"true"},"target":{"op":"self","args":{}}},{"op":"skill","args":{"s":"Hand_Cure_HEAL"},"target":{"op":"target","args":{}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"],"targetConditions":["isPlayer true","distance{d=<2} true"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "hand_cure_heal": {"steps":[{"op":"potion","args":{"type":"SLOW","duration":"20","level":"100","hasparticles":"false"}},{"op":"onjump","args":{"ce":"true","d":"20","cancelondeath":"true","cancelonquit":"true","cancelonchangeworld":"true"}},{"op":"heal","args":{"a":"<modifier.heal>"}},{"op":"randomskill","args":{"s":"Hand_Cure_FX_1"}}]},
    "hand_cure_fx_1": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_cerrith_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "c9f405f18142629574b33481eadbd1e219bd9e0ed27d41487977509c68af4129"}
};
