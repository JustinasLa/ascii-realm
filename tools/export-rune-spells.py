"""Export configured rune/class gameplay from a read-only plugin configuration snapshot.

Usage: python tools/export-rune-spells.py SNAPSHOT OUTPUT
Requires PyYAML for this offline authoring tool only. No server access or writes.
Tests: python3 -m unittest discover -s tools/tests
Minecraft display models and sound assets are replaced by ASCII effects; the
gameplay graph, targeting, formulas and timing remain individually reviewable.
The snapshot's own skill namespace is replaced by neutral rune_ names, and only
a content checksum of the configuration files used is kept with each spell.
"""
import argparse
import hashlib
import json
import pathlib
import re
from collections import OrderedDict

import yaml


def namespace(snapshot):
    """The folder under MythicMobs/skills that holds the class skills.

    Exporting without renaming would keep the snapshot's own identifiers, so
    anything but exactly one candidate stops the export until --namespace is given.
    """
    found = sorted({path.parent.parent.name.lower() for path in (snapshot / "MythicMobs/skills").rglob("Classes/*.yml")})
    if len(found) != 1:
        detail = "none found" if not found else f"found {len(found)}: {', '.join(found)}"
        raise ValueError(f"Cannot detect the skill namespace ({detail}); pass --namespace")
    return found[0]


def neutral(text, prefix):
    """Rename namespace-prefixed identifiers (variables such as caster.<prefix>_mana) to rune_."""
    return re.sub(rf"(?<![a-z0-9]){re.escape(prefix)}_", "rune_", text, flags=re.I) if prefix else text


def is_vfx(name):
    """Visual-only summons are named VFX_* or <namespace>_VFX_*."""
    return "VFX" in name.upper().split("_")[:2]


def read(path):
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def parse(text):
    match = re.match(r"\s*([^\s{]+)(?:\{(.*)\})?\s*$", text)
    if not match:
        raise ValueError(text)
    args = {}
    for part in re.split(r';(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)', match[2] or ""):
        if "=" in part:
            key, value = part.split("=", 1)
            args[key.strip().lower()] = value.strip().strip('"')
    return {"op": match[1].lower(), "args": args}


def step(text):
    if not isinstance(text, str):
        raise ValueError(text)
    text = re.split(r"\s+#", text)[0].strip()
    if text.lower().startswith("delay "):
        return {"op": "delay", "args": {"ticks": text.split(" ", 1)[1]}}
    # The targeter is outside the mechanic's braces, except teleportto's
    # location=@targetlocation inside the mechanic.
    depth, quote, split = 0, False, None
    for index, char in enumerate(text):
        if char == '"':
            quote = not quote
        if not quote:
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            elif char == "@" and depth == 0:
                split = index
                break
    body = text[:split].strip() if split is not None else text
    # Trailing cast chance belongs to the mechanic, not its arguments.
    chance = re.search(r"\}\s+(0?\.\d+)\s*$", body)
    if chance:
        body = body[:chance.start() + 1]
    result = parse(body)
    if split is not None:
        target = text[split + 1:]
        end = target.rfind("}") + 1 if "{" in target else len(target.split()[0])
        result["target"] = parse(target[:end])
    if chance:
        result["chance"] = float(chance[1])
    if result["op"].startswith("effect:") or result["op"] == "particles":
        if "sound" in result["op"]:
            return None
        args = result["args"]
        result = {**result, "op": "visual", "args": {
            "shape": "ward" if "ring" in result["op"] else "burst",
            "radius": args.get("radius", "1"), "life": "0.25",
        }}
    if result["op"] == "summon" and is_vfx(result["args"].get("type", "")):
        return {**result, "op": "visual", "args": {"radius": "2", "life": "0.4"}}
    if result["op"] == "projectile" and not any(k in result["args"] for k in ["onhit", "oh", "onend", "oe", "ontick", "ot", "onstart", "os"]):
        return {**result, "op": "visual", "args": {"radius": "0.6", "life": "0.3"}}
    # Bukkit-only absorption maximum reset is implicit in the shield expiry.
    if result["op"] == "attribute":
        return None
    if result["op"] == "randomskill":
        # Minecraft particle variants collapse to the same ASCII primitive.
        result["args"]["s"] = result["args"].get("s", "").split(",")[0]
    return result


