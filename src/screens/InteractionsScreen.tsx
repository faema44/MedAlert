import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMedications } from '../database/db';
import {
  checkInteractions, getAllInteractions, isPhytotherapicInteraction,
  getAllMedsList, getAllPhytoList, DbEntry, getBulaUrl, getPhytoBulaUrl,
} from '../utils/drugSearch';
import { useBulaViewer } from '../utils/useBulaViewer';
import { DrugInteraction, Medication } from '../types';
import MedDisclaimer from '../components/MedDisclaimer';
import InteractionConsentModal, { hasAcceptedInteractionTerms, acceptInteractionTerms } from '../components/InteractionConsentModal';
import ReportarErroModal from '../components/ReportarErroModal';

const RISK_CONFIG = {
  critical: { label: 'Crítico',  color: '#CC3322', bg: '#FEE9E9' },
  high:     { label: 'Alto',     color: '#D07020', bg: '#FFF3E0' },
  moderate: { label: 'Moderado', color: '#886600', bg: '#FFF8E0' },
};

type Tab = 'interactions' | 'meds' | 'phyto';
type RiskFilter = 'all' | 'critical' | 'high' | 'moderate';
type TypeFilter = 'all' | 'meds' | 'phyto';

function InteractionCard({ item, expanded, onToggle }: {
  item: DrugInteraction; expanded: boolean; onToggle: () => void;
}) {
  const risk = RISK_CONFIG[item.risk_level];
  const isPhyto = isPhytotherapicInteraction(item);
  const accentColor = isPhyto ? '#1a6b3a' : risk.color;
  const typeLabel = isPhyto ? '🌿 Fito.' : '💊';
  const temFonte = !!item.source && item.source !== 'desconhecida';
  const [reportar, setReportar] = useState(false);

  return (
    <TouchableOpacity
      style={[styles.intCard, { borderLeftColor: accentColor }]}
      onPress={onToggle}
      activeOpacity={0.8}
    >
      <View style={styles.intCardHeader}>
        <View style={styles.intCardHeaderLeft}>
          <View style={[styles.riskBadge, { backgroundColor: isPhyto ? '#EAF4EC' : risk.bg }]}>
            <Text style={[styles.riskBadgeText, { color: isPhyto ? '#1a6b3a' : risk.color }]}>
              {risk.label}
            </Text>
          </View>
        </View>
        <View style={styles.intCardHeaderRight}>
          <Text style={styles.typeTag}>{typeLabel}</Text>
          <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
        </View>
      </View>

      <Text style={styles.drugPair}>
        <Text style={styles.drugName}>{item.drug1}</Text>
        <Text style={[styles.drugPlus, { color: accentColor }]}>{' + '}</Text>
        <Text style={styles.drugName}>{item.drug2}</Text>
      </Text>

      <Text style={styles.riskDesc}>{item.risk_description}</Text>

      {expanded && (
        <View style={[styles.mechanismBox, { backgroundColor: isPhyto ? '#EAF4EC' : risk.bg }]}>
          <Text style={styles.mechanismTitle}>Como ocorre:</Text>
          <Text style={styles.mechanismText}>{item.mechanism}</Text>

          {/* De onde veio. 31% da base não tem procedência (847 entradas, e elas carregam 281
              dos 429 alertas críticos) — o app precisa DIZER isso em vez de apresentar tudo
              com a mesma autoridade. "Sem fonte" não é o mesmo que "errado": a interação
              Metformina × Contraste Iodado está entre elas e é clássica. É que não temos o
              que citar — então o usuário é quem confere. */}
          <Text style={temFonte ? styles.sourceOk : styles.sourceNone}>
            {temFonte
              ? `Fonte: ${item.source}`
              : 'Sem fonte verificada — não conseguimos rastrear este texto até uma bula ou publicação.'}
          </Text>

          {/* O aviso fica NO CARTÃO, junto da afirmação. O MedDisclaimer do topo da tela é
              recolhível e some da vista justamente na hora em que o usuário está lendo o
              alerta e decidindo o que fazer. */}
          <Text style={styles.aiNotice}>
            🤖 Interação apontada por <Text style={styles.bold}>IA</Text> e sujeita a erro.
            Confira na <Text style={styles.bold}>bula impressa</Text> do seu medicamento e
            fale com seu <Text style={styles.bold}>médico ou farmacêutico</Text>.
          </Text>

          {/* O usuário é a última linha de defesa, e a mais valiosa: as auditorias automáticas
              pegam alarme falso por token de sal e bula de composto no slug do puro, mas não
              pegam "esta interação está exagerada" nem "falta a que eu conheço". Sem um caminho
              para ele contar, o erro fica no ar. */}
          <TouchableOpacity
            style={styles.reportBtn}
            onPress={() => setReportar(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.reportBtnText}>⚑ Informar erro nesta interação</Text>
          </TouchableOpacity>
        </View>
      )}

      <ReportarErroModal
        visible={reportar}
        tipo="interacao"
        alvo={`${item.id} · ${item.drug1} × ${item.drug2}`}
        titulo={`${item.drug1} + ${item.drug2}`}
        onClose={() => setReportar(false)}
      />
    </TouchableOpacity>
  );
}

function MedCard({ item, isPhyto, onOpenBula }: { item: DbEntry; isPhyto?: boolean; onOpenBula: (url: string, medName: string) => void }) {
  const accent = isPhyto ? '#1a6b3a' : '#1C3F7A';
  const bgAccent = isPhyto ? '#EAF4EC' : '#EEF3FF';
  const popularNames = item.brands.slice(0, 3).join(' · ');
  const firstBrand = item.brands[0];

  function handleOpenBula() {
    const url = isPhyto ? getPhytoBulaUrl(item.genericName, firstBrand) : getBulaUrl(item.genericName, firstBrand);
    onOpenBula(url, item.genericName);
  }

  return (
    <View style={[styles.medCard, { borderLeftColor: accent }]}>
      <View style={[styles.medIcon, { backgroundColor: bgAccent }]}>
        <Text style={styles.medIconText}>{isPhyto ? '🌿' : '💊'}</Text>
      </View>
      <View style={styles.medInfo}>
        <Text style={[styles.medGenericName, { color: accent }]}>{item.genericName}</Text>
        {popularNames ? <Text style={styles.medBrands} numberOfLines={1}>{popularNames}</Text> : null}
        <View style={[styles.catChip, { backgroundColor: bgAccent }]}>
          <Text style={[styles.catChipText, { color: accent }]}>{item.category}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.bulaBtn} onPress={handleOpenBula}>
        <Text style={styles.bulaBtnText}>📋</Text>
        <Text style={[styles.bulaBtnLabel, { color: accent }]}>Bula</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function InteractionsScreen() {
  const { openBula, modal: bulaModal } = useBulaViewer();
  const [tab, setTab] = useState<Tab>('interactions');
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [medSearch, setMedSearch] = useState('');
  const [phytoSearch, setPhytoSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  // Esta aba lista a base inteira de interações, então também passa pelo termo de ciência.
  const [consentDone, setConsentDone] = useState(hasAcceptedInteractionTerms);

  const intFiltered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return getAllInteractions().filter(i => {
      const matchSearch = !q || i.drug1.toLowerCase().includes(q) || i.drug2.toLowerCase().includes(q);
      const matchRisk = riskFilter === 'all' || i.risk_level === riskFilter;
      const isPhyto = isPhytotherapicInteraction(i);
      const matchType = typeFilter === 'all' || (typeFilter === 'phyto' ? isPhyto : !isPhyto);
      return matchSearch && matchRisk && matchType;
    });
  }, [search, riskFilter, typeFilter]);

  const medsList = useMemo(() => {
    const q = medSearch.toLowerCase().trim();
    const all = getAllMedsList();
    if (!q) return all;
    return all.filter(m =>
      m.genericName.toLowerCase().includes(q) || m.brands.some(b => b.toLowerCase().includes(q))
    );
  }, [medSearch]);

  const phytoList = useMemo(() => {
    const q = phytoSearch.toLowerCase().trim();
    const all = getAllPhytoList();
    if (!q) return all;
    return all.filter(m =>
      m.genericName.toLowerCase().includes(q) || m.brands.some(b => b.toLowerCase().includes(q))
    );
  }, [phytoSearch]);

  const activeFilterCount = (typeFilter !== 'all' ? 1 : 0) + (riskFilter !== 'all' ? 1 : 0);

  function toggle(id: string) { setExpanded(prev => (prev === id ? null : id)); }

  function switchTab(t: Tab) {
    setTab(t);
    setSearch('');
    setMedSearch('');
    setPhytoSearch('');
    setRiskFilter('all');
    setTypeFilter('all');
    setExpanded(null);
    setShowFilters(false);
  }

  const tabs: { key: Tab; icon: string; label: string; activeColor: string }[] = [
    { key: 'interactions', icon: '⚡', label: 'Interações',    activeColor: '#CC3322' },
    { key: 'meds',         icon: '💊', label: 'Remédios',      activeColor: '#1C3F7A' },
    { key: 'phyto',        icon: '🌿', label: 'Fitoterápicos', activeColor: '#1a6b3a' },
  ];

  const riskFilters: { key: RiskFilter; label: string }[] = [
    { key: 'all',      label: 'Todos' },
    { key: 'critical', label: 'Crítico' },
    { key: 'high',     label: 'Alto' },
    { key: 'moderate', label: 'Moderado' },
  ];

  const typeFilters: { key: TypeFilter; label: string }[] = [
    { key: 'all',   label: 'Todas' },
    { key: 'meds',  label: '💊 Remédios' },
    { key: 'phyto', label: '🌿 Fito.' },
  ];

  return (
    <View style={styles.container}>

      {/* Segmented control */}
      <View style={styles.segWrap}>
        <View style={styles.segRow}>
          {tabs.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[styles.segBtn, tab === t.key && { backgroundColor: '#fff' }]}
              onPress={() => switchTab(t.key)}
              activeOpacity={0.7}
            >
              <Text style={styles.segIcon}>{t.icon}</Text>
              <Text style={[styles.segLabel, tab === t.key && { color: t.activeColor, fontWeight: '600' }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* A aba de interações lista a base inteira — passa pelo termo antes de exibir.
          "Voltar" leva para a aba de remédios em vez de deixar a tela vazia. */}
      <InteractionConsentModal
        visible={tab === 'interactions' && !consentDone}
        onCancel={() => switchTab('meds')}
        onAccept={() => { acceptInteractionTerms(); setConsentDone(true); }}
      />

      <MedDisclaimer />

      {/* Interactions tab */}
      {tab === 'interactions' && (
        <>
          <View style={styles.controlsWrap}>
            <View style={styles.searchFilterRow}>
              <View style={[styles.searchRow, { flex: 1 }]}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar interação..."
                  placeholderTextColor="#9CA3AF"
                  clearButtonMode="while-editing"
                />
              </View>
              <TouchableOpacity
                style={[styles.filterBtn, (showFilters || activeFilterCount > 0) && styles.filterBtnActive]}
                onPress={() => setShowFilters(prev => !prev)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterBtnText, (showFilters || activeFilterCount > 0) && styles.filterBtnTextActive]}>
                  Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''} {showFilters ? '▲' : '▼'}
                </Text>
              </TouchableOpacity>
            </View>
            {showFilters && (
              <>
                <Text style={styles.filterLabel}>Tipo</Text>
                <View style={styles.filterRow}>
                  {typeFilters.map(f => (
                    <TouchableOpacity
                      key={f.key}
                      style={[styles.filterChip, typeFilter === f.key && styles.filterChipActive]}
                      onPress={() => setTypeFilter(f.key)}
                    >
                      <Text style={[styles.filterChipText, typeFilter === f.key && styles.filterChipTextActive]}>
                        {f.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.filterLabel}>Risco</Text>
                <View style={styles.filterRow}>
                  {riskFilters.map(f => (
                    <TouchableOpacity
                      key={f.key}
                      style={[styles.filterChip, riskFilter === f.key && styles.filterChipActive]}
                      onPress={() => setRiskFilter(f.key)}
                    >
                      <Text style={[styles.filterChipText, riskFilter === f.key && styles.filterChipTextActive]}>
                        {f.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </View>
          <FlatList
            data={intFiltered}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Nenhuma interação encontrada.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <InteractionCard item={item} expanded={expanded === item.id} onToggle={() => toggle(item.id)} />
            )}
          />
        </>
      )}

      {/* Meds tab */}
      {tab === 'meds' && (
        <>
          <View style={styles.controlsWrap}>
            <View style={styles.searchRow}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                value={medSearch}
                onChangeText={setMedSearch}
                placeholder="Buscar medicamento..."
                placeholderTextColor="#9CA3AF"
                clearButtonMode="while-editing"
              />
            </View>
          </View>
          <Text style={styles.countLabel}>{medsList.length} medicamentos</Text>
          <FlatList
            data={medsList}
            keyExtractor={item => item.genericName}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Nenhum medicamento encontrado.</Text>
              </View>
            }
            renderItem={({ item }) => <MedCard item={item} onOpenBula={openBula} />}
          />
        </>
      )}

      {/* Phyto tab */}
      {tab === 'phyto' && (
        <>
          <View style={styles.controlsWrap}>
            <View style={styles.searchRow}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                value={phytoSearch}
                onChangeText={setPhytoSearch}
                placeholder="Buscar fitoterápico..."
                placeholderTextColor="#9CA3AF"
                clearButtonMode="while-editing"
              />
            </View>
          </View>
          <Text style={styles.countLabel}>{phytoList.length} fitoterápicos</Text>
          <FlatList
            data={phytoList}
            keyExtractor={item => item.genericName}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Nenhum fitoterápico encontrado.</Text>
              </View>
            }
            renderItem={({ item }) => <MedCard item={item} isPhyto onOpenBula={openBula} />}
          />
        </>
      )}
      {bulaModal}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },

  // Segmented control
  segWrap: {
    backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 0.5, borderBottomColor: '#E8EAF0',
  },
  segRow: {
    flexDirection: 'row', backgroundColor: '#EDEEF2',
    borderRadius: 10, padding: 3, gap: 2,
  },
  segBtn: {
    flex: 1, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 4,
    alignItems: 'center', gap: 2,
  },
  segIcon: { fontSize: 16, lineHeight: 20 },
  segLabel: { fontSize: 11, color: '#6B7280', fontWeight: '500' },

  // Controls
  controlsWrap: {
    backgroundColor: '#fff', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6,
    borderBottomWidth: 0.5, borderBottomColor: '#E8EAF0', gap: 6,
  },
  searchFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F2F4F8', borderRadius: 8,
    borderWidth: 0.5, borderColor: '#D0D5E8',
    paddingHorizontal: 10,
  },
  filterBtn: {
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9,
    backgroundColor: '#F2F4F8', borderWidth: 0.5, borderColor: '#D0D5E8',
  },
  filterBtnActive: { backgroundColor: '#1A1F2E', borderColor: '#1A1F2E' },
  filterBtnText: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  filterBtnTextActive: { color: '#fff' },
  searchIcon: { fontSize: 14, marginRight: 6 },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14, color: '#1A1F2E' },
  filterLabel: { fontSize: 10, color: '#9CA3AF', fontWeight: '600', letterSpacing: 0.4, marginTop: 2 },
  filterRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  filterChip: {
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: '#F2F4F8', borderWidth: 0.5, borderColor: '#D0D5E8',
  },
  filterChipActive: { backgroundColor: '#1A1F2E', borderColor: '#1A1F2E' },
  filterChipText: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  filterChipTextActive: { color: '#fff' },

  countLabel: { fontSize: 12, color: '#9CA3AF', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 2 },

  list: { padding: 12, paddingBottom: 32 },
  empty: { alignItems: 'center', marginTop: 48, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, color: '#999', textAlign: 'center' },

  // Interaction card
  intCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 8,
    borderLeftWidth: 3, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  intCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  intCardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  intCardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  riskBadge: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 },
  riskBadgeText: { fontSize: 11, fontWeight: '600' },
  typeTag: { fontSize: 13, color: '#8A8F9D' },
  chevron: { fontSize: 11, color: '#C0C5D0' },
  drugPair: { fontSize: 14, marginBottom: 6, lineHeight: 20 },
  drugName: { fontWeight: '600', color: '#1A1F2E' },
  drugPlus: { fontWeight: '700' },
  riskDesc: { fontSize: 12, color: '#6B7280', fontStyle: 'italic' },
  mechanismBox: { borderRadius: 8, padding: 10, marginTop: 10 },
  mechanismTitle: { fontSize: 11, fontWeight: '700', color: '#444', marginBottom: 4 },
  mechanismText: { fontSize: 12, color: '#333', lineHeight: 18 },
  reportBtn: {
    marginTop: 8, alignSelf: 'flex-start',
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: 8, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.12)',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  reportBtnText: { fontSize: 11.5, color: '#6B7280', fontWeight: '600' },
  sourceOk:   { fontSize: 11, color: '#5A6472', marginTop: 8, fontStyle: 'italic' },
  sourceNone: { fontSize: 11, color: '#8A5A00', marginTop: 8, fontStyle: 'italic', fontWeight: '600' },
  aiNotice: {
    fontSize: 11, color: '#3730A3', lineHeight: 16, marginTop: 8,
    paddingTop: 8, borderTopWidth: 0.5, borderTopColor: 'rgba(0,0,0,0.10)',
  },
  bold: { fontWeight: '700' },

  // Med / phyto card
  medCard: {
    backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8,
    borderLeftWidth: 3, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  medIcon: {
    width: 36, height: 36, borderRadius: 9, alignItems: 'center',
    justifyContent: 'center', flexShrink: 0,
  },
  medIconText: { fontSize: 18 },
  medInfo: { flex: 1 },
  medGenericName: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  medBrands: { fontSize: 11, color: '#8A8F9D', marginBottom: 5 },
  catChip: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  catChipText: { fontSize: 10, fontWeight: '600' },
  bulaBtn: { alignItems: 'center', justifyContent: 'center', paddingLeft: 10, gap: 2 },
  bulaBtnText: { fontSize: 18 },
  bulaBtnLabel: { fontSize: 9, fontWeight: '600' },
});
