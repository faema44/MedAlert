'use strict';
const {
  withDangerousMod, withAndroidManifest, withAppBuildGradle, withProjectBuildGradle,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MODULE_KT = `package com.alertamedico.app

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.provider.Settings
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
                .setOnlyAlertOnce(true)
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

    // Notificação simples (não sobrevive a reboot, sem BigTextStyle) usada pelo banner
    // "Próximo medicamento" — setShowWhen(false) esconde o carimbo de hora que o Android
    // mostra por padrão (que reflete quando foi postada, não o horário do remédio).
    @ReactMethod
    fun postSimpleNotification(title: String, body: String, channelId: String, notifId: Double, promise: Promise) {
        try {
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val notification = NotificationCompat.Builder(reactContext, channelId)
                .setSmallIcon(R.drawable.notification_icon)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setShowWhen(false)
                .build()
            nm.notify(notifId.toInt(), notification)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_NOTIF", e.message)
        }
    }

    @ReactMethod
    fun cancelSimpleNotification(notifId: Double, promise: Promise) {
        try {
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(notifId.toInt())
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_NOTIF", e.message)
        }
    }

    @ReactMethod
    fun setNextMedSchedule(scheduleJson: String, promise: Promise) {
        try {
            reactContext.getSharedPreferences("MedAlertNotif", Context.MODE_PRIVATE).edit()
                .putString("next_med_schedule", scheduleJson)
                .apply()
            NextMedReceiver.refresh(reactContext)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_NEXTMED", e.message)
        }
    }

    @ReactMethod
    fun cancelNextMedBanner(promise: Promise) {
        try {
            NextMedReceiver.cancelBanner(reactContext)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_NEXTMED", e.message)
        }
    }

    @ReactMethod
    fun isEmergencyActive(promise: Promise) {
        try {
            val nm = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            promise.resolve(nm.activeNotifications.any { it.id == NOTIF_ID })
        } catch (e: Exception) {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            val pm = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
            promise.resolve(pm.isIgnoringBatteryOptimizations(reactContext.packageName))
        } catch (e: Exception) {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_BATT", e.message)
        }
    }

    // Cripto dos avisos ao cuidador. Ver CAREGIVER_CRYPTO_KT: a cifra precisa existir em Kotlin
    // de qualquer forma (o aviso de "sem resposta" sai com o app morto, sem runtime de JS), então
    // o JS reaproveita a MESMA implementação em vez de trazer uma lib de cripto ao package.json.
    @ReactMethod
    fun caregiverNewKey(promise: Promise) {
        try {
            promise.resolve(CaregiverCrypto.newKeyB64())
        } catch (e: Exception) {
            promise.reject("ERR_CRYPTO", e.message)
        }
    }

    @ReactMethod
    fun caregiverEncrypt(plaintext: String, keyB64: String, promise: Promise) {
        try {
            promise.resolve(CaregiverCrypto.encrypt(plaintext, keyB64))
        } catch (e: Exception) {
            promise.reject("ERR_CRYPTO", e.message)
        }
    }

    @ReactMethod
    fun caregiverDecrypt(payloadB64: String, keyB64: String, promise: Promise) {
        try {
            promise.resolve(CaregiverCrypto.decrypt(payloadB64, keyB64))
        } catch (e: Exception) {
            // Chave errada ou payload adulterado — o GCM detecta e estoura aqui.
            promise.reject("ERR_CRYPTO", e.message)
        }
    }

    companion object {
        const val NOTIF_ID = 1001
    }
}
`;

const CAREGIVER_CRYPTO_KT = `package com.alertamedico.app

import android.util.Base64
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Cifra dos avisos enviados ao cuidador.
 *
 * O aviso viaja como push pelos servidores do Expo e do Google (FCM). O corpo VISÍVEL da push é
 * genérico ("Novo aviso — toque para ver"); o que é dado de saúde (qual remédio, qual dose, e até
 * o NOME do paciente) vai só aqui dentro, cifrado com a chave que idoso e cuidador trocaram no
 * pareamento. Nem o Expo nem o Google conseguem ler.
 *
 * Fica em Kotlin, e não em JS, por um motivo que não é estético: o aviso de "sem resposta" tem que
 * sair com o app MORTO (é a definição de sem resposta — ninguém tocou em nada). Quem envia é um
 * receiver de alarme nativo, sem runtime de JS por perto. Como a cifra precisa existir aqui de
 * qualquer jeito, o lado JS chama estas mesmas funções via MedNotificationModule — o que também
 * evita adicionar uma biblioteca de cripto ao package.json.
 *
 * AES-256-GCM. O IV (12 bytes, novo a cada mensagem) vai na frente do texto cifrado.
 */
object CaregiverCrypto {
    private const val IV_BYTES = 12
    private const val TAG_BITS = 128

    fun newKeyB64(): String {
        val key = ByteArray(32)
        SecureRandom().nextBytes(key)
        return Base64.encodeToString(key, Base64.NO_WRAP)
    }

    fun encrypt(plaintext: String, keyB64: String): String {
        val key = SecretKeySpec(Base64.decode(keyB64, Base64.NO_WRAP), "AES")
        val iv = ByteArray(IV_BYTES)
        SecureRandom().nextBytes(iv)

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv))
        val sealed = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))

        return Base64.encodeToString(iv + sealed, Base64.NO_WRAP)
    }

    fun decrypt(payloadB64: String, keyB64: String): String {
        val raw = Base64.decode(payloadB64, Base64.NO_WRAP)
        require(raw.size > IV_BYTES) { "payload cifrado truncado" }

        val key = SecretKeySpec(Base64.decode(keyB64, Base64.NO_WRAP), "AES")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, raw.copyOfRange(0, IV_BYTES)))

        return String(cipher.doFinal(raw.copyOfRange(IV_BYTES, raw.size)), Charsets.UTF_8)
    }
}
`;

const PACKAGE_KT = `package com.alertamedico.app

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

const BOOT_RECEIVER_KT = `package com.alertamedico.app

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != "android.intent.action.QUICKBOOT_POWERON") return

        NextMedReceiver.refresh(context)

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
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .build()
        nm.notify(MedNotificationModule.NOTIF_ID, notification)

        NotifRefreshReceiver.scheduleNext(context)
    }
}
`;

const NOTIF_REFRESH_RECEIVER_KT = `package com.alertamedico.app

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
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .build()
        nm.notify(MedNotificationModule.NOTIF_ID, notification)

        scheduleNext(context)
    }

    companion object {
        private const val INTERVAL_MS = 15 * 60 * 1000L

        // Nulável: com FLAG_NO_CREATE o Android devolve null quando não há PendingIntent
        // (e ele não sobrevive a reboot). Declarado não-nulo, o Kotlin lançava NPE.
        private fun pendingIntent(context: Context, flag: Int): PendingIntent? =
            PendingIntent.getBroadcast(
                context, 9001,
                Intent(context, NotifRefreshReceiver::class.java),
                flag or PendingIntent.FLAG_IMMUTABLE
            )

        fun scheduleNext(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val trigger = SystemClock.elapsedRealtime() + INTERVAL_MS
            val pi = pendingIntent(context, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
            try {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi)
            } catch (e: SecurityException) {
                am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi)
            }
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

const NEXT_MED_RECEIVER_KT = `package com.alertamedico.app

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import org.json.JSONArray

class NextMedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        refresh(context)
    }

    companion object {
        const val NEXT_MED_ID = 1002
        private const val CHANNEL = "medalert_next_med_v1"
        private const val PREF_KEY = "next_med_schedule"

        fun refresh(context: Context) {
            val prefs = context.getSharedPreferences("MedAlertNotif", Context.MODE_PRIVATE)
            val json = prefs.getString(PREF_KEY, null)
            val now = System.currentTimeMillis()
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            var atMs = 0L
            var title: String? = null
            var body: String? = null
            if (json != null) {
                try {
                    val arr = JSONArray(json)
                    for (i in 0 until arr.length()) {
                        val o = arr.getJSONObject(i)
                        val ms = o.getLong("ms")
                        if (ms > now) { atMs = ms; title = o.getString("title"); body = o.getString("body"); break }
                    }
                } catch (e: Exception) {}
            }

            if (title == null) {
                nm.cancel(NEXT_MED_ID)
                cancelAlarm(context)
                return
            }

            val n = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.notification_icon)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setShowWhen(false)
                .setOnlyAlertOnce(true)
                .build()
            nm.notify(NEXT_MED_ID, n)

            scheduleAt(context, atMs)
        }

        fun cancelBanner(context: Context) {
            context.getSharedPreferences("MedAlertNotif", Context.MODE_PRIVATE)
                .edit().remove(PREF_KEY).apply()
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NEXT_MED_ID)
            cancelAlarm(context)
        }

        // Nulável: com FLAG_NO_CREATE o Android devolve null quando não há PendingIntent
        // (e ele não sobrevive a reboot). Declarado não-nulo, o Kotlin lançava NPE em
        // cancelAlarm() — o que MATAVA o BootReceiver antes de ele restaurar a ficha de
        // emergência. Como cancelAlarm() só é chamado quando não há dose futura na agenda
        // do dia, a falha acontecia justamente nos reboots à noite e depois da meia-noite.
        private fun pendingIntent(context: Context, flag: Int): PendingIntent? =
            PendingIntent.getBroadcast(
                context, 9002,
                Intent(context, NextMedReceiver::class.java),
                flag or PendingIntent.FLAG_IMMUTABLE
            )

        private fun scheduleAt(context: Context, triggerMs: Long) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pi = pendingIntent(context, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
            try {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pi)
            } catch (e: SecurityException) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerMs, pi)
            }
        }

        private fun cancelAlarm(context: Context) {
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
        'app/src/main/java/com/alertamedico/app'
      );

      fs.writeFileSync(path.join(javaDir, 'MedNotificationModule.kt'), MODULE_KT);
      fs.writeFileSync(path.join(javaDir, 'CaregiverCrypto.kt'), CAREGIVER_CRYPTO_KT);
      fs.writeFileSync(path.join(javaDir, 'MedNotificationPackage.kt'), PACKAGE_KT);
      fs.writeFileSync(path.join(javaDir, 'BootReceiver.kt'), BOOT_RECEIVER_KT);
      fs.writeFileSync(path.join(javaDir, 'NotifRefreshReceiver.kt'), NOTIF_REFRESH_RECEIVER_KT);
      fs.writeFileSync(path.join(javaDir, 'NextMedReceiver.kt'), NEXT_MED_RECEIVER_KT);

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

    if (!application.receiver.some(r => r.$?.['android:name'] === '.NextMedReceiver')) {
      application.receiver.push({
        $: { 'android:name': '.NextMedReceiver', 'android:exported': 'false' },
      });
    }

    return cfg;
  });
}

function withCompatResizability(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const activities = manifest.manifest.application[0].activity || [];
    const mainActivity = activities.find(a => a.$?.['android:name'] === '.MainActivity');
    if (!mainActivity) return cfg;

    if (!mainActivity.property) mainActivity.property = [];
    if (!mainActivity.property.some(p => p.$?.['android:name'] === 'android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY')) {
      mainActivity.property.push({
        $: { 'android:name': 'android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY', 'android:value': 'true' },
      });
    }

    return cfg;
  });
}

// Injeta o signingConfig de release no build.gradle gerado.
//
// As credenciais NÃO ficam aqui. Este arquivo é versionado num repositório PÚBLICO — a
// senha da keystore chegou a ser commitada em texto puro neste bloco (rotacionada em
// 12/07/2026). Agora os valores vêm de propriedades do Gradle, que moram em
// ~/.gradle/gradle.properties, fora do repositório E fora da pasta do projeto:
//
//   MEDALERT_STORE_FILE, MEDALERT_STORE_PASSWORD, MEDALERT_KEY_ALIAS, MEDALERT_KEY_PASSWORD
//
// Sem essas propriedades, o build de release cai no debug signing em vez de quebrar — quem
// clonar o repo sem a chave ainda consegue compilar.
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('MEDALERT_STORE_FILE')) return cfg;

    gradle = gradle.replace(
      /signingConfigs \{\s*debug \{/,
      `signingConfigs {\n        release {\n            if (project.hasProperty('MEDALERT_STORE_FILE')) {\n                storeFile rootProject.file(MEDALERT_STORE_FILE)\n                storePassword MEDALERT_STORE_PASSWORD\n                keyAlias MEDALERT_KEY_ALIAS\n                keyPassword MEDALERT_KEY_PASSWORD\n            }\n        }\n        debug {`
    );
    gradle = gradle.replace(
      /\/\/ Caution.*\n.*signingConfig signingConfigs\.debug/,
      `// Assina com a chave de upload quando ela estiver configurada (ver acima).\n            signingConfig project.hasProperty('MEDALERT_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
}

// FCM: o plugin do google-services precisa do classpath no build.gradle RAIZ. Sem ele, o
// google-services.json é ignorado EM SILÊNCIO — o app compila, instala, e o push simplesmente
// nunca chega. Foi assim que o projeto ficou meses com push impossível sem ninguém notar.
function withGoogleServices(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('com.google.gms:google-services')) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      /classpath\('org\.jetbrains\.kotlin:kotlin-gradle-plugin'\)/,
      `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')\n    classpath('com.google.gms:google-services:4.4.2')`
    );
    return cfg;
  });
}

