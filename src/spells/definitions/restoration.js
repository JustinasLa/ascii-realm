// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "restoration",
  "name": "Restoration",
  "element": "cerrith",
  "root": "restoration",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 20.0,
        "mana": 8.0
      },
      "root": "restoration",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "restoration": {"steps":[{"op":"totem","args":{"md":"37","oe":"Restoration_RESTORE","ot":"Restoration_FX","hnp":"true","hp":"true","hr":"4","vr":"2","i":"4","delay":"1","hs":"true","hfs":"0.1","bullettype":"DISPLAY","bulletmaterial":"PAPER","bulletmodel":"7205","bulletbrightness":"15","bulletbrightnesssky":"15","bulletscale":"5.32,1,5.32"},"target":{"op":"self","args":{}}},{"op":"potion","args":{"type":"SLOW","duration":"40","level":"100","hasparticles":"false"},"target":{"op":"self","args":{}}},{"op":"onjump","args":{"ce":"true","d":"40","cancelondeath":"true","cancelonquit":"true","cancelonchangeworld":"true"},"target":{"op":"self","args":{}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "restoration_restore": {"steps":[{"op":"randomskill","args":{"s":"Restoration_RESTORE_FX_1"}},{"op":"delay","args":{"ticks":"3"}},{"op":"skill","args":{"s":"Restoration_CLEANSE"},"target":{"op":"self","args":{}}},{"op":"skill","args":{"s":"Restoration_CLEANSE"},"target":{"op":"playersnearorigin","args":{"r":"5"}}}]},
    "restoration_restore_fx_1": {"steps":[{"op":"visual","args":{"radius":"2","life":"0.4"},"target":{"op":"origin","args":{"cpitch":"0.01"}}},{"op":"visual","args":{"shape":"burst","radius":"3","life":"0.25"}}]},
    "restoration_cleanse": {"steps":[{"op":"auraremove","args":{"aura":"Slowed"}},{"op":"auraremove","args":{"aura":"Frozen"}},{"op":"auraremove","args":{"aura":"Burnt"}},{"op":"auraremove","args":{"aura":"Weakened"}}],"targetConditions":["variableequals{var=target.tfmc_foe_<caster.uuid>;value=\"<caster.uuid>\"} false"]},
    "restoration_fx": {"steps":[{"op":"randomskill","args":{"s":"Restoration_FX_1"}}]},
    "restoration_fx_1": {"steps":[{"op":"visual","args":{"shape":"burst","radius":"5","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_cerrith_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "c9f405f18142629574b33481eadbd1e219bd9e0ed27d41487977509c68af4129"}
};
