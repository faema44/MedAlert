import React, { useState, useEffect } from 'react';
import {
  Modal, View, TouchableOpacity, Text, Linking, StyleSheet, ActivityIndicator, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getKV, setKV } from '../database/db';
import ReportarErroModal from '../components/ReportarErroModal';

const ANVISA_BULARIO = 'https://consultas.anvisa.gov.br/#/bulario/';

// Aceite gravado no banco: na primeira vez o usuário marca; nas seguintes o aviso ainda
// APARECE — ele precisa ver o que está prestes a ler — mas já vem marcado e sai num toque.
// Antes isto era um Alert.alert com texto corrido e nenhuma confirmação.
const ACEITE_KEY = 'bula_aviso_v1';

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

const slugDaUrl = (url: string) => url.split('/').pop()?.replace(/\.pdf$/i, '') ?? url;

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

// ─── Aviso antes de abrir ────────────────────────────────────────────────────
//
// O texto antigo dizia "bula apenas para referência rápida, sempre consulte a bula conforme o
// fabricante". Vago, e escondia o que de fato importa: a bula que hospedamos é de UM fabricante
// e UMA apresentação, escolhidos por nós. A do "Cloreto de Potássio", por exemplo, é a SOLUÇÃO
// INJETÁVEL da Farmarin — não o comprimido que o usuário provavelmente toma. Ele precisa saber
// disso ANTES de ler, e precisa saber como conferir: pelo CABEÇALHO da bula.

