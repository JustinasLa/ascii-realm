// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "cerrith-glyph",
  "name": "Cerrith Glyph",
  "element": "cerrith",
  "root": "cerrith_glyph",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 20.0,
        "mana": 8.0,
        "duration": 8.0,
        "shield_power": 23.0,
        "shield_duration": 6.0
      },
      "root": "cerrith_glyph",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "cerrith_glyph": {"steps":[{"op":"projectile","args":{"onend":"Cerrith_Glyph_SUMMON_LEVEL","v":"2","i":"1","gravity":"0.9","hr":"1","vr":"1","mr":"5","hnp":"false","se":"false","sb":"true"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "cerrith_glyph_summon_level": {"steps":[{"op":"projectile","args":{"v":"0","i":"1","md":"1","hnp":"false","hp":"false","se":"false","sb":"false","fromorigin":"true","onend":"Cerrith_Glyph_SUMMON"},"target":{"op":"origin","args":{"yoffset":"10"}}}]},
    "cerrith_glyph_summon": {"steps":[{"op":"totem","args":{"md":"20","ot":"Cerrith_Glyph_SKILLSPAWN_FX","hnp":"false","hp":"true","hr":"4","vr":"2","i":"20","hs":"true","hfs":"0.1","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7205","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"2.13,1,2.13"},"target":{"op":"origin","args":{}}},{"op":"delay","args":{"ticks":"20"}},{"op":"totem","args":{"md":"<modifier.duration> * 20","oh":"Cerrith_Glyph_SKILL","hnp":"true","hp":"true","hr":"4","vr":"2","i":"1","ch":"1","delay":"1","hs":"true","hfs":"0.1"},"target":{"op":"origin","args":{}}},{"op":"totem","args":{"md":"<modifier.duration> * 20","ot":"Cerrith_Glyph_SKILL_FX","hnp":"true","hp":"true","hr":"4","vr":"2","i":"5","ch":"1","delay":"1","hs":"true","hfs":"0.1","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7205","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"4.26,1,4.26"},"target":{"op":"origin","args":{}}},{"op":"totem","args":{"md":"<modifier.duration> * 20","ot":"Cerrith_Glyph_SKILL_FXSOUND","hnp":"true","hp":"true","hr":"4","vr":"2","i":"40","ch":"1","delay":"1","hs":"true","hfs":"0.1"},"target":{"op":"origin","args":{}}}]},
    "cerrith_glyph_skillspawn_fx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"ringaroundorigin","args":{"r":"1","p":"4"}}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"ringaroundorigin","args":{"r":"1","p":"8"}}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"ringaroundorigin","args":{"r":"2","p":"12"}}},{"op":"delay","args":{"ticks":"2"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"ringaroundorigin","args":{"r":"2","p":"16"}}}]},
    "cerrith_glyph_skill": {"steps":[{"op":"skill","args":{"s":"Cerrith_Glyph_SKILL_HEAL"},"target":{"op":"playersnearorigin","args":{"r":"6"}}}]},
    "cerrith_glyph_skill_heal": {"steps":[{"op":"potion","args":{"type":"ABSORPTION","duration":"<modifier.shield_duration> * 20","level":"(<modifier.shield_power> + 3) / 4 - 1","hasparticles":"false"}},{"op":"shield","args":{"a":"0","ms":"<modifier.shield_power>"}},{"op":"skill","args":{"s":"Cerrith_Glyph_SKILL_HEAL_FX"},"target":{"op":"origin","args":{}}}],"targetConditions":["variableequals{var=target.tfmc_foe_<caster.uuid>;value=\"<caster.uuid>\"} false"]},
    "cerrith_glyph_skill_heal_fx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"delay","args":{"ticks":"1"}},{"op":"visual","args":{"shape":"burst","radius":"3","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"delay","args":{"ticks":"1"}},{"op":"visual","args":{"shape":"burst","radius":"6","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "cerrith_glyph_skill_fx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"ringaroundorigin","args":{"r":"2","p":"5"}}}]},
    "cerrith_glyph_skill_fxsound": {"steps":[]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_cerrith_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "c9f405f18142629574b33481eadbd1e219bd9e0ed27d41487977509c68af4129"}
};
