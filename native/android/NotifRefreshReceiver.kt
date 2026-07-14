package com.alertamedico.app

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
        private const val INTERVAL_MS = 15 * 60 * 1000L // 15 min

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
            // FLAG_UPDATE_CURRENT sempre cria, então nunca é null aqui.
            val pi = pendingIntent(context, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
            // Exato + AllowWhileIdle: o app declara USE_EXACT_ALARM (app de lembretes),
            // então o keepalive dispara mesmo em Doze. setAndAllowWhileIdle simples era
            // adiado indefinidamente no Samsung, deixando o card sumir por horas.
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
