// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "ice-shard",
  "name": "Ice Shard",
  "element": "seithr",
  "root": "ice_shard",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 10.0,
        "mana": 4.0,
        "duration": 6.0
      },
      "root": "ice_shard",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "ice_shard": {"steps":[{"op":"projectile","args":{"ontick":"Ice_Shard_TICK","onhit":"Ice_Shard_HIT","v":"40","i":"1","hr":"1","vr":"1","mr":"40","hnp":"true","syo":"1.5","tyo":"1.5","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7203","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"0.9,0.9,0.9"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "ice_shard_tick": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "ice_shard_hit": {"steps":[{"op":"skill","args":{"s":"Ice_Shard_SLOW"}},{"op":"randomskill","args":{"s":"Ice_Shard_FX_1"}}]},
    "ice_shard_slow": {"steps":[{"op":"aura","args":{"auraname":"Slowed","ot":"Slowed","d":"<modifier.duration> * 20","i":"20"},"target":{"op":"entitiesnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}}]},
    "slowed": {"steps":[{"op":"potion","args":{"type":"SLOW","duration":"21","level":"1","hasparticles":"false"}},{"op":"delay","args":{"ticks":"10"}},{"op":"randomskill","args":{"s":"Slowed_MSG_1"}}],"targetConditions":["hasaura{aura=Slowed}"]},
    "slowed_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Slowed </gradient>"}}]},
    "ice_shard_fx_1": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"3","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_seithr_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "dd420157d6e6bbbfa6a8aa60a51f3e625b8a4885f4070cfc3fb59b94b1130599"}
};
