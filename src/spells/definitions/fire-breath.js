// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "fire-breath",
  "name": "Fire Breath",
  "element": "oseni",
  "root": "fire_breath",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 15.0,
        "mana": 6.0,
        "burnt_damage": 6.0,
        "burnt_duration": 4.0
      },
      "root": "fire_breath",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "fire_breath": {"steps":[{"op":"skill","args":{"s":"Fire_Breath_SKILL"},"target":{"op":"livingincone","args":{"a":"120","r":"6"}}},{"op":"randomskill","args":{"s":"Fire_Breath_FX_1"}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "fire_breath_skill": {"steps":[{"op":"aura","args":{"auraname":"Burnt","ot":"Burnt","d":"<modifier.burnt_duration> * 20","i":"20"}}]},
    "burnt": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.burnt_damage>","pi":"true","ii":"true","ia":"true"}},{"op":"delay","args":{"ticks":"10"}},{"op":"randomskill","args":{"s":"Burnt_MSG_1"}}],"targetConditions":["hasaura{aura=Burnt}"]},
    "burnt_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Burnt </gradient>"}}]},
    "fire_breath_fx_1": {"steps":[{"op":"visual","args":{"radius":"2","life":"0.4"},"target":{"op":"forward","args":{"f":"0","y":"0","lockpitch":"true","cpitch":"0.01"}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"cone","args":{"a":"120","r":"6","p":"110"}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"cone","args":{"a":"120","r":"6","p":"90"}}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_oseni_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "cc41f032e051b5cfe15d040f7fbd68b0cc12ff0501dca0bfd844b295b09958b9"}
};
