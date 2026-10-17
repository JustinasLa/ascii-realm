// Gameplay derived from TF's configured rune/class ability.
import presentation from '../presentations/oseni-glyph.js';

export default {
  presentation,
  "id": "oseni-glyph",
  "name": "Oseni Glyph",
  "element": "oseni",
  "root": "oseni_glyph",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 20.0,
        "mana": 8.0,
        "duration": 8.0,
        "damage": 23.0
      },
      "root": "oseni_glyph",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "oseni_glyph": {"steps":[{"op":"projectile","args":{"onend":"Oseni_Glyph_SUMMON_LEVEL","v":"2","i":"1","gravity":"0.9","hr":"1","vr":"1","mr":"5","hnp":"false","se":"false","sb":"true"},"target":{"op":"forward","args":{"f":"20","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "oseni_glyph_summon_level": {"steps":[{"op":"projectile","args":{"v":"0","i":"1","md":"1","hnp":"false","hp":"false","se":"false","sb":"false","fromorigin":"true","onend":"Oseni_Glyph_SUMMON"},"target":{"op":"origin","args":{"yoffset":"10"}}}]},
    "oseni_glyph_summon": {"steps":[{"op":"totem","args":{"md":"20","ot":"Oseni_Glyph_SKILLSPAWN_FX","hnp":"false","hp":"true","hr":"4","vr":"2","i":"20","hs":"true","hfs":"0.1","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7206","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"2.13,1,2.13"},"target":{"op":"origin","args":{}}},{"op":"delay","args":{"ticks":"20"}},{"op":"totem","args":{"md":"<modifier.duration> * 20","oh":"Oseni_Glyph_SKILL","hnp":"true","hp":"true","hr":"4","vr":"2","i":"1","ch":"1","delay":"1","hs":"true","hfs":"0.1"},"target":{"op":"origin","args":{}}},{"op":"totem","args":{"md":"<modifier.duration> * 20","ot":"Oseni_Glyph_SKILL_FX","hnp":"true","hp":"true","hr":"4","vr":"2","i":"5","ch":"1","delay":"1","hs":"true","hfs":"0.1","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7206","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"4.26,1,4.26"},"target":{"op":"origin","args":{}}},{"op":"totem","args":{"md":"<modifier.duration> * 20","ot":"Oseni_Glyph_SKILL_FXSOUND","hnp":"true","hp":"true","hr":"4","vr":"2","i":"40","ch":"1","delay":"1","hs":"true","hfs":"0.1"},"target":{"op":"origin","args":{}}}]},
    "oseni_glyph_skillspawn_fx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"ringaroundorigin","args":{"r":"1","p":"4"}}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"ringaroundorigin","args":{"r":"1","p":"8"}}},{"op":"delay","args":{"ticks":"5"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"ringaroundorigin","args":{"r":"2","p":"12"}}},{"op":"delay","args":{"ticks":"2"}},{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"ringaroundorigin","args":{"r":"2","p":"16"}}}]},
    "oseni_glyph_skill": {"steps":[{"op":"skill","args":{"s":"Oseni_Glyph_SKILL_ACTIVE"},"target":{"op":"entitiesnearorigin","args":{"r":"6"}}}]},
    "oseni_glyph_skill_active": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pi":"true"}},{"op":"skill","args":{"s":"Oseni_Glyph_SKILL_ACTIVE_FX"},"target":{"op":"origin","args":{}}}]},
    "oseni_glyph_skill_active_fx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"delay","args":{"ticks":"1"}},{"op":"visual","args":{"shape":"burst","radius":"3","life":"0.25"},"target":{"op":"origin","args":{}}},{"op":"delay","args":{"ticks":"1"}},{"op":"visual","args":{"shape":"burst","radius":"6","life":"0.25"},"target":{"op":"origin","args":{}}}]},
    "oseni_glyph_skill_fx": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"1","life":"0.25"},"target":{"op":"ringaroundorigin","args":{"r":"2","p":"5"}}}]},
    "oseni_glyph_skill_fxsound": {"steps":[]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_oseni_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "cc41f032e051b5cfe15d040f7fbd68b0cc12ff0501dca0bfd844b295b09958b9"}
};
