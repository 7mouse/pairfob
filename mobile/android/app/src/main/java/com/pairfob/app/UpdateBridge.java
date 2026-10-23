package com.pairfob.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.webkit.WebView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Update access belongs only to the bundled app's main frame. */
final class UpdateBridge {
    private final Activity activity;
    private final WebView view;
    private final boolean debug;
    private final AtomicBoolean fetching = new AtomicBoolean();

    UpdateBridge(Activity activity, WebView view) {
        this.activity = activity;
        this.view = view;
        debug = (activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    void install() {
        // Fail closed on old WebViews; never fall back to an all-frame interface.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return;
        Set<String> origins = new HashSet<>();
        origins.add("https://localhost");
        if (debug) origins.add("http://localhost");
        WebViewCompat.addWebMessageListener(view, "PairfobNative", origins,
            (webView, message, sourceOrigin, isMainFrame, reply) -> {
                if (!isMainFrame || !origins.contains(sourceOrigin.toString())) return;
                String id = "";
                try {
                    String data = message.getData();
                    if (data == null || data.length() > 4096) return;
                    JSONObject request = new JSONObject(data);
                    id = request.getString("id");
                    if (!id.matches("[0-9]{1,16}")) return;
                    switch (request.getString("method")) {
                        case "getInfo":
                            PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
                            long code = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
                            respond(reply, id, true, new JSONObject()
                                .put("name", "Pairfob").put("id", activity.getPackageName())
                                .put("version", info.versionName).put("build", Long.toString(code)));
                            break;
                        case "openUrl":
                            Uri apk = allowed(request.getString("url"), false);
                            if (apk == null) throw new IllegalArgumentException();
                            activity.startActivity(new Intent(Intent.ACTION_VIEW, apk));
                            respond(reply, id, true, "");
                            break;
                        case "fetchText":
                            Uri manifest = allowed(request.getString("url"), true);
                            if (manifest == null || !fetching.compareAndSet(false, true)) {
                                throw new IllegalArgumentException();
                            }
                            fetch(manifest, reply, id);
                            break;
                        default:
                            throw new IllegalArgumentException();
                    }
                } catch (Exception ignored) {
                    respond(reply, id, false, "native update request failed");
                }
            });
    }

    private Uri allowed(String value, boolean manifest) {
        Uri uri = Uri.parse(value);
        if (uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) return null;
        String scheme = uri.getScheme();
        String host = uri.getHost();
        boolean production = "https".equals(scheme) && "dl.pairfob.com".equals(host)
            && (uri.getPort() == -1 || uri.getPort() == 443);
        boolean local = debug && ("https".equals(scheme) || "http".equals(scheme))
            && ("localhost".equals(host) || "127.0.0.1".equals(host));
        if (!production && !local) return null;
        String path = uri.getEncodedPath();
        if (manifest ? !"/android/beta/latest.json".equals(path)
            : path == null || !path.matches("/android/beta/[A-Za-z0-9._-]+\\.apk")) return null;
        return uri;
    }

    private void fetch(Uri uri, JavaScriptReplyProxy reply, String id) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            boolean ok = false;
            String body = "native update request failed";
            try {
                connection = (HttpURLConnection) new URL(uri.toString()).openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Accept", "application/json");
                if (connection.getResponseCode() != 200) throw new IllegalStateException();
                try (InputStream input = connection.getInputStream()) {
                    ByteArrayOutputStream output = new ByteArrayOutputStream();
                    byte[] buffer = new byte[4096];
                    int read;
                    long deadline = android.os.SystemClock.elapsedRealtime() + 12000;
                    while ((read = input.read(buffer)) != -1) {
                        if (android.os.SystemClock.elapsedRealtime() > deadline) throw new IllegalStateException();
                        if (output.size() + read > 64 * 1024) throw new IllegalStateException();
                        output.write(buffer, 0, read);
                    }
                    body = output.toString(StandardCharsets.UTF_8.name());
                    ok = true;
                }
            } catch (Exception ignored) {
                // A failed check is retryable from Settings.
            } finally {
                if (connection != null) connection.disconnect();
                fetching.set(false);
            }
            final boolean success = ok;
            final String payload = body;
            view.post(() -> respond(reply, id, success, payload));
        }, "pairfob-update").start();
    }

    private void respond(JavaScriptReplyProxy reply, String id, boolean ok, Object value) {
        try {
            // Reply to the initiating frame, never evaluate code in a later page.
            reply.postMessage(new JSONObject().put("id", id).put("ok", ok).put("value", value).toString());
        } catch (Exception ignored) {
            // The initiating document may have gone away.
        }
    }
}
