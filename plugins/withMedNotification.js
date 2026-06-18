'use strict';
const { withDangerousMod } = require('@expo/config-plugins');
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
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val notification = NotificationCompat.Builder(reactContext, channelId)
                .setSmallIcon(R.drawable.notification_icon)
                .setContentTitle(title)
                .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .build()
            nm.notify(NOTIF_ID, notification)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_NOTIF", e.message)
        }
    }

    @ReactMethod
    fun cancelNotification(promise: Promise) {
        try {
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIF_ID)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_NOTIF", e.message)
        }
    }

    companion object {
        private const val NOTIF_ID = 1001
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

module.exports = function withMedNotification(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const javaDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java/com/medalert/app'
      );

      fs.writeFileSync(path.join(javaDir, 'MedNotificationModule.kt'), MODULE_KT);
      fs.writeFileSync(path.join(javaDir, 'MedNotificationPackage.kt'), PACKAGE_KT);

      // Register package in MainApplication.kt
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
};
