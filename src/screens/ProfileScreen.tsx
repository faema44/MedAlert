import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getProfile, saveProfile } from '../database/db';
import { getMedications } from '../database/db';
import { updateEmergencyNotification } from '../services/notifications';
import { Profile, BLOOD_TYPES } from '../types';

export default function ProfileScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [bloodType, setBloodType] = useState('Desconhecido');
  const [birthDate, setBirthDate] = useState('');
  const [allergies, setAllergies] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const profile = await getProfile();
    if (profile) {
      setName(profile.name);
      setBloodType(profile.blood_type);
      setBirthDate(profile.birth_date);
      setAllergies(profile.allergies);
      setNotes(profile.notes);
    }
    setLoading(false);
  }

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
        { text: 'OK', onPress: () => navigation.navigate('Home' as never) },
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
        <ActivityIndicator size="large" color="#1a3a6b" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" enabled={Platform.OS === 'ios'}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
          <TextInput
            style={styles.input}
            value={birthDate}
            onChangeText={setBirthDate}
            placeholder="DD/MM/AAAA"
            keyboardType="numeric"
            maxLength={10}
          />
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
          />
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            ℹ️  Estas informações serão exibidas na tela de bloqueio para socorristas. Salvar atualiza automaticamente o alerta de emergência.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.saveBtnContainer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Salvar Perfil</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 16, paddingBottom: 24 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section: {
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 14,
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#1a3a6b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { fontSize: 13, color: '#555', marginBottom: 4, marginTop: 10 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#222', backgroundColor: '#fafafa',
  },
  inputMultiline: { minHeight: 70, textAlignVertical: 'top' },
  bloodTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bloodTypeBtn: {
    borderWidth: 1.5, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, minWidth: 60, alignItems: 'center',
  },
  bloodTypeBtnSelected: { borderColor: '#1a3a6b', backgroundColor: '#1a3a6b' },
  bloodTypeBtnText: { fontSize: 14, color: '#444', fontWeight: '600' },
  bloodTypeBtnTextSelected: { color: '#fff' },
  infoBox: { backgroundColor: '#e8f4fd', borderRadius: 10, padding: 12, marginBottom: 16 },
  infoText: { fontSize: 13, color: '#0066cc', lineHeight: 18 },
  saveBtnContainer: { backgroundColor: '#fff', paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: '#E0E4EE' },
  saveBtn: { backgroundColor: '#1a3a6b', borderRadius: 10, padding: 16, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
