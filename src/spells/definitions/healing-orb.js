// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "healing-orb",
  "name": "Healing Orb",
  "element": "cerrith",
  "root": "healing_orb",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 10.0,
        "mana": 4.0,
        "heal": 12.0
      },
      "root": "healing_orb",
      "trigger": "CAST"
    }
  ],
  "supportive": true,
  "nodes": {
    "healing_orb": {"steps":[{"op":"projectile","args":{"ontick":"Healing_Orb_TICK","onhit":"Healing_Orb_HIT","v":"40","i":"1","hr":"1","vr":"1","mr":"40","hnp":"true","syo":"1.5","tyo":"1.5","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7201","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"0.55,0.55,0.55","bulletbillboard":"CENTER"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "healing_orb_tick": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "healing_orb_hit": {"steps":[{"op":"skill","args":{"s":"Healing_Orb_HEAL"}},{"op":"randomskill","args":{"s":"Healing_Orb_FX_1"}}]},
    "healing_orb_heal": {"steps":[{"op":"heal","args":{"a":"<modifier.heal>"},"target":{"op":"playersnearorigin","args":{"r":"3","limit":"1","sort":"NEAREST"}}}]},
    "healing_orb_fx_1": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"3","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_cerrith_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "c9f405f18142629574b33481eadbd1e219bd9e0ed27d41487977509c68af4129"}
};