function AvisoBula({
  medName, jaAceitou, onCancelar, onAbrir,
}: {
  medName: string; jaAceitou: boolean; onCancelar: () => void; onAbrir: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [aceito, setAceito] = useState(jaAceitou);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancelar}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <Text style={styles.avisoTitulo}>Antes de abrir a bula</Text>
          <Text style={styles.avisoSub} numberOfLines={1}>{medName}</Text>

          <ScrollView style={styles.avisoScroll} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
            <View style={styles.item}>
              <Text style={styles.itemIcon}>🏭</Text>
              <View style={styles.itemCol}>
                <Text style={styles.itemTitulo}>É a bula de UM fabricante.</Text>
                <Text style={styles.itemSub}>
                  A sua caixa pode ser de outra marca, outra dose ou outra forma (comprimido,
                  gotas, injetável) — e a bula muda.
                </Text>
              </View>
            </View>

            <View style={styles.item}>
              <Text style={styles.itemIcon}>🔎</Text>
              <View style={styles.itemCol}>
                <Text style={styles.itemTitulo}>Confira o cabeçalho.</Text>
                <Text style={styles.itemSub}>
                  Nome comercial, fabricante e apresentação aparecem na primeira linha. Se não
                  bater com a sua caixa, esta bula não é a sua.
                </Text>
              </View>
            </View>

            <View style={styles.item}>
              <Text style={styles.itemIcon}>📄</Text>
              <View style={styles.itemCol}>
                <Text style={styles.itemTitulo}>A fonte oficial é a ANVISA.</Text>
                <Text style={styles.itemSub}>
                  Em caso de dúvida, consulte o bulário — ou a bula impressa que veio na caixa.
                </Text>
              </View>
            </View>
          </ScrollView>

          <TouchableOpacity
            style={[styles.check, aceito && styles.checkAtivo]}
            onPress={() => setAceito(v => !v)}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: aceito }}
          >
            <View style={[styles.box, aceito && styles.boxAtivo]}>
              {aceito && <Text style={styles.boxCheck}>✓</Text>}
            </View>
            <Text style={styles.checkTexto}>
              Entendi que esta bula pode ser de <Text style={styles.bold}>outro fabricante ou
              outra apresentação</Text>, e que devo conferir com a bula do meu medicamento.
            </Text>
          </TouchableOpacity>

          <View style={styles.acoes}>
            <TouchableOpacity style={styles.btnSec} onPress={onCancelar} activeOpacity={0.7}>
              <Text style={styles.btnSecText}>Voltar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btnSec}
              onPress={() => Linking.openURL(ANVISA_BULARIO).catch(() => {})}
              activeOpacity={0.7}
            >
              <Text style={styles.btnSecText}>Bulário ANVISA</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.btnPri, !aceito && styles.btnDesativado]}
            onPress={onAbrir}
            disabled={!aceito}
            activeOpacity={0.8}
          >
            <Text style={[styles.btnPriText, !aceito && styles.btnTextoDesativado]}>Ver bula</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function BulaModal({ url, fallbackUrl, medName, onClose }: {
  url: string; fallbackUrl: string; medName: string; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [reportar, setReportar] = useState(false);
  const Pdf = getPdf();
  // Nome de cache único por abertura: evita duas instâncias (ex: abas
  // diferentes mantidas montadas em segundo plano) baixarem a mesma bula
  // para o mesmo arquivo .tmp e colidirem (ENOENT visto no Sentry).
  const [cacheFileName] = useState(() => `bula_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle} numberOfLines={1}>{medName || 'Bula'}</Text>
        <View style={styles.headerBtns}>
          {/* O usuário é quem enxerga o que a auditoria automática não vê: "esta bula não é a
              do meu remédio". Sem um caminho para ele contar, o erro fica no ar. */}
          <TouchableOpacity onPress={() => setReportar(true)} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>⚑ Erro</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>✕ Fechar</Text>
          </TouchableOpacity>
        </View>
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
      <ReportarErroModal
        visible={reportar}
        tipo="bula"
        alvo={slugDaUrl(url)}
        titulo={medName}
        onClose={() => setReportar(false)}
      />
    </Modal>
  );
}

type Pendente = { url: string; medName: string };

export function useBulaViewer() {
  const [pendente, setPendente] = useState<Pendente | null>(null);
  const [pdfState, setPdfState] = useState<{ url: string; fallbackUrl: string; medName: string } | null>(null);
  const [jaAceitou, setJaAceitou] = useState(false);

  useEffect(() => {
    getKV(ACEITE_KEY).then(v => setJaAceitou(v === '1')).catch(() => {});
  }, []);

  function openBula(url: string, medName: string) {
    setPendente({ url, medName });
  }

  async function abrir() {
    if (!pendente) return;
    const { url, medName } = pendente;
    setPendente(null);
    setKV(ACEITE_KEY, '1').catch(() => {});
    setJaAceitou(true);

    const fallbackUrl = searchFallbackUrl(medName);
    if (await urlExists(url)) setPdfState({ url, fallbackUrl, medName });
    else Linking.openURL(fallbackUrl).catch(() => {});
  }

  const modal = (
    <>
      {pendente && (
        <AvisoBula
          medName={pendente.medName}
          jaAceitou={jaAceitou}
          onCancelar={() => setPendente(null)}
          onAbrir={abrir}
        />
      )}
      {pdfState && (
        <BulaModal
          url={pdfState.url}
          fallbackUrl={pdfState.fallbackUrl}
          medName={pdfState.medName}
          onClose={() => setPdfState(null)}
        />
      )}
    </>
  );

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
    gap: 8,
  },
  headerTitle: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '600' },
  headerBtns: { flexDirection: 'row', gap: 4 },
  headerBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  headerBtnText: { color: '#fff', fontSize: 14 },

  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    top: 60,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F2F4F8',
  },
  pdf: { flex: 1, backgroundColor: '#F2F4F8' },

  // aviso
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#F2F4F8',
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: 16, paddingTop: 16,
    maxHeight: '88%',
  },
  avisoTitulo: { fontSize: 18, fontWeight: '700', color: '#1C3F7A' },
  avisoSub: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  avisoScroll: { flexGrow: 0 },

  item: {
    backgroundColor: '#fff',
    borderRadius: 12, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    paddingVertical: 11, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
  },
  itemIcon: { fontSize: 19 },
  itemCol: { flex: 1 },
  itemTitulo: { fontSize: 13.5, fontWeight: '700', color: '#1A1F2E', lineHeight: 18 },
  itemSub: { fontSize: 12.5, color: '#6B7280', lineHeight: 17, marginTop: 2 },

  check: {
    backgroundColor: '#fff',
    borderRadius: 12, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    paddingVertical: 12, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 4,
  },
  checkAtivo: { borderColor: '#1C3F7A', backgroundColor: '#F7F9FF' },
  checkTexto: { flex: 1, fontSize: 12.5, color: '#1A1F2E', lineHeight: 17 },
  bold: { fontWeight: '700' },
  box: {
    width: 24, height: 24, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#C0C5D0',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  boxAtivo: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  boxCheck: { color: '#fff', fontSize: 14, fontWeight: '900', lineHeight: 18 },

  acoes: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btnSec: {
    flex: 1, backgroundColor: '#fff',
    borderRadius: 12, paddingVertical: 13, alignItems: 'center',
    borderWidth: 0.5, borderColor: '#D0D5E8',
  },
  btnSecText: { color: '#6B7280', fontSize: 14, fontWeight: '600' },
  btnPri: {
    backgroundColor: '#E07B4F',
    borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 8,
  },
  btnDesativado: { backgroundColor: '#E5E7EB' },
  btnPriText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnTextoDesativado: { color: '#9CA3AF' },
});
