import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMedications } from '../database/db';
import { checkInteractions, getAllInteractions } from '../utils/drugSearch';
import { DrugInteraction, Medication } from '../types';

const RISK_CONFIG = {
  critical: { label: 'CRÍTICO', color: '#CC0000', bg: '#fff0f0' },
  high:     { label: 'ALTO',    color: '#e65c00', bg: '#fff5f0' },
  moderate: { label: 'MODERADO',color: '#b58900', bg: '#fffaf0' },
};

type Tab = 'mine' | 'db';
type RiskFilter = 'all' | 'critical' | 'high' | 'moderate';

function InteractionCard({ item, expanded, onToggle }: {
  item: DrugInteraction;
  expanded: boolean;
  onToggle: () => void;
}) {
  const risk = RISK_CONFIG[item.risk_level];
  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: risk.color }]}
      onPress={onToggle}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.riskBadge, { backgroundColor: risk.bg }]}>
          <Text style={[styles.riskBadgeText, { color: risk.color }]}>{risk.label}</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </View>
      <Text style={styles.drug1}>{item.drug1}</Text>
      <Text style={styles.arrow}>⚡</Text>
      <Text style={styles.drug2}>{item.drug2}</Text>
      <Text style={styles.riskDesc}>{item.risk_description}</Text>
      {expanded && (
        <View style={[styles.mechanismBox, { backgroundColor: risk.bg }]}>
          <Text style={styles.mechanismTitle}>Como ocorre:</Text>
          <Text style={styles.mechanismText}>{item.mechanism}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function InteractionsScreen() {
  const [tab, setTab] = useState<Tab>('mine');
  const [myMeds, setMyMeds] = useState<Medication[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RiskFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    getMedications().then(setMyMeds).catch(() => {});
  }, []));

  // All pairwise interactions among the user's medications
  const myInteractions = useMemo<DrugInteraction[]>(() => {
    const seen = new Set<string>();
    const results: DrugInteraction[] = [];
    for (let i = 0; i < myMeds.length; i++) {
      const drug = myMeds[i].generic_name;
      const rest = myMeds.slice(i + 1).map(m => m.generic_name);
      for (const hit of checkInteractions(drug, rest)) {
        if (!seen.has(hit.id)) { seen.add(hit.id); results.push(hit); }
      }
    }
    const order: Record<string, number> = { critical: 0, high: 1, moderate: 2 };
    return results.sort((a, b) => order[a.risk_level] - order[b.risk_level]);
  }, [myMeds]);

  // Database tab: filter ALL_INTERACTIONS
  const dbFiltered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return getAllInteractions().filter(i => {
      const matchSearch = !q || i.drug1.toLowerCase().includes(q) || i.drug2.toLowerCase().includes(q);
      const matchFilter = filter === 'all' || i.risk_level === filter;
      return matchSearch && matchFilter;
    });
  }, [search, filter]);

  function toggle(id: string) {
    setExpanded(prev => (prev === id ? null : id));
  }

  const criticalCount = myInteractions.filter(i => i.risk_level === 'critical').length;
  const highCount     = myInteractions.filter(i => i.risk_level === 'high').length;

  return (
    <View style={styles.container}>
      {/* Tab selector */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'mine' && styles.tabBtnActive]}
          onPress={() => setTab('mine')}
        >
          <Text style={[styles.tabBtnText, tab === 'mine' && styles.tabBtnTextActive]}>
            Meus Medicamentos
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'db' && styles.tabBtnActive]}
          onPress={() => setTab('db')}
        >
          <Text style={[styles.tabBtnText, tab === 'db' && styles.tabBtnTextActive]}>
            Base de Dados
          </Text>
        </TouchableOpacity>
      </View>

      {tab === 'mine' ? (
        // ── Meus Medicamentos ────────────────────────────────────────────────
        <FlatList
          data={myInteractions}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            myMeds.length === 0 ? null : (
              <View style={styles.myMedsSummary}>
                <Text style={styles.myMedsTitle}>
                  {myMeds.length} medicamento{myMeds.length !== 1 ? 's' : ''} na sua lista
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillsRow}>
                  {myMeds.map(m => (
                    <View key={m.id} style={[styles.medPill, m.is_critical && styles.medPillCritical]}>
                      <Text style={[styles.medPillText, m.is_critical && styles.medPillTextCritical]} numberOfLines={1}>
                        {m.generic_name}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
                {myInteractions.length > 0 && (
                  <View style={styles.interactionSummary}>
                    {criticalCount > 0 && (
                      <View style={[styles.summaryBadge, { backgroundColor: '#fff0f0' }]}>
                        <Text style={[styles.summaryBadgeText, { color: '#CC0000' }]}>
                          {criticalCount} CRÍTICA{criticalCount !== 1 ? 'S' : ''}
                        </Text>
                      </View>
                    )}
                    {highCount > 0 && (
                      <View style={[styles.summaryBadge, { backgroundColor: '#fff5f0' }]}>
                        <Text style={[styles.summaryBadgeText, { color: '#e65c00' }]}>
                          {highCount} ALTA{highCount !== 1 ? 'S' : ''}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              {myMeds.length === 0 ? (
                <>
                  <Text style={styles.emptyText}>Nenhum medicamento cadastrado.</Text>
                  <Text style={styles.emptyHint}>Adicione seus medicamentos na aba Medicamentos.</Text>
                </>
              ) : (
                <>
                  <Text style={styles.emptyIcon}>✅</Text>
                  <Text style={styles.emptyText}>Nenhuma interação detectada</Text>
                  <Text style={styles.emptyHint}>Seus medicamentos atuais não têm interações conhecidas entre si.</Text>
                </>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <InteractionCard
              item={item}
              expanded={expanded === item.id}
              onToggle={() => toggle(item.id)}
            />
          )}
        />
      ) : (
        // ── Base de Dados ────────────────────────────────────────────────────
        <>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="🔍 Buscar medicamento..."
              clearButtonMode="while-editing"
            />
          </View>
          <View style={styles.filterRow}>
            {(['all', 'critical', 'high', 'moderate'] as const).map(f => (
              <TouchableOpacity
                key={f}
                style={[styles.filterBtn, filter === f && styles.filterBtnActive]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.filterBtnText, filter === f && styles.filterBtnTextActive]}>
                  {f === 'all' ? 'Todas' : RISK_CONFIG[f].label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <FlatList
            data={dbFiltered}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Nenhuma interação encontrada.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <InteractionCard
                item={item}
                expanded={expanded === item.id}
                onToggle={() => toggle(item.id)}
              />
            )}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  // Tabs
  tabRow: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#e8e8e8',
  },
  tabBtn: {
    flex: 1, paddingVertical: 13, alignItems: 'center',
    borderBottomWidth: 3, borderBottomColor: 'transparent',
  },
  tabBtnActive: { borderBottomColor: '#1a3a6b' },
  tabBtnText: { fontSize: 13, color: '#888', fontWeight: '600' },
  tabBtnTextActive: { color: '#1a3a6b' },
  // My meds header
  myMedsSummary: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12,
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  myMedsTitle: { fontSize: 13, color: '#666', marginBottom: 8 },
  pillsRow: { flexDirection: 'row', marginBottom: 8 },
  medPill: {
    backgroundColor: '#e8edf7', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    marginRight: 6, borderWidth: 1, borderColor: '#c0ccdf',
  },
  medPillCritical: { backgroundColor: '#fff0f0', borderColor: '#CC0000' },
  medPillText: { fontSize: 12, color: '#1a3a6b', fontWeight: '600' },
  medPillTextCritical: { color: '#CC0000' },
  interactionSummary: { flexDirection: 'row', gap: 8, marginTop: 4 },
  summaryBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  summaryBadgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  // Search / filter (db tab)
  searchBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  searchInput: {
    backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, borderWidth: 1, borderColor: '#e0e0e0',
  },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  filterBtn: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#e0e0e0' },
  filterBtnActive: { backgroundColor: '#1a3a6b' },
  filterBtnText: { fontSize: 12, color: '#555', fontWeight: '600' },
  filterBtnTextActive: { color: '#fff' },
  // List
  list: { padding: 16, paddingTop: 12, paddingBottom: 32 },
  empty: { alignItems: 'center', marginTop: 48, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 15, color: '#999', textAlign: 'center', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#bbb', textAlign: 'center', lineHeight: 18 },
  // Card
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    borderLeftWidth: 4, elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  riskBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  riskBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  chevron: { fontSize: 11, color: '#aaa' },
  drug1: { fontSize: 15, fontWeight: '700', color: '#222' },
  arrow: { fontSize: 14, marginVertical: 2 },
  drug2: { fontSize: 15, fontWeight: '700', color: '#222' },
  riskDesc: { fontSize: 13, color: '#555', marginTop: 6, fontStyle: 'italic' },
  mechanismBox: { borderRadius: 8, padding: 10, marginTop: 10 },
  mechanismTitle: { fontSize: 12, fontWeight: '700', color: '#444', marginBottom: 4 },
  mechanismText: { fontSize: 13, color: '#333', lineHeight: 19 },
});
