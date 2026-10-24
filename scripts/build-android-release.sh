#!/usr/bin/env bash
# Build and stamp one signed APK from a stable, committed source snapshot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
snapshot="$(mktemp)"
trap 'rm -f "$snapshot"' EXIT
python3 "$ROOT/scripts/android-provenance.py" stamp "$snapshot"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export PAIRFOB_ANDROID_SCHEME=https
export VITE_PAIRFOB_RELAY_ORIGIN=https://pairfob.com
export VITE_PAIRFOB_DOWNLOAD_ORIGIN=https://dl.pairfob.com
cd "$ROOT/mobile"
bun run pwa:native
cp "$snapshot" "$ROOT/pwa/dist-native/build-provenance.json"
bun run sync
bun run apk:release
python3 "$ROOT/scripts/android-provenance.py" check "$snapshot"
python3 "$ROOT/scripts/android-provenance.py" seal "$ROOT/mobile/android/app/build/outputs/apk/release/app-release.apk"
python3 "$ROOT/scripts/android-provenance.py" apk "$ROOT/mobile/android/app/build/outputs/apk/release/app-release.apk"
