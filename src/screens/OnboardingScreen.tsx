import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { saveProfile, addMedication, addReminder, addContact, setKV } from '../database/db';
import { scheduleReminder } from '../services/notifications';

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const RELATIONSHIPS = ['Familiar', 'Amigo(a)', 'Cônjuge', 'Médico(a)'];

type Props = { onComplete: () => void };

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <View style={s.dots}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[s.dot, i < current && s.dotDone, i === current && s.dotActive]} />
      ))}
    </View>
  );
}

function FieldHint({ text }: { text: string }) {
  return <Text style={s.fieldHint}>{text}</Text>;
}

function Chips({ options, selected, onSelect }: { options: string[]; selected: string; onSelect: (v: string) => void }) {
  return (
    <View style={s.chips}>
      {options.map(o => (
        <TouchableOpacity
          key={o}
          style={[s.chip, selected === o && s.chipSelected]}
          onPress={() => onSelect(selected === o ? '' : o)}
        >
          <Text style={[s.chipText, selected === o && s.chipTextSelected]}>{o}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── STEP 0 — BOAS-VINDAS ────────────────────────────────────────────────────

function WelcomeStep({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.screen, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={s.welcomeBody}>
        <Text style={s.welcomeIcon}>💊</Text>
        <Text style={s.welcomeTitle}>Bem-vindo ao{'\n'}MedAlert</Text>
        <Text style={s.welcomeSubtitle}>
          Seu assistente pessoal de saúde.{'\n'}
          Em menos de 2 minutos você terá tudo configurado.
        </Text>

        <View style={s.welcomeCards}>
          <View style={s.welcomeCard}>
            <Text style={s.welcomeCardIcon}>👤</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.welcomeCardTitle}>Perfil médico</Text>
              <Text style={s.welcomeCardDesc}>Tipo sanguíneo e alergias acessíveis em emergências</Text>
            </View>
          </View>
          <View style={s.welcomeCard}>
            <Text style={s.welcomeCardIcon}>💊</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.welcomeCardTitle}>Lembretes de medicamentos</Text>
              <Text style={s.welcomeCardDesc}>Nunca mais esqueça de tomar um remédio</Text>
            </View>
          </View>
          <View style={s.welcomeCard}>
            <Text style={s.welcomeCardIcon}>📞</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.welcomeCardTitle}>Contato de emergência</Text>
              <Text style={s.welcomeCardDesc}>Ligue para alguém de confiança com um toque</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={s.welcomeActions}>
        <TouchableOpacity style={s.primaryBtn} onPress={onStart}>
          <Text style={s.primaryBtnText}>Começar configuração →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.skipLink} onPress={onSkip}>
          <Text style={s.skipLinkText}>Já conheço o app, pular</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── STEP 1 — PERFIL ────────────────────────────────────────────────────────

function ProfileStep({ onNext, onSkip }: { onNext: (name: string, bt: string, al: string) => void; onSkip: () => void }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [bloodType, setBloodType] = useState('');
  const [allergies, setAllergies] = useState('');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.screen}
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.stepHeader}>
          <ProgressDots current={0} total={3} />
          <TouchableOpacity onPress={onSkip} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.skipText}>Pular</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.stepIcon}>👤</Text>
        <Text style={s.stepTitle}>Seu Perfil Médico</Text>
        <Text style={s.stepSubtitle}>
          Estas informações ficam salvas apenas no seu celular e aparecem na tela de bloqueio caso seja necessário em alguma emergência médica.
        </Text>

        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>Como você se chama?</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="Nome completo"
            placeholderTextColor="#B0B7C3"
            autoCapitalize="words"
            returnKeyType="next"
          />
          <FieldHint text="Usado para identificação em prontos-socorros e na tela de emergência do app." />
        </View>

        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>Tipo sanguíneo</Text>
          <Chips options={BLOOD_TYPES} selected={bloodType} onSelect={setBloodType} />
          <FieldHint text="Essencial para transfusões de emergência. Deixe em branco se não souber." />
        </View>

        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>Alergias conhecidas</Text>
          <TextInput
            style={[s.input, s.inputMulti]}
            value={allergies}
            onChangeText={setAllergies}
            placeholder="Ex: Dipirona, Penicilina, látex..."
            placeholderTextColor="#B0B7C3"
            multiline
            autoCapitalize="sentences"
          />
          <FieldHint text="Alertas exibidos em destaque na tela de emergência para que médicos evitem esses medicamentos." />
        </View>

        <TouchableOpacity
          style={[s.primaryBtn, { marginTop: 24 }]}
          onPress={() => onNext(name, bloodType, allergies)}
        >
          <Text style={s.primaryBtnText}>Continuar →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── STEP 2 — MEDICAMENTO ───────────────────────────────────────────────────

