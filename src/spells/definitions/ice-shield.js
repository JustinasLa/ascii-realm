// Gameplay derived from TF's configured rune/class ability.
import presentation from '../presentations/ice-shield.js';

export default {
  presentation,
  "id": "ice-shield",
  "name": "Ice Shield",
  "element": "seithr",
  "root": "ice_shield",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 15.0,
        "mana": 6.0,
        "shield_power": 10.0,
        "shield_duration": 6.0
      },
      "root": "ice_shield",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "ice_shield": {"steps":[{"op":"potion","args":{"type":"ABSORPTION","duration":"<modifier.shield_duration> * 20","level":"(<modifier.shield_power> + 3) / 4 - 1","hasparticles":"false"},"target":{"op":"self","args":{}}},{"op":"shield","args":{"a":"0","ms":"<modifier.shield_power>"},"target":{"op":"self","args":{}}},{"op":"randomskill","args":{"s":"Ice_Shield_FX_1"},"target":{"op":"self","args":{}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "ice_shield_fx_1": {"steps":[{"op":"visual","args":{"radius":"2","life":"0.4"},"target":{"op":"self","args":{}}},{"op":"visual","args":{"shape":"burst","radius":"1.5","life":"0.25"}}]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_seithr_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml"], "sha256": "dd420157d6e6bbbfa6a8aa60a51f3e625b8a4885f4070cfc3fb59b94b1130599"}
};