def export(snapshot, output, include_classes=False, prefix=None):
    prefix = prefix or namespace(snapshot)
    library, nodes, node_sources = {}, {}, {}
    for path in sorted((snapshot / "MythicLib/skill").glob("*.yml")):
        for key, value in read(path).items():
            if isinstance(value, dict):
                library[key] = value
    for path in sorted((snapshot / "MythicMobs/skills").rglob("*.yml")):
        for key, value in read(path).items():
            if isinstance(value, dict):
                nodes[key.lower()] = value
                node_sources[key.lower()] = path
    spells = OrderedDict()

    def add(handler, variant, name=None, element=None):
        data = library[handler]
        root = data.get("mythicmobs-skill-id") or data.get("source", "").split(":")[-1]
        if not root:
            raise ValueError(handler)
        key = handler.removeprefix("CLASS_").lower().replace("_", "-")
        if key not in spells:
            spells[key] = {"id": key, "name": name or data.get("name") or key.replace("-", " ").title(),
                           "element": element or "martial", "root": root.lower(), "variants": []}
        spell = spells[key]
        variant.update(root=root.lower(), trigger=data.get("trigger", "CAST"))
        spell["variants"].append(variant)
        if data.get("lore"):
            spell.setdefault("description", " ".join(re.sub(r"&[0-9a-fklmnor]|<[^>]+>", "", x) for x in data["lore"] if "mana_name" not in x).strip())

    # Start with Fire Shard: it is also the end-to-end collision smoke test.
    for element in ["oseni", "seithr", "cerrith", "mitlan"]:
        path = snapshot / "MMOItems/item" / f"{element}_runes.yml"
        for value in read(path).values():
            base = value.get("base", {})
            for ability in base.get("ability", {}).values():
                handler = ability["type"]
                params = {k: v for k, v in ability.items() if isinstance(v, (int, float))}
                name = re.sub(r"<[^>]+>", "", base["name"])
                add(handler, {"id": "rune", "kind": "rune", "params": params}, name, element)
    for path in sorted((snapshot / "MMOCore/classes").glob("*.yml")) if include_classes else []:
        if path.stem in ["default", "test"]:
            continue
        for handler, config in (read(path).get("skills") or {}).items():
            params = {k: v for k, v in config.items() if isinstance(v, dict) and "base" in v}
            add(handler, {"id": path.stem, "kind": "class", "class": path.stem, "params": params})

    for spell in spells.values():
        graph, used = {}, set()

        def visit(key):
            key = key.lower()
            if key in graph:
                return
            if key not in nodes:
                raise ValueError(f"Missing skill {key} for {spell['id']}")
            source = nodes[key]
            graph[key] = compiled = {"steps": []}
            if source.get("Cooldown"):
                compiled["cooldown"] = source["Cooldown"]
            used.add(node_sources[key])
            for from_key, to_key in [("Conditions", "conditions"), ("TargetConditions", "targetConditions")]:
                if source.get(from_key):
                    compiled[to_key] = source[from_key]
                    for condition in source[from_key]:
                        ref = re.search(r"(?:castinstead|orElseCast| cast)\s+(\S+)", condition, re.I)
                        if ref and ref[1].lower() in nodes:
                            visit(ref[1])
            for line in source.get("Skills", []):
                parsed = step(line)
                if parsed is None:
                    continue
                compiled["steps"].append(parsed)
                for k, value in parsed["args"].items():
                    if k in ["s", "skill", "ot", "ontick", "oh", "onhit", "oe", "onend", "os", "onstart", "osh", "onhitskill"]:
                        for ref in value.split(","):
                            ref = ref.strip().split(" ")[0]
                            if ref.lower() in nodes:
                                visit(ref)
        for variant in spell["variants"]:
            visit(variant["root"])
        spell["nodes"] = graph
        spell["supportive"] = spell["element"] == "cerrith" and any(x in spell["id"] for x in ["orb", "cure", "transfer", "swiftness", "blessing"])
        spell["checksum"] = hashlib.sha256(b"".join(p.read_bytes() for p in sorted(used))).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    for spell in spells.values():
        # One node per line keeps each spell PR compact and readable.
        header = {k: v for k, v in spell.items() if k not in ["nodes", "checksum"]}
        text = json.dumps(header, ensure_ascii=False, indent=2)[:-2] + ',\n  "nodes": {\n'
        text += ',\n'.join('    ' + json.dumps(k) + ': ' + json.dumps(v, ensure_ascii=False, separators=(',', ':')) for k, v in spell['nodes'].items())
        text += '\n  },\n  "checksum": ' + json.dumps(spell['checksum']) + '\n}'
        text = neutral(text, prefix)
        (output / f"{spell['id']}.js").write_text("// Rune gameplay graph generated by tools/export-rune-spells.py.\nexport default " + text + ";\n", encoding="utf-8")
    return list(spells)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--include-classes", action="store_true")
    parser.add_argument("--namespace", help="skill namespace to rename to rune_ (default: detected from the snapshot)")
    args = parser.parse_args()
    try:
        ids = export(args.snapshot, args.output, args.include_classes, args.namespace)
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(ids))
