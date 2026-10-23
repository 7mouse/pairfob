import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("provenance", Path(__file__).with_name("android-provenance.py"))
provenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provenance)


class ProvenanceTest(unittest.TestCase):
    def valid(self):
        return {"commit": "a" * 40, "tree": "b" * 40, "dirty": False,
                "relayOrigin": "https://pairfob.com", "downloadOrigin": "https://dl.pairfob.com",
                "webViewOrigin": "https://localhost"}

    def test_requires_clean_production_source(self):
        self.assertEqual(provenance.validate(self.valid()), self.valid())
        for patch in ({"dirty": True}, {"dirty": "false"}, {"commit": "unknown"},
                      {"tree": "HEAD"}, {"relayOrigin": "http://localhost"},
                      {"downloadOrigin": "https://example.com"}, {"webViewOrigin": "http://localhost"}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                provenance.validate(self.valid() | patch)

    def test_reads_signed_apk_entry_and_refuses_missing_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.apk"
            with zipfile.ZipFile(path, "w") as apk:
                apk.writestr(provenance.ENTRY, json.dumps(self.valid()))
            self.assertEqual(provenance.from_apk(path), self.valid())
            with zipfile.ZipFile(path, "w") as apk:
                apk.writestr("assets/public/index.html", "old APK")
            with self.assertRaises(ValueError):
                provenance.from_apk(path)

    def test_rejects_duplicate_or_oversized_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.apk"
            with zipfile.ZipFile(path, "w") as apk:
                apk.writestr(provenance.ENTRY, " " * 4097)
            with self.assertRaises(ValueError):
                provenance.from_apk(path)

    def test_receipt_binds_the_final_apk_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "app.apk"
            with zipfile.ZipFile(path, "w") as apk:
                apk.writestr(provenance.ENTRY, json.dumps(self.valid()))
            saved = Path(str(path) + ".provenance.json")
            saved.write_text(json.dumps(provenance.receipt(path, self.valid())))
            self.assertEqual(provenance.verify_receipt(path), self.valid())
            with zipfile.ZipFile(path, "a") as apk:
                apk.writestr("classes.dex", "rebuilt outside the release pipeline")
            with self.assertRaises(ValueError):
                provenance.verify_receipt(path)


if __name__ == "__main__":
    unittest.main()
