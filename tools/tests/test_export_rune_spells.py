"""Tests for tools/export-rune-spells.py. Run: python3 -m unittest discover -s tools/tests"""
import contextlib
import importlib.util
import io
import pathlib
import shutil
import sys
import tempfile
import unittest

TOOL = pathlib.Path(__file__).resolve().parents[1] / "export-rune-spells.py"
spec = importlib.util.spec_from_file_location("export_rune_spells", TOOL)
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


def snapshot(root, namespaces):
    """A minimal snapshot with one rune whose skill lives under each made-up namespace."""
    write = lambda path, text: (path.parent.mkdir(parents=True, exist_ok=True), path.write_text(text, encoding="utf-8"))
    write(root / "MythicLib/skill/runes.yml", "FIRE_SHARD:\n  mythicmobs-skill-id: Fire_Shard\n")
    write(root / "MMOItems/item/oseni_runes.yml",
          "FIRE:\n  base:\n    name: <red>Fire Shard\n    ability:\n      a:\n        type: FIRE_SHARD\n        damage: 4\n")
    for element in ["seithr", "cerrith", "mitlan"]:
        write(root / f"MMOItems/item/{element}_runes.yml", "{}\n")
    for name in namespaces:
        write(root / f"MythicMobs/skills/{name}/Classes/fire.yml",
              f"Fire_Shard:\n  Skills:\n  - setvariable{{var=caster.{name}_mana;value=1}} @self\n")
    return root


class ExportTest(unittest.TestCase):
    def setUp(self):
        self.dir = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)
        self.out = self.dir / "out"

    def test_detected_namespace_is_renamed(self):
        ids = tool.export(snapshot(self.dir / "snap", ["acme"]), self.out)
        text = (self.out / "fire-shard.js").read_text(encoding="utf-8")
        self.assertEqual(ids, ["fire-shard"])
        self.assertIn("caster.rune_mana", text)
        self.assertNotIn("acme", text.lower())

    def test_missing_namespace_requires_flag(self):
        with self.assertRaisesRegex(ValueError, r"none found.*--namespace"):
            tool.export(snapshot(self.dir / "snap", []), self.out)
        self.assertFalse(self.out.exists())

    def test_several_namespaces_require_flag(self):
        with self.assertRaisesRegex(ValueError, r"found 2: acme, zeta.*--namespace"):
            tool.export(snapshot(self.dir / "snap", ["zeta", "acme"]), self.out)
        self.assertFalse(self.out.exists())

    def test_explicit_namespace_skips_detection(self):
        # The skill file sorted last (zeta) defines the exported node.
        tool.export(snapshot(self.dir / "snap", ["zeta", "acme"]), self.out, prefix="zeta")
        text = (self.out / "fire-shard.js").read_text(encoding="utf-8")
        self.assertIn("caster.rune_mana", text)
        self.assertNotIn("zeta_", text.lower())

    def test_cli_reports_ambiguity_as_usage_error(self):
        argv, sys.argv = sys.argv, [str(TOOL), str(snapshot(self.dir / "snap", [])), str(self.out)]
        stderr = io.StringIO()
        try:
            with self.assertRaises(SystemExit) as exit, contextlib.redirect_stderr(stderr):
                exec(compile(TOOL.read_text(encoding="utf-8"), str(TOOL), "exec"), {"__name__": "__main__"})
        finally:
            sys.argv = argv
        self.assertEqual(exit.exception.code, 2)
        self.assertIn("pass --namespace", stderr.getvalue())
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
