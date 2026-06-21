import React, { useState } from 'react';
import {
  Modal, View, TouchableOpacity, Text, Alert, Linking, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ANVISA_BULARIO = 'https://consultas.anvisa.gov.br/#/bulario/';

// Lazy-load so react-native-blob-util native module is not accessed at app startup
let _Pdf: any = null;
function getPdf() {
  if (!_Pdf) _Pdf = require('react-native-pdf').default;
  return _Pdf;
}

function BulaModal({ url, onClose }: { url: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const Pdf = getPdf();

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Bula</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕ Fechar</Text>
        </TouchableOpacity>
      </View>
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#1C3F7A" />
        </View>
      )}
      <Pdf
        source={{ uri: url, cache: true }}
        style={styles.pdf}
        onLoadComplete={() => setLoading(false)}
        onError={() => {
          onClose();
          Linking.openURL(url).catch(() => {});
        }}
      />
    </Modal>
  );
}

export function useBulaViewer() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  function openBula(url: string) {
    Alert.alert(
      'Aviso sobre a bula',
      'Bula apenas para referência rápida, sempre consulte a bula conforme o fabricante e a dosagem desejada.\n\nPara a bula exata às suas necessidades consulte o bulário da Anvisa.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Bulário Anvisa', onPress: () => Linking.openURL(ANVISA_BULARIO) },
        { text: 'Ver bula', onPress: () => setPdfUrl(url) },
      ],
    );
  }

  const modal = pdfUrl
    ? <BulaModal url={pdfUrl} onClose={() => setPdfUrl(null)} />
    : null;

  return { openBula, modal };
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#1C3F7A',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  closeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  closeText: {
    color: '#fff',
    fontSize: 15,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    top: 60,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F4F8',
  },
  pdf: {
    flex: 1,
    backgroundColor: '#F2F4F8',
  },
});
