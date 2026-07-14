package com.alertamedico.app

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import org.json.JSONArray

// Banner "Próximo medicamento" (id 1002). O JS grava em SharedPrefs a agenda das doses de
// hoje (JSON [{ms,title,body}] ordenado). Este receiver posta a próxima dose futura e
// reagenda um alarme exato no horário dela — ao disparar, avança para a seguinte (ou limpa
// quando acaba o dia). Assim o banner fica correto mesmo com o app fechado.
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

        // Retorno NULÁVEL: com FLAG_NO_CREATE o Android devolve null quando não existe
        // PendingIntent — e PendingIntent não sobrevive a reboot. Declarado como não-nulo,
        // o Kotlin lançava NPE aqui, MATANDO o BootReceiver antes de ele restaurar a ficha
        // de emergência e rearmar o keepalive (BootReceiver.kt:15 é a primeira linha).
        private fun pendingIntent(context: Context, flag: Int): PendingIntent? =
            PendingIntent.getBroadcast(
                context, 9002,
                Intent(context, NextMedReceiver::class.java),
                flag or PendingIntent.FLAG_IMMUTABLE
            )

        private fun scheduleAt(context: Context, triggerMs: Long) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            // FLAG_UPDATE_CURRENT sempre cria, então nunca é null aqui.
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
