// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "crashing-wave",
  "name": "Crashing Wave",
  "element": "mitlan",
  "root": "crashing_wave",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 20.0,
        "mana": 8.0,
        "damage": 18.0
      },
      "root": "crashing_wave",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "crashing_wave": {"steps":[{"op":"projectile","args":{"ontick":"Crashing_Wave_TICK","onhit":"Crashing_Wave_HIT","v":"14","i":"1","hr":"3","vr":"2","mr":"16","hnp":"true","hp":"true","se":"false","sb":"true","hs":"true","hfs":"0.2","syo":"0.5","tyo":"0.5","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7221","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"2,1.6,2"},"target":{"op":"forward","args":{"f":"16","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "crashing_wave_tick": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "crashing_wave_hit": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>"}},{"op":"throw","args":{"velocity":"12","velocityy":"4"}}],"targetConditions":["entitytype{t=armorstands} false"]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_mitlan_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "468d1b9c3771c22a600e79a47b37fe72a1399d1f477501e0118a75b7c7540bc2"}
};
