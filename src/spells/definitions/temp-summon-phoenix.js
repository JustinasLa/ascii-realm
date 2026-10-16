// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "temp-summon-phoenix",
  "name": "Fire Phoneix",
  "element": "oseni",
  "root": "temp_summon_phoenix",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 15.0,
        "mana": 6.0,
        "damage": 15.0,
        "duration": 3.0
      },
      "root": "temp_summon_phoenix",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "temp_summon_phoenix": {"steps":[{"op":"aura","args":{"auraname":"Spirit_Guardian_STOP","interval":"1","duration":"40"},"target":{"op":"self","args":{}}},{"op":"aura","args":{"auraname":"Summon_Phoenix_NO","interval":"1","duration":"25"},"target":{"op":"self","args":{}}},{"op":"summon","args":{"type":"Summon_Phoenix","amount":"1","radius":"0","yradius":"0","onsurface":"true"},"target":{"op":"self","args":{}}},{"op":"projectile","args":{"ontick":"TEMP_Summon_Phoenix_TickT","onstart":"TEMP_Summon_Phoenix_Tick","onhit":"TEMP_Summon_Phoenix_HIT","v":"1","i":"1","hr":"1","vr":"1","mr":"23","hnp":"true","ho":"0","se":"false","sb":"false","hs":"true","hfs":"0","syo":"0","tyo":"0","sfo":"-1.5"},"target":{"op":"forward","args":{"f":"20","y":"0","lockpitch":"true"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "temp_summon_phoenix_tickt": {"steps":[{"op":"totem","args":{"md":"60","ot":"TEMP_Summon_Phoenix_BURNFX","oh":"TEMP_Summon_Phoenix_BURN_D","hnp":"true","hp":"true","hr":"2","vr":"1","i":"10"},"target":{"op":"origin","args":{}}}],"conditions":["hasaurastacks{auraName=Summon_Phoenix_NO} false"]},
    "temp_summon_phoenix_burnfx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "temp_summon_phoenix_burn_d": {"steps":[{"op":"skill","args":{"s":"TEMP_Summon_Phoenix_BURN"}}]},
    "temp_summon_phoenix_burn": {"steps":[{"op":"aura","args":{"auraname":"TEMP_Summon_Phoenix_BURN_HIT","duration":"10"}},{"op":"ignite","args":{"ticks":"<modifier.duration> * 20"}},{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage> * 0.3","pi":"true"}}],"targetConditions":["mmoCanTarget{interaction=OFFENSE_ACTION} true","entitytype{t=armorstands} false","hasaura{n=TEMP_Summon_Phoenix_BURN_HIT} false"]},
    "temp_summon_phoenix_tick": {"steps":[{"op":"delay","args":{"ticks":"25"}},{"op":"modifyprojectile","args":{"trait":"VELOCITY","action":"SET","value":"12"}}]},
    "temp_summon_phoenix_hit": {"steps":[{"op":"skill","args":{"s":"TEMP_Summon_Phoenix_HIT_SKILL"},"target":{"op":"entitiesnearorigin","args":{"r":"5"}}}],"targetConditions":["entitytype{t=ARMOR_STAND} false"]},
    "temp_summon_phoenix_hit_skill": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pi":"true"}},{"op":"ignite","args":{"ticks":"<modifier.duration> * 20"}}],"targetConditions":["mmoCanTarget{interaction=OFFENSE_ACTION} true","entitytype{t=armorstands} false"]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_temp_skills.yml"], "sha256": "ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7"}
};
