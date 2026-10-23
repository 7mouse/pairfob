package com.pairfob.app;

import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    /**
     * The Android beta channel's only native surface: the installed version, the
     * system browser, and one allowlisted HTTPS GET. The WebView fetch is not
     * reliable for this cross-origin manifest, and a native request keeps the
     * update check working when the page's network stack is busy with the relay.
     */
    private final class UpdateBridge {
        @JavascriptInterface
        public String versionName() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (PackageManager.NameNotFoundException e) {
                return "";
            }
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public int versionCode() {
            try {
                PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
                return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? (int) info.getLongVersionCode()
                    : info.versionCode;
            } catch (PackageManager.NameNotFoundException e) {
                return 0;
            }
        }

        @JavascriptInterface
        public void openUrl(String value) {
            final Uri uri = allowed(value);
            if (uri == null) return;
            runOnUiThread(() -> startActivity(new Intent(Intent.ACTION_VIEW, uri)));
        }

        @JavascriptInterface
        public void fetch(String value, String requestId) {
            final String id = requestId == null ? "" : requestId;
            new Thread(() -> {
                boolean ok = false;
                String body = "";
                HttpURLConnection connection = null;
                try {
                    Uri uri = allowed(value);
                    if (uri == null) throw new IllegalArgumentException("blocked url");
                    connection = (HttpURLConnection) new URL(uri.toString()).openConnection();
                    connection.setConnectTimeout(8000);
                    connection.setReadTimeout(8000);
                    connection.setInstanceFollowRedirects(false);
                    connection.setRequestProperty("Accept", "application/json");
                    if (connection.getResponseCode() == 200) {
                        try (InputStream input = connection.getInputStream()) {
                            body = readLimited(input, 64 * 1024);
                            ok = true;
                        }
                    }
                } catch (Exception ignored) {
                    // The page turns a failed fetch into "check failed".
                } finally {
                    if (connection != null) connection.disconnect();
                }
                final boolean success = ok;
                final String payload = body;
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView == null) return;
                webView.post(() -> webView.evaluateJavascript(
                    "window.__pairfobNativeFetch&&window.__pairfobNativeFetch("
                        + JSONObject.quote(id) + "," + success + "," + JSONObject.quote(payload) + ")",
                    null));
            }).start();
        }

        private String readLimited(InputStream input, int limit) throws IOException {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (output.size() + read > limit) throw new IOException("response too large");
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }

        private Uri allowed(String value) {
            if (value == null) return null;
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null) return null;
            if ("https".equals(scheme) && ("pairfob.com".equals(host)
                || "www.pairfob.com".equals(host)
                || "dl.pairfob.com".equals(host))) {
                return uri;
            }
            boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            if (debuggable && ("https".equals(scheme) || "http".equals(scheme))
                && ("localhost".equals(host) || "127.0.0.1".equals(host) || "::1".equals(host))) {
                return uri;
            }
            return null;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) {
            webView.addJavascriptInterface(new UpdateBridge(), "PairfobNative");
        }
        applySystemBars();
        // The splash hand-off can reapply the light-bar style after onCreate.
        getWindow().getDecorView().postDelayed(this::applySystemBars, 1500);

        OnBackPressedCallback backNavigation = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView view = getBridge() == null ? null : getBridge().getWebView();
                if (view != null && view.canGoBack()) {
                    view.goBack();
                    return;
                }
                // Let the system finish the activity when there is no in-app history.
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, backNavigation);
    }

    @Override
    public void onResume() {
        super.onResume();
        applySystemBars();
    }

    private void applySystemBars() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);
        getWindow().getDecorView().setSystemUiVisibility(
            getWindow().getDecorView().getSystemUiVisibility() & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        getWindow().setStatusBarColor(0xFF0A0C10);
        getWindow().setNavigationBarColor(0xFF0A0C10);
    }
}
