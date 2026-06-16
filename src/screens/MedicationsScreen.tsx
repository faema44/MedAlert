import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Switch, Alert, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMedications, addMedication, deleteMedication } from '../database/db';
import { getProfile } from '../database/db';
import { updateEmergencyNotification } from '../services/notifications';
import { Medication } from '../types';

const EMPTY_MED: Omit<Medication, 'id'> = {
  generic_name: '', commercial_name: '', dose: '', frequency: '', is_critical: false, notes: '',
};

export default function MedicationsScreen() {
  const insets = useSafeAreaInsets();
  const [medications, setMedications] = useState<Medication[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_MED);

  const load = useCallback(async () => {
    setMedications(await getMedications());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function syncNotification(meds: Medication[]) {
    try {
      const profile = await getProfile();
      if (profile?.name) await updateEmergencyNotification(profile, meds);
    } catch {}
  }

  function openAdd() {
    setForm(EMPTY_MED);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.generic_name.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome genérico do medicamento.');
      return;
    }
    try {
      await addMedication({ ...form, generic_name: form.generic_name.trim(), commercial_name: form.commercial_name.trim() });
      const updated = await getMedications();
      setMedications(updated);
      setShowModal(false);
      await syncNotification(updated);
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível salvar o medicamento. Tente novamente.');
    }
  }

  async function handleDelete(id: number, name: string) {
    Alert.alert('Remover medicamento', `Deseja remover "${name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive', onPress: async () => {
          await deleteMedication(id);
          const updated = await getMedications();
          setMedications(updated);
          await syncNotification(updated);
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={medications}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nenhum medicamento cadastrado.</Text>
            <Text style={styles.emptyHint}>Toque em + para adicionar.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.medCard, item.is_critical && styles.medCardCritical]}>
            <View style={styles.medInfo}>
              <View style={styles.medHeader}>
                {item.is_critical && <Text style={styles.criticalTag}>⚠️ CRÍTICO</Text>}
                <Text style={styles.medGeneric}>{item.generic_name}</Text>
              </View>
              {item.commercial_name ? <Text style={styles.medCommercial}>{item.commercial_name}</Text> : null}
              {item.dose ? <Text style={styles.medDetail}>💊 {item.dose}</Text> : null}
              {item.frequency ? <Text style={styles.medDetail}>🕐 {item.frequency}</Text> : null}
              {item.notes ? <Text style={styles.medNotes}>{item.notes}</Text> : null}
            </View>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id, item.generic_name)}>
              <Text style={styles.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={openAdd}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalBox} contentContainerStyle={[styles.modalContent, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>Novo Medicamento</Text>

            <Text style={styles.fieldLabel}>Nome genérico *</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.generic_name}
              onChangeText={v => setForm(f => ({ ...f, generic_name: v }))}
              placeholder="Ex: Metformina"
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>Nome comercial</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.commercial_name}
              onChangeText={v => setForm(f => ({ ...f, commercial_name: v }))}
              placeholder="Ex: Glifage"
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>Dose</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.dose}
              onChangeText={v => setForm(f => ({ ...f, dose: v }))}
              placeholder="Ex: 850 mg"
            />

            <Text style={styles.fieldLabel}>Frequência</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.frequency}
              onChangeText={v => setForm(f => ({ ...f, frequency: v }))}
              placeholder="Ex: 2x ao dia com as refeições"
            />

            <Text style={styles.fieldLabel}>Observações</Text>
            <TextInput
              style={[styles.fieldInput, { minHeight: 60, textAlignVertical: 'top' }]}
              value={form.notes}
              onChangeText={v => setForm(f => ({ ...f, notes: v }))}
              placeholder="Informações adicionais para socorristas..."
              multiline
            />

            <View style={styles.criticalRow}>
              <View>
                <Text style={styles.criticalLabel}>Medicamento crítico ⚠️</Text>
                <Text style={styles.criticalHint}>Aparecerá em destaque no alerta</Text>
              </View>
              <Switch
                value={form.is_critical}
                onValueChange={v => setForm(f => ({ ...f, is_critical: v }))}
                trackColor={{ true: '#1a3a6b', false: '#ccc' }}
                thumbColor={form.is_critical ? '#fff' : '#fff'}
              />
            </View>

            {form.is_critical && (
              <View style={styles.criticalInfo}>
                <Text style={styles.criticalInfoText}>
                  ⚠️ Marque como crítico medicamentos que interagem com procedimentos comuns de emergência (ex: Metformina com contraste, Varfarina com cirurgias).
                </Text>
              </View>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveBtnText}>Salvar</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  list: { padding: 16, paddingBottom: 80 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 16, color: '#999', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#bbb' },
  medCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'flex-start',
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  medCardCritical: { borderLeftWidth: 4, borderLeftColor: '#CC0000' },
  medInfo: { flex: 1 },
  medHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  criticalTag: { fontSize: 11, color: '#CC0000', fontWeight: '700', backgroundColor: '#fff0f0', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  medGeneric: { fontSize: 16, fontWeight: '600', color: '#222' },
  medCommercial: { fontSize: 13, color: '#888', marginBottom: 4 },
  medDetail: { fontSize: 13, color: '#555', marginTop: 2 },
  medNotes: { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
  deleteBtn: { padding: 8, marginLeft: 4 },
  deleteBtnText: { fontSize: 16, color: '#ccc' },
  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1a3a6b', justifyContent: 'center', alignItems: 'center',
    elevation: 4, shadowColor: '#1a3a6b', shadowOpacity: 0.4, shadowRadius: 6,
  },
  fabText: { fontSize: 28, color: '#fff', lineHeight: 30 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  modalContent: { padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#222', marginBottom: 16 },
  fieldLabel: { fontSize: 13, color: '#555', marginBottom: 4, marginTop: 10 },
  fieldInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#222', backgroundColor: '#fafafa',
  },
  criticalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0',
  },
  criticalLabel: { fontSize: 15, fontWeight: '600', color: '#333' },
  criticalHint: { fontSize: 12, color: '#999', marginTop: 2 },
  criticalInfo: { backgroundColor: '#fff8f0', borderRadius: 8, padding: 10, marginTop: 10 },
  criticalInfoText: { fontSize: 12, color: '#cc6600', lineHeight: 17 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ccc', borderRadius: 10, padding: 14, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: '#666', fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#1a3a6b', borderRadius: 10, padding: 14, alignItems: 'center' },
  saveBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
