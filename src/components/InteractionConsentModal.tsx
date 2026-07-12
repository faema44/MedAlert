import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity,
  NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Aceite válido por sessão. Pedir a cada toque geraria habituação — o usuário passaria a
// tocar em "aceito" sem ler, que é exatamente o que este aviso existe para evitar.
// Reinicia quando o app é fechado.
let sessionAccepted = false;
export function hasAcceptedInteractionTerms() { return sessionAccepted; }
export function resetInteractionConsent() { sessionAccepted = false; }

type Props = {
  visible: boolean;
  onAccept: () => void;
  onCancel: () => void;
};

const ITEMS: { icon: string; title: string; body: string }[] = [
  {
    icon: '🛑',
    title: 'Não altere nem interrompa seu tratamento',
    body: 'Não pare, não troque e não mude a dose de nenhum medicamento por causa do que você ler aqui. Interromper um remédio de repente pode ser MAIS PERIGOSO que a própria interação — é o caso de anticoagulantes, anticonvulsivantes, corticoides e remédios para o coração.',
  },
  {
    icon: '🧑‍⚕️',
    title: 'Só o médico ou farmacêutico pode decidir',
    body: 'Leve esta informação a eles. O app não conhece a sua dose, sua função dos rins e do fígado, sua idade, se você está grávida, nem as suas outras doenças — e é justamente isso que define se a interação importa no seu caso. Só o profissional tem o contexto completo.',
  },
  {
    icon: '🤖',
    title: 'Conteúdo gerado e traduzido por IA',
    body: 'As interações foram extraídas das bulas do FDA (a agência reguladora dos Estados Unidos, equivalente à nossa Anvisa) e traduzidas por inteligência artificial. Apesar dos nossos melhores esforços, podem conter erros de conceito, de medicamento e de tradução.',
  },
  {
    icon: '📄',
    title: 'Consulte sempre a bula — esta lista não é completa',
    body: 'Existem outras interações além das listadas aqui. Por isso, NÃO APARECER ALERTA NÃO SIGNIFICA QUE A COMBINAÇÃO É SEGURA: a ausência de aviso nunca deve ser lida como permissão. Leia a bula de cada medicamento que você usa e, na dúvida, pergunte ao profissional.',
  },
  {
    icon: '🚑',
    title: 'Em caso de sintoma grave, procure emergência',
    body: 'Se sentir falta de ar, dor no peito, sangramento, batimentos irregulares, confusão ou desmaio, ligue 192 ou vá ao pronto-socorro. Não use o app para decidir o que fazer numa emergência.',
  },
];

export default function InteractionConsentModal({ visible, onAccept, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  // O aceite só libera depois de rolar até o fim. Sem isso, dá para tocar em
  // "li e aceito" sem nunca ver os últimos avisos — e o consentimento vira ficção.
  const [reachedEnd, setReachedEnd] = useState(false);

  // Se o conteúdo couber na tela sem rolagem, não há o que rolar: libera.
  function onContentSizeChange(_w: number, h: number) {
    if (viewportH.current > 0 && h <= viewportH.current + 4) setReachedEnd(true);
  }
  const viewportH = useRef(0);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 24) setReachedEnd(true);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Antes de ver as interações</Text>
          <Text style={styles.headerSub}>Leia com atenção. É importante.</Text>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          onScroll={onScroll}
          scrollEventThrottle={64}
          onContentSizeChange={onContentSizeChange}
          onLayout={e => {
            viewportH.current = e.nativeEvent.layout.height;
          }}
        >
          {ITEMS.map(item => (
            <View key={item.title} style={styles.card}>
              <Text style={styles.cardIcon}>{item.icon}</Text>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardText}>{item.body}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {!reachedEnd && (
            <Text style={styles.scrollHint}>Role até o final para liberar o botão ↓</Text>
          )}
          <TouchableOpacity style={styles.btnBack} onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.btnBackText}>Voltar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btnOk, !reachedEnd && styles.btnOkDisabled]}
            onPress={onAccept}
            activeOpacity={0.8}
            disabled={!reachedEnd}
          >
            <Text style={[styles.btnOkText, !reachedEnd && styles.btnOkTextDisabled]}>
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
  scrollContent: { padding: 14, gap: 10 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    padding: 14,
    flexDirection: 'row', gap: 12,
  },
  cardIcon: { fontSize: 22, lineHeight: 28 },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: '#1A1F2E', marginBottom: 5, lineHeight: 20 },
  cardText: { fontSize: 13.5, color: '#4B5563', lineHeight: 20 },

  footer: {
    backgroundColor: '#fff',
    borderTopWidth: 0.5, borderTopColor: '#E8EAF0',
    paddingHorizontal: 14, paddingTop: 12,
    gap: 8,
  },
  scrollHint: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', marginBottom: 2 },
  btnOk: {
    backgroundColor: '#E07B4F',
    borderRadius: 12, paddingVertical: 15,
    alignItems: 'center',
  },
  btnOkDisabled: { backgroundColor: '#E5E7EB' },
  btnOkText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnOkTextDisabled: { color: '#9CA3AF' },
  btnBack: {
    backgroundColor: '#F2F4F8',
    borderRadius: 12, paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 0.5, borderColor: '#D0D5E8',
  },
  btnBackText: { color: '#6B7280', fontSize: 14.5, fontWeight: '600' },
});

// Marca o aceite. Exportado à parte para a tela decidir quando gravar.
export function acceptInteractionTerms() { sessionAccepted = true; }
