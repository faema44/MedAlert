import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Switch, Alert, Linking,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getContacts, addContact, updateContact, deleteContact } from '../database/db';
import { EmergencyContact } from '../types';

const EMPTY: Omit<EmergencyContact, 'id'> = {
  name: '', phone: '', relationship: '', is_primary: false,
};

export default function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setContacts(await getContacts());
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function openNew() {
    setForm(EMPTY);
    setEditingId(null);
    setShowModal(true);
  }

  function openEdit(item: EmergencyContact) {
    setForm({ name: item.name, phone: item.phone, relationship: item.relationship, is_primary: item.is_primary });
    setEditingId(item.id);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.phone.trim()) {
      Alert.alert('Campos obrigatórios', 'Informe nome e telefone do contato.');
      return;
    }
    if (editingId !== null) {
      await updateContact({ ...form, id: editingId, name: form.name.trim(), phone: form.phone.trim(), relationship: form.relationship.trim() });
    } else {
      await addContact({ ...form, name: form.name.trim(), phone: form.phone.trim(), relationship: form.relationship.trim() });
    }
    setContacts(await getContacts());
    setShowModal(false);
  }

  async function handleDelete(id: number, name: string) {
    Alert.alert('Remover contato', `Deseja remover "${name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive', onPress: async () => {
          await deleteContact(id);
          setContacts(await getContacts());
        },
      },
    ]);
  }

  function handleCall(phone: string) {
    Linking.openURL(`tel:${phone.replace(/\D/g, '')}`);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={contacts}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>Nenhum contato de emergência.</Text>
            <Text style={styles.emptyHint}>Adicione familiares ou médicos responsáveis.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.card, item.is_primary && styles.cardPrimary]}>
            <View style={styles.cardInfo}>
              {item.is_primary && <Text style={styles.primaryTag}>★ CONTATO PRINCIPAL</Text>}
              <Text style={styles.contactName}>{item.name}</Text>
              {item.relationship ? <Text style={styles.contactRelation}>{item.relationship}</Text> : null}
              <Text style={styles.contactPhone}>{item.phone}</Text>
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.callBtn} onPress={() => handleCall(item.phone)}>
                <Text style={styles.callBtnText}>📞</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
                <Text style={styles.editBtnText}>✏️</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id, item.name)}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={openNew}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { paddingBottom: insets.bottom + 32 }]}>
            <Text style={styles.modalTitle}>{editingId !== null ? 'Editar Contato' : 'Contato de Emergência'}</Text>

            <Text style={styles.fieldLabel}>Nome *</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.name}
              onChangeText={v => setForm(f => ({ ...f, name: v }))}
              placeholder="Ex: Maria (mãe)"
              autoCapitalize="words"
            />

            <Text style={styles.fieldLabel}>Telefone *</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.phone}
              onChangeText={v => setForm(f => ({ ...f, phone: v }))}
              placeholder="Ex: (11) 99999-9999"
              keyboardType="phone-pad"
            />

            <Text style={styles.fieldLabel}>Relação / Cargo</Text>
            <TextInput
              style={styles.fieldInput}
              value={form.relationship}
              onChangeText={v => setForm(f => ({ ...f, relationship: v }))}
              placeholder="Ex: Esposa, Médico Dr. Silva, Filha..."
              autoCapitalize="sentences"
            />

            <View style={styles.primaryRow}>
              <Text style={styles.primaryLabel}>Contato principal ★</Text>
              <Switch
                value={form.is_primary}
                onValueChange={v => setForm(f => ({ ...f, is_primary: v }))}
                trackColor={{ true: '#1a3a6b', false: '#ccc' }}
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                <Text style={styles.saveBtnText}>{editingId !== null ? 'Atualizar' : 'Salvar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
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
  emptyHint: { fontSize: 13, color: '#bbb', textAlign: 'center', paddingHorizontal: 32 },
  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center',
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  cardPrimary: { borderLeftWidth: 4, borderLeftColor: '#1a3a6b' },
  cardInfo: { flex: 1 },
  primaryTag: { fontSize: 10, color: '#1a3a6b', fontWeight: '700', marginBottom: 3, letterSpacing: 0.5 },
  contactName: { fontSize: 16, fontWeight: '600', color: '#222' },
  contactRelation: { fontSize: 13, color: '#888', marginTop: 1 },
  contactPhone: { fontSize: 14, color: '#444', marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  callBtn: { padding: 8 },
  callBtnText: { fontSize: 20 },
  editBtn: { padding: 8 },
  editBtnText: { fontSize: 17 },
  deleteBtn: { padding: 8 },
  deleteBtnText: { fontSize: 16, color: '#ccc' },
  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1a3a6b', justifyContent: 'center', alignItems: 'center',
    elevation: 4, shadowColor: '#1a3a6b', shadowOpacity: 0.4, shadowRadius: 6,
  },
  fabText: { fontSize: 28, color: '#fff', lineHeight: 30 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#222', marginBottom: 16 },
  fieldLabel: { fontSize: 13, color: '#555', marginBottom: 4, marginTop: 10 },
  fieldInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#222', backgroundColor: '#fafafa',
  },
  primaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 },
  primaryLabel: { fontSize: 15, fontWeight: '600', color: '#333' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ccc', borderRadius: 10, padding: 14, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: '#666', fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#1a3a6b', borderRadius: 10, padding: 14, alignItems: 'center' },
  saveBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
