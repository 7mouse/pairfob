#!/usr/bin/env python3
"""Preserve the other release channel when replacing a Worker's static assets."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tempfile
from urllib.parse import urlsplit

DAEMON_FILES = {"VERSION", "SHA256SUMS", "pairfob-darwin-amd64", "pairfob-darwin-arm64",
                "pairfob-linux-amd64", "pairfob-linux-arm64"}
DAEMON_PATHS = {"daemon/" + name for name in DAEMON_FILES} | {"install.sh"}
APK_PATH = re.compile(r"/android/beta/[A-Za-z0-9._-]+\.apk\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
VERSION = re.compile(r"v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def version(value):
    match = VERSION.fullmatch(value) if isinstance(value, str) else None
    if not match:
        raise ValueError("daemon release must use three-part SemVer")
    return tuple(int(part) for part in match.groups())


def origin(value):
    parsed = urlsplit(value)
    if (parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ("", "/") or not parsed.hostname
            or (parsed.scheme != "https" and not
                (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1")))):
        raise ValueError("download origin must be HTTPS (HTTP only on loopback)")
    return value.rstrip("/")


def fetch(base, path, limit=65536, optional=False):
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "response"
        result = subprocess.run([
            "curl", "--silent", "--show-error", "--max-time", "120", "--retry", "2",
            "--max-filesize", str(limit), "-o", str(output), "-w", "%{http_code}", base + path,
        ], capture_output=True, text=True)
        if result.returncode:
            raise ValueError(f"download failed for {path}: {result.stderr.strip()}")
        if optional and result.stdout == "404":
            return None
        if result.stdout != "200":
            raise ValueError(f"download failed for {path}: HTTP {result.stdout}")
        data = output.read_bytes()
        if len(data) > limit:
            raise ValueError(f"download too large: {path}")
        return data


def daemon_manifest(data):
    value = json.loads(data)
    version(value.get("version"))
    if value.get("schema") != 1 or not re.fullmatch(r"[0-9a-f]{40}", value.get("commit", "")):
        raise ValueError("invalid daemon release provenance")
    files = value.get("files")
    if not isinstance(files, dict) or set(files) != DAEMON_PATHS:
        raise ValueError("invalid daemon release inventory")
    for info in files.values():
        if (not isinstance(info, dict) or not isinstance(info.get("sha256"), str)
                or not SHA.fullmatch(info["sha256"]) or type(info.get("size")) is not int
                or not 0 < info["size"] <= 64 * 1024 * 1024):
            raise ValueError("invalid daemon artifact hash or size")
    return value


def android_manifest(data, previous=False):
    value = json.loads(data)
    code, path, sha = value.get("versionCode"), value.get("url"), value.get("sha256")
    if (type(code) is not int or not 0 < code <= 2147483647 or not isinstance(path, str)
            or not APK_PATH.fullmatch(path) or path.endswith("/latest.apk")
            or not isinstance(sha, str) or not SHA.fullmatch(sha)):
        raise ValueError("invalid Android release inventory")
    # Old previous.json records may refer to the former relay path.
    if previous and value.get("origin") not in (None, "https://dl.pairfob.com"):
        raise ValueError("previous Android release must be on the download host")
    return value


def check_receipt(receipt):
    for path, expected in receipt["metadata"].items():
        data = fetch(receipt["origin"], path, optional=True)
        if (digest(data) if data is not None else None) != expected:
            raise ValueError(f"download channel changed during publication: {path}")


def preserve(base, public, channel, receipt_path, required=False):
    metadata = {}
    def read(path):
        data = fetch(base, path, optional=True)
        metadata[path] = digest(data) if data is not None else None
        return data
    public.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=public.parent) as directory:
        staged = Path(directory)
        def save(path, data):
            target = staged / path.lstrip("/")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        if channel == "daemon":
            data = read("/daemon/release.json")
            if data is None:
                if required:
                    raise ValueError("publish the daemon download channel before publishing Android")
                # An absent channel is allowed only before the initial migration.
                if read("/daemon/VERSION") is not None:
                    raise ValueError("daemon channel has no verified inventory")
            else:
                manifest = daemon_manifest(data)
                for path, info in manifest["files"].items():
                    payload = fetch(base, "/" + path, info["size"])
                    if len(payload) != info["size"] or digest(payload) != info["sha256"]:
                        raise ValueError(f"daemon artifact mismatch: {path}")
                    save(path, payload)
                save("daemon/release.json", data)
        else:
            data = read("/android/beta/latest.json")
            if data is not None:
                latest = android_manifest(data)
                entries = [latest]
                save("android/beta/latest.json", data)
                previous = read("/android/beta/previous.json")
                if previous is not None:
                    prior = android_manifest(previous, previous=True)
                    if prior["versionCode"] >= latest["versionCode"]:
                        raise ValueError("Android predecessor is not older")
                    entries.append(prior)
                    save("android/beta/previous.json", previous)
                for entry in entries:
                    payload = fetch(base, entry["url"], 64 * 1024 * 1024)
                    if digest(payload) != entry["sha256"]:
                        raise ValueError("Android APK hash mismatch")
                    save(entry["url"], payload)
                    provenance = read(entry["url"] + ".provenance.json")
                    if provenance is not None:
                        saved = json.loads(provenance)
                        if saved.get("sha256") != entry["sha256"]:
                            raise ValueError("Android provenance hash mismatch")
                        save(entry["url"] + ".provenance.json", provenance)
        receipt = {"origin": base, "metadata": metadata}
        check_receipt(receipt)
        # Replace only the untouched channel, never the channel being published.
        target = public / ("daemon" if channel == "daemon" else "android/beta")
        if target.exists():
            shutil.rmtree(target)
        source = staged / ("daemon" if channel == "daemon" else "android/beta")
        if source.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source, target)
        if channel == "daemon":
            if (staged / "install.sh").exists():
                shutil.copyfile(staged / "install.sh", public / "install.sh")
            elif (public / "install.sh").exists():
                (public / "install.sh").unlink()
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")


def stage_daemon(base, public, source, installer, receipt_path):
    source = source.resolve()
    release = (source / "VERSION").read_text().strip()
    version(release)
    commit = None
    for name in sorted(DAEMON_FILES - {"VERSION", "SHA256SUMS"}):
        output = subprocess.check_output(["go", "version", "-m", str(source / name)], text=True)
        settings = {}
        for line in output.splitlines():
            parts = line.strip().split("\t", 1)
            if len(parts) == 2 and parts[0] == "build" and "=" in parts[1]:
                key, val = parts[1].split("=", 1)
                settings[key] = val
        os_name, arch = name.removeprefix("pairfob-").split("-")
        revision = settings.get("vcs.revision", "")
        if (settings.get("vcs.modified") != "false" or settings.get("GOOS") != os_name
                or settings.get("GOARCH") != arch or not re.fullmatch(r"[0-9a-f]{40}", revision)):
            raise ValueError(f"binary has wrong or dirty build provenance: {name}")
        if commit is not None and revision != commit:
            raise ValueError("daemon binaries have different source commits")
        commit = revision
    native_os = platform.system().lower()
    native_arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "amd64", "AMD64": "amd64"}.get(platform.machine())
    native = f"pairfob-{native_os}-{native_arch}"
    if native not in DAEMON_FILES:
        raise ValueError("publish on macOS or Linux with a supported architecture")
    output = subprocess.check_output([str(source / native), "version"], text=True, timeout=5)
    if not output.startswith(f"pairfob {release} "):
        raise ValueError("native executable version differs from VERSION")
    paths = {"daemon/" + name: source / name for name in DAEMON_FILES}
    paths["install.sh"] = installer
    manifest = {"schema": 1, "version": release, "commit": commit,
                "files": {name: {"sha256": digest(path.read_bytes()), "size": path.stat().st_size}
                          for name, path in sorted(paths.items())}}
    daemon_manifest(json.dumps(manifest))
    old = fetch(base, "/daemon/release.json", optional=True)
    if old is not None:
        prior = daemon_manifest(old)
        if version(release) < version(prior["version"]):
            raise ValueError("refusing daemon version rollback")
        if version(release) == version(prior["version"]):
            for path in DAEMON_PATHS - {"install.sh"}:
                if prior["files"][path] != manifest["files"][path]:
                    raise ValueError("published daemon version already has different bytes")
    receipt_path.write_text(json.dumps({"origin": base, "metadata": {
        "/daemon/release.json": digest(old) if old is not None else None}}, indent=2) + "\n")
    public.mkdir(parents=True, exist_ok=True)
    for name, path in paths.items():
        dest = public / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, dest)
    (public / "daemon/release.json").write_text(json.dumps(manifest, indent=2) + "\n")


def verify_daemon(base, public):
    expected = (public / "daemon/release.json").read_bytes()
    actual = fetch(base, "/daemon/release.json")
    if actual != expected:
        raise ValueError("live daemon manifest differs from candidate")
    for path, info in daemon_manifest(actual)["files"].items():
        data = fetch(base, "/" + path, info["size"])
        if len(data) != info["size"] or digest(data) != info["sha256"]:
            raise ValueError(f"live daemon artifact mismatch: {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["preserve", "check", "stage-daemon", "verify-daemon"])
    parser.add_argument("--origin", default="https://dl.pairfob.com")
    parser.add_argument("--public", type=Path)
    parser.add_argument("--channel", choices=["android", "daemon"])
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--require-present", action="store_true")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--installer", type=Path)
    args = parser.parse_args()
    base = origin(args.origin)
    if args.mode == "preserve":
        preserve(base, args.public, args.channel, args.receipt, args.require_present)
    elif args.mode == "check":
        check_receipt(json.loads(args.receipt.read_text()))
    elif args.mode == "stage-daemon":
        stage_daemon(base, args.public, args.source, args.installer, args.receipt)
    else:
        verify_daemon(base, args.public)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
