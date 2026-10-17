import presentation from '../presentations/temp-vine-wave.js';

// Gameplay derived from TF's configured rune/class ability.
export default {
  presentation,
  "id": "temp-vine-wave",
  "name": "Vine Wave",
  "element": "cerrith",
  "root": "temp_vine_wave",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "cooldown": 20.0,
        "mana": 8.0,
        "damage": 16.0,
        "duration": 2.0
      },
      "root": "temp_vine_wave",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "temp_vine_wave": {"steps":[{"op":"projectile","args":{"ontick":"TEMP_Vine_Wave_TICK","v":"15","i":"3","hr":"1","vr":"1","mr":"12","hnp":"true","ho":"0","se":"false","sb":"false","hs":"true","hfs":"0","syo":"1.5","tyo":"1.5"},"target":{"op":"forward","args":{"f":"20"}}},{"op":"aura","args":{"auraname":"Vine_Wave_aura","interval":"1","duration":"20"},"target":{"op":"self","args":{}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "temp_vine_wave_tick": {"steps":[{"op":"summon","args":{"type":"Vine_Wave","amount":"1","radius":"0","yradius":"0","onsurface":"true"},"target":{"op":"origin","args":{}}},{"op":"skill","args":{"s":"TEMP_Vine_Wave_DAMAGE"},"target":{"op":"entitiesnearorigin","args":{"r":"3"}}}],"targetConditions":["entitytype{t=ARMOR_STAND} false"]},
    "temp_vine_wave_damage": {"steps":[{"op":"aura","args":{"auraname":"Vine_Wave_Stun","interval":"1","duration":"80"}},{"op":"skill","args":{"s":"TEMP_Vine_Wave_SUDO"}},{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>","pkb":"true","hnp":"true","hp":"true","delay":"15"}},{"op":"potion","args":{"type":"SLOW","duration":"<modifier.duration> * 20","level":"3","hasparticles":"false","delay":"15"}},{"op":"potion","args":{"type":"POISON","duration":"<modifier.duration> * 20","level":"1","hasparticles":"false","delay":"15"},"target":{"op":"target","args":{}}}],"targetConditions":["mmoCanTarget{interaction=OFFENSE_ACTION} true","entitytype{t=armorstands} false"]},
    "temp_vine_wave_sudo": {"steps":[{"op":"sudoskill","args":{"s":"TEMP_Vine_Wave_SUMMON","setcasterastrigger":"true","delay":"15"}}]},
    "temp_vine_wave_summon": {"steps":[{"op":"summon","args":{"type":"Vine_Entangle","amount":"1","radius":"0","yradius":"0","onsurface":"true"},"target":{"op":"self","args":{}}}],"cooldown":1}
  },
  "source": {"snapshot": "TFMCMain01 2026-10-16", "files": ["MythicMobs/skills/TFMC/Classes/tfmc_status_skills.yml", "MythicMobs/skills/TFMC/Classes/tfmc_temp_skills.yml"], "sha256": "ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7"}
};
