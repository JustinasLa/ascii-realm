// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "maelstrom",
  "name": "Maelstrom",
  "element": "mitlan",
  "root": "maelstrom",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 25.0,
        "mana": 10.0,
        "damage": 5.0,
        "duration": 5.0
      },
      "root": "maelstrom",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "maelstrom": {"steps":[{"op":"projectile","args":{"ontick":"Tide_Shard_TICK","onend":"Maelstrom_ACTIVE_LEVEL","v":"40","i":"1","hr":"1.5","vr":"2.5","mr":"20","hnp":"true","hp":"false","se":"true","sb":"true","syo":"1","tyo":"1","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7204","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"0.9,0.9,0.9"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "tide_shard_tick": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "maelstrom_active_level": {"steps":[{"op":"projectile","args":{"v":"0","i":"1","md":"1","hnp":"false","hp":"false","se":"false","sb":"false","fromorigin":"true","onend":"Maelstrom_ACTIVE"},"target":{"op":"origin","args":{"yoffset":"10"}}}]},
    "maelstrom_active": {"steps":[{"op":"totem","args":{"md":"30","ot":"Maelstrom_SPAWN_FX","hnp":"false","hp":"true","hr":"4","vr":"2","i":"10","hs":"true","hfs":"0.1"},"target":{"op":"origin","args":{}}},{"op":"delay","args":{"ticks":"30"}},{"op":"totem","args":{"md":"<modifier.duration> * 20","ot":"Maelstrom_TICK","hnp":"true","hp":"false","hr":"7","vr":"3","i":"20","hs":"true","hfs":"0.1"},"target":{"op":"origin","args":{}}},{"op":"totem","args":{"md":"<modifier.duration> * 20","ot":"Maelstrom_DRAG_TICK","hnp":"true","hp":"false","hr":"7","vr":"3","i":"5","hs":"true","hfs":"0.1"},"target":{"op":"origin","args":{}}},{"op":"totem","args":{"md":"<modifier.duration> * 20","hnp":"false","hp":"false","hr":"0.1","vr":"0.1","i":"1","hs":"true","hfs":"0.15","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7209","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"7.45,1,7.45","yawspeed":"0.08"},"target":{"op":"origin","args":{}}}]},
    "maelstrom_spawn_fx": {"steps":[{"op":"visual","args":{"shape":"ward","radius":"7","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"}}]},
    "maelstrom_tick": {"steps":[{"op":"skill","args":{"s":"Maelstrom_HIT"},"target":{"op":"entitiesnearorigin","args":{"r":"7"}}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "maelstrom_hit": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pkb":"true"}}],"targetConditions":["entitytype{t=armorstands} false"]},
    "maelstrom_drag_tick": {"steps":[{"op":"skill","args":{"s":"Maelstrom_DRAG"},"target":{"op":"entitiesnearorigin","args":{"r":"7"}}}]},
    "maelstrom_drag": {"steps":[{"op":"pull","args":{"velocity":"2.5","toorigin":"true"}}],"targetConditions":["entitytype{t=armorstands} false"]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_mitlan_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "468d1b9c3771c22a600e79a47b37fe72a1399d1f477501e0118a75b7c7540bc2"}
};
