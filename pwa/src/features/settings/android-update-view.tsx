import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { lang, t } from "../../lib/i18n";
import { nativeApp } from "../../lib/native-app";
import { nativePlatform } from "../../lib/platform";
import { Button, SetAction, SetGroup, SetItem, SetTag, Spinner } from "../../shared/ui/primitives";
import {
  cacheAndroidRelease,
  cachedAndroidRelease,
  dueForCheck,
  fetchAndroidRelease,
  hasNewerRelease,
  markChecked,
  parseAndroidBuild,
  releaseNotes,
  resolveReleaseURL,
  type AndroidBuild,
  type AndroidRelease,
} from "./android-update";

const FEEDBACK_URL = "https://github.com/arronKler/pairfob/issues/new?template=android-beta.yml";

type Phase =
  | { kind: "reading" }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; release: AndroidRelease }
  | { kind: "opening"; release: AndroidRelease }
  | { kind: "open-error"; release: AndroidRelease }
  | { kind: "read-error" }
  | { kind: "check-error" };

/**
 * The local app's own update card, separate from the connected computer and
 * language preferences. It exists only inside the native shell. Checking is
 * silent on foreground and explicit on tap; installing opens the system browser.
 */
export function AndroidUpdateCard() {
  const android = nativePlatform()?.kind === "android";
  const [build, setBuild] = useState<AndroidBuild | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });
  const mounted = useRef(true);
  const buildRef = useRef<AndroidBuild | null>(null);
  const checkingRef = useRef(false);
  const openingRef = useRef(false);
  const readAttempt = useRef(0);

  async function check(known: AndroidBuild, manual: boolean): Promise<void> {
    if (checkingRef.current || openingRef.current) return;
    const app = nativeApp();
    if (!app) {
      setPhase({ kind: "check-error" });
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
      else setPhase(manual ? { kind: "check-error" } : { kind: "idle" });
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

  async function readVersion(manual = false): Promise<void> {
    const attempt = ++readAttempt.current;
    setPhase({ kind: "reading" });
    try {
      const app = nativeApp();
      if (!app) throw new Error("native bridge unavailable");
      const info = await app.getInfo();
      const parsed = parseAndroidBuild(info.version, info.build);
      if (!parsed) throw new Error("invalid native version");
      if (!mounted.current || attempt !== readAttempt.current) return;
      buildRef.current = parsed;
      setBuild(parsed);
      const cached = cachedAndroidRelease();
      if (cached && hasNewerRelease(parsed.code, cached)) setPhase({ kind: "available", release: cached });
      if (manual || dueForCheck()) await check(parsed, manual);
      else if (!cached || !hasNewerRelease(parsed.code, cached)) setPhase({ kind: "idle" });
    } catch {
      if (mounted.current && attempt === readAttempt.current) setPhase({ kind: "read-error" });
    }
  }

  useEffect(() => {
    if (!android) return;
    void readVersion();
    return () => { readAttempt.current++; };
  }, [android]);

  async function install(release: AndroidRelease): Promise<void> {
    if (openingRef.current) return;
    openingRef.current = true;
    setPhase({ kind: "opening", release });
    try {
      const app = nativeApp();
      const url = resolveReleaseURL(release.url);
      if (!app || !url) throw new Error("download unavailable");
      await app.openUrl({ url });
      if (mounted.current) setPhase({ kind: "available", release });
    } catch {
      if (mounted.current) setPhase({ kind: "open-error", release });
    } finally {
      openingRef.current = false;
    }
  }

  if (!android) return null;

  const checking = phase.kind === "reading" || phase.kind === "checking";
  const release = "release" in phase ? phase.release : null;
  const failed = phase.kind === "read-error" || phase.kind === "check-error" || phase.kind === "open-error";
  const sub = build ? t("set.androidInstalled", { version: build.version }) : null;
  const notes = release ? releaseNotes(release, lang()) : "";
  const status = phase.kind === "reading" ? t("set.androidReading")
    : phase.kind === "checking" ? t("set.androidChecking")
    : phase.kind === "current" ? t("set.androidCurrent")
    : phase.kind === "read-error" ? t("set.androidNoBridge")
    : phase.kind === "check-error" ? t("set.androidError")
    : phase.kind === "open-error" ? t("set.androidOpenError") : null;

  let trailing;
  if (checking) {
    trailing = <Spinner />;
  } else if (release) {
    trailing = <SetTag tone="accent">{t("set.androidUpdateAvailable")}</SetTag>;
  } else {
    trailing = (
      <SetAction onClick={() => { if (build) void check(build, true); else void readVersion(true); }}>
        {t(failed ? "set.androidRetry" : "set.androidCheck")}
      </SetAction>
    );
  }

  return (
    <SetGroup label={t("set.androidSection")} className="android-update" id="settings-android-app">
      <SetItem label={t("set.androidApp")} sub={sub} trailing={trailing} />
      {status ? <p className="android-update-status" data-error={failed || undefined} role="status">{status}</p> : null}
      {release ? (
        <div className="set-item-block android-update-release">
          <p className="android-update-target"><span>{t("set.androidNewVersion")}</span><strong>{release.versionName}</strong></p>
          <Button className="btn btn-primary android-update-install" disabled={phase.kind === "opening"} onClick={() => void install(release)}>
            {phase.kind === "opening" ? <Spinner /> : null}{t(phase.kind === "opening" ? "set.androidOpening" : phase.kind === "open-error" ? "set.androidRetryDownload" : "set.androidInstall")}
          </Button>
          <p className="android-update-hint">{t("set.androidInstallNote")}</p>
          {notes ? <details className="android-update-notes">
            <summary>{t("set.androidReleaseNotes")}<ChevronDown size={14} className="set-disclosure" aria-hidden="true" /></summary>
            <p>{notes}</p>
          </details> : null}
        </div>
      ) : null}
      <SetItem
        label={t("set.androidFeedback")}
        sub={t("set.androidFeedbackHint")}
        trailing={<a className="set-action android-update-feedback" href={FEEDBACK_URL} target="_blank" rel="noreferrer">{t("set.androidFeedbackOpen")}</a>}
      />
    </SetGroup>
  );
}
