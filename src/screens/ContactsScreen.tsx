import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Switch, Alert, Linking, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getContacts, addContact, updateContact, deleteContact, getMedications, getProfile } from '../database/db';
import { updateEmergencyNotification } from '../services/notifications';
import { EmergencyContact, Medication } from '../types';

const EMPTY: Omit<EmergencyContact, 'id'> = {
  name: '', phone: '', relationship: '', is_primary: false, is_doctor: false, show_on_lock: false,
};

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function buildWhatsAppNumber(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.substring(1);
  if (!digits.startsWith('55')) digits = '55' + digits;
  return digits;
}

export default function ContactsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);

  // WhatsApp modal state
  const [waContact, setWaContact] = useState<EmergencyContact | null>(null);
  const [waMeds, setWaMeds] = useState<Medication[]>([]);
  const [waSelected, setWaSelected] = useState<Set<number>>(new Set());
  const [waReceita, setWaReceita] = useState<Set<number>>(new Set());

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
    setForm({ name: item.name, phone: item.phone, relationship: item.relationship, is_primary: item.is_primary, is_doctor: item.is_doctor, show_on_lock: item.show_on_lock });
    setEditingId(item.id);
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name.trim() || !form.phone.trim()) {
      Alert.alert('Campos obrigatórios', 'Informe nome e telefone do contato.');
      return;
    }
    const isNew = editingId === null;
    if (editingId !== null) {
      await updateContact({ ...form, id: editingId, name: form.name.trim(), phone: form.phone.trim(), relationship: form.relationship.trim() });
    } else {
      await addContact({ ...form, name: form.name.trim(), phone: form.phone.trim(), relationship: form.relationship.trim() });
    }
    const updated = await getContacts();
    setContacts(updated);
    setShowModal(false);
    getProfile().then(p => { if (p) getMedications().then(m => updateEmergencyNotification(p, m).catch(() => {})); }).catch(() => {});
    if (isNew) navigation.navigate('Home' as never);
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

  async function openWaModal(contact: EmergencyContact) {
    const meds = await getMedications();
    setWaContact(contact);
    setWaMeds(meds);
    const all = new Set(meds.map(m => m.id));
    setWaSelected(all);
    setWaReceita(new Set());
  }

  async function sendWhatsApp() {
    if (!waContact) return;
    const profile = await getProfile();
    const selected = waMeds.filter(m => waSelected.has(m.id));

    const medLines = selected.map(m => {
      const name = m.commercial_name ? `${m.generic_name} (${m.commercial_name})` : m.generic_name;
      const dose = m.dose ? ` – ${m.dose}` : '';
      const receita = waReceita.has(m.id) ? ' ✦ solicito receita' : '';
      return `💊 ${name}${dose}${receita}`;
    }).join('\n');

    const patient = profile?.name ? `\n\nAtenciosamente,\n${profile.name}` : '';

    let message: string;
    if (waContact.is_doctor) {
      const needReceita = selected.filter(m => waReceita.has(m.id));
      const receitaNote = needReceita.length > 0
        ? `\n\nSolicito receita para: ${needReceita.map(m => m.generic_name).join(', ')}.`
        : '';
      message = `Olá, ${waContact.name}!\n\nSegue a lista dos meus medicamentos em uso:\n\n${medLines}${receitaNote}${patient}`;
    } else {
      message = `Olá, ${waContact.name}!\n\nSegue a lista dos meus medicamentos em uso:\n\n${medLines}${patient}`;
    }

    const digits = buildWhatsAppNumber(waContact.phone);
    const url = `whatsapp://send?phone=${digits}&text=${encodeURIComponent(message)}`;
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    setWaContact(null);
    if (canOpen) {
      Linking.openURL(url);
    } else {
      Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`);
    }
  }

  function toggleWaSelected(id: number) {
    setWaSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); setWaReceita(r => { const nr = new Set(r); nr.delete(id); return nr; }); }
      else next.add(id);
      return next;
    });
  }

  function toggleWaReceita(id: number) {
    setWaReceita(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
            <View style={styles.cardTop}>
              <View style={[styles.avatar, item.is_primary && styles.avatarPrimary]}>
                <Text style={[styles.avatarText, item.is_primary && styles.avatarTextPrimary]}>
                  {getInitials(item.name)}
                </Text>
              </View>
              <View style={styles.cardInfo}>
                <View style={styles.nameRow}>
                  <Text style={styles.contactName} numberOfLines={1}>{item.name}</Text>
                  {item.is_primary && (
                    <View style={styles.primaryBadge}>
                      <Text style={styles.primaryBadgeText}>Principal</Text>
                    </View>
                  )}
                  {item.is_doctor && (
                    <View style={styles.doctorBadge}>
                      <Text style={styles.doctorBadgeText}>Médico</Text>
                    </View>
                  )}
                  {item.show_on_lock && (
                    <Text style={styles.lockBadge}>🔒</Text>
                  )}
                </View>
                {item.relationship ? <Text style={styles.contactRelation}>{item.relationship}</Text> : null}
                <Text style={styles.contactPhone}>{item.phone}</Text>
              </View>
              <View style={styles.cardMeta}>
                <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
                  <Text style={styles.editBtnText}>✏️</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id, item.name)}>
                  <Text style={styles.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.cardActions}>
              <TouchableOpacity style={styles.callBtn} onPress={() => handleCall(item.phone)}>
                <Text style={styles.callBtnText}>📞  Ligar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.waBtn} onPress={() => openWaModal(item)}>
                <Text style={styles.waBtnText}>💬  WhatsApp</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={openNew}>
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Contact form modal */}
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
              placeholder="Ex: Esposa, Dr. Silva, Filha..."
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

            <View style={styles.primaryRow}>
              <Text style={styles.primaryLabel}>É médico 🩺</Text>
              <Switch
                value={form.is_doctor}
                onValueChange={v => setForm(f => ({ ...f, is_doctor: v }))}
                trackColor={{ true: '#1C3F7A', false: '#ccc' }}
              />
            </View>

            <View style={styles.primaryRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.primaryLabel}>Exibir na tela de bloqueio 🔒</Text>
                <Text style={styles.lockHint}>Nome e telefone aparecem sem desbloquear o celular</Text>
              </View>
              <Switch
                value={form.show_on_lock}
                onValueChange={v => setForm(f => ({ ...f, show_on_lock: v }))}
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

      {/* WhatsApp modal */}
      <Modal visible={!!waContact} animationType="slide" transparent onRequestClose={() => setWaContact(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.modalTitle}>
              {waContact?.is_doctor ? '💬 Mensagem para Médico' : '💬 Enviar no WhatsApp'}
            </Text>
            <Text style={styles.waSubtitle}>
              {waContact?.name} · {waContact?.is_doctor ? 'Marque os medicamentos e solicite receitas' : 'Selecione os medicamentos'}
            </Text>

            {waMeds.length === 0 ? (
              <Text style={styles.waEmpty}>Nenhum medicamento cadastrado.</Text>
            ) : (
              <ScrollView style={styles.waMedList}>
                {waContact?.is_doctor && (
                  <View style={styles.waHeader}>
                    <Text style={[styles.waHeaderCell, { flex: 1 }]}>Medicamento</Text>
                    <Text style={styles.waHeaderCell}>Receita</Text>
                  </View>
                )}
                {waMeds.map(m => (
                  <View key={m.id} style={styles.waMedRow}>
                    <TouchableOpacity style={styles.waCheckRow} onPress={() => toggleWaSelected(m.id)}>
                      <View style={[styles.waCheck, waSelected.has(m.id) && styles.waCheckActive]}>
                        {waSelected.has(m.id) && <Text style={styles.waCheckMark}>✓</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.waMedName}>{m.generic_name}</Text>
                        {!!m.dose && <Text style={styles.waMedDose}>{m.dose}</Text>}
                      </View>
                    </TouchableOpacity>
                    {waContact?.is_doctor && (
                      <TouchableOpacity
                        style={[styles.waReceitaBtn, waReceita.has(m.id) && styles.waReceitaBtnActive, !waSelected.has(m.id) && { opacity: 0.3 }]}
                        onPress={() => waSelected.has(m.id) && toggleWaReceita(m.id)}
                      >
                        <Text style={[styles.waReceitaText, waReceita.has(m.id) && styles.waReceitaTextActive]}>Receita</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setWaContact(null)}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={sendWhatsApp} disabled={waSelected.size === 0}>
                <Text style={styles.saveBtnText}>Enviar 💬</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  cardPrimary: { borderLeftWidth: 3, borderLeftColor: '#1C3F7A' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },

  avatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: '#EEF3FF',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarPrimary: { backgroundColor: '#1C3F7A' },
  avatarText: { fontSize: 15, fontWeight: '600', color: '#1C3F7A' },
  avatarTextPrimary: { color: '#fff' },

  cardInfo: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  contactName: { fontSize: 15, fontWeight: '600', color: '#1A1F2E', flexShrink: 1 },
  primaryBadge: { backgroundColor: '#EEF3FF', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 0 },
  primaryBadgeText: { fontSize: 10, color: '#1C3F7A', fontWeight: '600' },
  doctorBadge: { backgroundColor: '#F0FFF4', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 0 },
  doctorBadgeText: { fontSize: 10, color: '#1a6b3a', fontWeight: '600' },
  contactRelation: { fontSize: 12, color: '#8A8F9D', marginBottom: 2 },
  contactPhone: { fontSize: 13, color: '#4A5270', fontWeight: '500' },

  cardMeta: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  editBtn: { padding: 8 },
  editBtnText: { fontSize: 17 },
  deleteBtn: { padding: 8 },
  deleteBtnText: { fontSize: 16, color: '#ccc' },

  cardActions: {
    flexDirection: 'row', gap: 8,
    borderTopWidth: 0.5, borderTopColor: '#F0F2F7', paddingTop: 10,
  },
  callBtn: { flex: 1, backgroundColor: '#1C3F7A', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  callBtnText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  waBtn: { flex: 1, backgroundColor: '#25D366', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  waBtnText: { fontSize: 13, color: '#fff', fontWeight: '600' },

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
  lockHint: { fontSize: 11, color: '#888', marginTop: 2 },
  lockBadge: { fontSize: 14, marginLeft: 2 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: '#D0D5E8', borderRadius: 10, padding: 14, alignItems: 'center' },
  cancelBtnText: { fontSize: 15, color: '#6B7280', fontWeight: '600' },
  saveBtn: { flex: 1, backgroundColor: '#1C3F7A', borderRadius: 10, padding: 14, alignItems: 'center' },
  saveBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },

  // WhatsApp modal
  waSubtitle: { fontSize: 13, color: '#8A8F9D', marginBottom: 12 },
  waEmpty: { fontSize: 14, color: '#aaa', textAlign: 'center', paddingVertical: 20 },
  waMedList: { maxHeight: 320 },
  waHeader: { flexDirection: 'row', paddingBottom: 6, borderBottomWidth: 1, borderColor: '#EEF0F5', marginBottom: 4 },
  waHeaderCell: { fontSize: 11, color: '#8A8F9D', fontWeight: '600', textAlign: 'center', minWidth: 60 },
  waMedRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderColor: '#F0F0F5' },
  waCheckRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  waCheck: {
    width: 22, height: 22, borderRadius: 5, borderWidth: 1.5, borderColor: '#C0C8DC',
    alignItems: 'center', justifyContent: 'center',
  },
  waCheckActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  waCheckMark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  waMedName: { fontSize: 14, color: '#1A1F2E', fontWeight: '500' },
  waMedDose: { fontSize: 12, color: '#8A8F9D' },
  waReceitaBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    borderWidth: 1, borderColor: '#C0C8DC', marginLeft: 8,
  },
  waReceitaBtnActive: { backgroundColor: '#E07B4F', borderColor: '#E07B4F' },
  waReceitaText: { fontSize: 12, color: '#8A8F9D', fontWeight: '600' },
  waReceitaTextActive: { color: '#fff' },
});
