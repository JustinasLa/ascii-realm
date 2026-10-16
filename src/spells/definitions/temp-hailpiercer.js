// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "temp-hailpiercer",
  "name": "Hailpiercer",
  "element": "seithr",
  "root": "temp_hailpiercer",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 25.0,
        "mana": 10.0,
        "damage": 20.0
      },
      "root": "temp_hailpiercer",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "temp_hailpiercer": {"steps":[{"op":"skill","args":{"s":"TEMP_Hailpiercer_CAST","damage":"<modifier.damage>","duration":"<modifier.duration>"}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG","hasAura{aura=CASTING} false"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "temp_hailpiercer_cast": {"steps":[{"op":"aura","args":{"auraname":"CASTING","duration":"35"},"target":{"op":"self","args":{}}},{"op":"potion","args":{"type":"RESISTANCE","duration":"35","level":"1","hasparticles":"false"},"target":{"op":"self","args":{}}},{"op":"stun","args":{"d":"35","f":"true","cancelontakedamage":"false","cancelondeath":"true"},"target":{"op":"self","args":{}}},{"op":"summon","args":{"type":"VFX_AwakenedMage_Hailpiercer_Inhale","amount":"1","radius":"0","yradius":"0","onsurface":"true"},"target":{"op":"forward","args":{"f":"1.5","y":"0","lockpitch":"true"}}},{"op":"skill","args":{"s":"TEMP_Hailpiercer_PRO","origin":"@SelfEyeLocation{fo=-0.5","yo":"-0.2}","repeat":"5","repeati":"5"},"target":{"op":"forward","args":{"f":"12","uel":"true"}}},{"op":"delay","args":{"ticks":"30"}},{"op":"summon","args":{"type":"VFX_AwakenedMage_Hailpiercer0","amount":"1","radius":"0","yradius":"0","onsurface":"true"},"target":{"op":"forward","args":{"f":"2","y":"0","sideoffset":"0","lockpitch":"true"}}},{"op":"totem","args":{"md":"1","i":"1","ot":"TEMP_Hailpiercer_PRO_DAMAGE_D1","hnp":"true","hp":"true","hr":"1","vr":"1","delay":"2"},"target":{"op":"forward","args":{"f":"3","y":"0","lockpitch":"true"}}},{"op":"totem","args":{"md":"1","i":"1","ot":"TEMP_Hailpiercer_PRO_DAMAGE_D1","hnp":"true","hp":"true","hr":"1","vr":"1","delay":"7"},"target":{"op":"forward","args":{"f":"9","y":"0","lockpitch":"true"}}},{"op":"totem","args":{"md":"1","i":"1","ot":"TEMP_Hailpiercer_PRO_DAMAGE_D1","hnp":"true","hp":"true","hr":"1","vr":"1","delay":"12"},"target":{"op":"forward","args":{"f":"15","y":"0","lockpitch":"true"}}},{"op":"delay","args":{"ticks":"5"}},{"op":"summon","args":{"type":"VFX_AwakenedMage_Hailpiercer1","amount":"1","radius":"0","yradius":"0","onsurface":"true"},"target":{"op":"forward","args":{"f":"6","y":"0","sideoffset":"-1","lockpitch":"true"}}},{"op":"delay","args":{"ticks":"5"}},{"op":"summon","args":{"type":"VFX_AwakenedMage_Hailpiercer2","amount":"1","radius":"0","yradius":"0","onsurface":"true"},"target":{"op":"forward","args":{"f":"10","y":"0","sideoffset":"0","lockpitch":"true"}}}]},
    "temp_hailpiercer_pro": {"steps":[{"op":"projectile","args":{"bmd":"true","onhit":"TEMP_Hailpiercer_PRO_DAMAGE_D","v":"25","i":"1","hr":"1","vr":"1","mr":"9","hnp":"true","ho":"0","se":"false","sb":"false","hs":"false","hfs":"0","sfo":"0","syo":"0","tyo":"0","sso":"0","fo":"true","hitconditions":"[- isLiving true]","byo":"0","drawhitbox":"false","ham":"true"}}]},
    "temp_hailpiercer_pro_damage_d": {"steps":[{"op":"skill","args":{"s":"TEMP_Hailpiercer_PRO_DAMAGE_DD"},"target":{"op":"entitiesnearorigin","args":{"r":"3","limit":"5","sort":"NEAREST"}}}],"cooldown":0.001},
    "temp_hailpiercer_pro_damage_dd": {"steps":[{"op":"skill","args":{"s":"TEMP_Hailpiercer_PRO_DAMAGE"},"target":{"op":"targetedtarget","args":{"conditions":"[ - isLiving true ]"}}}]},
    "temp_hailpiercer_pro_damage": {"steps":[{"op":"pull","args":{"velocity":"1"}}],"targetConditions":["entitytype{t=ARMOR_STAND} false","mmoCanTarget{interaction=OFFENSE_ACTION} true"]},
    "temp_hailpiercer_pro_damage_d1": {"steps":[{"op":"skill","args":{"s":"TEMP_Hailpiercer_PRO_DAMAGE_DD1"},"target":{"op":"entitiesnearorigin","args":{"r":"6","limit":"5","sort":"NEAREST"}}}]},
    "temp_hailpiercer_pro_damage_dd1": {"steps":[{"op":"skill","args":{"s":"TEMP_Hailpiercer_PRO_DAMAGE1"},"target":{"op":"targetedtarget","args":{"conditions":"[ - isLiving true - hasaura{aura=immunedelay} false ]"}}}]},
    "temp_hailpiercer_pro_damage1": {"steps":[{"op":"aura","args":{"auraname":"immunedelay","duration":"3"}},{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pkb":"true","hnp":"true","hp":"true"}},{"op":"visual","args":{"radius":"0.6","life":"0.3"}}],"targetConditions":["entitytype{t=ARMOR_STAND} false","mmoCanTarget{interaction=OFFENSE_ACTION} true"]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_temp_skills.yml"], "sha256": "ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7"}
};
