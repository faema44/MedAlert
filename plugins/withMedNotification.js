'use strict';
const { withDangerousMod, withAndroidManifest, withAppBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODULE_KT = `package com.medalert.app

import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class MedNotificationModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "MedNotification"

    @ReactMethod
    fun postNotification(title: String, contentText: String, bigText: String, channelId: String, promise: Promise) {
        try {
            reactContext.getSharedPreferences("MedAlertNotif", Context.MODE_PRIVATE).edit()
                .putBoolean("alert_active", true)
                .putString("notif_title", title)
                .putString("notif_contentText", contentText)
                .putString("notif_bigText", bigText)
                .putString("notif_channelId", channelId)
                .apply()

            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val notification = NotificationCompat.Builder(reactContext, channelId)
                .setSmallIcon(R.drawable.notification_icon)
                .setContentTitle(title)
                .setContentText(contentText)
                .setStyle(NotificationCompat.BigTextStyle().bigText(bigText).setSummaryText(contentText))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setShowWhen(false)
                .build()
            nm.notify(NOTIF_ID, notification)

            NotifRefreshReceiver.scheduleNext(reactContext)

            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_NOTIF", e.message)
        }
    }

    @ReactMethod
    fun cancelNotification(promise: Promise) {
        try {
            reactContext.getSharedPreferences("MedAlertNotif", Context.MODE_PRIVATE).edit()
                .putBoolean("alert_active", false)
                .apply()

            NotifRefreshReceiver.cancel(reactContext)

            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIF_ID)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_NOTIF", e.message)
        }
    }

    companion object {
        const val NOTIF_ID = 1001
    }
}
`;

const PACKAGE_KT = `package com.medalert.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class MedNotificationPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(MedNotificationModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
`;

const BOOT_RECEIVER_KT = `package com.medalert.app

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != "android.intent.action.QUICKBOOT_POWERON") return

        val prefs = context.getSharedPreferences("MedAlertNotif", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("alert_active", false)) return

        val title = prefs.getString("notif_title", null) ?: return
        val contentText = prefs.getString("notif_contentText", "") ?: ""
        val bigText = prefs.getString("notif_bigText", null) ?: return
        val channelId = prefs.getString("notif_channelId", null) ?: return

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.notification_icon)
            .setContentTitle(title)
            .setContentText(contentText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText).setSummaryText(contentText))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setShowWhen(false)
            .build()
        nm.notify(MedNotificationModule.NOTIF_ID, notification)

        NotifRefreshReceiver.scheduleNext(context)
    }
}
`;

const NOTIF_REFRESH_RECEIVER_KT = `package com.medalert.app

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.core.app.NotificationCompat

class NotifRefreshReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val prefs = context.getSharedPreferences("MedAlertNotif", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("alert_active", false)) return

        val title = prefs.getString("notif_title", null) ?: return
        val contentText = prefs.getString("notif_contentText", "") ?: ""
        val bigText = prefs.getString("notif_bigText", null) ?: return
        val channelId = prefs.getString("notif_channelId", null) ?: return

        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(R.drawable.notification_icon)
            .setContentTitle(title)
            .setContentText(contentText)
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText).setSummaryText(contentText))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setShowWhen(false)
            .build()
        nm.notify(MedNotificationModule.NOTIF_ID, notification)

        scheduleNext(context)
    }

    companion object {
        private const val INTERVAL_MS = 30 * 60 * 1000L

        private fun pendingIntent(context: Context, flag: Int): PendingIntent =
            PendingIntent.getBroadcast(
                context, 9001,
                Intent(context, NotifRefreshReceiver::class.java),
                flag or PendingIntent.FLAG_IMMUTABLE
            )

        fun scheduleNext(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val trigger = SystemClock.elapsedRealtime() + INTERVAL_MS
            am.setAndAllowWhileIdle(
                AlarmManager.ELAPSED_REALTIME_WAKEUP,
                trigger,
                pendingIntent(context, PendingIntent.FLAG_UPDATE_CURRENT)
            )
        }

        fun cancel(context: Context) {
            val pi = pendingIntent(context, PendingIntent.FLAG_NO_CREATE) ?: return
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.cancel(pi)
            pi.cancel()
        }
    }
}
`;

function withKotlinFiles(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const javaDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java/com/medalert/app'
      );

      fs.writeFileSync(path.join(javaDir, 'MedNotificationModule.kt'), MODULE_KT);
      fs.writeFileSync(path.join(javaDir, 'MedNotificationPackage.kt'), PACKAGE_KT);
      fs.writeFileSync(path.join(javaDir, 'BootReceiver.kt'), BOOT_RECEIVER_KT);
      fs.writeFileSync(path.join(javaDir, 'NotifRefreshReceiver.kt'), NOTIF_REFRESH_RECEIVER_KT);

      const mainAppPath = path.join(javaDir, 'MainApplication.kt');
      let src = fs.readFileSync(mainAppPath, 'utf8');
      if (!src.includes('MedNotificationPackage')) {
        src = src.replace(
          'PackageList(this).packages.apply {',
          'PackageList(this).packages.apply {\n          add(MedNotificationPackage())'
        );
        fs.writeFileSync(mainAppPath, src);
      }

      return cfg;
    },
  ]);
}

function withBootReceiver(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;

    if (!manifest.manifest['uses-permission']) manifest.manifest['uses-permission'] = [];
    const perms = manifest.manifest['uses-permission'];
    if (!perms.some(p => p.$?.['android:name'] === 'android.permission.RECEIVE_BOOT_COMPLETED')) {
      perms.push({ $: { 'android:name': 'android.permission.RECEIVE_BOOT_COMPLETED' } });
    }

    const application = manifest.manifest.application[0];
    if (!application.receiver) application.receiver = [];

    if (!application.receiver.some(r => r.$?.['android:name'] === '.BootReceiver')) {
      application.receiver.push({
        $: { 'android:name': '.BootReceiver', 'android:exported': 'true' },
        'intent-filter': [{
          action: [
            { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
            { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
          ],
        }],
      });
    }

    if (!application.receiver.some(r => r.$?.['android:name'] === '.NotifRefreshReceiver')) {
      application.receiver.push({
        $: { 'android:name': '.NotifRefreshReceiver', 'android:exported': 'false' },
      });
    }

    return cfg;
  });
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('signingConfigs.release')) return cfg;

    gradle = gradle.replace(
      /signingConfigs \{\s*debug \{/,
      `signingConfigs {\n        release {\n            storeFile rootProject.file('../medalert.keystore')\n            storePassword 'medalert123'\n            keyAlias 'medalert'\n            keyPassword 'medalert123'\n        }\n        debug {`
    );
    gradle = gradle.replace(
      /\/\/ Caution.*\n.*signingConfig signingConfigs\.debug/,
      `// Caution! In production, you need to generate your own keystore file.\n            // see https://reactnative.dev/docs/signed-apk-android.\n            signingConfig signingConfigs.release`
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
}

module.exports = function withMedNotification(config) {
  config = withKotlinFiles(config);
  config = withBootReceiver(config);
  config = withReleaseSigning(config);
  return config;
};
