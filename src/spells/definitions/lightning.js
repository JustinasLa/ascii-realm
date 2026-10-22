// Authored for ASCII Realm in TF's rune graph format; not part of the TF snapshot.
import presentation from '../presentations/lightning.js';

export default {
  presentation,
  "id": "lightning",
  "name": "Lightning",
  "element": "mitlan",
  "root": "lightning",
  "variants": [
    {
      "id": "rune",
      "kind": "rune",
      "params": {
        "mana": 7.0,
        "damage": 18.0,
        "radius": 2.5,
        "stun": 0.5,
        "chain": 0.5,
        "reach": 3.0
      },
      "root": "lightning",
      "trigger": "CAST"
    }
  ],
  "supportive": false,
  "nodes": {
    "lightning": {"steps":[{"op":"totem","args":{"md":"12","hr":"<modifier.radius>","i":"20","hnp":"false","hp":"false","oe":"Lightning_STRIKE"},"target":{"op":"targetlocation","args":{"max":"18"}}}],"conditions":["hasaura{aura=Silenced} castinstead Silence_MSG"]},
    "silence_msg": {"steps":[{"op":"randomskill","args":{"s":"Silence_MSG_1"},"target":{"op":"self","args":{}}}],"cooldown":1},
    "silence_msg_1": {"steps":[{"op":"actionmessage","args":{"m":"<gradient:#15e5ff:#82e8f5> You are Silenced </gradient>"}}]},
    "lightning_strike": {"steps":[{"op":"skill","args":{"s":"Lightning_GROUND"},"target":{"op":"origin","args":{}}},{"op":"skill","args":{"s":"Lightning_BOLT"},"target":{"op":"entitiesnearorigin","args":{"r":"<modifier.radius>","limit":"1","sort":"NEAREST"}}}]},
    "lightning_ground": {"steps":[{"op":"fakelightning","args":{"r":"<modifier.radius>"},"target":{"op":"origin","args":{}}}],"conditions":["entitiesinradius{r=<modifier.radius>} false"]},
    "lightning_bolt": {"steps":[{"op":"fakelightning","args":{"r":"<modifier.radius>"},"target":{"op":"target","args":{}}},{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage>"},"target":{"op":"target","args":{}}},{"op":"stun","args":{"d":"<modifier.stun> * 20"},"target":{"op":"target","args":{}}},{"op":"chain","args":{"bounces":"8","bounceradius":"<modifier.reach>","originradius":"<modifier.radius>","bouncedelay":"2","onbounce":"Lightning_CHAINED","hittarget":"false"},"target":{"op":"target","args":{}}}],"targetConditions":["entitytype{t=armorstands} false"]},
    "lightning_chained": {"steps":[{"op":"mmodamage","args":{"types":"MAGIC","a":"<modifier.damage> * <modifier.chain>"}}],"targetConditions":["entitytype{t=armorstands} false"]}
  },
  "source": {"authored": "ASCII Realm 2026-10-22"}
};
