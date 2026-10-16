// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "tide-shard",
  "name": "Tide Shard",
  "element": "mitlan",
  "root": "tide_shard",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 10.0,
        "mana": 4.0,
        "damage": 12.0
      },
      "root": "tide_shard",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "tide_shard": {"steps":[{"op":"projectile","args":{"ontick":"Tide_Shard_TICK","onhit":"Tide_Shard_HIT","v":"40","i":"1","hr":"1","vr":"1","mr":"40","hnp":"true","syo":"1.5","tyo":"1.5","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7204","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"0.9,0.9,0.9"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "tide_shard_tick": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "tide_shard_hit": {"steps":[{"op":"skill","args":{"s":"Tide_Shard_DAMAGE"}},{"op":"randomskill","args":{"s":"Tide_Shard_FX_1"}}]},
    "tide_shard_damage": {"steps":[{"op":"skill","args":{"s":"Tide_Shard_DAMAGE_TARGET"},"target":{"op":"entitiesnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}}]},
    "tide_shard_damage_target": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC,PROJECTILE","a":"<modifier.damage>"}},{"op":"throw","args":{"velocity":"8","velocityy":"2"}}],"targetConditions":["entitytype{t=armorstands} false"]},
    "tide_shard_fx_1": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"3","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_mitlan_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "468d1b9c3771c22a600e79a47b37fe72a1399d1f477501e0118a75b7c7540bc2"}
};
