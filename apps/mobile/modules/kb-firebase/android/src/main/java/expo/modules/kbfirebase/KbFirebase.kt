package expo.modules.kbfirebase

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/** Firebase values saved on the phone, so Firebase can start without google-services.json in the build. */
object KbFirebase {
  private const val PREFS = "kb_firebase"

  fun save(context: Context, projectId: String, appId: String, apiKey: String, senderId: String, storageBucket: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("projectId", projectId)
      .putString("appId", appId)
      .putString("apiKey", apiKey)
      .putString("senderId", senderId)
      .putString("storageBucket", storageBucket)
      .apply()
  }

  fun savedAppId(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("appId", null)

  /** Start the default Firebase app from saved values; true when one is running afterwards. */
  fun start(context: Context): Boolean {
    if (FirebaseApp.getApps(context).isNotEmpty()) return true
    val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val projectId = p.getString("projectId", null) ?: return false
    val appId = p.getString("appId", null) ?: return false
    val apiKey = p.getString("apiKey", null) ?: return false
    val senderId = p.getString("senderId", null) ?: return false
    val b = FirebaseOptions.Builder()
      .setProjectId(projectId)
      .setApplicationId(appId)
      .setApiKey(apiKey)
      .setGcmSenderId(senderId)
    p.getString("storageBucket", null)?.takeIf { it.isNotEmpty() }?.let { b.setStorageBucket(it) }
    return try {
      FirebaseApp.initializeApp(context, b.build())
      true
    } catch (e: Exception) {
      false
    }
  }
}
