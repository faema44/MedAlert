import React from 'react';
import { View, Text, Image, Modal, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { temFoto } from '../services/fotoMedicamento';

// ---------------------------------------------------------------------------
// Miniatura da foto do medicamento, que amplia ao toque.
//
// A miniatura (22–44px) serve para DISTINGUIR um remédio do outro na lista. Não serve para
// CONFERIR — a marcação gravada no comprimido, a cor exata, o formato do sulco. Quem está com
// a cartela na mão e quer ter certeza precisa ver grande.
//
// O modal de ampliar mora na RAIZ da tela, nunca dentro de outro modal: o iOS mostra um
// Modal por vez, e um dentro do outro simplesmente não abre (ver project_ios_modal_gotcha).
// Por isso o componente é dividido em dois — a miniatura só avisa quem foi tocada, e a tela
// decide onde pendurar o modal.
// ---------------------------------------------------------------------------

export function FotoMini({
  uri, size, radius = 5, fallback, onAmpliar, style,
}: {
  uri?: string | null;
  size: number;
  radius?: number;
  fallback: React.ReactNode;   // o emoji de sempre, quando não há foto
  onAmpliar?: (uri: string) => void;
  style?: object;
}) {
  if (!temFoto(uri)) return <>{fallback}</>;
  const img = (
    <Image source={{ uri: uri as string }} style={[{ width: size, height: size, borderRadius: radius, backgroundColor: '#eee' }, style]} />
  );
  if (!onAmpliar) return img;
  return (
    // hitSlop porque a miniatura é pequena e o público tem mão trêmula: a área de toque
    // precisa ser maior que o desenho.
    <TouchableOpacity
      onPress={() => onAmpliar(uri as string)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="imagebutton"
      accessibilityLabel="Ver foto do medicamento ampliada"
    >
      {img}
    </TouchableOpacity>
  );
}

/** O modal de ampliar. Pendure na RAIZ da tela — nunca dentro de outro Modal. */
export function ModalFoto({ uri, nome, onFechar }: { uri: string | null; nome?: string; onFechar: () => void }) {
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onFechar}>
      {/* Fecha tocando em qualquer lugar: é o gesto que a pessoa tenta primeiro, e um "X"
          pequeno num canto seria justamente o alvo mais difícil para quem tem a mão trêmula. */}
      <Pressable style={styles.fundo} onPress={onFechar}>
        {!!uri && (
          <View style={styles.caixa}>
            {!!nome && <Text style={styles.nome} numberOfLines={2}>{nome}</Text>}
            <Image source={{ uri }} style={styles.grande} resizeMode="contain" />
            <Text style={styles.dica}>Toque para fechar</Text>
          </View>
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  caixa: { alignItems: 'center', gap: 12 },
  nome: { color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  // Fundo branco de propósito: comprimido é quase sempre claro, e sobre preto ele some.
  grande: { width: 300, height: 300, borderRadius: 12, backgroundColor: '#fff' },
  dica: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
});
