import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getKV, setKV } from '../database/db';

// Aceite mostrado uma vez por SESSÃO (não a cada toque: pedir toda hora gera habituação, e
// aviso marcado no automático não protege ninguém).
let sessionAccepted = false;
export function hasAcceptedInteractionTerms() { return sessionAccepted; }
export function acceptInteractionTerms() { sessionAccepted = true; }
export function resetInteractionConsent() { sessionAccepted = false; }

// ...mas o aceite ANTIGO fica gravado no banco. Antes vivia só em memória, então o usuário
// tomava as 6 confirmações de novo a cada reinício do app — o caminho mais curto para ele
// aprender a marcar tudo sem ler. Agora: na primeira vez ele marca; nas seguintes o aviso
// ainda APARECE (ele precisa ver), só que já marcado, e sai com um toque.
const CONSENT_KEY = 'interaction_consent_v2';

// Avisos que o usuário LÊ. Não viram caixa: seis caixas obrigatórias não são seis decisões,
// são seis toques mecânicos.
const AVISOS: { icon: string; title: string; sub: string }[] = [
  {
    icon: '📄',
    title: 'O app é só um alerta. A bula é a fonte oficial.',
    sub: 'Confirme sempre na bula impressa do seu medicamento.',
  },
  {
    icon: '🧑‍⚕️',
    title: 'O app não conhece o seu caso.',
    sub: 'Ele não sabe sua dose, seus exames, nem suas outras doenças.',
  },
  {
    icon: '🚑',
    title: 'Sintoma grave? Ligue 192.',
    sub: 'Não use o app para decidir numa emergência.',
  },
];

// As duas que o usuário CONFIRMA. São as que de fato protegem: a primeira impede o dano mais
// provável (parar um remédio necessário por causa de um alerta), a segunda diz a verdade
// sobre o que este app é e sobre o que o silêncio dele NÃO significa.
const CONFIRMACOES: { icon: string; text: string }[] = [
  {
    icon: '🛑',
    text: 'Não vou parar nem mudar nenhum medicamento por causa deste alerta. Quem decide é o médico ou o farmacêutico.',
  },
  {
    icon: '🤖',
    text: 'Entendi que os alertas são gerados por IA e podem conter erros — e que NÃO aparecer alerta não quer dizer que a combinação é segura.',
  },
];

type Props = {
  visible: boolean;
  onAccept: () => void;
  onCancel: () => void;
};

export default function InteractionConsentModal({ visible, onAccept, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [checked, setChecked] = useState<boolean[]>(() => CONFIRMACOES.map(() => false));
  const [jaAceitou, setJaAceitou] = useState(false);

  // Quem já aceitou antes reencontra as caixas MARCADAS — o aviso continua na frente dele,
  // mas o trabalho não se repete.
  useEffect(() => {
    if (!visible) return;
    let vivo = true;
    getKV(CONSENT_KEY)
      .then(v => {
        if (!vivo || v !== '1') return;
        setJaAceitou(true);
        setChecked(CONFIRMACOES.map(() => true));
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [visible]);

  const allChecked = checked.every(Boolean);

  function toggle(i: number) {
    setChecked(prev => prev.map((v, k) => (k === i ? !v : v)));
  }

  function handleCancel() {
    setChecked(CONFIRMACOES.map(() => jaAceitou));
    onCancel();
  }

  function handleAccept() {
    setKV(CONSENT_KEY, '1').catch(() => {});
    onAccept();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleCancel}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Antes de ver as interações</Text>
          <Text style={styles.headerSub}>
            {jaAceitou ? 'Confirme para continuar.' : 'Leia e confirme os dois itens no fim.'}
          </Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {AVISOS.map(a => (
            <View key={a.title} style={styles.aviso}>
              <Text style={styles.icon}>{a.icon}</Text>
              <View style={styles.texts}>
                <Text style={styles.title}>{a.title}</Text>
                <Text style={styles.sub}>{a.sub}</Text>
              </View>
            </View>
          ))}

          <Text style={styles.secao}>Confirme para continuar</Text>

          {CONFIRMACOES.map((c, i) => (
            <TouchableOpacity
              key={c.text}
              style={[styles.row, checked[i] && styles.rowChecked]}
              onPress={() => toggle(i)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: checked[i] }}
              accessibilityLabel={c.text}
            >
              <View style={[styles.box, checked[i] && styles.boxChecked]}>
                {checked[i] && <Text style={styles.check}>✓</Text>}
              </View>
              <Text style={styles.icon}>{c.icon}</Text>
              <Text style={styles.confirmText}>{c.text}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={styles.btnBack} onPress={handleCancel} activeOpacity={0.7}>
            <Text style={styles.btnBackText}>Voltar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnOk, !allChecked && styles.btnOkDisabled]}
            onPress={handleAccept}
            activeOpacity={0.8}
            disabled={!allChecked}
          >
            <Text style={[styles.btnOkText, !allChecked && styles.btnOkTextDisabled]}>
              Li e concordo
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },

  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 0.5, borderBottomColor: '#E8EAF0',
  },
  headerTitle: { fontSize: 19, fontWeight: '700', color: '#1C3F7A' },
  headerSub: { fontSize: 13, color: '#6B7280', marginTop: 3 },

  scroll: { flex: 1 },
  scrollContent: { padding: 14, gap: 8 },

  aviso: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    paddingVertical: 12, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },

  secao: {
    fontSize: 12, fontWeight: '700', color: '#6B7280',
    marginTop: 10, marginBottom: 2, marginLeft: 2,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  row: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    paddingVertical: 12, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  rowChecked: { borderColor: '#1C3F7A', backgroundColor: '#F7F9FF' },

  box: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#C0C5D0',
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  boxChecked: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  check: { color: '#fff', fontSize: 14, fontWeight: '900', lineHeight: 18 },

  icon: { fontSize: 20, flexShrink: 0 },
  texts: { flex: 1 },
  title: { fontSize: 13.5, fontWeight: '700', color: '#1A1F2E', lineHeight: 18 },
  sub: { fontSize: 12.5, color: '#6B7280', lineHeight: 17, marginTop: 2 },
  confirmText: { flex: 1, fontSize: 13, color: '#1A1F2E', lineHeight: 18, fontWeight: '600' },

  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 0.5, borderTopColor: '#E8EAF0',
    paddingHorizontal: 14, paddingTop: 12,
    gap: 8,
  },
  btnBack: {
    backgroundColor: '#F2F4F8',
    borderRadius: 12, paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 0.5, borderColor: '#D0D5E8',
  },
  btnBackText: { color: '#6B7280', fontSize: 14.5, fontWeight: '600' },
  btnOk: {
    backgroundColor: '#E07B4F',
    borderRadius: 12, paddingVertical: 15,
    alignItems: 'center',
  },
  btnOkDisabled: { backgroundColor: '#E5E7EB' },
  btnOkText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnOkTextDisabled: { color: '#9CA3AF' },
});
