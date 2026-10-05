package br.com.multmed.atemfield;

import android.net.Uri;

/** Launches only ATEM Field, including when another app sends an explicit Intent. */
public final class LauncherActivity extends com.google.androidbrowserhelper.trusted.LauncherActivity {
    @Override
    protected Uri getLaunchingUrl() {
        return Uri.parse(getString(R.string.launch_url));
    }
}
