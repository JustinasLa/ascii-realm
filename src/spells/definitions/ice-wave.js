// Gameplay derived from TF's configured rune/class ability.
import presentation from '../presentations/ice-wave.js';

export default {
  presentation,
  "id": "ice-wave",
  "name": "Ice Wave",
  "element": "seithr",
  "root": "ice_wave_class",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 15.0,
        "mana": 6.0,
        "duration": 10.0,
        "damage": 8.0
      },
      "root": "ice_wave_class",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "ice_wave_class": {"steps":[{"op":"skill","args":{"s":"Ice_Wave_Class_SKILL"},"target":{"op":"livingincone","args":{"a":"120","r":"6"}}},{"op":"randomskill","args":{"s":"Ice_Wave_FX_1"}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "ice_wave_class_skill": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pkb":"true"}},{"op":"throw","args":{"velocity":"20","velocityy":"0"}},{"op":"aura","args":{"auraname":"Slowed","ot":"Slowed","d":"<modifier.duration> * 20","i":"20"}}],"targetConditions":["entitytype{t=armorstands} false"]},
    "slowed": {"steps":[{"op":"potion","args":{"type":"SLOW","duration":"21","level":"1","hasparticles":"false"}},{"op":"delay","args":{"ticks":"10"}},{"op":"randomskill","args":{"s":"Slowed_MSG_1"}}],"targetConditions":["hasaura{aura=Slowed}"]},
    "slowed_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Slowed </gradient>"}}]},
    "ice_wave_fx_1": {"steps":[{"op":"visual","args":{"radius":"2","life":"0.4"},"target":{"op":"forward","args":{"f":"0","y":"0","lockpitch":"true","cpitch":"0.01"}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"cone","args":{"a":"120","r":"6","p":"110"}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"cone","args":{"a":"120","r":"6","p":"90"}}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_seithr_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "dd420157d6e6bbbfa6a8aa60a51f3e625b8a4885f4070cfc3fb59b94b1130599"}
};
