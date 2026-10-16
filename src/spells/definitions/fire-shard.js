// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "fire-shard",
  "name": "Fire Shard",
  "element": "oseni",
  "root": "fire_shard",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 10.0,
        "mana": 4.0,
        "damage": 12.0
      },
      "root": "fire_shard",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "fire_shard": {"steps":[{"op":"projectile","args":{"ontick":"Fire_Shard_TICK","onhit":"Fire_Shard_HIT","v":"40","i":"1","hr":"1","vr":"1","mr":"40","hnp":"true","syo":"1.5","tyo":"1.5","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7202","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"0.9,0.9,0.9"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "fire_shard_tick": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "fire_shard_hit": {"steps":[{"op":"skill","args":{"s":"Fire_Shard_DAMAGE"}},{"op":"randomskill","args":{"s":"Fire_Shard_FX_1"}}]},
    "fire_shard_damage": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pi":"true"},"target":{"op":"entitiesnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}}]},
    "fire_shard_fx_1": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"3","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_oseni_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "cc41f032e051b5cfe15d040f7fbd68b0cc12ff0501dca0bfd844b295b09958b9"}
};
