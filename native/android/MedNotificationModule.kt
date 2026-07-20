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

    /**
     * Grava o recado do widget e manda redesenhar.
     *
     * O widget roda no processo do LAUNCHER e não alcança o nosso JS — então o app não pede
     * para desenhar, ele deixa escrito. Chamado a cada reagendamento: `updatePeriodMillis` é
     * 0 de propósito, porque o mínimo do Android (30 min) mostraria dose velha.
     */
    @ReactMethod
    fun setWidgetData(json: String, promise: Promise) {
        try {
            reactContext.getSharedPreferences(MedWidgetProvider.PREFS, Context.MODE_PRIVATE)
                .edit().putString(MedWidgetProvider.KEY_DADOS, json).apply()
            MedWidgetProvider.atualizarTodos(reactContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WIDGET_ERR", e.message, e)
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

    // Aqui viviam a cripto do cuidador (CaregiverCrypto) e a agenda do "sem resposta"
    // (setCaregiverSchedule + CaregiverReceiver). Ambas foram REMOVIDAS em 14/07/2026.
    //
    // Elas existiam por um motivo só: o idoso tinha que ENVIAR o aviso com o app morto, e lá não
    // há runtime de JS. A inversão do disparo eliminou essa necessidade — quem gera o alerta
    // agora é o celular do CUIDADOR, com uma notificação local sua. O idoso só envia quando
    // alguém toca num botão, e aí o JS está vivo.
    //
    // Isso apagou ~250 linhas de Kotlin, tirou o cuidador da dependência de alarme exato (que o
    // iOS proíbe) e ainda cobriu o buraco que o desenho antigo tinha: com o celular do idoso
    // DESLIGADO, o alarme não disparava e o cuidador não recebia nada — lendo o silêncio como
    // "está tudo bem". Ver src/services/caregiver.ts.

    companion object {
        const val NOTIF_ID = 1001
    }
}