// E o plugin em si, no módulo do app. O google-services.json é copiado da RAIZ do repositório a
// cada build: android/ é regenerável, e manter uma segunda cópia lá dentro repetiria o drift que
// já custou caro com o versionCode — dois lugares com a mesma verdade, um deles envelhecendo
// calado. Se o arquivo não existir, o plugin QUEBRA o build, de propósito.
function withGoogleServicesApp(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('com.google.gms.google-services')) return cfg;
    cfg.modResults.contents += `
copy {
    from "\${rootDir}/../google-services.json"
    into projectDir
}
apply plugin: 'com.google.gms.google-services'
`;
    return cfg;
  });
}

// Deep link do pareamento do cuidador: alertamedico://cuidador?n=&t=&k=
// O convite chega por WhatsApp e o idoso toca no link uma vez. Ver src/services/caregiver.ts.
function withPairingDeepLink(config) {
  return withAndroidManifest(config, (cfg) => {
    const activities = cfg.modResults.manifest.application[0].activity || [];
    const main = activities.find(a => a.$?.['android:name'] === '.MainActivity');
    if (!main) return cfg;

    if (!main['intent-filter']) main['intent-filter'] = [];
    const jaTem = main['intent-filter'].some(f =>
      f.data?.some(d => d.$?.['android:scheme'] === 'alertamedico')
    );
    if (!jaTem) {
      main['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        category: [
          { $: { 'android:name': 'android.intent.category.DEFAULT' } },
          { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
        ],
        data: [{ $: { 'android:scheme': 'alertamedico' } }],
      });
    }
    return cfg;
  });
}

module.exports = function withMedNotification(config) {
  config = withKotlinFiles(config);
  config = withBootReceiver(config);
  config = withCompatResizability(config);
  config = withReleaseSigning(config);
  config = withGoogleServices(config);
  config = withGoogleServicesApp(config);
  config = withPairingDeepLink(config);
  return config;
};
