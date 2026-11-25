package expo.modules.kbfirebase

import com.google.firebase.FirebaseApp
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class KbFirebaseModule : Module() {
  private val context get() = appContext.reactContext ?: throw CodedException("The app is not ready yet")

  override fun definition() = ModuleDefinition {
    Name("KbFirebase")

    /** App ID of the running Firebase app, or "" when none is running. */
    Function("currentAppId") {
      FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }?.options?.applicationId ?: ""
    }

    /**
     * Save the values and start Firebase. Returns "started", "running" (already on with these values)
     * or "restart" (another project is running; the new one is used after the app is reopened).
     */
    Function("configure") { projectId: String, appId: String, apiKey: String, senderId: String, storageBucket: String ->
      val ctx = context
      val running = FirebaseApp.getApps(ctx).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
      KbFirebase.save(ctx, projectId, appId, apiKey, senderId, storageBucket)
      when {
        running == null -> if (KbFirebase.start(ctx)) "started" else "failed"
        running.options.applicationId == appId -> "running"
        else -> "restart"
      }
    }
  }
}
