import React, { useCallback, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Share, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMedications, getRemindersForMedication, getProfile } from '../database/db';
import { cicloDoMedicamento, diasDeEstoque } from '../utils/medCycle';
import {
  ItemCompra, LinhaCompra, ordenarParaCompra, precisaRepor, sugestaoQuantidade,
  montarTextoLista, DIAS_PARA_REPOR,
} from '../utils/listaCompras';
import { gerarListaComprasPdf } from '../services/listaComprasPdf';

export default function ShoppingListScreen() {
  const insets = useSafeAreaInsets();
  const [itens, setItens] = useState<ItemCompra[]>([]);
  const [nome, setNome] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [gerando, setGerando] = useState(false);

  // A chave presente = item marcado; o valor é o que está escrito no campo de quantidade.
  // Guardar as duas coisas num mapa só evita o estado impossível de "marcado sem quantidade" e
  // "quantidade sem marcação" discordarem.
  const [sel, setSel] = useState<Record<number, string>>({});
  // A pré-marcação é um palpite de BOAS-VINDAS, não uma opinião do app que deva se reimpor.
  // Sem esta trava, voltar de outra aba (a tela fica montada, mas recarrega ao ganhar foco)
  // desfaria à força tudo que a pessoa tivesse marcado e digitado.
  const jaPreMarcou = useRef(false);

  const load = useCallback(async () => {
    // Inclui os pausados: quem parou um remédio temporariamente ainda pode querer repor, e
    // sumir com ele da lista sem dizer nada seria decidir isso por ele.
    const [meds, perfil] = await Promise.all([getMedications(true), getProfile()]);
    const lista: ItemCompra[] = await Promise.all(meds.map(async med => {
      const rs = (await getRemindersForMedication(med.id).catch(() => [])).filter(r => r.is_active);
      // Mesma conta da tela de Medicamentos, de propósito: é lá que a pessoa vê "faltam 4 dias".
      // Duas fórmulas para a mesma pergunta dariam dois números, e ela não teria como saber qual
      // acreditar.
      const tipo = (rs[0]?.period ?? 'day').split(':')[0];
      const dosesPorDia = rs.length ? (tipo === 'day' ? rs.length : 1) * (med.units_per_dose || 1) : 0;
      const ciclo = cicloDoMedicamento(med);
      const dias = med.stock_quantity == null || !dosesPorDia ? null
        : ciclo ? diasDeEstoque(ciclo, med.stock_quantity, dosesPorDia)
        : Math.floor(med.stock_quantity / dosesPorDia);
      return {
        id: med.id,
        nome: med.commercial_name?.trim() || med.generic_name,
        dose: med.dose ?? '',
        estoque: med.stock_quantity,
        diasRestantes: dias,
        dosesPorDia,
        suspenso: !!med.suspended,
      };
    }));

    const ordenada = ordenarParaCompra(lista);
    setItens(ordenada);
    setNome(perfil?.name?.trim() || null);
    if (!jaPreMarcou.current) {
      jaPreMarcou.current = true;
      const inicial: Record<number, string> = {};
      for (const i of ordenada) {
        if (precisaRepor(i)) inicial[i.id] = String(sugestaoQuantidade(i) ?? '');
      }
      setSel(inicial);
    }
    setCarregando(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function toggle(i: ItemCompra) {
    setSel(prev => {
      const novo = { ...prev };
      if (i.id in novo) delete novo[i.id];
      else novo[i.id] = String(sugestaoQuantidade(i) ?? '');
      return novo;
    });
  }

  function linhasSelecionadas(): LinhaCompra[] {
    return itens.filter(i => i.id in sel).map(i => {
      const q = parseInt(sel[i.id], 10);
      return {
        nome: i.nome,
        dose: i.dose,
        quantidade: Number.isFinite(q) && q > 0 ? q : null,
        estoque: i.estoque,
      };
    });
  }

  /** Todo botão do rodapé passa por aqui: nenhum deles faz sentido com a lista vazia. */
  async function comSelecao(acao: (linhas: LinhaCompra[]) => Promise<void>) {
    const linhas = linhasSelecionadas();
    if (!linhas.length) {
      Alert.alert('Nenhum item marcado', 'Marque os medicamentos que quer levar na lista.');
      return;
    }
    if (gerando) return;
    setGerando(true);
    try {
      // A corrida contra o relógio não é preciosismo — foi um travamento observado.
      //
      // printToFileAsync desenha o PDF num WebView do sistema. Quando esse WebView morre no
      // arranque a frio, a promessa NÃO rejeita: ela simplesmente nunca resolve. Sem o limite,
      // o `finally` nunca roda, `gerando` fica preso em true e os três botões do rodapé ficam
      // mortos — calados, sem mensagem nenhuma. E a tela é de ABA: ela continua montada, então
      // sair e voltar não conserta. Só fechar o app inteiro. Aqui isso vira um aviso.
      await Promise.race([
        acao(linhas),
        new Promise<never>((_, rej) => setTimeout(
          () => rej(new Error('A geração demorou demais. Tente de novo.')), 20000)),
      ]);
    } catch (e: any) {
      // Sem catch silencioso: uma lista que não sai e não avisa faz a pessoa ir à farmácia
      // achando que levou.
      Alert.alert('Não foi possível', e?.message ?? 'Tente novamente.');
    } finally {
      setGerando(false);
    }
  }

  const marcados = Object.keys(sel).length;

  return (
    <View style={styles.container}>
      {carregando ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#1C3F7A" />
      ) : itens.length === 0 ? (
        <Text style={styles.vazio}>Nenhum medicamento cadastrado ainda.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.intro}>
            Marque o que precisa comprar e ajuste a quantidade. Quem está acabando nos próximos{' '}
            {DIAS_PARA_REPOR} dias já vem marcado.
          </Text>

          {itens.map(i => {
            const marcado = i.id in sel;
            return (
              <View key={i.id} style={[styles.card, marcado && styles.cardMarcado]}>
                <TouchableOpacity
                  style={styles.linha}
                  activeOpacity={0.7}
                  onPress={() => toggle(i)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: marcado }}
                  accessibilityLabel={i.nome}
                >
                  <View style={[styles.box, marcado && styles.boxMarcado]}>
                    {marcado && <Text style={styles.check}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nome} numberOfLines={2}>
                      {i.nome}{i.dose ? <Text style={styles.dose}>  {i.dose}</Text> : null}
                    </Text>
                    <Text style={[styles.saldo, precisaRepor(i) && styles.saldoBaixo]}>
                      {i.suspenso ? 'pausado · ' : ''}
                      {i.estoque == null
                        ? 'sem controle de estoque'
                        : `tenho ${i.estoque}${i.diasRestantes != null ? ` · dá para ${i.diasRestantes} dia${i.diasRestantes === 1 ? '' : 's'}` : ''}`}
                    </Text>
                  </View>
                </TouchableOpacity>

                {marcado && (
                  <View style={styles.qtdLinha}>
                    <Text style={styles.qtdRot}>Comprar</Text>
                    <TextInput
                      style={styles.qtdInput}
                      value={sel[i.id]}
                      onChangeText={t => setSel(p => ({ ...p, [i.id]: t.replace(/[^0-9]/g, '') }))}
                      keyboardType="number-pad"
                      maxLength={4}
                      placeholder="—"
                      placeholderTextColor="#C0C5D0"
                      selectTextOnFocus
                    />
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {itens.length > 0 && (
        <View style={[styles.rodape, { paddingBottom: insets.bottom + 10 }]}>
          {/* O estado de ocupado precisa APARECER. Sem ele, gerar o PDF (que leva alguns
              segundos) é indistinguível de um botão que não funcionou — e a pessoa toca de
              novo, ou desiste achando que o app está quebrado. */}
          <Text style={[styles.contagem, gerando && styles.contagemGerando]}>
            {gerando ? 'Gerando…'
              : marcados === 0 ? 'Nenhum item marcado'
              : `${marcados} ${marcados === 1 ? 'item marcado' : 'itens marcados'}`}
          </Text>
          <View style={styles.botoes}>
            {/* Três saídas porque servem a três destinos diferentes: o PDF é o papel que se
                imprime ou se anexa; o texto é o que o WhatsApp aceita sem virar anexo que
                ninguém abre; e copiar serve para colar onde o compartilhar não chega. */}
            <TouchableOpacity
              style={[styles.btn, gerando && styles.btnOff]} activeOpacity={0.8} disabled={gerando}
              onPress={() => comSelecao(async l => { await gerarListaComprasPdf(l, nome); })}
            >
              <Text style={styles.btnIcon}>📄</Text>
              <Text style={styles.btnText}>PDF</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, gerando && styles.btnOff]} activeOpacity={0.8} disabled={gerando}
              onPress={() => comSelecao(async l => { await Share.share({ message: montarTextoLista(l) }); })}
            >
              <Text style={styles.btnIcon}>📤</Text>
              <Text style={styles.btnText}>Enviar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, gerando && styles.btnOff]} activeOpacity={0.8} disabled={gerando}
              onPress={() => comSelecao(async l => {
                await Clipboard.setStringAsync(montarTextoLista(l));
                Alert.alert('Copiado', 'A lista está na área de transferência.');
              })}
            >
              <Text style={styles.btnIcon}>📋</Text>
              <Text style={styles.btnText}>Copiar</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 14, paddingBottom: 24, gap: 10 },
  intro: { fontSize: 13, color: '#5A6072', lineHeight: 19, marginBottom: 2 },
  vazio: { textAlign: 'center', color: '#8A8F9D', marginTop: 40, fontSize: 14 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  cardMarcado: { borderWidth: 1.5, borderColor: '#1C3F7A' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: {
    width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: '#C0C5D0',
    alignItems: 'center', justifyContent: 'center',
  },
  boxMarcado: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  check: { color: '#fff', fontSize: 16, fontWeight: '700', lineHeight: 20 },
  nome: { fontSize: 15, fontWeight: '700', color: '#1A1F2E' },
  dose: { fontSize: 13, fontWeight: '400', color: '#8A8F9D' },
  saldo: { fontSize: 12, color: '#8A8F9D', marginTop: 3 },
  saldoBaixo: { color: '#E07B4F', fontWeight: '600' },
  qtdLinha: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.08)',
  },
  qtdRot: { fontSize: 13, color: '#5A6072', fontWeight: '600' },
  qtdInput: {
    minWidth: 80, borderWidth: 1, borderColor: '#D5DAE3', borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 12, fontSize: 16, color: '#1A1F2E',
    textAlign: 'center', backgroundColor: '#F8F9FC',
  },
  rodape: {
    backgroundColor: '#fff', paddingHorizontal: 14, paddingTop: 10,
    borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.08)',
  },
  contagem: { fontSize: 12, color: '#8A8F9D', textAlign: 'center', marginBottom: 8 },
  contagemGerando: { color: '#1C3F7A', fontWeight: '700' },
  botoes: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1, backgroundColor: '#1C3F7A', borderRadius: 10, paddingVertical: 12,
    alignItems: 'center', gap: 2,
  },
  btnOff: { opacity: 0.45 },
  btnIcon: { fontSize: 16 },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
