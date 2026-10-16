// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "temp-frost-bolt",
  "name": "Frost Bolt",
  "element": "seithr",
  "root": "temp_frost_bolt",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 10.0,
        "mana": 4.0,
        "damage": 8.0
      },
      "root": "temp_frost_bolt",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "temp_frost_bolt": {"steps":[{"op":"projectile","args":{"bullettype":"MOB","mob":"Frost_Bolt","onend":"TEMP_Frost_Bolt_END","onhit":"TEMP_Frost_Bolt_HIT","v":"30","i":"1","hr":"1","vr":"1","mr":"30","hnp":"true","ho":"0","se":"true","sb":"true","hs":"false","hfs":"0","syo":"1.5","tyo":"1.5"},"target":{"op":"forward","args":{"f":"15","y":"0"}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"forward","args":{"f":"1","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "temp_frost_bolt_end": {"steps":[{"op":"skill","args":{"s":"TEMP_Frost_Bolt_HIT_FX"},"target":{"op":"origin","args":{}}}]},
    "temp_frost_bolt_hit_fx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}}]},
    "temp_frost_bolt_hit": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pi":"true"},"target":{"op":"entitiesnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}},{"op":"potion","args":{"type":"SLOW","duration":"40","level":"2","hasparticles":"false"},"target":{"op":"entitiesnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}},{"op":"skill","args":{"s":"TEMP_Frost_Bolt_HIT_FX"},"target":{"op":"entitiesnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_temp_skills.yml"], "sha256": "ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7"}
};
