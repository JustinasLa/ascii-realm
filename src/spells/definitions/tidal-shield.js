// Gameplay derived from TF's configured rune/class ability.
export default {
  "id": "tidal-shield",
  "name": "Tidal Shield",
  "element": "mitlan",
  "root": "tidal_shield",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 15.0,
        "mana": 6.0,
        "shield_power": 7.0,
        "shield_duration": 6.0,
        "damage": 6.0
      },
      "root": "tidal_shield",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "tidal_shield": {"steps":[{"op":"potion","args":{"type":"ABSORPTION","duration":"<modifier.shield_duration> * 20","level":"(<modifier.shield_power> + 3) / 4 - 1","hasparticles":"false"},"target":{"op":"self","args":{}}},{"op":"shield","args":{"a":"0","ms":"<modifier.shield_power>"},"target":{"op":"self","args":{}}},{"op":"skill","args":{"s":"Tidal_Shield_BURST"},"target":{"op":"livinginradius","args":{"r":"3"}}},{"op":"randomskill","args":{"s":"Tidal_Shield_FX_1"},"target":{"op":"self","args":{}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "tidal_shield_burst": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pi":"true"}},{"op":"throw","args":{"velocity":"10","velocityy":"2"}}],"targetConditions":["entitytype{t=armorstands} false"]},
    "tidal_shield_fx_1": {"steps":[{"op":"visual","args":{"radius":"2","life":"0.4"},"target":{"op":"selflocation","args":{"cpitch":"0.01"}}},{"op":"visual","args":{"shape":"burst","radius":"2","life":"0.25"}},{"op":"visual","args":{"shape":"ward","radius":"3","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_mitlan_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "468d1b9c3771c22a600e79a47b37fe72a1399d1f477501e0118a75b7c7540bc2"}
};
