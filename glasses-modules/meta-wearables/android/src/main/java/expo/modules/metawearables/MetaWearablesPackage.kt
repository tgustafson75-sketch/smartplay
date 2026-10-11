package expo.modules.metawearables

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.os.Bundle
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

/**
 * Sightline — the SDK's app-scoped entry points, through Expo's lifecycle hooks (no edit to MainActivity /
 * MainApplication, no android/ directory touched — CNG):
 *   - Application.onCreate → Wearables.initialize, once per process (+ the voice-invocation stream);
 *   - Activity.onCreate AND onNewIntent → Wearables.handleIntent (required on SDK >= 1.0.0) and the
 *     voice-invocation intent check.
 */
class MetaWearablesPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) { Sightline.initialize(application) }
    })

  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(object : ReactActivityLifecycleListener {
      private var activity: Activity? = null
      override fun onCreate(activity: Activity, savedInstanceState: Bundle?) {
        this.activity = activity
        Sightline.initialize(activity.application)
        Sightline.handleIntent(activity, activity.intent)
      }
      override fun onNewIntent(intent: Intent): Boolean {
        activity?.let { Sightline.handleIntent(it, intent) }
        return false   // never swallow: expo-router / deep links still see the intent
      }
      override fun onDestroy(activity: Activity) { if (this.activity === activity) this.activity = null }
    })
}
