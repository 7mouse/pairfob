import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The scheme is the app's WebView origin and must be chosen with the relay:
 * production is `https://localhost` against `https://pairfob.com`; a local
 * development build is `http://localhost` against `http://127.0.0.1:18786`.
 * The mobile scripts set both explicitly. Changing the scheme changes the
 * IndexedDB origin, so credentials do not carry across the two builds.
 */
const scheme: "http" | "https" = process.env.PAIRFOB_ANDROID_SCHEME === "http" ? "http" : "https";

const config: CapacitorConfig = {
  appId: "com.pairfob.app",
  appName: "Pairfob",
  webDir: "../pwa/dist-native",
  server: {
    hostname: "localhost",
    androidScheme: scheme,
  },
};

export default config;