function MedicationStep({ onNext, onSkip }: { onNext: (name: string, dose: string, time: Date) => void; onSkip: () => void }) {
  const insets = useSafeAreaInsets();
  const [medName, setMedName] = useState('');
  const [dose, setDose] = useState('');
  const [time, setTime] = useState(() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d; });
  const [showPicker, setShowPicker] = useState(false);

  const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.screen}
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.stepHeader}>
          <ProgressDots current={1} total={3} />
          <TouchableOpacity onPress={onSkip} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.skipText}>Pular</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.stepIcon}>💊</Text>
        <Text style={s.stepTitle}>Primeiro Medicamento</Text>
        <Text style={s.stepSubtitle}>
          Adicione o medicamento que você toma com mais frequência. Você pode adicionar mais depois.
        </Text>

        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>Nome do medicamento</Text>
          <TextInput
            style={s.input}
            value={medName}
            onChangeText={setMedName}
            placeholder="Ex: Losartana, Metformina..."
            placeholderTextColor="#B0B7C3"
            autoCapitalize="words"
            returnKeyType="next"
          />
          <FieldHint text="O MedAlert verifica interações entre seus medicamentos e te avisa sobre riscos." />
        </View>

        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>Dose</Text>
          <TextInput
            style={s.input}
            value={dose}
            onChangeText={setDose}
            placeholder="Ex: 50mg, 1 comprimido..."
            placeholderTextColor="#B0B7C3"
            autoCapitalize="none"
            returnKeyType="done"
          />
          <FieldHint text="Aparece na notificação de lembrete para você confirmar a dose certa." />
        </View>

        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>Horário do lembrete</Text>
          <TouchableOpacity style={s.timeBtn} onPress={() => setShowPicker(true)}>
            <Text style={s.timeBtnText}>{timeStr}</Text>
            <Text style={s.timeBtnIcon}>🕐</Text>
          </TouchableOpacity>
          {showPicker && (
            <DateTimePicker
              value={time}
              mode="time"
              is24Hour
              onChange={(e, d) => {
                setShowPicker(false);
                if (e.type === 'set' && d) setTime(d);
              }}
            />
          )}
          <FieldHint text="Você receberá uma notificação neste horário todos os dias." />
        </View>

        <TouchableOpacity
          style={[s.primaryBtn, { marginTop: 24 }]}
          onPress={() => onNext(medName, dose, time)}
        >
          <Text style={s.primaryBtnText}>Continuar →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── STEP 3 — CONTATO ───────────────────────────────────────────────────────

