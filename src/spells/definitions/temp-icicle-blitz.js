// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "temp-icicle-blitz",
  "name": "Icicle Blitz",
  "element": "seithr",
  "root": "temp_icicle_blitz",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 6.0,
        "mana": 6.0,
        "damage": 4.0
      },
      "root": "temp_icicle_blitz",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "temp_icicle_blitz": {"steps":[{"op":"skill","args":{"s":"TEMP_Glacial_Quills_1"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_2"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_3"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_4"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_5"}}],"cooldown":5,"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "temp_glacial_quills_1": {"steps":[{"op":"aura","args":{"auraname":"Glacial_Quills_Stack","duration":"160","maxstacks":"4","delay":"1"},"target":{"op":"self","args":{}}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT"}}],"conditions":["hasaurastacks{auraName=Glacial_Quills_Stack;stacks=1} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=2} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=3} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=4} false"]},
    "temp_glacial_quills_shot": {"steps":[{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SFX"},"target":{"op":"self","args":{}}},{"op":"projectile","args":{"bullettype":"MOB","mob":"VFX_Glacial_Quills","onhit":"TEMP_Glacial_Quills_HIT_D","v":"22","i":"1","hr":"1","vr":"1","mr":"30","hnp":"true","ho":"0","se":"false","sb":"true","hs":"false","hfs":"0","sfo":"0.3","syo":"1.8","tyo":"1.5","accuracy":"0.98"},"target":{"op":"forward","args":{"f":"15","y":"0"}}}]},
    "temp_glacial_quills_sfx": {"steps":[]},
    "temp_glacial_quills_hit_d": {"steps":[{"op":"skill","args":{"s":"TEMP_Glacial_Quills_HIT"},"target":{"op":"entitiesnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}}]},
    "temp_glacial_quills_hit": {"steps":[{"op":"aura","args":{"auraname":"Glacial_Quills_HIT","duration":"3"}},{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pkb":"true","pi":"true"}},{"op":"potion","args":{"type":"SLOW","duration":"10","level":"0","hasparticles":"false"}},{"op":"summon","args":{"type":"VFX_Snowflake","amount":"1","radius":"1","yradius":"1.5","onsurface":"false"}},{"op":"summon","args":{"type":"VFX_Snowflake","amount":"1","radius":"1","yradius":"1.5","onsurface":"false"}},{"op":"summon","args":{"type":"VFX_Snowflake","amount":"1","radius":"1","yradius":"1.5","onsurface":"false"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}}],"targetConditions":["entitytype{t=ARMOR_STAND} false","hasaura{n=Glacial_Quills_HIT} false","mmoCanTarget{interaction=OFFENSE_ACTION} true"]},
    "temp_glacial_quills_2": {"steps":[{"op":"aura","args":{"auraname":"Glacial_Quills_Stack","duration":"160","maxstacks":"4","delay":"1"},"target":{"op":"self","args":{}}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT","delay":"6"}}],"conditions":["hasaurastacks{auraName=Glacial_Quills_Stack;stacks=1} true","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=2} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=3} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=4} false"]},
    "temp_glacial_quills_3": {"steps":[{"op":"aura","args":{"auraname":"Glacial_Quills_Stack","duration":"160","maxstacks":"4","delay":"1"},"target":{"op":"self","args":{}}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT","delay":"5"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT","delay":"10"}}],"conditions":["hasaurastacks{auraName=Glacial_Quills_Stack;stacks=1} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=2} true","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=3} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=4} false"]},
    "temp_glacial_quills_4": {"steps":[{"op":"aura","args":{"auraname":"Glacial_Quills_Stack","duration":"160","maxstacks":"4","delay":"1"},"target":{"op":"self","args":{}}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT","delay":"4"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT","delay":"8"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT","delay":"12"}}],"conditions":["hasaurastacks{auraName=Glacial_Quills_Stack;stacks=1} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=2} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=3} true","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=4} false"]},
    "temp_glacial_quills_5": {"steps":[{"op":"aura","args":{"auraname":"Glacial_Quills_Stack","duration":"160","maxstacks":"4","delay":"1"},"target":{"op":"self","args":{}}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT","delay":"3"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT","delay":"6"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT","delay":"9"}},{"op":"skill","args":{"s":"TEMP_Glacial_Quills_SHOT","delay":"12"}}],"conditions":["hasaurastacks{auraName=Glacial_Quills_Stack;stacks=1} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=2} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=3} false","hasaurastacks{auraName=Glacial_Quills_Stack;stacks=4} true"]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_temp_skills.yml"], "sha256": "ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7"}
};
