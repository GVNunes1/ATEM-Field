package br.com.multmed.atemfield;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

import com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/** Tests the actual merged manifest, not a test-only replacement manifest. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class LauncherManifestTest {
    private final Context context = RuntimeEnvironment.getApplication();

    @Test
    public void manageDataActivityIsRegisteredAndNotExported() throws Exception {
        // The library toggles this component at startup on API 25+. Android rejects an
        // undeclared component. Robolectric's shadow does not reproduce that exception,
        // so check registration explicitly through the real merged manifest instead.
        ActivityInfo activity = manageDataActivity();

        assertEquals(ManageDataLauncherActivity.class.getName(), activity.name);
        assertFalse("Site settings must remain internal to the app", activity.exported);
    }

    @Test
    public void manageDataActivityHasTheFixedAtemFieldOrigin() throws Exception {
        ActivityInfo activity = manageDataActivity();

        assertNotNull("The browser helper requires MANAGE_SPACE_URL metadata", activity.metaData);
        assertEquals("https://atem-field.vercel.app/",
                activity.metaData.getString("android.support.customtabs.trusted.MANAGE_SPACE_URL"));
    }

    @Test
    public void applicationRoutesManageSpaceToTheRegisteredActivity() throws Exception {
        ApplicationInfo application = context.getPackageManager().getApplicationInfo(
                context.getPackageName(), PackageManager.GET_META_DATA);

        assertEquals(ManageDataLauncherActivity.class.getName(),
                application.manageSpaceActivityName);
    }

    @Test
    public void siteSettingsShortcutCanDisableTheRegisteredComponent() throws Exception {
        manageDataActivity();

        // No provider supports site settings here; the helper must safely disable its
        // declared component rather than referring to an undeclared activity.
        ManageDataLauncherActivity.addSiteSettingsShortcut(context, null);

        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                context.getPackageManager().getComponentEnabledSetting(manageDataComponent()));
    }

    private ComponentName manageDataComponent() {
        return new ComponentName(context, ManageDataLauncherActivity.class);
    }

    private ActivityInfo manageDataActivity() throws PackageManager.NameNotFoundException {
        return context.getPackageManager().getActivityInfo(
                manageDataComponent(), PackageManager.GET_META_DATA);
    }
}
