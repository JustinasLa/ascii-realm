// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "drowning-prison",
  "name": "Drowning Prison",
  "element": "mitlan",
  "root": "drowning_prison",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 25.0,
        "mana": 10.0,
        "duration": 4.0,
        "damage": 6.0
      },
      "root": "drowning_prison",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "drowning_prison": {"steps":[{"op":"projectile","args":{"onend":"Drowning_Prison_ACTIVE_LEVEL","v":"100","i":"1","hr":"1","vr":"1","mr":"20","hnp":"false","se":"false","sb":"true"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "drowning_prison_active_level": {"steps":[{"op":"projectile","args":{"v":"0","i":"1","md":"1","hnp":"false","hp":"false","se":"false","sb":"false","fromorigin":"true","onend":"Drowning_Prison_ACTIVE"},"target":{"op":"origin","args":{"yoffset":"10"}}}]},
    "drowning_prison_active": {"steps":[{"op":"totem","args":{"md":"20","ot":"Drowning_Prison_SKILL_SPAWN_FX","hnp":"false","hp":"true","hr":"4","vr":"2","i":"20","hs":"true","hfs":"0.1","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7208","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"3.19,1,3.19"},"target":{"op":"origin","args":{}}},{"op":"totem","args":{"md":"20","oh":"Drowning_Prison_SKILL","hnp":"true","hp":"true","hr":"3","vr":"2","i":"1","ch":"1","delay":"1","hs":"true","hfs":"0.1"},"target":{"op":"origin","args":{}}}]},
    "drowning_prison_skill_spawn_fx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}}]},
    "drowning_prison_skill": {"steps":[{"op":"skill","args":{"s":"Drowning_Prison_SKILL_HIT"},"target":{"op":"entitiesnearorigin","args":{"r":"4","limit":"1","sort":"NEAREST"}}}]},
    "drowning_prison_skill_hit": {"steps":[{"op":"potion","args":{"type":"SLOW","duration":"<modifier.duration> * 20","level":"100","hasparticles":"false"}},{"op":"onjump","args":{"ce":"true","d":"max(1, min(400, <modifier.duration> * 20))","cancelondeath":"true","cancelonquit":"true","cancelonchangeworld":"true"}},{"op":"totem","args":{"md":"max(1, min(400, <modifier.duration> * 20))","hnp":"false","hp":"false","hr":"0.1","vr":"0.1","i":"20","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7220","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"2.6,2.6,2.6","bulletbillboard":"CENTER","bulletyoffset":"1"}},{"op":"skill","args":{"s":"Drowning_Prison_DROWN","repeat":"<modifier.duration> - 1","repeatinterval":"20","delay":"20"}},{"op":"skill","args":{"s":"Drowning_Prison_HOLD_FX","repeat":"<modifier.duration> * 4 - 1","repeatinterval":"5"}}],"targetConditions":["entitytype{t=armorstands} false"]},
    "drowning_prison_drown": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pi":"true"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}}]},
    "drowning_prison_hold_fx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_mitlan_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "468d1b9c3771c22a600e79a47b37fe72a1399d1f477501e0118a75b7c7540bc2"}
};
