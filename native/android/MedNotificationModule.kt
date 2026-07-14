package com.alertamedico.app

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
                .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setShowWhen(false)
                // Atualizações (mesmo NOTIF_ID) não re-exibem o banner heads-up —
                // permite canal de importância alta sem banner a cada repost/keepalive
                .setOnlyAlertOnce(true)
                .build()
            nm.notify(NOTIF_ID, notification)

            // Keepalive: re-posta a notificação a cada 30 min caso o Android a remova
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

    // O card de emergência é ongoing, mas o One UI (Samsung) o remove quando o app
    // está em segundo plano e chega um heads-up. O JS usa isso para não confiar só na
    // assinatura: se o card não está mais na bandeja, reposta mesmo sem mudança de conteúdo.
    // Agenda do banner "Próximo medicamento": JSON [{ms,title,body}] das doses de hoje.
    // Guarda em SharedPrefs e deixa o NextMedReceiver postar/agendar as trocas.
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
            // Abre a LISTA de otimização de bateria do sistema (o usuário acha o app e
            // marca "Não otimizar"). Diferente de ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            // NÃO exige a permissão REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, que a Play Store
            // restringe (app é categoria Produtividade / pessoa física).
            val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_BATT", e.message)
        }
    }

    // Cripto dos avisos ao cuidador. Ver CaregiverCrypto: a cifra tem que existir em Kotlin de
    // qualquer forma (o aviso de "sem resposta" sai com o app morto), então o JS reaproveita a
    // mesma implementação em vez de trazer uma biblioteca de cripto para o package.json.
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

    // Agenda do "sem resposta" (ver CaregiverReceiver). O JS entrega a lista de doses a cobrar e
    // os dados de envio; a partir daí o Kotlin é autossuficiente — é obrigatório, porque na hora
    // de cobrar o app está morto.
    @ReactMethod
    fun setCaregiverSchedule(pushJson: String, checksJson: String, promise: Promise) {
        try {
            reactContext.getSharedPreferences("MedAlertNotif", Context.MODE_PRIVATE).edit()
                .putString("caregiver_push", pushJson)
                .putString("caregiver_checks", checksJson)
                .apply()
            CaregiverReceiver.refresh(reactContext)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_CAREGIVER", e.message)
        }
    }

    companion object {
        const val NOTIF_ID = 1001
    }
}
