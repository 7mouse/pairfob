/**
 * The Android beta download host. It is a separate Worker on dl.pairfob.com so
 * publishing an APK never deploys the relay and never resets its WebSockets.
 */

export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

const APP_ORIGIN = "https://localhost";
const MANIFEST = "/android/beta/latest.json";
const APK = /^\/android\/beta\/[A-Za-z0-9._-]+\.apk$/;

function cors(req: Request): Record<string, string> {
  if (req.headers.get("Origin") !== APP_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function headers(res: Response, extra: Record<string, string>): Headers {
  const merged = new Headers(res.headers);
  merged.set("X-Content-Type-Options", "nosniff");
  for (const [key, value] of Object.entries(extra)) merged.set(key, value);
  return merged;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS" && url.pathname === MANIFEST) {
      return new Response(null, {
        status: 204,
        headers: headers(new Response(null), {
          ...cors(req),
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "content-type",
          "Access-Control-Max-Age": "600",
        }),
      });
    }
    const res = await env.ASSETS.fetch(req);
    if (url.pathname === MANIFEST) {
      return new Response(res.body, {
        status: res.status,
        headers: headers(res, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          ...cors(req),
        }),
      });
    }
    if (APK.test(url.pathname)) {
      return new Response(res.body, {
        status: res.status,
        headers: headers(res, res.ok
          ? {
            "Content-Type": "application/vnd.android.package-archive",
            "Cache-Control": "public, max-age=31536000, immutable",
          }
          : {
            "Content-Type": "application/vnd.android.package-archive",
            "Cache-Control": "no-store",
          }),
      });
    }
    return new Response(res.body, { status: res.status, headers: headers(res, {}) });
  },
};
