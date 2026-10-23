package com.pairfob.app;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void load() {
        // Install before Capacitor navigates, so the first document has the bridge.
        WebView view = findViewById(com.getcapacitor.android.R.id.webview);
        if (view != null) new UpdateBridge(this, view).install();
        super.load();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
