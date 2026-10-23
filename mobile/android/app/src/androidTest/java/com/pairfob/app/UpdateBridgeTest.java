package com.pairfob.app;

import static org.junit.Assert.*;

import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercise the actual WebView boundary, including same-origin and opaque frames. */
@RunWith(AndroidJUnit4.class)
public class UpdateBridgeTest {
    private String evaluate(WebView view, String script) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            view.evaluateJavascript(script, value -> { result.set(value); latch.countDown(); }));
        assertTrue("JavaScript evaluation completed", latch.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private void waitFor(WebView view, String condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            if ("true".equals(evaluate(view, condition))) return;
            Thread.sleep(50);
        }
        fail("WebView condition timed out: " + condition);
    }

    @Test
    public void mainFrameOnlyAndRestrictedDestinations() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<WebView> holder = new AtomicReference<>();
            scenario.onActivity(activity -> {
                WebView view = new WebView(activity);
                view.getSettings().setJavaScriptEnabled(true);
                new UpdateBridge(activity, view).install();
                holder.set(view);
                view.loadDataWithBaseURL("https://localhost/", "<html><body>bridge test</body></html>",
                    "text/html", "UTF-8", null);
            });
            WebView view = holder.get();
            try {
                waitFor(view, "typeof PairfobNative === 'object'");
                evaluate(view, "window.replies={};PairfobNative.onmessage=e=>{const r=JSON.parse(e.data);replies[r.id]=r};"
                    + "PairfobNative.postMessage(JSON.stringify({id:'1',method:'getInfo'}))");
                waitFor(view, "!!window.replies?.['1']");
                assertEquals("true", evaluate(view, "replies['1'].ok && replies['1'].value.id === 'com.pairfob.app'"));
                evaluate(view, "PairfobNative.postMessage(JSON.stringify({id:'2',method:'fetchText',url:'https://evil.example/android/beta/latest.json'}));"
                    + "PairfobNative.postMessage(JSON.stringify({id:'3',method:'openUrl',url:'https://dl.pairfob.com/elsewhere'}))");
                waitFor(view, "!!replies['2'] && !!replies['3']");
                assertEquals("true", evaluate(view, "!replies['2'].ok && !replies['3'].ok"));

                // A same-origin child receives the object, but native rejects its calls.
                evaluate(view, "window.childReply=false;window.childSent=false;const f=document.createElement('iframe');"
                    + "f.srcdoc='<script>PairfobNative.onmessage=()=>parent.childReply=true;"
                    + "PairfobNative.postMessage(JSON.stringify({id:\"4\",method:\"getInfo\"}));parent.childSent=true;<\\/script>';"
                    + "document.body.appendChild(f)");
                waitFor(view, "window.childSent === true");
                // Round-trip the main frame after the child request to drain native work.
                evaluate(view, "PairfobNative.postMessage(JSON.stringify({id:'5',method:'getInfo'}))");
                waitFor(view, "!!replies['5']");
                assertEquals("false", evaluate(view, "window.childReply"));

                evaluate(view, "window.opaqueBridge=null;window.addEventListener('message',e=>{if(e.data.kind==='opaque')opaqueBridge=e.data.bridge});"
                    + "const s=document.createElement('iframe');s.sandbox='allow-scripts';"
                    + "s.srcdoc='<script>parent.postMessage({kind:\"opaque\",bridge:typeof PairfobNative},\"*\");<\\/script>';document.body.appendChild(s)");
                waitFor(view, "window.opaqueBridge !== null");
                assertEquals("\"undefined\"", evaluate(view, "window.opaqueBridge"));

                InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
                    view.loadDataWithBaseURL("https://untrusted.example/", "<html><body>foreign</body></html>",
                        "text/html", "UTF-8", null));
                waitFor(view, "document.body?.textContent === 'foreign'");
                assertEquals("\"undefined\"", evaluate(view, "typeof PairfobNative"));
            } finally {
                InstrumentationRegistry.getInstrumentation().runOnMainSync(view::destroy);
            }
        }
    }
}
