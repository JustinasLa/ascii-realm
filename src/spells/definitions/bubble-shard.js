// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "bubble-shard",
  "name": "Bubble Shard",
  "element": "mitlan",
  "root": "bubble_shard",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 10.0,
        "mana": 4.0,
        "damage": 6.0,
        "duration": 6.0
      },
      "root": "bubble_shard",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "bubble_shard": {"steps":[{"op":"projectile","args":{"ontick":"Bubble_Shard_TICK","onhit":"Bubble_Shard_HIT","v":"40","i":"1","hr":"1","vr":"1","mr":"40","hnp":"true","syo":"1.5","tyo":"1.5","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7204","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"0.9,0.9,0.9"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "bubble_shard_tick": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "bubble_shard_hit": {"steps":[{"op":"skill","args":{"s":"Bubble_Shard_DAMAGE"}},{"op":"randomskill","args":{"s":"Bubble_Shard_FX_1"}}]},
    "bubble_shard_damage": {"steps":[{"op":"skill","args":{"s":"Bubble_Shard_DAMAGE_TARGET"},"target":{"op":"entitiesnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}}]},
    "bubble_shard_damage_target": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pi":"true"}},{"op":"aura","args":{"auraname":"Slowed","ot":"Slowed","d":"<modifier.duration> * 20","i":"20"}}],"targetConditions":["entitytype{t=armorstands} false"]},
    "slowed": {"steps":[{"op":"potion","args":{"type":"SLOW","duration":"21","level":"1","hasparticles":"false"}},{"op":"delay","args":{"ticks":"10"}},{"op":"randomskill","args":{"s":"Slowed_MSG_1"}}],"targetConditions":["hasaura{aura=Slowed}"]},
    "slowed_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Slowed </gradient>"}}]},
    "bubble_shard_fx_1": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"2","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_mitlan_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "468d1b9c3771c22a600e79a47b37fe72a1399d1f477501e0118a75b7c7540bc2"}
};
