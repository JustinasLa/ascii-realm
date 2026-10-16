// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "temp-quickshot",
  "name": "Leaf Arrow",
  "element": "cerrith",
  "root": "temp_quick_shot",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 10.0,
        "mana": 4.0,
        "damage": 8.0
      },
      "root": "temp_quick_shot",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "temp_quick_shot": {"steps":[{"op":"projectile","args":{"bullettype":"MOB","mob":"Quick_Shot","onhit":"TEMP_Quick_Shot_HIT","v":"35","i":"1","hr":"1","vr":"1","mr":"40","hnp":"true","ho":"0","se":"true","sb":"true","hs":"false","hfs":"0","syo":"1.5","tyo":"1.5","g":"0.1"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "temp_quick_shot_hit": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pi":"true"},"target":{"op":"entitiesnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}}],"targetConditions":["entitytype{t=armorstands} false","mmoCanTarget{interaction=OFFENSE_ACTION} true"]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_temp_skills.yml"], "sha256": "ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7"}
};
