// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "frozen-tomb",
  "name": "Frozen Tomb",
  "element": "seithr",
  "root": "frozen_tomb",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 25.0,
        "mana": 10.0,
        "damage": 23.0,
        "duration": 5.0
      },
      "root": "frozen_tomb",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "frozen_tomb": {"steps":[{"op":"projectile","args":{"onend":"Frozen_Tomb_ACTIVE_LEVEL","v":"100","i":"1","hr":"1","vr":"1","mr":"20","hnp":"false","se":"false","sb":"true"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "frozen_tomb_active_level": {"steps":[{"op":"projectile","args":{"v":"0","i":"1","md":"1","hnp":"false","hp":"false","se":"false","sb":"false","fromorigin":"true","onend":"Frozen_Tomb_ACTIVE"},"target":{"op":"origin","args":{"yoffset":"10"}}}]},
    "frozen_tomb_active": {"steps":[{"op":"totem","args":{"md":"20","ot":"Frozen_Tomb_SKILL_SPAWN_FX","hnp":"false","hp":"true","hr":"4","vr":"2","i":"20","hs":"true","hfs":"0.1","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7207","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"3.19,1,3.19"},"target":{"op":"origin","args":{}}},{"op":"totem","args":{"md":"20","oh":"Frozen_Tomb_SKILL","hnp":"true","hp":"true","hr":"3","vr":"2","i":"1","ch":"1","delay":"1","hs":"true","hfs":"0.1"},"target":{"op":"origin","args":{}}}]},
    "frozen_tomb_skill_spawn_fx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}}]},
    "frozen_tomb_skill": {"steps":[{"op":"skill","args":{"s":"Frozen_Tomb_SKILL_HIT"},"target":{"op":"entitiesnearorigin","args":{"r":"4","limit":"1","sort":"NEAREST"}}}]},
    "frozen_tomb_skill_hit": {"steps":[{"op":"potion","args":{"type":"SLOW","duration":"<modifier.duration> * 20","level":"100","hasparticles":"false"}},{"op":"onjump","args":{"ce":"true","d":"max(1, min(400, <modifier.duration> * 20))","cancelondeath":"true","cancelonquit":"true","cancelonchangeworld":"true"}},{"op":"totem","args":{"md":"max(1, min(400, <modifier.duration> * 20))","hnp":"false","hp":"false","hr":"0.1","vr":"0.1","i":"20","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7219","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"2.4,2.4,2.4","bulletbillboard":"CENTER","bulletyoffset":"1"}},{"op":"delay","args":{"ticks":"19"}},{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pi":"true"}},{"op":"visual","args":{"shape":"burst","radius":"2","life":"0.25"}},{"op":"delay","args":{"ticks":"4"}},{"op":"visual","args":{"shape":"burst","radius":"4","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_seithr_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "dd420157d6e6bbbfa6a8aa60a51f3e625b8a4885f4070cfc3fb59b94b1130599"}
};
