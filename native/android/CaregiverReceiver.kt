package com.alertamedico.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * O aviso de "sem resposta" ao cuidador.
 *
 * POR QUE ISTO É NATIVO
 * Este é o único aviso que, por definição, acontece quando NINGUÉM tocou em nada — e é
 * justamente aí que o Android já matou o processo e não há runtime de JS para reagir. Se o
 * envio dependesse do JS, ele falharia exatamente nos casos que importam, e o cuidador leria o
 * silêncio como "está tudo bem". Então quem envia é este receiver, acordado por alarme exato,
 * lendo o SQLite direto e falando HTTP por conta própria.
 *
 * O FALSO POSITIVO QUE NÃO DÁ PARA EVITAR AQUI
 * Se a pessoa apertou "Tomei" no botão da NOTIFICAÇÃO com o app morto, essa resposta não chega
 * ao banco na hora — o App.tsx só a processa no próximo cold-start (é por isso que o
 * reconcileMissedDoses existe). No instante do alarme, o banco diz "sem resposta" mesmo que ela
 * tenha tomado. Não mentimos: a informação disponível ERA essa. E a correção sai sozinha, porque
 * o gancho do db.ts dispara também no cold-start, quando a resposta represada é finalmente
 * gravada — o cuidador recebe "Maria tomou X (15:00)" logo depois. Errar para MAIS aviso é
 * recuperável; errar para menos é silêncio, e silêncio aqui é indistinguível de "tudo bem".
 */
class CaregiverReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        // Rede em BroadcastReceiver: goAsync() segura o processo vivo além do onReceive.
        val pending = goAsync()
        Thread {
            try {
                processarVencidos(context)
                agendarProximo(context)
            } catch (e: Exception) {
                // Nunca deixe o receiver estourar: uma exceção aqui mata o rearme do alarme e o
                // cuidador para de receber avisos PARA SEMPRE, em silêncio. Foi assim que uma NPE
                // no NextMedReceiver derrubou a ficha de emergência por meses.
            } finally {
                pending.finish()
            }
        }.start()
    }

    companion object {
        private const val PREFS = "MedAlertNotif"
        private const val KEY_CHECKS = "caregiver_checks"   // agenda: doses a cobrar
        private const val KEY_PUSH = "caregiver_push"       // { token, key, patient }
        private const val REQUEST_CODE = 9003
        private const val EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

        /** Chamado pelo JS (via MedNotificationModule) e pelo BootReceiver. */
        fun refresh(context: Context) {
            Thread {
                try {
                    processarVencidos(context)
                    agendarProximo(context)
                } catch (e: Exception) {}
            }.start()
        }

        private fun prefs(context: Context) =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        // -------------------------------------------------------------------------------
        // Agenda
        // -------------------------------------------------------------------------------
        private fun lerChecks(context: Context): JSONArray {
            val raw = prefs(context).getString(KEY_CHECKS, null) ?: return JSONArray()
            return try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
        }

        private fun gravarChecks(context: Context, arr: JSONArray) {
            prefs(context).edit().putString(KEY_CHECKS, arr.toString()).apply()
        }

        /** Cobra toda dose cuja janela de tolerância já venceu, e remove da agenda. */
        private fun processarVencidos(context: Context) {
            val checks = lerChecks(context)
            val agora = System.currentTimeMillis()
            val restantes = JSONArray()

            for (i in 0 until checks.length()) {
                val c = checks.optJSONObject(i) ?: continue
                val cobrarEm = c.optLong("at")
                if (cobrarEm > agora) { restantes.put(c); continue }

                // Venceu. Só avisa se a dose continuar sem resposta no banco.
                if (!doseRespondida(context, c.optInt("medId"), c.optLong("slot"))) {
                    enviar(context, c)
                }
                // Respondida ou avisada, sai da agenda nos dois casos.
            }
            gravarChecks(context, restantes)
        }

        private fun agendarProximo(context: Context) {
            val checks = lerChecks(context)
            var proximo = Long.MAX_VALUE
            for (i in 0 until checks.length()) {
                val at = checks.optJSONObject(i)?.optLong("at") ?: continue
                if (at < proximo) proximo = at
            }

            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            if (proximo == Long.MAX_VALUE) {
                pendingIntent(context, PendingIntent.FLAG_NO_CREATE)?.let { am.cancel(it); it.cancel() }
                return
            }
            val pi = pendingIntent(context, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
            try {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, proximo, pi)
            } catch (e: SecurityException) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, proximo, pi)
            }
        }

        // Nulável de propósito: com FLAG_NO_CREATE o Android devolve null quando o PendingIntent
        // não existe (e ele não sobrevive a reboot). Declarar não-nulo aqui foi o que gerou a NPE
        // que matou o BootReceiver — mesmo erro, não repetir.
        private fun pendingIntent(context: Context, flag: Int): PendingIntent? =
            PendingIntent.getBroadcast(
                context, REQUEST_CODE,
                Intent(context, CaregiverReceiver::class.java),
                flag or PendingIntent.FLAG_IMMUTABLE
            )

        // -------------------------------------------------------------------------------
        // O banco (o mesmo arquivo que o expo-sqlite usa; aberto só para leitura)
        // -------------------------------------------------------------------------------
        private fun doseRespondida(context: Context, medId: Int, slotMs: Long): Boolean {
            val arquivo = File(context.filesDir, "SQLite/medalert.db")
            if (!arquivo.exists()) return true // sem banco, não invente um alerta

            var db: SQLiteDatabase? = null
            return try {
                db = SQLiteDatabase.openDatabase(
                    arquivo.absolutePath, null, SQLiteDatabase.OPEN_READONLY
                )
                // Mesma janela de ±50min que a Home usa para casar resposta com horário agendado.
                val cursor = db.rawQuery(
                    """SELECT 1 FROM medication_log
                       WHERE medication_id=? AND taken IS NOT NULL
                         AND ABS(strftime('%s', scheduled_at) - ?) < 3000 LIMIT 1""",
                    arrayOf(medId.toString(), (slotMs / 1000).toString())
                )
                val achou = cursor.moveToFirst()
                cursor.close()
                achou
            } catch (e: Exception) {
                // Banco ilegível: cala a boca. Um aviso falso de "não tomou" faz o cuidador
                // cobrar uma dose que já foi tomada — e pode causar dose DUPLA.
                true
            } finally {
                db?.close()
            }
        }

        // -------------------------------------------------------------------------------
        // O envio
        // -------------------------------------------------------------------------------
        private fun enviar(context: Context, check: JSONObject) {
            val pushRaw = prefs(context).getString(KEY_PUSH, null) ?: return
            val push = try { JSONObject(pushRaw) } catch (e: Exception) { return }
            val token = push.optString("token").ifEmpty { return }
            val chave = push.optString("key").ifEmpty { return }
            val paciente = push.optString("patient").ifEmpty { "A pessoa que você cuida" }

            val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }.format(Date(check.optLong("slot")))

            val payload = JSONObject()
                .put("kind", "med")
                .put("name", check.optString("name"))
                .put("dose", check.optString("dose"))
                .put("status", "no_response")
                .put("at", iso)
                .put("patient", paciente)

            val corpo = JSONObject()
                .put("to", token)
                // Igual ao lado JS: o que Expo e Google leem não diz NADA. O conteúdo vai cifrado.
                .put("title", "Alerta Médico")
                .put("body", "Novo aviso — toque para ver")
                .put("data", JSONObject().put("c", CaregiverCrypto.encrypt(payload.toString(), chave)))
                .put("channelId", "caregiver_alerts")
                .put("priority", "high")

            val conn = (URL(EXPO_PUSH_URL).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 15000
                readTimeout = 15000
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("Accept", "application/json")
            }
            try {
                conn.outputStream.use { it.write(corpo.toString().toByteArray(Charsets.UTF_8)) }
                conn.responseCode // dispara o envio
            } finally {
                conn.disconnect()
            }
        }
    }
}
