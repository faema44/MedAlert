import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProfile, saveProfile, getMedications } from '../database/db';
import { updateEmergencyNotification, calculateAge } from '../services/notifications';
import { Profile, BLOOD_TYPES } from '../types';

const IS_IOS = Platform.OS === 'ios';

export default function ProfileScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const returnTo = (route.params as { returnTo?: string } | undefined)?.returnTo;
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [bloodType, setBloodType] = useState('Desconhecido');
  const [bdDay, setBdDay] = useState('');
  const [bdMonth, setBdMonth] = useState('');
  const [bdYear, setBdYear] = useState('');
  const [allergies, setAllergies] = useState('');
  const [notes, setNotes] = useState('');
  const bdMonthRef = useRef<TextInput>(null);
  const bdYearRef = useRef<TextInput>(null);
  const profileScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const profile = await getProfile();
    if (profile) {
      setName(profile.name);
      setBloodType(profile.blood_type);
      const match = profile.birth_date?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (match) { setBdDay(match[1]); setBdMonth(match[2]); setBdYear(match[3]); }
      setAllergies(profile.allergies);
      setNotes(profile.notes);
    }
    setLoading(false);
  }

  const birthDate = (bdDay.length === 2 && bdMonth.length === 2 && bdYear.length === 4) ? `${bdDay}/${bdMonth}/${bdYear}` : '';

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Campo obrigatório', 'Por favor, informe seu nome.');
      return;
    }
    setSaving(true);
    try {
      await saveProfile({ name: name.trim(), blood_type: bloodType, birth_date: birthDate, allergies: allergies.trim(), notes: notes.trim() });
      const meds = await getMedications();
      const profile = await getProfile();
      if (profile) await updateEmergencyNotification(profile, meds).catch(() => {});
      Alert.alert('Salvo!', 'Perfil atualizado.', [
        { text: 'OK', onPress: () => returnTo ? (navigation as any).navigate(returnTo) : navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar o perfil. Tente novamente.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1C3F7A" />
      </View>
    );
  }

  const previewAge = calculateAge(birthDate);
  const previewBloodSuffix = (bloodType && bloodType !== 'Desconhecido') ? `  🩸 ${bloodType}` : '';
  const previewAgeSuffix = previewAge != null ? `  ${previewAge}A` : '';
  const previewLines = [
    `👤 ${name.trim() || 'Seu nome'}${previewBloodSuffix}${previewAgeSuffix}`,
    allergies.trim() ? `Alergia: ${allergies.trim()}` : null,
    notes.trim() ? `📋 ${notes.trim()}` : null,
  ].filter(Boolean) as string[];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView ref={profileScrollRef} style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        {/* A prévia imita o card de emergência do Android. No iPhone esse card não existe —
            mostrá-la seria prometer uma tela de bloqueio que o app nunca vai desenhar. */}
        {!IS_IOS && (
          <View style={styles.previewSection}>
            <Text style={styles.previewLabel}>PRÉ-VISUALIZAÇÃO — TELA DE BLOQUEIO</Text>
            <View style={styles.previewNotif}>
              <View style={styles.previewIconBox}>
                <Text style={styles.previewIconCross}>✚</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.previewTitle} numberOfLines={1}>Informações Médicas</Text>
                {previewLines.map((line, i) => (
                  <Text key={i} style={styles.previewLine} numberOfLines={1}>{line}</Text>
                ))}
              </View>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Identificação</Text>

          <Text style={styles.label}>Nome completo *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Seu nome completo"
            autoCapitalize="words"
          />

          <Text style={styles.label}>Data de nascimento</Text>
          <View style={styles.dateRow}>
            <TextInput
              style={[styles.input, styles.dateInputDay]}
              value={bdDay}
              onChangeText={t => {
                const digits = t.replace(/\D/g, '').slice(0, 2);
                setBdDay(digits);
                if (digits.length === 2) bdMonthRef.current?.focus();
              }}
              onEndEditing={() => {
                if (bdDay.length === 0) return;
                if (bdDay.length === 1) { setBdDay('0' + bdDay); return; }
                const n = parseInt(bdDay, 10);
                if (n < 1 || n > 31) setBdDay('00');
              }}
              placeholder="DD"
              keyboardType="numeric"
              maxLength={2}
              textAlign="center"
            />
            <Text style={styles.dateSeparator}>/</Text>
            <TextInput
              ref={bdMonthRef}
              style={[styles.input, styles.dateInputMonth]}
              value={bdMonth}
              onChangeText={t => {
                const digits = t.replace(/\D/g, '').slice(0, 2);
                setBdMonth(digits);
                if (digits.length === 2) bdYearRef.current?.focus();
              }}
              onEndEditing={() => {
                if (bdMonth.length === 0) return;
                if (bdMonth.length === 1) { setBdMonth('0' + bdMonth); return; }
                const n = parseInt(bdMonth, 10);
                if (n < 1 || n > 12) setBdMonth('00');
              }}
              placeholder="MM"
              keyboardType="numeric"
              maxLength={2}
              textAlign="center"
            />
            <Text style={styles.dateSeparator}>/</Text>
            <TextInput
              ref={bdYearRef}
              style={[styles.input, styles.dateInputYear]}
              value={bdYear}
              onChangeText={t => setBdYear(t.replace(/\D/g, '').slice(0, 4))}
              onEndEditing={() => {
                if (bdYear.length === 0) return;
                const n = parseInt(bdYear, 10);
                if (bdYear.length !== 4 || n < 1890 || n > 2050) setBdYear('0000');
              }}
              placeholder="AAAA"
              keyboardType="numeric"
              maxLength={4}
              textAlign="center"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tipo Sanguíneo</Text>
          <View style={styles.bloodTypeGrid}>
            {BLOOD_TYPES.map(bt => (
              <TouchableOpacity
                key={bt}
                style={[styles.bloodTypeBtn, bloodType === bt && styles.bloodTypeBtnSelected]}
                onPress={() => setBloodType(bt)}
              >
                <Text style={[styles.bloodTypeBtnText, bloodType === bt && styles.bloodTypeBtnTextSelected]}>
                  {bt}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informações Médicas</Text>

          <Text style={styles.label}>Alergias</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={allergies}
            onChangeText={setAllergies}
            placeholder="Ex: Penicilina, Dipirona, látex..."
            multiline
            numberOfLines={3}
          />

          <Text style={styles.label}>Observações (condições, cirurgias, etc.)</Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Ex: Diabético tipo 2, marca-passo, insuficiência renal crônica..."
            multiline
            numberOfLines={4}
            onFocus={() => setTimeout(() => profileScrollRef.current?.scrollToEnd({ animated: true }), 250)}
          />
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>{IS_IOS
            ? 'ℹ️  Estas informações ficam guardadas no app. Para que socorristas as vejam na tela de bloqueio do iPhone, preencha também nome, tipo sanguíneo e alergias na Ficha Médica, no app Saúde da Apple — nenhum app pode fazer isso por você.'
            : 'ℹ️  Estas informações serão exibidas na tela de bloqueio para socorristas. Salvar atualiza automaticamente o alerta de emergência.'}
          </Text>
        </View>

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Salvar Perfil</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  content: { padding: 16, paddingBottom: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  previewSection: { marginBottom: 14 },
  previewLabel: { fontSize: 10, fontWeight: '700', color: '#8A8F9D', letterSpacing: 0.5, marginBottom: 6 },
  previewNotif: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#fff', borderRadius: 12, padding: 12,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.08)',
  },
  previewIconBox: {
    width: 36, height: 36, borderRadius: 8, backgroundColor: '#1C3F7A',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  previewIconCross: { color: '#E53935', fontSize: 18, fontWeight: '900' },
  previewTitle: { fontSize: 14, fontWeight: '700', color: '#1A1F2E' },
  previewLine: { fontSize: 12, color: '#555', marginTop: 2 },
  section: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 14,
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#1C3F7A', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: 13, color: '#555', marginBottom: 4, marginTop: 10 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#222', backgroundColor: '#fafafa',
  },
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateInputDay: { width: 56 },
  dateInputMonth: { width: 56 },
  dateInputYear: { width: 76 },
  dateSeparator: { fontSize: 16, color: '#999' },
  bloodTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bloodTypeBtn: {
    borderWidth: 1.5, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 60, alignItems: 'center',
  },
  bloodTypeBtnSelected: { borderColor: '#1C3F7A', backgroundColor: '#1C3F7A' },
  bloodTypeBtnText: { fontSize: 14, color: '#444', fontWeight: '600' },
  bloodTypeBtnTextSelected: { color: '#fff' },
  infoBox: { backgroundColor: '#e8f4fd', borderRadius: 10, padding: 12, marginBottom: 16 },
  infoText: { fontSize: 13, color: '#0066cc', lineHeight: 18 },
  saveBtn: { backgroundColor: '#1C3F7A', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 4 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
