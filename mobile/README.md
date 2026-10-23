# Pairfob mobile shell

Capacitor 8 Android shell for the existing PWA. The shell adds no screens of
its own: it bundles `pwa/dist-native` into the APK, serves it from the local
WebView origin, and points the existing screens at a relay origin.

```
pwa/src (same app) --bun run build:native--> pwa/dist-native
                                                   |
                                      cap sync android
                                                   |
                                    android/app/src/main/assets/public
```

The generated bundle and Gradle output are not committed. `pwa/dist-native` is
built from the checked-out PWA; rerun `bun run sync` after every PWA change.

## Prerequisites

- macOS or Linux with Android Studio and an emulator
- JDK 21, for example `/Applications/Android Studio.app/Contents/jbr/Contents/Home`
- Android SDK platform 36 (`android-36`) and build-tools `36.1.0`
- Bun 1.3 or newer
- `adb` from the same SDK

Create `android/local.properties` (untracked) when Gradle cannot find the SDK:

```properties
sdk.dir=/path/to/Android/sdk
```

## Build the debug APK

```sh
# macOS with Android Studio installed:
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

cd mobile
bun install
bun run build:debug
```

`build:debug` is ordered deliberately:

1. `pwa:native` runs the PWA `build:native` script into `pwa/dist-native`
2. `sync` runs `cap sync android`, copying the bundle into the Android project
3. `apk:debug` runs `./gradlew assembleDebug`

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`.

This build uses the production pair:

| Input | Value |
| --- | --- |
| WebView origin | `https://localhost` |
| Relay | `https://pairfob.com` |

Install and launch on the running emulator:

```sh
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.pairfob.app/.MainActivity
```

## Beta release APK

Release builds are signed with a local beta key that never enters the repository:

```
android/keystore.properties        # gitignored
android/app/pairfob-beta.keystore  # gitignored
```

`keystore.properties` names the file and holds the passwords:

```properties
storeFile=pairfob-beta.keystore
storePassword=…
keyAlias=pairfob-beta
keyPassword=…
```

Back up both files: every future beta update must use the same key, and
without it Android refuses to install the update over an existing install.
When the files are absent, `assembleRelease` still builds but produces an
unsigned APK. `versionName` lives in `android/app/build.gradle`.

```sh
cd mobile
bun run build:release
```

The signed APK is
`android/app/build/outputs/apk/release/app-release.apk`. Verify it with
`$ANDROID_HOME/build-tools/36.1.0/apksigner verify --print-certs <apk>`.

## Beta updates

The app checks the self-hosted channel at
`https://dl.pairfob.com/android/beta/latest.json`. It is a separate Worker so a
publish never deploys the relay and never resets the daemons' WebSockets. The
Settings row shows the installed version and checks on foreground at most once
every six hours. A higher `versionCode` offers **Download and install**, which
sends the versioned APK to the system browser. Android's installer enforces the
same signing key and keeps app data and pairing.

Publish a built APK:

```sh
./scripts/publish-android-beta.sh --notes "What changed" --deploy
```

The script verifies the beta certificate, requires a `versionCode` higher than
every published channel, stages `latest.json` and the APK, deploys
`workers/pairfob-downloads`, and verifies the live manifest and APK hash. It
keeps the current and previous APK. A bad beta is fixed with a higher
`versionCode`, because Android refuses downgrades.

Builds from before beta.9 used the relay path
`https://pairfob.com/dl/android/beta/latest.json`. `--legacy-only` points that
old channel at the staged build once more, and `--legacy-relay` publishes to
both in one run. Both deploy the relay and require `--deploy`; use them only for the transition.

The PWA side is `pwa/src/features/settings/android-update.ts` and
`android-update-view.tsx`. `MainActivity` exposes the native bridge: installed
version, an allowlisted HTTPS GET, and the browser intent. The allowlist is
`pairfob.com`, `dl.pairfob.com`, and loopback for development.

## Local dev relay

The dev build keeps the same app id, swaps the WebView origin to
`http://localhost`, and points at the loopback relay. It reuses the app
installation slot, so installing it replaces a production debug build.

```sh
# terminal 1: origin + fake-runtime daemon on 127.0.0.1:18786
PAIRFOB_DEV_FAKE_RUNTIME=1 ./scripts/dev-up.sh   # from the repository root
```

```sh
# terminal 2: expose the host relay to the emulator, then build
adb reverse tcp:18786 tcp:18786
cd mobile
bun run build:debug:dev
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.pairfob.app/.MainActivity
```

`build:debug:dev` defaults to `VITE_PAIRFOB_RELAY_ORIGIN=http://127.0.0.1:18786`.
Override the variable to use another loopback relay. The Android debug manifest
permits cleartext only to `127.0.0.1` and `localhost`; release has
`usesCleartextTraffic="false"` and no debug network security config.

The WebView origin also changes between the two builds, so IndexedDB (device
credentials and session state) does not carry across them. Pair again after
switching.

## What the shell handles

- `MainActivity` routes the system back gesture into WebView history when the
  WebView can go back; with no history the normal system back finishes the app.
- `windowSoftInputMode="adjustResize"` keeps the keyboard from covering the
  compose field.
- Capacitor's WebChromeClient supplies JS dialogs, the file chooser, and
  `getUserMedia` camera permission handling. Camera QR scanning is available
  when the OS grants CAMERA; **Enter pairing code** is the fallback when it is
  not.
- The PWA's service worker is not registered in native mode. The native build
  carries its own CSP meta tag (`vite.config.ts`), scoped to the configured
  relay and its WebSocket origin.

## Not in this scaffold

- FCM/HMS/MiPush/OPPO/vivo/Honor/aggregator push delivery. The PWA already
  exposes the platform seam in `pwa/src/lib/platform.ts`; this shell reports
  `kind: "android"` with an empty `pushChannels` list, so web-push-only UI is
  hidden and no push is attempted.
- Play Store packaging and OTA updates.
- iOS. `NativePlatform` accepts `"ios"` but no iOS project exists here.
- Native deep-link and QR plugins. The typed pairing code path is the
  acceptance fallback.