function ContactStep({ onNext, onSkip }: { onNext: (name: string, phone: string, rel: string) => void; onSkip: () => void }) {
  const insets = useSafeAreaInsets();
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [rel, setRel] = useState('Familiar');

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={s.screen}
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.stepHeader}>
          <ProgressDots current={2} total={3} />
          <TouchableOpacity onPress={onSkip} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={s.skipText}>Pular</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.stepIcon}>📞</Text>
        <Text style={s.stepTitle}>Contato de Emergência</Text>
        <Text style={s.stepSubtitle}>
          Em caso de emergência, este contato aparece em destaque para que você ou alguém próximo possa ligar imediatamente.
        </Text>

        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>Nome do contato</Text>
          <TextInput
            style={s.input}
            value={contactName}
            onChangeText={setContactName}
            placeholder="Ex: Ana (filha), Dr. Carlos..."
            placeholderTextColor="#B0B7C3"
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>

        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>Telefone</Text>
          <TextInput
            style={s.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="(11) 99999-9999"
            placeholderTextColor="#B0B7C3"
            keyboardType="phone-pad"
            returnKeyType="done"
          />
          <FieldHint text="Exibido na tela de emergência com botão para ligar com um toque." />
        </View>

        <View style={s.fieldBlock}>
          <Text style={s.fieldLabel}>Relação</Text>
          <Chips options={RELATIONSHIPS} selected={rel} onSelect={v => setRel(v || 'Familiar')} />
        </View>

        <TouchableOpacity
          style={[s.primaryBtn, { marginTop: 24 }]}
          onPress={() => onNext(contactName, phone, rel)}
        >
          <Text style={s.primaryBtnText}>Continuar →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── STEP 4 — PRONTO ────────────────────────────────────────────────────────

function DoneStep({ summary, onComplete }: { summary: { profile: boolean; med: boolean; contact: boolean }; onComplete: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.screen, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>
      <Text style={s.doneIcon}>🎉</Text>
      <Text style={s.stepTitle}>Tudo pronto!</Text>
      <Text style={s.stepSubtitle}>Seu MedAlert está configurado e pronto para te ajudar.</Text>

      <View style={s.summaryCards}>
        <View style={[s.summaryCard, summary.profile && s.summaryCardDone]}>
          <Text style={s.summaryCardIcon}>{summary.profile ? '✅' : '⭕'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.summaryCardTitle}>Perfil médico</Text>
            <Text style={s.summaryCardDesc}>{summary.profile ? 'Salvo com sucesso' : 'Pode preencher depois em Perfil'}</Text>
          </View>
        </View>
        <View style={[s.summaryCard, summary.med && s.summaryCardDone]}>
          <Text style={s.summaryCardIcon}>{summary.med ? '✅' : '⭕'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.summaryCardTitle}>Medicamento</Text>
            <Text style={s.summaryCardDesc}>{summary.med ? 'Lembrete agendado' : 'Pode adicionar depois em Medicamentos'}</Text>
          </View>
        </View>
        <View style={[s.summaryCard, summary.contact && s.summaryCardDone]}>
          <Text style={s.summaryCardIcon}>{summary.contact ? '✅' : '⭕'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.summaryCardTitle}>Contato de emergência</Text>
            <Text style={s.summaryCardDesc}>{summary.contact ? 'Contato salvo' : 'Pode adicionar depois em Contatos'}</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={[s.primaryBtn, { marginTop: 32 }]} onPress={onComplete}>
        <Text style={s.primaryBtnText}>Ir para o app →</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

export default function OnboardingScreen({ onComplete }: Props) {
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [summary, setSummary] = useState({ profile: false, med: false, contact: false });

  async function finish() {
    await setKV('onboarding_done', '1');
    onComplete();
  }

  async function handleProfile(name: string, bt: string, al: string) {
    let saved = false;
    if (name.trim()) {
      await saveProfile({ name: name.trim(), blood_type: bt, allergies: al.trim(), notes: '', birth_date: '' }).catch(() => {});
      saved = true;
    }
    setSummary(p => ({ ...p, profile: saved }));
    setStep(2);
  }

  async function handleMedication(name: string, dose: string, time: Date) {
    let saved = false;
    if (name.trim()) {
      try {
        const h = time.getHours();
        const m = time.getMinutes();
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const medId = await addMedication({
          generic_name: name.trim(),
          commercial_name: '',
          dose: dose.trim(),
          frequency: 'daily',
          is_critical: false,
          notes: '',
          stock_quantity: null,
          end_date: null,
        });
        await addReminder({
          medication_id: medId,
          time: timeStr,
          period: 'day',
          with_sound: true,
          is_active: true,
          repeat_interval: 0,
        });
        await scheduleReminder(medId, name.trim(), dose.trim(), h, m, true, 0).catch(() => {});
        saved = true;
      } catch {}
    }
    setSummary(p => ({ ...p, med: saved }));
    setStep(3);
  }

  async function handleContact(name: string, phone: string, rel: string) {
    let saved = false;
    if (name.trim() && phone.trim()) {
      await addContact({
        name: name.trim(),
        phone: phone.trim(),
        relationship: rel,
        is_primary: true,
        is_doctor: rel.startsWith('Médico'),
      }).catch(() => {});
      saved = true;
    }
    setSummary(p => ({ ...p, contact: saved }));
    setStep(4);
  }

  if (step === 0) return <WelcomeStep onStart={() => setStep(1)} onSkip={finish} />;
  if (step === 1) return <ProfileStep onNext={handleProfile} onSkip={() => setStep(2)} />;
  if (step === 2) return <MedicationStep onNext={handleMedication} onSkip={() => setStep(3)} />;
  if (step === 3) return <ContactStep onNext={handleContact} onSkip={() => { setSummary(p => ({ ...p, contact: false })); setStep(4); }} />;
  return <DoneStep summary={summary} onComplete={finish} />;
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F2F4F8', paddingHorizontal: 24 },

  // Progress
  dots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D1D5DB' },
  dotActive: { width: 20, backgroundColor: '#1C3F7A' },
  dotDone: { backgroundColor: '#1C3F7A', opacity: 0.4 },

  stepHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 32,
  },
  skipText: { fontSize: 14, color: '#6B7280', fontWeight: '500' },

  stepIcon: { fontSize: 44, marginBottom: 12 },
  stepTitle: { fontSize: 26, fontWeight: '800', color: '#1A1F2E', marginBottom: 8, lineHeight: 32 },
  stepSubtitle: { fontSize: 15, color: '#6B7280', lineHeight: 22, marginBottom: 28 },

  fieldBlock: { marginBottom: 20 },
  fieldLabel: { fontSize: 15, fontWeight: '700', color: '#1A1F2E', marginBottom: 8 },
  fieldHint: { fontSize: 12, color: '#9CA3AF', marginTop: 6, lineHeight: 17 },

  input: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#E5E7EB',
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: '#1A1F2E',
  },
  inputMulti: { height: 90, textAlignVertical: 'top', paddingTop: 12 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E5E7EB',
  },
  chipSelected: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  chipTextSelected: { color: '#fff' },

  timeBtn: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1.5, borderColor: '#E5E7EB',
    paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
  },
  timeBtnText: { fontSize: 22, fontWeight: '700', color: '#1C3F7A' },
  timeBtnIcon: { fontSize: 20 },

  primaryBtn: {
    backgroundColor: '#1C3F7A', borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginHorizontal: 0,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  skipLink: { alignItems: 'center', paddingVertical: 14 },
  skipLinkText: { color: '#9CA3AF', fontSize: 14 },

  // Welcome
  welcomeBody: { flex: 1, paddingTop: 24 },
  welcomeIcon: { fontSize: 52, marginBottom: 16 },
  welcomeTitle: { fontSize: 32, fontWeight: '800', color: '#1A1F2E', lineHeight: 38, marginBottom: 10 },
  welcomeSubtitle: { fontSize: 16, color: '#6B7280', lineHeight: 24, marginBottom: 32 },
  welcomeCards: { gap: 12 },
  welcomeCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    borderWidth: 1, borderColor: '#E9ECF2',
  },
  welcomeCardIcon: { fontSize: 26, marginTop: 2 },
  welcomeCardTitle: { fontSize: 14, fontWeight: '700', color: '#1A1F2E', marginBottom: 3 },
  welcomeCardDesc: { fontSize: 12, color: '#6B7280', lineHeight: 17 },
  welcomeActions: { gap: 4 },

  // Done
  doneIcon: { fontSize: 52, marginBottom: 16 },
  summaryCards: { gap: 10, marginTop: 24 },
  summaryCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    borderWidth: 1.5, borderColor: '#E9ECF2',
  },
  summaryCardDone: { borderColor: '#BBF7D0' },
  summaryCardIcon: { fontSize: 22 },
  summaryCardTitle: { fontSize: 14, fontWeight: '700', color: '#1A1F2E', marginBottom: 2 },
  summaryCardDesc: { fontSize: 12, color: '#6B7280' },
});
