"""Re-apply UAOS1's Android tweaks after `npx cap add android` (idempotent).

- uaos1://pair deep link (server address + token arrive once, never baked into the APK)
- microphone permission for voice
- WebView text at 100%: Android's font-size setting would otherwise scale every page and break the layouts
"""

from pathlib import Path

root = Path(__file__).resolve().parents[1] / "android" / "app" / "src" / "main"

manifest = root / "AndroidManifest.xml"
s = manifest.read_text()
if 'android:scheme="uaos1"' not in s:
    filt = """
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="uaos1" />
            </intent-filter>
"""
    i = s.index("</intent-filter>") + len("</intent-filter>")
    s = s[:i] + filt + s[i:]
# uaos1://pair (pairing), uaos1://open (notification taps), uaos1://share (share sheet, below)
s = s.replace('<data android:scheme="uaos1" android:host="pair" />', '<data android:scheme="uaos1" />')
if "android.intent.action.SEND" not in s:
    share = """
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
"""
    i = s.index("</intent-filter>") + len("</intent-filter>")
    s = s[:i] + share + s[i:]
anchor = '<uses-permission android:name="android.permission.INTERNET" />'
for perm in ("android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"):
    if perm not in s:
        s = s.replace(anchor, f'{anchor}\n    <uses-permission android:name="{perm}" />', 1)
manifest.write_text(s)

activity = next(root.joinpath("java").rglob("MainActivity.java"))
activity.write_text(
    """package co.tonysplace.uaos1;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Window;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Text shared from another app arrives as SEND; hand it to the web app as uaos1://share?text=... */
    private static Intent asShareLink(Intent in) {
        if (in == null || !Intent.ACTION_SEND.equals(in.getAction())) return in;
        CharSequence text = in.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text == null) return in;
        Uri link = Uri.parse("uaos1://share").buildUpon().appendQueryParameter("text", text.toString()).build();
        return new Intent(Intent.ACTION_VIEW, link);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        Intent link = asShareLink(intent);
        setIntent(link);
        super.onNewIntent(link);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        setIntent(asShareLink(getIntent()));
        super.onCreate(savedInstanceState);
        // Render pages at their designed size; Android's font-size setting otherwise scales all text.
        getBridge().getWebView().getSettings().setTextZoom(100);
        // Coral status and navigation bars matching the UAOS1 design
        Window window = getWindow();
        int coral = Color.parseColor("#cd4f33");
        window.setStatusBarColor(coral);
        window.setNavigationBarColor(coral);
        window.getDecorView().setBackgroundColor(coral);
    }
}
"""
)

styles = root / "res" / "values" / "styles.xml"
if styles.exists():
    st = styles.read_text()
    if "android:statusBarColor" not in st:
        st = st.replace(
            '<item name="android:background">@null</item>',
            '<item name="android:background">@null</item>\n        <item name="android:statusBarColor">#cd4f33</item>\n        <item name="android:navigationBarColor">#cd4f33</item>',
        )
        styles.write_text(st)

print("patched", manifest.name, activity.name)
