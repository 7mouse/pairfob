#!/usr/bin/env python3
"""Bind a release APK to the clean source and production origins used to build it."""
import json
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ENTRY = "assets/public/build-provenance.json"


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True).strip()


def snapshot():
    # The handoff transcript is local context, not a build input.
    dirty = git("status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude)handoff.md")
    if dirty:
        raise ValueError("release requires committed source (including new files)")
    return {"commit": git("rev-parse", "HEAD"), "tree": git("rev-parse", "HEAD^{tree}"),
            "dirty": False, "relayOrigin": "https://pairfob.com",
            "downloadOrigin": "https://dl.pairfob.com", "webViewOrigin": "https://localhost"}


def validate(data):
    if not isinstance(data, dict) or data.get("dirty") is not False:
        raise ValueError("APK has no clean source provenance; rebuild from committed source")
    for key in ("commit", "tree"):
        if not isinstance(data.get(key), str) or not re.fullmatch(r"[0-9a-f]{40}", data[key]):
            raise ValueError("invalid APK source provenance")
    for key, expected in (("relayOrigin", "https://pairfob.com"),
                          ("downloadOrigin", "https://dl.pairfob.com"),
                          ("webViewOrigin", "https://localhost")):
        if data.get(key) != expected:
            raise ValueError("APK was not built for the production origins")
    return data


def from_apk(path):
    with zipfile.ZipFile(path) as apk:
        if apk.namelist().count(ENTRY) != 1 or apk.getinfo(ENTRY).file_size > 4096:
            raise ValueError("missing or ambiguous APK source provenance")
        return validate(json.loads(apk.read(ENTRY)))


def receipt(path, data):
    return {**data, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest()}


def verify_receipt(path):
    data = from_apk(path)
    saved = json.loads(Path(str(path) + ".provenance.json").read_text())
    if saved != receipt(path, data):
        raise ValueError("APK differs from the completed release build; rebuild before publishing")
    return data


def main():
    mode, path = sys.argv[1:]
    if mode == "stamp":
        Path(path).write_text(json.dumps(snapshot(), indent=2) + "\n")
    elif mode == "check":
        if validate(json.loads(Path(path).read_text())) != snapshot():
            raise ValueError("source changed during the Android build; rebuild before publishing")
    elif mode == "seal":
        data = from_apk(path)
        if data != snapshot():
            raise ValueError("source changed during the Android build")
        Path(path + ".provenance.json").write_text(json.dumps(receipt(path, data), indent=2) + "\n")
    elif mode == "apk":
        data = verify_receipt(path)
        if git("rev-parse", data["commit"] + "^{tree}") != data["tree"]:
            raise ValueError("APK source commit and tree differ")
        print(data["commit"])
    else:
        raise ValueError("unknown provenance command")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
