import presentation from '../presentations/scalding-wave.js';

// Gameplay derived from TF's configured rune/class ability.
export default {
  presentation,
  "id": "scalding-wave",
  "name": "Scalding Wave",
  "element": "mitlan",
  "root": "scalding_wave",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 15.0,
        "mana": 6.0,
        "burnt_damage": 5.0,
        "burnt_duration": 3.0
      },
      "root": "scalding_wave",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "scalding_wave": {"steps":[{"op":"skill","args":{"s":"Scalding_Wave_SKILL"},"target":{"op":"livingincone","args":{"a":"120","r":"4"}}},{"op":"randomskill","args":{"s":"Scalding_Wave_FX_1"}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "scalding_wave_skill": {"steps":[{"op":"throw","args":{"velocity":"12","velocityy":"1"}},{"op":"aura","args":{"auraname":"Burnt","ot":"Burnt","d":"<modifier.burnt_duration> * 20","i":"20"}}],"targetConditions":["entitytype{t=armorstands} false"]},
    "burnt": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.burnt_damage>","pi":"true","ii":"true","ia":"true"}},{"op":"delay","args":{"ticks":"10"}},{"op":"randomskill","args":{"s":"Burnt_MSG_1"}}],"targetConditions":["hasaura{aura=Burnt}"]},
    "burnt_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Burnt </gradient>"}}]},
    "scalding_wave_fx_1": {"steps":[{"op":"visual","args":{"radius":"2","life":"0.4"},"target":{"op":"forward","args":{"f":"0","y":"0","lockpitch":"true","cpitch":"0.01"}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"cone","args":{"a":"120","r":"4","p":"40"}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"cone","args":{"a":"120","r":"4","p":"20"}}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_mitlan_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "468d1b9c3771c22a600e79a47b37fe72a1399d1f477501e0118a75b7c7540bc2"}
};
