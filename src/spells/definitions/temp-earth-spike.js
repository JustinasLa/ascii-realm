import presentation from '../presentations/temp-earth-spike.js';

// Gameplay derived from TF's configured rune/class ability.
export default {
  presentation,
  "id": "temp-earth-spike",
  "name": "Earth Spike",
  "element": "cerrith",
  "root": "temp_earth_spike",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 15.0,
        "mana": 6.0,
        "damage": 12.0,
        "range": 30.0
      },
      "root": "temp_earth_spike",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "temp_earth_spike": {"steps":[{"op":"projectile","args":{"ontick":"TEMP_Earth_Spike_SUM","v":"15","i":"4","hr":"1","vr":"1","mr":"<modifier.range>","hnp":"false","ho":"0","se":"false","d":"200","hs":"true","hfs":"0"},"target":{"op":"forward","args":{"f":"7","y":"0"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "temp_earth_spike_sum": {"steps":[{"op":"summon","args":{"type":"Stone_Erosion_Diag","amount":"1","radius":"0","yradius":"0"},"target":{"op":"origin","args":{}}},{"op":"skill","args":{"s":"TEMP_Earth_Erosion2_DAMAGE"},"target":{"op":"entitiesnearorigin","args":{"r":"2"}}}]},
    "temp_earth_erosion2_damage": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pkb":"false","hnp":"false","hp":"true"}},{"op":"throw","args":{"velocity":"8","velocityy":"8","delay":"1"}}],"targetConditions":["owner{} false"]}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_temp_skills.yml"], "sha256": "ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7"}
};
