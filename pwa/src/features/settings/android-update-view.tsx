import { useEffect, useRef, useState } from "react";
import { t } from "../../lib/i18n";
import { nativeApp } from "../../lib/native-app";
import { nativePlatform } from "../../lib/platform";
import { SetAction, SetItem, Spinner } from "../../shared/ui/primitives";
import {
  cacheAndroidRelease,
  cachedAndroidRelease,
  dueForCheck,
  fetchAndroidRelease,
  hasNewerRelease,
  markChecked,
  parseAndroidBuild,
  resolveReleaseURL,
  type AndroidBuild,
  type AndroidRelease,
} from "./android-update";

type Phase =
  | { kind: "reading" }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; release: AndroidRelease }
  | { kind: "opening"; release: AndroidRelease }
  | { kind: "error" };

function versionLine(build: AndroidBuild | null): string {
  return build ? `${build.version} (${build.code})` : t("set.androidNoBridge");
}

/**
 * The Android app's update row. The hosted web build has no self-update, so the
 * row exists only inside the native shell. Checking is silent on foreground and
 * explicit on tap; installing hands the versioned APK to the system browser.
 */
export function AndroidUpdateRow() {
  const android = nativePlatform()?.kind === "android";
  const [build, setBuild] = useState<AndroidBuild | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });
  const mounted = useRef(true);
  const buildRef = useRef<AndroidBuild | null>(null);
  const checkingRef = useRef(false);

  async function check(known: AndroidBuild, manual: boolean): Promise<void> {
    if (checkingRef.current) return;
    const app = nativeApp();
    if (!app) {
      setPhase({ kind: "error" });
      return;
    }
    checkingRef.current = true;
    setPhase({ kind: "checking" });
    try {
      const release = await fetchAndroidRelease(app.fetchText);
      if (!mounted.current) return;
      markChecked();
      const newer = hasNewerRelease(known.code, release);
      cacheAndroidRelease(newer ? release : null);
      setPhase(newer ? { kind: "available", release } : { kind: "current" });
    } catch {
      if (!mounted.current) return;
      const cached = manual ? null : cachedAndroidRelease();
      if (!manual && cached && hasNewerRelease(known.code, cached)) setPhase({ kind: "available", release: cached });
      else setPhase(manual ? { kind: "error" } : { kind: "idle" });
    } finally {
      checkingRef.current = false;
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    buildRef.current = build;
  }, [build]);

  useEffect(() => {
    if (!android) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const current = buildRef.current;
      if (current && dueForCheck()) void check(current, false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [android]);

  useEffect(() => {
    if (!android) return;
    let cancelled = false;
    const app = nativeApp();
    if (!app) {
      setPhase({ kind: "error" });
      return;
    }
    void app.getInfo().then((info) => {
      if (cancelled) return;
      const parsed = parseAndroidBuild(info.version, info.build);
      if (!parsed) {
        setPhase({ kind: "error" });
        return;
      }
      setBuild(parsed);
      const cached = cachedAndroidRelease();
      if (cached && hasNewerRelease(parsed.code, cached)) setPhase({ kind: "available", release: cached });
      if (dueForCheck()) void check(parsed, false);
      else if (!cached || !hasNewerRelease(parsed.code, cached)) setPhase({ kind: "idle" });
    }).catch(() => {
      if (!cancelled) setPhase({ kind: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [android]);

  async function install(release: AndroidRelease): Promise<void> {
    const app = nativeApp();
    const url = resolveReleaseURL(release.url);
    if (!app || !url) {
      setPhase({ kind: "error" });
      return;
    }
    setPhase({ kind: "opening", release });
    try {
      await app.openUrl({ url });
    } finally {
      if (mounted.current) setPhase({ kind: "available", release });
    }
  }

  if (!android) return null;

  const checking = phase.kind === "reading" || phase.kind === "checking";
  const release = phase.kind === "available" || phase.kind === "opening" ? phase.release : null;
  let sub = versionLine(build);
  if (checking) sub = t("set.androidChecking");
  else if (phase.kind === "opening") sub = `${versionLine(build)} · ${t("set.androidOpening")}`;
  else if (phase.kind === "current") sub = `${versionLine(build)} · ${t("set.androidCurrent")}`;
  else if (release) sub = `${versionLine(build)} · ${t("set.androidAvailable", { version: release.versionName })}`;
  else if (phase.kind === "error") sub = `${versionLine(build)} · ${t("set.androidError")}`;

  let trailing;
  if (checking) {
    trailing = <Spinner />;
  } else if (phase.kind === "opening") {
    trailing = <span className="set-state">{t("set.androidOpening")}</span>;
  } else if (release) {
    trailing = <SetAction tone="fill" onClick={() => void install(release)}>{t("set.androidInstall")}</SetAction>;
  } else {
    trailing = (
      <SetAction disabled={!build} onClick={() => { if (build) void check(build, true); }}>
        {t(phase.kind === "error" ? "set.androidRetry" : "set.androidCheck")}
      </SetAction>
    );
  }

  return (
    <div className="set-item-group android-update">
      <SetItem label={t("set.androidApp")} sub={sub} trailing={trailing} />
      {release ? (
        <div>
          {release.notes ? <p className="set-note">{release.notes}</p> : null}
          <p className="set-note">{t("set.androidInstallNote")}</p>
        </div>
      ) : null}
    </div>
  );
}
