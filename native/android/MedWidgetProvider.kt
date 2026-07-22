package com.alertamedico.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.util.Calendar

/**
 * Widget da tela inicial: próxima(s) dose(s) e remédios acabando.
 *
 * O widget é desenhado pelo LAUNCHER, num processo que não roda o nosso JS. Ele não pergunta
 * nada ao app — só lê o que o app deixou escrito em SharedPreferences (o mesmo canal que a
 * ficha de emergência já usa). Quem escreve é o MedNotificationModule.setWidgetData.
 *
 * O TEXTO DE TEMPO É CALCULADO AQUI, não no JS. O recado guarda o instante em ms, e o widget
 * pode ficar na tela por horas depois de gravado: "em 2 horas" escrito pelo JS viraria mentira
 * sozinho. Recalculando no desenho, o pior caso é o widget não redesenhar — e aí ele mostra
 * um horário absoluto, que continua verdadeiro.
 */
class MedWidgetProvider : AppWidgetProvider() {

    companion object {
        const val PREFS = "MedAlertWidget"
        const val KEY_DADOS = "dados"

        /** Chamado pelo módulo quando o app regrava os dados. */
        fun atualizarTodos(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, MedWidgetProvider::class.java))
            if (ids.isEmpty()) return
            val provider = MedWidgetProvider()
            for (id in ids) provider.desenhar(context, mgr, id)
        }
    }

    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) desenhar(context, mgr, id)
    }

    /** Redesenha quando a pessoa redimensiona: o layout depende da altura disponível. */
    override fun onAppWidgetOptionsChanged(
        context: Context, mgr: AppWidgetManager, id: Int, newOptions: Bundle
    ) {
        desenhar(context, mgr, id)
    }

    private fun desenhar(context: Context, mgr: AppWidgetManager, id: Int) {
        val opts = mgr.getAppWidgetOptions(id)
        val alturaDp = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 40)

        // Quantas linhas cabem. Os cortes são por ALTURA porque é ela que limita: o launcher
        // dá largura de sobra e altura contada.
        val quantas = when {
            alturaDp >= 180 -> 3
            alturaDp >= 110 -> 2
            else -> 1
        }
        val layout = when (quantas) {
            3 -> R.layout.med_widget_large
            2 -> R.layout.med_widget_medium
            else -> R.layout.med_widget_small
        }

        val views = RemoteViews(context.packageName, layout)
        val json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_DADOS, null)

        try {
            preencher(context, views, json, quantas)
        } catch (e: Exception) {
            // Widget que estoura fica com "Problema ao carregar" na tela do launcher, e o
            // usuário não tem como saber por quê. Melhor mostrar o estado honesto.
            views.setTextViewText(R.id.linha1_nome, "Abra o app")
            views.setTextViewText(R.id.linha1_hora, "")
        }

        // Tocar em qualquer lugar abre o app. É o único gesto que um widget assim precisa.
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        if (intent != null) {
            val pi = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_raiz, pi)
        }

        mgr.updateAppWidget(id, views)
    }

    private fun preencher(context: Context, views: RemoteViews, json: String?, quantas: Int) {
        val idsNome = intArrayOf(R.id.linha1_nome, R.id.linha2_nome, R.id.linha3_nome)
        val idsHora = intArrayOf(R.id.linha1_hora, R.id.linha2_hora, R.id.linha3_hora)
        val idsLinha = intArrayOf(R.id.linha1, R.id.linha2, R.id.linha3)

        if (json.isNullOrBlank()) {
            views.setTextViewText(R.id.linha1_nome, "Nenhum lembrete")
            views.setTextViewText(R.id.linha1_hora, "")
            for (i in 1 until quantas) {
                if (i < idsLinha.size) views.setViewVisibility(idsLinha[i], View.GONE)
            }
            if (quantas >= 3) views.setViewVisibility(R.id.estoque_bloco, View.GONE)
            return
        }

        val o = JSONObject(json)
        val proximas = o.optJSONArray("proximas")
        val n = proximas?.length() ?: 0

        for (i in 0 until minOf(quantas, idsLinha.size)) {
            if (i < n) {
                val item = proximas!!.getJSONObject(i)
                val nome = item.optString("nome")
                val dose = item.optString("dose")
                // O ícone separa remédio de atividade na mesma lista. Default 💊 para dado
                // gravado por uma versão anterior, que não tinha este campo.
                val icone = item.optString("icone", "💊")
                val rotulo = if (dose.isBlank()) nome else "$nome · $dose"
                views.setTextViewText(idsNome[i], if (icone.isBlank()) rotulo else "$icone $rotulo")
                views.setTextViewText(idsHora[i], textoDeQuando(item.optLong("quandoMs")))
                views.setViewVisibility(idsLinha[i], View.VISIBLE)
            } else if (i == 0) {
                views.setTextViewText(idsNome[0], "Nenhum lembrete")
                views.setTextViewText(idsHora[0], "")
            } else {
                views.setViewVisibility(idsLinha[i], View.GONE)
            }
        }

        // Estoque só existe no grande.
        if (quantas >= 3) {
            val estoque = o.optJSONArray("estoqueBaixo")
            if (estoque == null || estoque.length() == 0) {
                views.setViewVisibility(R.id.estoque_bloco, View.GONE)
            } else {
                val sb = StringBuilder()
                for (i in 0 until estoque.length()) {
                    val e = estoque.getJSONObject(i)
                    if (sb.isNotEmpty()) sb.append(" · ")
                    val d = e.optInt("dias")
                    sb.append(e.optString("nome"))
                    sb.append(if (d <= 0) " (acabou)" else if (d == 1) " (1 dia)" else " ($d dias)")
                }
                views.setTextViewText(R.id.estoque_texto, sb.toString())
                views.setViewVisibility(R.id.estoque_bloco, View.VISIBLE)
            }
        }
    }

    /**
     * "hoje 08:00", "amanhã 08:00" ou "19/07 08:00".
     *
     * Absoluto, não relativo. "Em 2 horas" exigiria o widget redesenhar de minuto em minuto —
     * e o Android não redesenha widget de minuto em minuto. O horário do relógio continua certo
     * mesmo se o widget ficar parado a tarde inteira.
     */
    private fun textoDeQuando(ms: Long): String {
        if (ms <= 0L) return ""
        val quando = Calendar.getInstance().apply { timeInMillis = ms }
        val hoje = Calendar.getInstance()
        val amanha = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, 1) }
        val hora = String.format("%02d:%02d", quando.get(Calendar.HOUR_OF_DAY), quando.get(Calendar.MINUTE))
        return when {
            mesmoDia(quando, hoje) -> "hoje $hora"
            mesmoDia(quando, amanha) -> "amanhã $hora"
            else -> String.format(
                "%02d/%02d %s",
                quando.get(Calendar.DAY_OF_MONTH), quando.get(Calendar.MONTH) + 1, hora
            )
        }
    }

    private fun mesmoDia(a: Calendar, b: Calendar) =
        a.get(Calendar.YEAR) == b.get(Calendar.YEAR) &&
            a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
}
