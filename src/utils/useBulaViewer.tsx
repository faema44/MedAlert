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

// Bula real não existente no acervo (404) cai numa pesquisa no navegador em vez
// de tentar abrir/reabrir o mesmo link quebrado no viewer embutido.
function searchFallbackUrl(medName: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${medName} bula pdf`)}`;
}

// Checagem rápida antes de abrir o viewer: evita montar o <Pdf> com uma URL que
// vai falhar o download (bula não hospedada — boa parte dos medicamentos não tem
// PDF real no acervo). Só reporta "não existe" com uma resposta HTTP de erro
// confirmada — timeout/erro de rede na checagem não deve ser tratado como 404,
// senão qualquer engasgo de rede manda uma bula que existe pro fallback errado.
// GET com Range (só o primeiro byte) em vez de HEAD: HEAD não é respeitado de
// forma confiável pelo cliente HTTP do RN nesse servidor.
async function urlExists(url: string): Promise<boolean> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-1' }, signal: controller.signal });
    return res.ok;
  } catch {
    return true;
  } finally {
    clearTimeout(id);
  }
}

function BulaModal({ url, fallbackUrl, onClose }: { url: string; fallbackUrl: string; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const Pdf = getPdf();
  // Nome de cache único por abertura: evita duas instâncias (ex: abas
  // diferentes mantidas montadas em segundo plano) baixarem a mesma bula
  // para o mesmo arquivo .tmp e colidirem (ENOENT visto no Sentry).
  const [cacheFileName] = useState(() => `bula_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);

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
        source={{ uri: url, cache: true, cacheFileName }}
        style={styles.pdf}
        // Default é true; a lib usa isso para pedir ao react-native-blob-util um
        // OkHttpClient "unsafe" (confia em qualquer certificado), mas o blob-util
        // 0.24.9 tem um bug onde esse caminho lança IllegalStateException ("Use of
        // own trust manager but none defined") — quebrava o download de TODA bula,
        // existente ou não. Nosso domínio tem certificado válido normal, não precisa disso.
        trustAllCerts={false}
        onLoadComplete={() => setLoading(false)}
        onError={() => {
          onClose();
          Linking.openURL(fallbackUrl).catch(() => {});
        }}
      />
    </Modal>
  );
}

export function useBulaViewer() {
  const [pdfState, setPdfState] = useState<{ url: string; fallbackUrl: string } | null>(null);

  function openBula(url: string, medName: string) {
    Alert.alert(
      'Aviso sobre a bula',
      'Bula apenas para referência rápida, sempre consulte a bula conforme o fabricante e a dosagem desejada.\n\nPara a bula exata às suas necessidades consulte o bulário da Anvisa.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Bulário Anvisa', onPress: () => Linking.openURL(ANVISA_BULARIO) },
        {
          text: 'Ver bula',
          onPress: async () => {
            const fallbackUrl = searchFallbackUrl(medName);
            const exists = await urlExists(url);
            if (exists) {
              setPdfState({ url, fallbackUrl });
            } else {
              Linking.openURL(fallbackUrl).catch(() => {});
            }
          },
        },
      ],
    );
  }

  const modal = pdfState
    ? <BulaModal url={pdfState.url} fallbackUrl={pdfState.fallbackUrl} onClose={() => setPdfState(null)} />
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
    ...StyleSheet.absoluteFill,
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
