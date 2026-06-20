import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Switch, Alert, Linking, ScrollView,
  KeyboardAvoidingView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getContacts, addContact, updateContact, deleteContact } from '../database/db';
import { EmergencyContact } from '../types';

const EMPTY: Omit<EmergencyContact, 'id'> = {
  name: '', phone: '', relationship: '', is_primary: false,
};

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

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
            {/* Avatar */}
            <View style={[styles.avatar, item.is_primary && styles.avatarPrimary]}>
              <Text style={[styles.avatarText, item.is_primary && styles.avatarTextPrimary]}>
                {getInitials(item.name)}
              </Text>
            </View>

            {/* Info */}
            <View style={styles.cardInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.contactName}>{item.name}</Text>
                {item.is_primary && (
                  <View style={styles.primaryBadge}>
                    <Text style={styles.primaryBadgeText}>Principal</Text>
                  </View>
                )}
              </View>
              {item.relationship ? <Text style={styles.contactRelation}>{item.relationship}</Text> : null}
              <Text style={styles.contactPhone}>{item.phone}</Text>
            </View>

            {/* Actions */}
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.callBtn} onPress={() => handleCall(item.phone)}>
                <Text style={styles.callBtnText}>Ligar</Text>
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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalBox} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>{editingId !== null ? 'Editar Contato' : 'Contato de Emergência'}</Text>
            {editingId === null && (
              <Text style={styles.modalSubtitle}>Aparecerá na tela de bloqueio — acesso sem senha</Text>
            )}

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
                trackColor={{ true: '#1C3F7A', false: '#ccc' }}
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
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  list: { padding: 14, paddingBottom: 80 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 16, color: '#999', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#bbb', textAlign: 'center', paddingHorizontal: 32 },

  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  cardPrimary: { borderLeftWidth: 3, borderLeftColor: '#1C3F7A' },

  avatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#EEF3FF',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarPrimary: { backgroundColor: '#1C3F7A' },
  avatarText: { fontSize: 15, fontWeight: '600', color: '#1C3F7A' },
  avatarTextPrimary: { color: '#fff' },

  cardInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  contactName: { fontSize: 15, fontWeight: '600', color: '#1A1F2E' },
  primaryBadge: { backgroundColor: '#EEF3FF', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  primaryBadgeText: { fontSize: 10, color: '#1C3F7A', fontWeight: '600' },
  contactRelation: { fontSize: 12, color: '#8A8F9D', marginBottom: 2 },
  contactPhone: { fontSize: 13, color: '#4A5270', fontWeight: '500' },

  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  callBtn: {
    backgroundColor: '#1C3F7A', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7,
  },
  callBtnText: { fontSize: 12, color: '#fff', fontWeight: '600' },
  editBtn: { padding: 8 },
  editBtnText: { fontSize: 17 },
  deleteBtn: { padding: 8 },
  deleteBtnText: { fontSize: 16, color: '#ccc' },

  fab: {
    position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1C3F7A', justifyContent: 'center', alignItems: 'center',
    elevation: 4, shadowColor: '#1C3F7A', shadowOpacity: 0.4, shadowRadius: 6,
  },
  fabText: { fontSize: 28, color: '#fff', lineHeight: 30 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1A1F2E', marginBottom: 4 },
  modalSubtitle: { fontSize: 12, color: '#1a6b3a', marginBottom: 16 },
  fieldLabel: { fontSize: 12, color: '#8A8F9D', marginBottom: 4, marginTop: 12, fontWeight: '500' },
  fieldInput: {
    borderWidth: 0.5, borderColor: '#D0D5E8', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 15, color: '#1A1F2E', backgroundColor: '#FAFBFD',
  },
  primaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  primaryLabel: { fontSize: 15, fontWeight: '600', color: '#1A1F2E' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: '#D0D5E8', borderRadius: 10, padding: 14, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: '#6B7280', fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#1C3F7A', borderRadius: 10, padding: 14, alignItems: 'center' },
  saveBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
});
