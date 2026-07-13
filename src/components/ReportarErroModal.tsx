import React, { useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { reportarErro } from '../services/reportMissing';

/**
 * "Informar erro" — na bula e na interação.
 *
 * É a última linha de defesa, e a mais valiosa. As auditorias automáticas pegam bula de
 * composto no slug do ingrediente puro e alarme falso por token de sal; não pegam "esta bula é
 * de outro fabricante, não bate com a minha caixa" nem "esta interação está exagerada". Quem vê
 * isso é quem toma o remédio.
 *
 * Os motivos são LISTADOS, não só texto livre: relato solto ("está errado") não é acionável.
 * Cada motivo aqui aponta para uma correção concreta que já sabemos fazer.
 */

export type TipoErro = 'bula' | 'interacao';

const MOTIVOS: Record<TipoErro, string[]> = {
  bula: [
    'É a bula de OUTRO medicamento',
    'O fabricante/apresentação não é o do meu remédio',
    'A bula não abre ou dá erro',
    'Está faltando a bula deste medicamento',
    'Outro',
  ],
  interacao: [
    'Esta interação não existe',
    'A gravidade está exagerada',
    'A gravidade está branda demais',
    'O texto está errado ou confuso',
    'Falta uma interação que eu conheço',
    'Outro',
  ],
};

type Props = {
  visible: boolean;
  tipo: TipoErro;
  alvo: string;        // slug da bula, ou "int_006 · Sildenafila × Nitratos"
  titulo: string;      // o que o usuário está vendo, para ele confirmar que é isto mesmo
  onClose: () => void;
};

export default function ReportarErroModal({ visible, tipo, alvo, titulo, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [motivo, setMotivo] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<'ok' | 'falhou' | null>(null);

  function fechar() {
    setMotivo(null);
    setDetalhe('');
    setResultado(null);
    onClose();
  }

  async function enviar() {
    if (!motivo) return;
    setEnviando(true);
    const ok = await reportarErro(tipo, alvo, motivo, detalhe);
    setEnviando(false);
    setResultado(ok ? 'ok' : 'falhou');
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={fechar}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          {resultado === 'ok' ? (
            <View style={styles.fim}>
              <Text style={styles.fimIcon}>✓</Text>
              <Text style={styles.fimTitulo}>Recebemos, obrigado.</Text>
              <Text style={styles.fimTexto}>
                Vamos conferir. Enquanto isso, <Text style={styles.bold}>confirme na bula
                impressa</Text> e com seu médico ou farmacêutico.
              </Text>
              <TouchableOpacity style={styles.btnOk} onPress={fechar} activeOpacity={0.8}>
                <Text style={styles.btnOkText}>Fechar</Text>
              </TouchableOpacity>
            </View>
          ) : resultado === 'falhou' ? (
            <View style={styles.fim}>
              <Text style={styles.fimIcon}>⚠️</Text>
              <Text style={styles.fimTitulo}>Não conseguimos enviar.</Text>
              <Text style={styles.fimTexto}>
                Sem internet, o relato não sai. Tente de novo quando estiver conectado.
              </Text>
              <TouchableOpacity style={styles.btnOk} onPress={() => setResultado(null)} activeOpacity={0.8}>
                <Text style={styles.btnOkText}>Tentar de novo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btnVoltar} onPress={fechar} activeOpacity={0.7}>
                <Text style={styles.btnVoltarText}>Fechar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.titulo}>Informar erro</Text>
              <Text style={styles.alvo} numberOfLines={2}>{titulo}</Text>

              <Text style={styles.secao}>O que está errado?</Text>
              {MOTIVOS[tipo].map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.opcao, motivo === m && styles.opcaoAtiva]}
                  onPress={() => setMotivo(m)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: motivo === m }}
                >
                  <View style={[styles.radio, motivo === m && styles.radioAtivo]}>
                    {motivo === m && <View style={styles.radioDot} />}
                  </View>
                  <Text style={styles.opcaoTexto}>{m}</Text>
                </TouchableOpacity>
              ))}

              <TextInput
                style={styles.input}
                placeholder="Quer detalhar? (opcional)"
                placeholderTextColor="#9CA3AF"
                value={detalhe}
                onChangeText={setDetalhe}
                multiline
                maxLength={400}
              />

              <View style={styles.acoes}>
                <TouchableOpacity style={styles.btnVoltar} onPress={fechar} activeOpacity={0.7}>
                  <Text style={styles.btnVoltarText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnEnviar, (!motivo || enviando) && styles.btnDesativado]}
                  onPress={enviar}
                  disabled={!motivo || enviando}
                  activeOpacity={0.8}
                >
                  {enviando
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={[styles.btnEnviarText, !motivo && styles.btnTextoDesativado]}>Enviar</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#F2F4F8',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingTop: 16,
  },

  titulo: { fontSize: 18, fontWeight: '700', color: '#1C3F7A' },
  alvo: { fontSize: 12.5, color: '#6B7280', marginTop: 3, marginBottom: 6 },

  secao: {
    fontSize: 11.5, fontWeight: '700', color: '#6B7280',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginTop: 10, marginBottom: 6,
  },

  opcao: {
    backgroundColor: '#fff',
    borderRadius: 12, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    paddingVertical: 11, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 6,
  },
  opcaoAtiva: { borderColor: '#1C3F7A', backgroundColor: '#F7F9FF' },
  opcaoTexto: { flex: 1, fontSize: 13.5, color: '#1A1F2E' },

  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#C0C5D0',
    alignItems: 'center', justifyContent: 'center',
  },
  radioAtivo: { borderColor: '#1C3F7A' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1C3F7A' },

  input: {
    backgroundColor: '#fff',
    borderRadius: 12, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    padding: 12, marginTop: 6,
    fontSize: 13.5, color: '#1A1F2E',
    minHeight: 64, textAlignVertical: 'top',
  },

  acoes: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btnVoltar: {
    flex: 1, backgroundColor: '#fff',
    borderRadius: 12, paddingVertical: 13, alignItems: 'center',
    borderWidth: 0.5, borderColor: '#D0D5E8',
  },
  btnVoltarText: { color: '#6B7280', fontSize: 14.5, fontWeight: '600' },
  btnEnviar: {
    flex: 1, backgroundColor: '#E07B4F',
    borderRadius: 12, paddingVertical: 13, alignItems: 'center',
  },
  btnDesativado: { backgroundColor: '#E5E7EB' },
  btnEnviarText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  btnTextoDesativado: { color: '#9CA3AF' },

  fim: { alignItems: 'center', paddingVertical: 10, gap: 6 },
  fimIcon: { fontSize: 34 },
  fimTitulo: { fontSize: 17, fontWeight: '700', color: '#1C3F7A' },
  fimTexto: { fontSize: 13, color: '#4B5563', textAlign: 'center', lineHeight: 19, paddingHorizontal: 8 },
  bold: { fontWeight: '700' },
  btnOk: {
    alignSelf: 'stretch', backgroundColor: '#E07B4F',
    borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 10,
  },
  btnOkText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
