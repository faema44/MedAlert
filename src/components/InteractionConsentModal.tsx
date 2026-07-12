import React, { useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Aceite válido por sessão. Pedir a cada toque geraria habituação — o usuário passaria a
// marcar tudo sem ler, que é exatamente o que este aviso existe para evitar.
let sessionAccepted = false;
export function hasAcceptedInteractionTerms() { return sessionAccepted; }
export function acceptInteractionTerms() { sessionAccepted = true; }
export function resetInteractionConsent() { sessionAccepted = false; }

type Props = {
  visible: boolean;
  onAccept: () => void;
  onCancel: () => void;
};

// Uma linha por aviso. Texto longo não é lido — e aviso não lido não protege ninguém.
const ITEMS: { icon: string; title: string; sub: string }[] = [
  {
    icon: '🛑',
    title: 'Não pare nem mude nenhum remédio por causa deste alerta.',
    sub: 'Parar de repente pode ser mais perigoso que a própria interação.',
  },
  {
    icon: '🧑‍⚕️',
    title: 'Só o médico ou farmacêutico decide.',
    sub: 'O app não sabe sua dose, seus exames, nem suas outras doenças.',
  },
  {
    icon: '📄',
    title: 'O app é só um alerta. Sempre confirme com a bula.',
    sub: 'Ela é a fonte oficial do seu medicamento.',
  },
  {
    icon: '🔍',
    title: 'Não aparecer alerta não quer dizer que é seguro.',
    sub: 'A lista não é completa. Existem outras interações.',
  },
  {
    icon: '🤖',
    title: 'Feito por IA a partir das bulas do FDA.',
    sub: 'Pode conter erros de medicamento e de tradução.',
  },
  {
    icon: '🚑',
    title: 'Sintoma grave? Ligue 192.',
    sub: 'Não use o app para decidir numa emergência.',
  },
];

export default function InteractionConsentModal({ visible, onAccept, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [checked, setChecked] = useState<boolean[]>(() => ITEMS.map(() => false));

  const total = ITEMS.length;
  const done = checked.filter(Boolean).length;
  const allChecked = done === total;

  function toggle(i: number) {
    setChecked(prev => prev.map((v, k) => (k === i ? !v : v)));
  }

  function handleCancel() {
    setChecked(ITEMS.map(() => false));
    onCancel();
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleCancel}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Antes de ver as interações</Text>
          <Text style={styles.headerSub}>Marque cada item para continuar.</Text>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {ITEMS.map((item, i) => (
            <TouchableOpacity
              key={item.title}
              style={[styles.row, checked[i] && styles.rowChecked]}
              onPress={() => toggle(i)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: checked[i] }}
              accessibilityLabel={item.title}
            >
              <View style={[styles.box, checked[i] && styles.boxChecked]}>
                {checked[i] && <Text style={styles.check}>✓</Text>}
              </View>
              <Text style={styles.icon}>{item.icon}</Text>
              <View style={styles.texts}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.sub}>{item.sub}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {!allChecked && (
            <Text style={styles.counter}>{done} de {total} marcados</Text>
          )}
          <TouchableOpacity style={styles.btnBack} onPress={handleCancel} activeOpacity={0.7}>
            <Text style={styles.btnBackText}>Voltar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnOk, !allChecked && styles.btnOkDisabled]}
            onPress={onAccept}
            activeOpacity={0.8}
            disabled={!allChecked}
          >
            <Text style={[styles.btnOkText, !allChecked && styles.btnOkTextDisabled]}>
              Ok, li e aceito os itens acima
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

  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 0.5, borderTopColor: '#E8EAF0',
    paddingHorizontal: 14, paddingTop: 12,
    gap: 8,
  },
  counter: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginBottom: 2 },
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
