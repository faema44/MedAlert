import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, Switch, Alert, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard,
  InteractionManager, Image,
} from 'react-native';
import PickerDataHora from '../components/PickerDataHora';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getMedications, addMedication, updateMedication, archiveMedication,
  getRemindersForMedication, addReminder, deleteReminder, updateAllRemindersSound, updateMedicationStock,
  setMedicationSuspended,
} from '../database/db';
import {
  scheduleReminderWeekly, scheduleReminderMonthly, scheduleReminderEveryNMonths,
} from '../services/notifications';
import { getProfile } from '../database/db';
import {
  updateEmergencyNotification,
  scheduleReminder, cancelAllRemindersForMedication, notifyLowStock,
  rescheduleRemindersForMedication, relatarFalhaSilenciosa,
} from '../services/notifications';
import { syncMedicalIdReminder } from '../services/medicalId';
import { syncCaregiverSchedule } from '../services/caregiver';
import * as Sentry from '@sentry/react-native';
import { Medication, MedicationReminder } from '../types';
import { DrugSuggestion, getSuggestions, getBulaUrl, getPhytoBulaUrl, isPhytotherapic, nomeDaBaseParaBula } from '../utils/drugSearch';
import { cicloDoMedicamento, cycleState, ancoraPorDiaAtual, validarCiclo, diasDeEstoque } from '../utils/medCycle';
import { tirarFoto, escolherFoto, apagarFoto, temFoto, consolidarFoto } from '../services/fotoMedicamento';
import { FotoMini, ModalFoto } from '../components/FotoMedicamento';
import { useBulaViewer } from '../utils/useBulaViewer';
import { reportMissingDrug } from '../services/reportMissing';
// ──────────────────────────────────────────────────────────────────────────────

const IS_IOS = Platform.OS === 'ios';

const EMPTY_MED: Omit<Medication, 'id'> = {
  generic_name: '', commercial_name: '', dose: '', frequency: '', notes: '',
  stock_quantity: null, units_per_dose: 1, end_date: null, home_reminder: 1, save_history: 1,
};

function formatEndDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function daysRemaining(iso: string): number {
  const end = new Date(iso + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const TIMES_PER_DAY_OPTIONS = [1, 2, 3, 4, 6];
const DOSE_UNITS = ['mg', 'g', 'mcg', 'UI', 'mL', 'gotas', '%', 'cáps'];
type ReminderPeriod = 'day' | 'week' | 'month' | 'year';
type WizardStep = 'type' | 'name' | 'dose' | 'period' | 'cycle_preset' | 'cycle_setup' | 'times_per_day' | 'weekdays' | 'month_days' | 'n_months' | 'time' | 'deadline' | 'sound' | 'stock' | 'summary';

// Presets do ritmo com pausa. O passo 2 pergunta QUAL TRATAMENTO, não "diário ou semanal?",
// porque o anel não cabe nessa pergunta: ele é 1 colocação por ciclo mais uma retirada.
// Os números vêm prontos — num remédio em que errar custa gravidez, o padrão certo de fábrica
// vale mais que um formulário em branco. "Outro" existe para corticoide cíclico, reposição
// hormonal e quimio não virarem cidadãos de segunda classe num card rotulado de cartela.
const CYCLE_PRESETS = [
  { kind: 'pill'   as const, icon: '💊', label: 'Cartela / pílula', hint: 'Todo dia · 21 tomando + 7 de pausa', on: 21, off: 7, period: 'day'  as ReminderPeriod },
  { kind: 'patch'  as const, icon: '🩹', label: 'Adesivo',          hint: '1 por semana · 3 semanas + 1 de pausa', on: 21, off: 7, period: 'week' as ReminderPeriod },
  { kind: 'ring'   as const, icon: '⭕', label: 'Anel',             hint: 'Coloca e retira · 21 dias + 7 de pausa', on: 21, off: 7, period: 'day'  as ReminderPeriod },
  { kind: 'custom' as const, icon: '⚙️', label: 'Outro tratamento com pausa', hint: 'Você escolhe os dias', on: 21, off: 7, period: 'day' as ReminderPeriod },
];

const WEEKDAYS = [
  { label: 'Dom', value: 1 }, { label: 'Seg', value: 2 }, { label: 'Ter', value: 3 },
  { label: 'Qua', value: 4 }, { label: 'Qui', value: 5 }, { label: 'Sex', value: 6 },
  { label: 'Sáb', value: 7 },
];

function periodLabel(period: string, time: string): string {
  if (!period || period === 'day') return time;
  if (period.startsWith('week:')) {
    const labels = period.split(':')[1].split(',').map(v => WEEKDAYS.find(w => w.value === Number(v))?.label ?? '').join(', ');
    return `${time} · ${labels}`;
  }
  if (period.startsWith('month:')) return `${time} · dias ${period.split(':')[1]}/mês`;
  if (period.startsWith('nmonths:')) {
    const [, n, d] = period.split(':');
    return `${time} · dia ${d}, a cada ${n} mês${Number(n) > 1 ? 'es' : ''}`;
  }
  return time;
}

function fmtHM(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function computeTimes(startTime: string, timesPerDay: number): string[] {
  if (!startTime) return [];
  const parts = startTime.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (isNaN(h) || isNaN(m) || h > 23 || m > 59) return [];
  const intervalMin = Math.round((24 * 60) / timesPerDay);
  return Array.from({ length: timesPerDay }, (_, i) => {
    const total = ((h * 60 + m) + i * intervalMin) % (24 * 60);
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  });
}

function getStepSequence(
  period: ReminderPeriod,
  isNew: boolean,
  skipTime = false,
  comPausa = false,
  cycleKind: 'pill' | 'patch' | 'ring' | 'custom' = 'pill',
): WizardStep[] {
  const base: WizardStep[] = isNew
    ? ['type', 'name', 'dose', 'period']
    : ['name', 'dose', 'period'];
  // Com pausa, os dois passos do ciclo entram ANTES da frequência: é o preset que decide se
  // depois vem "vezes por dia" (pílula, anel) ou "dias da semana" (adesivo).
  if (comPausa) base.push('cycle_preset', 'cycle_setup');
  if (period === 'day') base.push('times_per_day');
  else if (period === 'week') base.push('weekdays');
  else if (period === 'month') base.push('month_days');
  else base.push('n_months');
  if (!skipTime) base.push('time');
  // Cartela/adesivo/anel recomeçam sozinhos — são indefinidos. Um prazo aqui arquivaria o
  // tratamento no meio de um ciclo ativo. "Outro" cobre corticoide/reposição hormonal/quimio,
  // que TÊM fim real, então mantém o passo.
  if (!(comPausa && cycleKind !== 'custom')) base.push('deadline');
  base.push('sound', 'stock');
  return base;
}

export default function MedicationsScreen() {
  const { openBula, modal: bulaModal } = useBulaViewer();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_MED);
  const [suggestions, setSuggestions] = useState<DrugSuggestion[]>([]);
  const [knownDrug, setKnownDrug] = useState<boolean>(false);
  const [customNameConfirmed, setCustomNameConfirmed] = useState<boolean>(false);
  const [commercialSuggestions, setCommercialSuggestions] = useState<DrugSuggestion[]>([]);
  const [entryType, setEntryType] = useState<'medicamento' | 'fitoterapico'>('medicamento');
  const [editingId, setEditingId] = useState<number | null>(null);
  // Interações aguardando o aceite do termo. O detalhe só abre depois do consentimento.
  const [stockInput, setStockInput] = useState('');
  const [unitsPerDoseInput, setUnitsPerDoseInput] = useState('1');
  // Dose em "cáps" já é a contagem por dose. Enquanto o usuário não ajustar este campo
  // à mão, ele segue a dose; depois de tocado, a dose não sobrescreve mais.
  const [unitsPerDoseTouched, setUnitsPerDoseTouched] = useState(false);
  const [durationDays, setDurationDays] = useState('');
  const [hasDeadline, setHasDeadline] = useState(false);
  // No cadastro novo os botões Sim/Não só acendem depois que o usuário toca
  // (na edição vêm acesos refletindo o que está salvo)
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [soundTouched, setSoundTouched] = useState(false);
  const [repeatTouched, setRepeatTouched] = useState(false);
  const [showStockHelp, setShowStockHelp] = useState(false);
  // Snapshot do resumo tirado quando os lembretes terminam de carregar na edição —
  // usado só pra marcar visualmente o que mudou e ainda não foi salvo.
  const [editSnapshot, setEditSnapshot] = useState<Record<string, string> | null>(null);
  const [homeReminderEnabled, setHomeReminderEnabled] = useState(true);
  const homeReminderRef = useRef(true);
  const lockOnlyRef = useRef(false);
  const wizStepScrollRef = useRef<ScrollView>(null);
  // Horários de quando o picker de horário abriu — âncora fixa do deslocamento.
  const horariosAoAbrirRef = useRef('');

  // No iOS o picker é uma view INLINE: abrir empurra a roda (~216px) e o Confirmar para
  // baixo do footer, fora da tela — a pessoa gira a hora e fica presa sem ver o botão.
  // Rola até ONDE o picker nasceu (o próprio componente avisa, no onLayout), não até o
  // fim: rolar ao fim passa do picker onde ele não é o último elemento. A folga de 100px
  // deixa à vista o campo que a pessoa acabou de tocar.
  function revelarPicker(y: number) {
    wizStepScrollRef.current?.scrollTo({ y: Math.max(0, y - 100), animated: true });
  }

  // Wizard
  const [wizardStep, setWizardStep] = useState<WizardStep>('name');

  // Reminder / picker state
  const [reminderHasSound, setReminderHasSound] = useState<Map<number, boolean>>(new Map());
  const [reminderMeta, setReminderMeta] = useState<Map<number, { repeat: number; periodType: string }>>(new Map());
  const [reminders, setReminders] = useState<MedicationReminder[]>([]);
  const [pickerH, setPickerH] = useState<number | null>(null);
  const [pickerM, setPickerM] = useState<number | null>(null);
  const [customH, setCustomH] = useState<number | null>(null);
  const [customM, setCustomM] = useState<number | null>(null);
  const [showHorarioPicker, setShowHorarioPicker] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [doseValue, setDoseValue] = useState('');
  const [doseUnit, setDoseUnit] = useState('mg');
  const [doseUnitTouched, setDoseUnitTouched] = useState(false);
  const [timesPerDay, setTimesPerDay] = useState(1);
  const [timesPerDayTouched, setTimesPerDayTouched] = useState(false);
  const [reminderTimes, setReminderTimes] = useState<Map<number, string[]>>(new Map());
  const [customTimes, setCustomTimes] = useState('');
  const [specificModeActive, setSpecificModeActive] = useState(false);
  const [withSound, setWithSound] = useState(true);
  const [repeatInterval, setRepeatInterval] = useState(0);
  // Ritmo com pausa. `comPausa` é o que faz os dois passos do ciclo entrarem na sequência.
  const [comPausa, setComPausa] = useState(false);
  const [cycleKind, setCycleKind] = useState<'pill' | 'patch' | 'ring' | 'custom'>('pill');
  const [cycleOn, setCycleOn] = useState('21');
  const [cycleOff, setCycleOff] = useState('7');
  const [cycleDiaAtual, setCycleDiaAtual] = useState('1');
  // Caminho da foto enquanto o assistente está aberto. Só vai para o banco no salvar.
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  // Na RAIZ da tela, fora do Modal do assistente: o iOS só mostra um Modal por vez.
  const [fotoZoom, setFotoZoom] = useState<{ uri: string; nome: string } | null>(null);

  // O arquivo da foto é nomeado por id do medicamento, mas um cadastro NOVO ainda não tem id.
  // Um negativo estável resolve: o arquivo nasce com esse nome e é renomeado no salvar, sem
  // colidir com nenhum medicamento real.
  const fotoTempIdRef = useRef<number>(-Date.now());
  function fotoMedId(): number {
    return editingId ?? fotoTempIdRef.current;
  }

  /**
   * Um `onPress={async () => ...}` sem catch engole a rejeição: a pessoa toca, nada acontece,
   * e ela conclui que o app ignorou o toque. Foi assim que eu mesmo escondi a primeira falha
   * desta tela. Aqui o erro aparece na cara e vai para o Sentry.
   */
  async function pegarFoto(fn: (id: number) => Promise<string | null>) {
    try {
      const u = await fn(fotoMedId());
      if (u) setFotoUri(u);
    } catch (e: any) {
      relatarFalhaSilenciosa(`foto do medicamento ${fotoMedId()}`, e);
      Alert.alert('Não foi possível usar a foto', e?.message ?? 'Tente novamente.');
    }
  }
  const [reminderPeriod, setReminderPeriod] = useState<ReminderPeriod>('day');
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
  const [selectedMonthDays, setSelectedMonthDays] = useState<number[]>([]);
  const [nMonths, setNMonths] = useState('1');
  const [monthDay, setMonthDay] = useState('1');

  // Meal time mode for notifications
  const [mealMode, setMealMode] = useState(false);
  const [mealCafe, setMealCafe] = useState('');
  const [mealAlmoco, setMealAlmoco] = useState('');
  const [mealJanta, setMealJanta] = useState('');
  const [mealPickerTarget, setMealPickerTarget] = useState<number | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pickerDisplay = pickerH !== null ? fmtHM(pickerH, pickerM ?? 0) : '';
  const customInputDisplay = customH !== null ? fmtHM(customH, customM ?? 0) : '';
  const startTime = pickerDisplay;
  const computedTimes = useMemo(
    () => computeTimes(startTime, timesPerDay),
    [startTime, timesPerDay]
  );

  const route = useRoute<RouteProp<{ Medications: { openMedId?: number } }, 'Medications'>>();

  const loadExtras = useCallback((allMeds: Medication[]) => {
    InteractionManager.runAfterInteractions(async () => {
      try {
        // Suspensos ficam fora das interações e do card detalhado (card compacto)
        const meds = allMeds.filter(m => !m.suspended);
        const timesMap = new Map<number, string[]>();
        const soundMap = new Map<number, boolean>();
        const metaMap = new Map<number, { repeat: number; periodType: string }>();
        await Promise.all(meds.map(async (med) => {
          const rs = await getRemindersForMedication(med.id);
          const active = rs.filter(r => r.is_active);
          timesMap.set(med.id, active.map(r => periodLabel(r.period, r.time)));
          soundMap.set(med.id, active.some(r => r.with_sound));
          const first = active[0];
          const pt = !first ? 'day'
            : first.period === 'day' ? 'day'
            : first.period.startsWith('week:') ? 'week'
            : first.period.startsWith('month:') ? 'month'
            : first.period.startsWith('nmonths:') ? 'nmonths'
            : 'day';
          metaMap.set(med.id, { repeat: first?.repeat_interval ?? 0, periodType: pt });
        }));
        setReminderTimes(timesMap);
        setReminderHasSound(soundMap);
        setReminderMeta(metaMap);
      } catch {}
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let meds: Medication[] = [];
    try {
      meds = await getMedications(true);
      setMedications(meds);
    } catch {}
    setLoading(false);
    loadExtras(meds);
    return meds;
  }, [loadExtras]);

  useFocusEffect(useCallback(() => {
    const openId = route.params?.openMedId;
    load().then(meds => {
      if (openId) {
        const med = meds.find(m => m.id === openId);
        if (med) openEdit(med);
      }
    });
  }, [load, route.params?.openMedId]));

  async function syncNotification(allMeds: Medication[]) {
    // Suspensos não entram na ficha de emergência nem nas interações
    const meds = allMeds.filter(m => !m.suspended);
    try {
      const profile = await getProfile();
      if (profile?.name) await updateEmergencyNotification(profile, meds);
    } catch {}
    // iOS: se a pessoa usa o Medical ID, lembra que os remédios mudaram (no-op fora do iOS)
    await syncMedicalIdReminder(meds);
    // O cuidador precisa da agenda corrigida a CADA mudança de remédio — senão fica com a tabela
    // antiga e não cobra (nem mostra) o que mudou. No-op se ninguém acompanha; uma falha de rede
    // aqui não pode quebrar o salvar do remédio.
    try {
      await syncCaregiverSchedule();
    } catch (e: any) {
      console.warn('[cuidador] falha ao reenviar a agenda após mudança de remédio:', e?.code, e?.message);
      Sentry.captureException(e);
    }
  }

  function handleGenericNameChange(v: string) {
    // Update form immediately so the input feels responsive
    setForm(f => ({ ...f, generic_name: v }));
    setKnownDrug(false);
    setCustomNameConfirmed(false);

    // Debounce expensive operations (search + interactions) so they don't block every keystroke
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSuggestions(getSuggestions(v, 7, entryType === 'fitoterapico' ? 'Fitoterápico' : undefined));
      setCommercialSuggestions([]);
    }, 300);
  }

  function applySuggestion(s: DrugSuggestion) {
    Keyboard.dismiss();
    setForm(f => ({
      ...f,
      generic_name: s.genericName,
      commercial_name: f.commercial_name.trim() ? f.commercial_name : (s.brandName ?? ''),
    }));
    setSuggestions([]);
    setCommercialSuggestions([]);
    setKnownDrug(true);
    setCustomNameConfirmed(false);
  }

  function handleCommercialNameChange(v: string) {
    setForm(f => ({ ...f, commercial_name: v }));
    setSuggestions([]);
    const all = getSuggestions(v);
    setCommercialSuggestions(all.filter(s => s.isBrand));
  }

  function applyCommercialSuggestion(s: DrugSuggestion) {
    Keyboard.dismiss();
    setForm(f => ({
      ...f,
      commercial_name: s.brandName ?? s.genericName,
      generic_name: f.generic_name.trim() ? f.generic_name : s.genericName,
    }));
    setCommercialSuggestions([]);
  }

  async function handleDelete(id: number, name: string) {
    Alert.alert('Remover medicamento', `Deseja remover "${name}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover', style: 'destructive', onPress: async () => {
          await cancelAllRemindersForMedication(id).catch(() => {});
          await archiveMedication(id);
          const updated = await getMedications(true);
          setMedications(updated);
          await syncNotification(updated);
        },
      },
    ]);
  }

  async function handleSuspend() {
    if (editingId === null) return;
    const name = form.commercial_name.trim() || form.generic_name.trim();
    Alert.alert(
      'Colocar em stand-by',
      IS_IOS
        ? `"${name}" ficará pausado: sem alarmes e fora da lista da Ficha Médica. O setup fica guardado para quando você retomar.`
        : `"${name}" ficará pausado: sem alarmes, fora da tela de bloqueio e da ficha de emergência. O setup fica guardado para quando você retomar.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Suspender', onPress: async () => {
            const id = editingId;
            await setMedicationSuspended(id, true).catch(() => {});
            await cancelAllRemindersForMedication(id).catch(() => {});
            setShowModal(false);
            setEditingId(null);
            const updated = await getMedications(true);
            setMedications(updated);
            loadExtras(updated);
            await syncNotification(updated);
          },
        },
      ]
    );
  }

  async function handleResume(item: Medication) {
    await setMedicationSuspended(item.id, false).catch(() => {});
    const rs = await getRemindersForMedication(item.id).catch(() => [] as MedicationReminder[]);
    await rescheduleRemindersForMedication({ ...item, suspended: 0 }, rs).catch(() => {});
    const updated = await getMedications(true);
    setMedications(updated);
    loadExtras(updated);
    await syncNotification(updated);
  }

  async function refreshReminderTimes(medId: number) {
    const rs = await getRemindersForMedication(medId);
    const active = rs.filter(r => r.is_active);
    const times = active.map(r => periodLabel(r.period, r.time));
    const hasSound = active.some(r => r.with_sound);
    const first = active[0];
    const pt = !first ? 'day'
      : first.period === 'day' ? 'day'
      : first.period.startsWith('week:') ? 'week'
      : first.period.startsWith('month:') ? 'month'
      : first.period.startsWith('nmonths:') ? 'nmonths'
      : 'day';
    setReminderTimes(prev => new Map(prev).set(medId, times));
    setReminderHasSound(prev => new Map(prev).set(medId, hasSound));
    setReminderMeta(prev => new Map(prev).set(medId, { repeat: first?.repeat_interval ?? 0, periodType: pt }));
  }

  function resetPickerState() {
    setPickerH(null); setPickerM(null); setCustomH(null); setCustomM(null);
    setShowHorarioPicker(false); setShowCustomPicker(false);
    setTimesPerDay(1); setTimesPerDayTouched(false); setSpecificModeActive(false);
    setCustomTimes(''); setWithSound(true); setRepeatInterval(0); setReminderPeriod('day');
    setSelectedWeekdays([]); setSelectedMonthDays([]); setNMonths('1'); setMonthDay('1');
    setMealMode(false); setMealCafe(''); setMealAlmoco(''); setMealJanta(''); setMealPickerTarget(null);
  }

  function populatePickerFromReminders(rs: MedicationReminder[], mealModeSalvo = false) {
    const active = rs.filter(r => r.is_active);
    const first = active[0] ?? rs[0];
    if (!first) { resetPickerState(); return; }
    const [h, m] = first.time.split(':').map(Number);
    setPickerH(h); setPickerM(m);
    setCustomTimes(''); setCustomH(null); setCustomM(null);
    const p = first.period ?? 'day';
    if (p === 'day') {
      setReminderPeriod('day');
      const dayRs = rs.filter(r => (r.period ?? 'day') === 'day');
      setTimesPerDay(dayRs.length || 1);
      setTimesPerDayTouched(true);
      const dayTimes = dayRs.map(r => r.time.substring(0, 5));
      // Distribui os horários salvos nos campos de refeição pela hora do dia. Isto é
      // PALPITE (não dá para saber se 08:00 é café ou só "de 8 em 8h"), e por isso não
      // decide nada sozinho: quem diz que este remédio é de refeição é o meal_mode
      // gravado. O palpite só preenche os campos para eles não aparecerem vazios.
      setMealCafe(''); setMealAlmoco(''); setMealJanta('');
      for (const t of dayTimes) {
        const hh = parseInt(t.split(':')[0], 10);
        if (hh < 10) setMealCafe(t);
        else if (hh < 15) setMealAlmoco(t);
        else setMealJanta(t);
      }
      // Abre direto na tela das refeições, em vez de em "Vezes por dia" — onde qualquer
      // toque recalculava horários que a pessoa tinha escolhido um a um.
      setMealMode(mealModeSalvo);
      if (dayRs.length > 1) {
        setCustomTimes(dayTimes.join(' '));
        setPickerH(null); setPickerM(null);
      }
    } else if (p.startsWith('week:')) {
      setReminderPeriod('week');
      setSelectedWeekdays(p.split(':')[1].split(',').map(Number));
    } else if (p.startsWith('month:')) {
      setReminderPeriod('month');
      setSelectedMonthDays(p.split(':')[1].split(',').map(Number));
    } else if (p.startsWith('nmonths:')) {
      setReminderPeriod('year');
      const [, nStr, dStr] = p.split(':');
      setNMonths(nStr); setMonthDay(dStr);
    }
    setWithSound(rs.some(r => r.with_sound));
    setRepeatInterval(rs[0]?.repeat_interval ?? 0);
  }

  async function handleToggleSound(item: Medication) {
    const rs = await getRemindersForMedication(item.id);
    if (rs.length === 0) return;
    const currentHasSound = rs.some(r => r.is_active && r.with_sound);
    const newSound = !currentHasSound;
    await updateAllRemindersSound(item.id, newSound);
    await cancelAllRemindersForMedication(item.id).catch(() => {});
    for (const r of rs.filter(r => r.is_active)) {
      const [h, m] = r.time.split(':').map(Number);
      const p = r.period ?? 'day';
      try {
        const ri = r.repeat_interval ?? 0;
        const notifName = item.commercial_name.trim() || item.generic_name;
        const isHerbal = isPhytotherapic(item.generic_name);
        if (p === 'day') await scheduleReminder(item.id, notifName, item.dose, h, m, newSound, ri, undefined, undefined, isHerbal);
        else if (p.startsWith('week:')) await scheduleReminderWeekly(item.id, notifName, item.dose, p.split(':')[1].split(',').map(Number), h, m, newSound, ri, undefined, undefined, isHerbal);
        else if (p.startsWith('month:')) await scheduleReminderMonthly(item.id, notifName, item.dose, p.split(':')[1].split(',').map(Number), h, m, newSound, ri, undefined, undefined, isHerbal);
        else if (p.startsWith('nmonths:')) { const [, nStr, dStr] = p.split(':'); await scheduleReminderEveryNMonths(item.id, notifName, item.dose, Number(nStr), Number(dStr), h, m, newSound, ri, undefined, undefined, isHerbal); }
      } catch {}
    }
    setReminderHasSound(prev => new Map(prev).set(item.id, newSound));
  }

  function cicloValidoDoForm(): boolean {
    return validarCiclo({
      kind: cycleKind,
      daysOn: parseInt(cycleOn, 10),
      daysOff: parseInt(cycleOff, 10),
      anchor: ancoraPorDiaAtual(1),
    }) === null;
  }

  async function doSaveWizard() {
    try {
      const effectiveTime = startTime || '08:00';
      let newEntries: Omit<MedicationReminder, 'id'>[] = [];

      if (!lockOnlyRef.current) {
        if (reminderPeriod === 'day') {
          let times: string[] = [];
          if (customTimes.trim()) {
            const raw = customTimes.trim();
            const num = parseInt(raw, 10);
            if (!isNaN(num) && /^\d+$/.test(raw)) {
              times = computeTimes(effectiveTime, num);
            } else {
              times = raw.split(/[,\s]+/).map(t => t.trim()).filter(t => /^\d{1,2}:\d{2}$/.test(t));
            }
          } else {
            const ct = computeTimes(effectiveTime, timesPerDay);
            times = ct.length > 0 ? ct : [effectiveTime];
          }
          newEntries = times.map(time => ({
            medication_id: 0, time, period: 'day',
            with_sound: withSound, is_active: true, repeat_interval: repeatInterval,
          }));
        } else if (reminderPeriod === 'week') {
          newEntries = [{
            medication_id: 0, time: effectiveTime,
            period: `week:${selectedWeekdays.sort((a, b) => a - b).join(',')}`,
            with_sound: withSound, is_active: true, repeat_interval: repeatInterval,
          }];
        } else if (reminderPeriod === 'month') {
          newEntries = [{
            medication_id: 0, time: effectiveTime,
            period: `month:${selectedMonthDays.sort((a, b) => a - b).join(',')}`,
            with_sound: withSound, is_active: true, repeat_interval: repeatInterval,
          }];
        } else if (reminderPeriod === 'year') {
          newEntries = [{
            medication_id: 0, time: effectiveTime,
            period: `nmonths:${nMonths}:${monthDay}`,
            with_sound: withSound, is_active: true, repeat_interval: repeatInterval,
          }];
        }
      }

      const stockQty = stockInput.trim() ? parseInt(stockInput.trim(), 10) : null;
      const unitsPerDose = unitsPerDoseInput.trim() ? Math.max(1, parseInt(unitsPerDoseInput.trim(), 10)) : 1;
      const endDate = hasDeadline && durationDays.trim() ? addDays(parseInt(durationDays.trim(), 10)) : null;
      const data = {
        ...form,
        generic_name: form.generic_name.trim(),
        commercial_name: form.commercial_name.trim(),
        stock_quantity: stockQty,
        units_per_dose: unitsPerDose,
        end_date: endDate,
        home_reminder: homeReminderRef.current ? 1 : 0,
        save_history: 1,
        // Só vale para o esquema diário: "refeições" não existe em semanal/mensal, e
        // guardar 1 ali faria a edição abrir na tela errada.
        meal_mode: mealMode && reminderPeriod === 'day' ? 1 : 0,
        // As QUATRO colunas do ciclo, ou as quatro em NULL — nunca metade: cicloDoMedicamento
        // exige todas, e configuração pela metade seria dado corrompido que o app trataria
        // como "sem ciclo" (falha segura, mas silenciosa).
        photo_uri: fotoUri,
        ...(comPausa && cicloValidoDoForm()
          ? {
              cycle_kind: cycleKind,
              cycle_days_on: parseInt(cycleOn, 10),
              cycle_days_off: parseInt(cycleOff, 10),
              cycle_anchor: ancoraPorDiaAtual(
                Math.min(Math.max(parseInt(cycleDiaAtual, 10) || 1, 1),
                         (parseInt(cycleOn, 10) || 1) + (parseInt(cycleOff, 10) || 0)),
              ),
            }
          : { cycle_kind: null, cycle_days_on: null, cycle_days_off: null, cycle_anchor: null }),
      };

      let savedMedId: number;
      if (editingId !== null) {
        await updateMedication({ ...data, id: editingId });
        savedMedId = editingId;
        await cancelAllRemindersForMedication(savedMedId).catch(() => {});
        const existing = await getRemindersForMedication(savedMedId);
        for (const r of existing) await deleteReminder(r.id).catch(() => {});
      } else {
        savedMedId = await addMedication(data);
      }

      // A foto de um cadastro NOVO nasceu com id provisório: agora que o id existe, o arquivo
      // é renomeado e o caminho definitivo volta para o banco. Sem isto sobrariam órfãos.
      const fotoFinal = await consolidarFoto(savedMedId, fotoUri);
      if (fotoFinal !== (fotoUri ?? null)) {
        await updateMedication({ ...data, id: savedMedId, photo_uri: fotoFinal } as any).catch(() => {});
      }

      // Editando um medicamento em stand-by: grava os lembretes no banco mas não
      // agenda alarmes no sistema — o Retomar reagenda tudo
      const isSuspendedMed = editingId !== null &&
        !!medications.find(m => m.id === editingId)?.suspended;

      // Com pausa, NADA é agendado aqui: os gatilhos abaixo são os nativos que se repetem
      // sozinhos, e um DAILY numa cartela dispararia justamente na semana de descanso. Pior,
      // ficaria órfão — este caminho não cancela nada, e o reagendamento seguinte trata a
      // cartela por outra rota sem tocar no diário que sobrou. O agendamento correto sai
      // depois do laço, quando os lembretes já existem no banco.
      const temCiclo = cicloDoMedicamento(data as any) != null;

      for (const e of newEntries) {
        const [h, m] = e.time.split(':').map(Number);
        const p = e.period ?? 'day';
        const ri = e.repeat_interval ?? 0;
        if (!isSuspendedMed && !temCiclo) try {
          const notifName = data.commercial_name.trim() || data.generic_name;
          const isHerbal = isPhytotherapic(data.generic_name);
          if (p === 'day') await scheduleReminder(savedMedId, notifName, data.dose, h, m, e.with_sound, ri, undefined, undefined, isHerbal);
          else if (p.startsWith('week:')) await scheduleReminderWeekly(savedMedId, notifName, data.dose, p.split(':')[1].split(',').map(Number), h, m, e.with_sound, ri, undefined, undefined, isHerbal);
          else if (p.startsWith('month:')) await scheduleReminderMonthly(savedMedId, notifName, data.dose, p.split(':')[1].split(',').map(Number), h, m, e.with_sound, ri, undefined, undefined, isHerbal);
          else if (p.startsWith('nmonths:')) {
            const [, nStr, dStr] = p.split(':');
            await scheduleReminderEveryNMonths(savedMedId, notifName, data.dose, Number(nStr), Number(dStr), h, m, e.with_sound, ri, undefined, undefined, isHerbal);
          }
        } catch (err) { relatarFalhaSilenciosa(`agendar ${savedMedId} ${e.time} (${p})`, err); }
        // Se ESTA falhar, o medicamento fica salvo SEM lembrete — aparece na lista, com
        // horário na tela, e nunca toca. Não há como o usuário perceber.
        await addReminder({ medication_id: savedMedId, time: e.time, period: e.period, with_sound: e.with_sound, is_active: true, repeat_interval: ri })
          .catch(err => relatarFalhaSilenciosa(`gravar lembrete ${savedMedId} ${e.time}`, err));
      }

      // A cartela é agendada agora, pela rota que conhece a pausa, e só depois dos lembretes
      // existirem no banco — scheduleCartela lê os horários de lá.
      if (temCiclo && !isSuspendedMed) {
        const rs = await getRemindersForMedication(savedMedId).catch(() => [] as MedicationReminder[]);
        const salvo = (await getMedications(true)).find(mm => mm.id === savedMedId);
        if (salvo) {
          await rescheduleRemindersForMedication(salvo, rs)
            .catch(err => relatarFalhaSilenciosa(`agendar cartela ${savedMedId}`, err));
        }
      }

      const isNew = editingId === null;
      const updated = await getMedications(true);
      setMedications(updated);
      setShowModal(false);

      setSuggestions([]); setCommercialSuggestions([]);
      setEditingId(null); setKnownDrug(false);
      setStockInput(''); setUnitsPerDoseInput('1'); setDurationDays(''); setHasDeadline(false);
      setReminders([]); resetPickerState(); setWizardStep('name'); lockOnlyRef.current = false;
      await syncNotification(updated);
      await refreshReminderTimes(savedMedId).catch(() => {});

      if (isNew) {
        navigation.navigate('Medications' as never);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Erro ao salvar', msg);
    }
  }

  async function handleSave() {
    if (!form.generic_name.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome do medicamento.');
      return;
    }
    await doSaveWizard();
  }

  function parseDose(dose: string): { value: string; unit: string } {
    const parts = dose.trim().split(' ');
    const last = parts[parts.length - 1];
    if (parts.length > 1 && DOSE_UNITS.includes(last)) {
      return { value: parts.slice(0, -1).join(' '), unit: last };
    }
    return { value: dose, unit: 'mg' };
  }

  function openWizard() {
    setForm(EMPTY_MED);
    setDoseValue(''); setDoseUnit('mg'); setDoseUnitTouched(false);
    setEditingId(null);
    setSuggestions([]); setCommercialSuggestions([]);
    setEntryType('medicamento'); setKnownDrug(false); setCustomNameConfirmed(false);
    setReminders([]); setStockInput(''); setUnitsPerDoseInput('1'); setDurationDays(''); setHasDeadline(false);
    setDeadlineTouched(false); setSoundTouched(false); setRepeatTouched(false); setUnitsPerDoseTouched(false);
    homeReminderRef.current = true; setHomeReminderEnabled(true);
    lockOnlyRef.current = false;
    resetPickerState();
    setEditSnapshot(null);
    setWizardStep('type');
    setShowModal(true);
  }

  function openEdit(item: Medication) {
    setForm({
      generic_name: item.generic_name,
      commercial_name: item.commercial_name,
      dose: item.dose,
      frequency: item.frequency,
      notes: item.notes,
      stock_quantity: item.stock_quantity,
      units_per_dose: item.units_per_dose ?? 1,
      end_date: item.end_date,
    });
    const parsed = parseDose(item.dose);
    setDoseValue(parsed.value); setDoseUnit(parsed.unit); setDoseUnitTouched(!!item.dose);
    setStockInput(item.stock_quantity != null ? String(item.stock_quantity) : '');
    setUnitsPerDoseInput(String(item.units_per_dose ?? 1));
    // Diferente dos outros "touched": 1 é o default de quem nunca respondeu, então
    // um cadastro antigo com dose "4 cáps" e 1 aqui ainda aceita o preenchimento pela dose.
    setUnitsPerDoseTouched((item.units_per_dose ?? 1) > 1);
    setDurationDays(item.end_date ? String(Math.max(0, daysRemaining(item.end_date))) : '');
    setHasDeadline(!!item.end_date);
    // Edição: botões refletem o que está salvo, então já entram acesos
    setDeadlineTouched(true); setSoundTouched(true); setRepeatTouched(true);
    homeReminderRef.current = item.home_reminder !== 0; setHomeReminderEnabled(item.home_reminder !== 0);
    lockOnlyRef.current = false;
    setEditingId(item.id);
    setSuggestions([]); setCommercialSuggestions([]); setKnownDrug(true); setCustomNameConfirmed(false);
    setEntryType(isPhytotherapic(item.generic_name) ? 'fitoterapico' : 'medicamento');
    resetPickerState(); setReminders([]);
    // Reabre o ciclo como foi salvo. O "dia da cartela" é recalculado a partir da âncora —
    // guardar o dia digitado seria mentira uma semana depois.
    setFotoUri(item.photo_uri ?? null);
    const cicloSalvo = cicloDoMedicamento(item);
    setComPausa(cicloSalvo != null);
    if (cicloSalvo) {
      setCycleKind(cicloSalvo.kind);
      setCycleOn(String(cicloSalvo.daysOn));
      setCycleOff(String(cicloSalvo.daysOff));
      setCycleDiaAtual(String(cycleState(cicloSalvo).dayInCycle));
    } else {
      setCycleKind('pill'); setCycleOn('21'); setCycleOff('7'); setCycleDiaAtual('1');
    }
    setEditSnapshot(null);
    setWizardStep('summary');
    setShowModal(true);
    getRemindersForMedication(item.id).then(rs => {
      setReminders(rs);
      if (rs.length > 0) populatePickerFromReminders(rs, item.meal_mode === 1);
    }).catch(() => {});
  }

  function stepNeedsNext(): boolean {
    if (editingId !== null) {
      // Edição: resumo tem "Salvar"; passos de toque voltam sozinhos ao resumo
      switch (wizardStep) {
        case 'period':
          return false;
        case 'deadline':
          return hasDeadline;
        default:
          return true;
      }
    }
    switch (wizardStep) {
      case 'type':
      case 'period':
        return false;
      case 'times_per_day':
        return mealMode;
      case 'deadline':
        return hasDeadline;
      default:
        return true;
    }
  }

  // Edição via resumo: cada passo confirma e volta ao resumo, exceto o sub-fluxo
  // de frequência (period → dias/vezes → horário), que precisa encadear.
  function editNextStep(cur: WizardStep, p: ReminderPeriod): WizardStep {
    switch (cur) {
      case 'period':
        return p === 'day' ? 'times_per_day' : p === 'week' ? 'weekdays' : p === 'month' ? 'month_days' : 'n_months';
      case 'times_per_day':
        return mealMode ? 'summary' : 'time';
      case 'weekdays':
      case 'month_days':
      case 'n_months':
        return 'time';
      default:
        return 'summary';
    }
  }

  // overridePeriod: pass the new period when calling from the period tap handler,
  // because React state won't have updated yet at call time.
  function wizGoNext(overridePeriod?: ReminderPeriod, overrideComPausa?: boolean, overrideCycleKind?: typeof cycleKind) {
    const p = overridePeriod ?? reminderPeriod;
    const isNew = editingId === null;
    // overrideComPausa/overrideCycleKind: o setState do card ⏸ e do preset ainda não refletiu
    // quando wizGoNext roda no mesmo toque — sem passar o valor à mão, a sequência sairia
    // sem os passos do ciclo, ou decidindo o passo "deadline" com o preset velho.
    const seq = getStepSequence(p, isNew, mealMode, overrideComPausa ?? comPausa, overrideCycleKind ?? cycleKind);
    const idx = seq.indexOf(wizardStep);

    if (wizardStep === 'name' && !form.generic_name.trim()) {
      Alert.alert('Campo obrigatório', 'Informe o nome do medicamento.');
      return;
    }
    // Silently report drug names not found in the local database
    if (wizardStep === 'name' && !knownDrug && form.generic_name.trim().length >= 3) {
      reportMissingDrug(form.generic_name.trim()).catch(() => {});
    }
    if (wizardStep === 'times_per_day' && mealMode) {
      const times = [mealCafe, mealAlmoco, mealJanta].filter(t => /^\d{1,2}:\d{2}$/.test(t));
      if (times.length === 0) {
        Alert.alert('Obrigatório', 'Informe ao menos um horário.');
        return;
      }
      setCustomTimes(times.join(' '));
      setTimesPerDay(times.length);
      setTimesPerDayTouched(true);
    }
    if (wizardStep === 'weekdays' && selectedWeekdays.length === 0) {
      Alert.alert('Selecione', 'Selecione ao menos um dia da semana.');
      return;
    }
    if (wizardStep === 'month_days' && selectedMonthDays.length === 0) {
      Alert.alert('Selecione', 'Selecione ao menos um dia do mês.');
      return;
    }
    // Na edição com vários horários/dia o picker pode estar vazio (customTimes cobre)
    if (wizardStep === 'time' && pickerH === null && !customTimes.trim()) {
      Alert.alert('Obrigatório', 'Defina o horário do primeiro aviso.');
      return;
    }
    // Passar batido aqui deixava o remédio SEM repetição — o padrão mais arriscado sendo o
    // resultado de não escolher nada. Repete só se pergunta quando há som ("Não" no som já
    // zera o intervalo e desliga o botão).
    if (wizardStep === 'sound' && !soundTouched) {
      Alert.alert('Obrigatório', 'Escolha se o lembrete toca alarme sonoro.');
      return;
    }
    if (wizardStep === 'sound' && withSound && !repeatTouched) {
      Alert.alert('Obrigatório', 'Escolha se o alarme repete até você responder.');
      return;
    }

    if (!isNew) {
      setWizardStep(editNextStep(wizardStep, p));
      return;
    }

    if (idx >= seq.length - 1) {
      handleSave();
    } else {
      setWizardStep(seq[idx + 1]);
    }
  }

  function wizGoBack() {
    if (editingId !== null) {
      if (wizardStep === 'summary') setShowModal(false);
      else setWizardStep('summary');
      return;
    }
    const isNew = editingId === null;
    const seq = getStepSequence(reminderPeriod, isNew, mealMode, comPausa, cycleKind);
    const idx = seq.indexOf(wizardStep);
    if (idx <= 0) {
      setShowModal(false);
    } else {
      setWizardStep(seq[idx - 1]);
    }
  }

  function computeSummaryRows(): { icon: string; label: string; value: string; step: WizardStep; warn?: string }[] {
    const schedText = (() => {
      if (reminderPeriod === 'week' && selectedWeekdays.length > 0) {
        const days = selectedWeekdays.slice().sort((a, b) => a - b).map(v => WEEKDAYS.find(w => w.value === v)?.label).filter(Boolean).join(', ');
        return `Semanal · ${days}${pickerDisplay ? ` · ${pickerDisplay}` : ''}`;
      }
      if (reminderPeriod === 'month' && selectedMonthDays.length > 0) {
        return `Mensal · dias ${selectedMonthDays.slice().sort((a, b) => a - b).join(', ')}${pickerDisplay ? ` · ${pickerDisplay}` : ''}`;
      }
      if (reminderPeriod === 'year') {
        return `A cada ${nMonths} ${Number(nMonths) > 1 ? 'meses' : 'mês'} · dia ${monthDay}${pickerDisplay ? ` · ${pickerDisplay}` : ''}`;
      }
      const times = customTimes.trim()
        ? customTimes.trim().split(/\s+/).filter(t => /^\d{1,2}:\d{2}$/.test(t))
        : (pickerDisplay ? computeTimes(startTime, timesPerDay) : []);
      // "Refeições" só é dito quando o meal_mode foi GRAVADO. Não se deduz da hora:
      // 07:00/12:00/19:00 e 08:00/14:00/20:00 são indistinguíveis pelo relógio.
      if (times.length > 0) return `${mealMode ? '🍽 Refeições' : 'Diário'} · ${times.join(' · ')}`;
      return IS_IOS ? 'Sem lembrete — só na Ficha Médica' : 'Sem lembrete — só tela de bloqueio';
    })();
    const deadlineDays = parseInt(durationDays, 10);
    // Rede de segurança pro cadastro salvo antes disto existir: dose em cáps e o estoque
    // ainda no default 1 que ninguém respondeu. Não bloqueia o Salvar, só mostra a
    // contradição no item que a resolve. Quem respondeu outro número respondeu de propósito
    // — avisar aí seria um alarme que o usuário não tem como calar.
    const doseCaps = doseUnit === 'cáps' ? parseInt(doseValue.trim(), 10) : NaN;
    const units = parseInt(unitsPerDoseInput.trim(), 10) || 1;
    const stockWarn = !!stockInput.trim() && doseCaps > 1 && units === 1
      ? `A dose diz ${doseCaps} cáps, mas o estoque desconta 1 por vez.`
      : undefined;
    // Cartela/adesivo/anel são indefinidos (recomeçam sozinhos) — a linha de prazo some do
    // resumo pelo mesmo motivo que some do wizard: ver getStepSequence.
    const mostraDeadline = !(comPausa && cycleKind !== 'custom');
    return [
      { icon: '💊', label: 'Nome', value: form.commercial_name.trim() ? `${form.commercial_name.trim()} — ${form.generic_name}` : form.generic_name, step: 'name' },
      { icon: '⚖️', label: 'Dose e observações', value: [form.dose, form.notes].filter(Boolean).join('  ·  ') || 'Não informada', step: 'dose' },
      { icon: '🗓', label: 'Frequência e horários', value: schedText, step: 'period' },
      ...(mostraDeadline ? [{ icon: '📅', label: 'Prazo do tratamento', value: hasDeadline && !isNaN(deadlineDays) ? `${deadlineDays} dia${deadlineDays !== 1 ? 's' : ''} · termina ${formatEndDate(addDays(deadlineDays))}` : 'Sem prazo', step: 'deadline' as WizardStep }] : []),
      { icon: withSound ? '🔔' : '🔕', label: 'Alarme', value: `${withSound ? 'Sim' : 'Não'}  ·  Repete: ${repeatInterval > 0 ? 'Sim' : 'Não'}`, step: 'sound' },
      { icon: '📦', label: 'Estoque', value: stockInput.trim() ? `${stockInput.trim()} restantes  ·  1 dose = ${unitsPerDoseInput.trim() || '1'}` : 'Sem controle de estoque', step: 'stock', warn: stockWarn },
    ];
  }

  // Tira o snapshot do resumo assim que os lembretes carregam numa edição —
  // é o que dá pra comparar depois pra marcar o que o usuário alterou e ainda não salvou.
  useEffect(() => {
    if (editingId === null || !showModal) return;
    const snap: Record<string, string> = {};
    computeSummaryRows().forEach(r => { snap[r.step] = r.value; });
    setEditSnapshot(snap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminders]);

  // "4 cáps" na dose já respondeu quantas unidades saem do estoque por vez — perguntar de
  // novo aqui é o que deixava a dose dizendo 4 e o estoque descontando 1. Só vale pra "cáps":
  // "500 mg" pode ser 1 comprimido de 500 ou 2 de 250, e aí a pergunta continua necessária.
  useEffect(() => {
    if (wizardStep !== 'stock' || unitsPerDoseTouched || doseUnit !== 'cáps') return;
    const n = parseInt(doseValue.trim(), 10);
    if (n >= 1) setUnitsPerDoseInput(String(n));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep]);

  function renderWizardStep() {
    switch (wizardStep) {
      case 'type':
        return (
          <>
            <Text style={styles.wizLabel}>O que deseja adicionar?</Text>
            <View style={[styles.yesNoRow, { marginTop: 24, flexDirection: 'column', gap: 16 }]}>
              <TouchableOpacity
                style={styles.typeCardBtn}
                onPress={() => { setEntryType('medicamento'); setSuggestions([]); setForm(f => ({ ...f, generic_name: '' })); wizGoNext(); }}
              >
                <Text style={styles.typeCardIcon}>💊</Text>
                <Text style={styles.typeCardText}>Medicamento</Text>
                <Text style={styles.typeCardHint}>Prescritos ou de uso contínuo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.typeCardBtn}
                onPress={() => { setEntryType('fitoterapico'); setSuggestions([]); setForm(f => ({ ...f, generic_name: '' })); wizGoNext(); }}
              >
                <Text style={styles.typeCardIcon}>🌿</Text>
                <Text style={styles.typeCardText}>Fitoterápico</Text>
                <Text style={styles.typeCardHint}>Plantas medicinais e suplementos</Text>
              </TouchableOpacity>
            </View>
          </>
        );

      case 'name':
        return (
          <>
            <Text style={styles.wizLabel}>{entryType === 'fitoterapico' ? 'Nome do fitoterápico' : 'Nome do medicamento'}</Text>
            <Text style={styles.wizHint}>Digite o nome genérico ou comercial</Text>

            <View style={[styles.fieldLabelRow, { marginTop: 14 }]}>
              {form.generic_name.length >= 2 && suggestions.length === 0 && !knownDrug && !customNameConfirmed && (
                <ActivityIndicator size="small" color="#1C3F7A" style={{ marginLeft: 2, marginRight: 6 }} />
              )}
            </View>
            {/* autoCorrect OFF não é preferência: nome de remédio nunca está no dicionário, então
                o corretor do iOS só pode errar. E ele corrompia em silêncio — o Keyboard.dismiss()
                do applySuggestion CONFIRMA a correção pendente, que dispara onChangeText por cima
                do nome que a sugestão acabou de gravar (digitar "dexa" + tocar em "Dexametasona"
                salvava "deixa"). Ver applySuggestion. */}
            <TextInput
              style={[styles.fieldInput, styles.wizBigInput]}
              value={form.generic_name}
              onChangeText={handleGenericNameChange}
              autoCapitalize="words"
              autoCorrect={false}
              spellCheck={false}
              placeholder={entryType === 'fitoterapico' ? 'Ex: Ginkgo Biloba...' : 'Ex: Losartana...'}
              placeholderTextColor="#bbb"
            />

            {/* Sugestões LOGO ABAIXO do campo (não presas no rodapé): antes elas renderizavam
                no fim do modal, separadas do input pelos botões Voltar/Próximo — num aparelho
                grande, longe demais pra parecerem ligadas ao que se digita. O passo é curto, então
                o campo fica no topo e as sugestões vêm acima do teclado. Mesmo padrão do fitoterápico. */}
            {entryType !== 'fitoterapico' && !knownDrug && !customNameConfirmed
              && form.generic_name.trim().length >= 2 && (
              <View style={styles.suggestionsInline}>
                {suggestions.map(s => (
                  <View key={s.label} style={styles.suggestionRow}>
                    <TouchableOpacity
                      style={[styles.suggestionChip, s.isBrand && styles.suggestionChipBrand]}
                      onPress={() => applySuggestion(s)}
                    >
                      <Text style={[styles.suggestionChipText, s.isBrand && styles.suggestionChipTextBrand]} numberOfLines={1}>
                        {s.label}
                      </Text>
                      {s.category ? (
                        <Text style={[styles.suggestionCategory, s.isBrand && styles.suggestionCategoryBrand]}>
                          {s.category}
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.bulaBtn} onPress={() => openBula(s.bulaUrl, s.genericName)} accessibilityLabel={`Ver bula de ${s.genericName}`} accessibilityRole="button">
                      <Text style={styles.bulaBtnText}>📋</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                {/* Card com o nome exatamente como digitado — dá segurança a quem não acha o remédio na lista.
                    Fica sempre disponível (mesmo com nome igual a alguma sugestão) porque o usuário pode
                    ainda estar completando o nome com um complemento/tipo diferente.
                    O nome continua sendo reportado ao Google Drive (via wizGoNext) para entrarmos com ele no BD.
                    Se o nome digitado bate exatamente com uma sugestão, tocar aqui aplica a sugestão do BD
                    (não o texto digitado), pra não reportar como "não encontrado" por engano. */}
                <View style={styles.suggestionRow}>
                  <TouchableOpacity
                    style={[styles.suggestionChip, styles.suggestionChipTyped]}
                    onPress={() => {
                      const typed = form.generic_name.trim().toLowerCase();
                      const exactMatch = suggestions.find(
                        s => s.label.toLowerCase() === typed || s.genericName.toLowerCase() === typed
                      );
                      if (exactMatch) { applySuggestion(exactMatch); return; }
                      Keyboard.dismiss(); setCustomNameConfirmed(true);
                    }}
                  >
                    <Text style={[styles.suggestionChipText, styles.suggestionChipTextTyped]} numberOfLines={1}>
                      {form.generic_name.trim()}
                    </Text>
                    <Text style={[styles.suggestionCategory, styles.suggestionCategoryTyped]}>
                      Digitado
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {entryType === 'fitoterapico' && form.generic_name.length > 0 && (() => {
              const phytoList = getSuggestions(form.generic_name, 34, 'Fitoterápico');
              const typed = form.generic_name.trim().toLowerCase();
              const exactMatch = phytoList.find(
                p => p.genericName.toLowerCase() === typed || (p.firstBrand ?? '').toLowerCase() === typed
              );
              return (
                <View style={styles.phytoGrid}>
                  {phytoList.map(p => {
                    const popular = p.firstBrand ?? p.genericName;
                    const scientific = p.genericName.replace(/\s*\(.*\)/, '').trim();
                    return (
                      <TouchableOpacity key={p.genericName} style={styles.phytoCard} onPress={() => applySuggestion(p)}>
                        <Text style={styles.phytoCardName} numberOfLines={2}>{popular}</Text>
                        <Text style={styles.phytoCardScientific} numberOfLines={1}>{scientific}</Text>
                      </TouchableOpacity>
                    );
                  })}
                  {/* Card com o nome exatamente como digitado — mesma lógica do fluxo de medicamento:
                      fica sempre disponível, mesmo com nome igual a alguma sugestão, pois o usuário pode
                      estar completando o nome. Continua sendo reportado ao Google Drive ao avançar.
                      Se o nome digitado bate exatamente com um item do BD, tocar aqui aplica o item do BD
                      (não o texto digitado), pra não reportar como "não encontrado" por engano. */}
                  {!knownDrug && !customNameConfirmed && (
                    <TouchableOpacity
                      style={[styles.phytoCard, styles.phytoCardTyped]}
                      onPress={() => {
                        if (exactMatch) { applySuggestion(exactMatch); return; }
                        Keyboard.dismiss(); setCustomNameConfirmed(true);
                      }}
                    >
                      <Text style={[styles.phytoCardName, styles.phytoCardNameTyped]} numberOfLines={2}>{form.generic_name.trim()}</Text>
                      <Text style={[styles.phytoCardScientific, styles.phytoCardScientificTyped]}>Digitado</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}
          </>
        );

      case 'dose':
        return (
          <>
            <Text style={styles.wizLabel}>Dose</Text>
            <Text style={styles.wizHint}>Quantidade e unidade (opcional)</Text>
            <View style={styles.doseRow}>
              <TextInput
                style={[styles.fieldInput, styles.doseValueInput]}
                value={doseValue}
                onChangeText={v => {
                  setDoseValue(v);
                  setForm(f => ({ ...f, dose: v ? `${v} ${doseUnit}` : '' }));
                }}
                keyboardType="numeric"
                autoCapitalize="none"
              />
              <View style={styles.doseUnitRow}>
                {DOSE_UNITS.map(u => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.doseUnitBtn, doseUnitTouched && doseUnit === u && styles.doseUnitBtnActive]}
                    onPress={() => {
                      setDoseUnit(u); setDoseUnitTouched(true);
                      setForm(f => ({ ...f, dose: doseValue ? `${doseValue} ${u}` : '' }));
                    }}
                  >
                    <Text style={[styles.doseUnitText, doseUnitTouched && doseUnit === u && styles.doseUnitTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {/* Foto no passo da DOSE, e não num passo próprio: é aqui que se descreve o
                medicamento, e assim não acrescenta um passo obrigatório para quem não quer
                foto. Serve para reconhecer o comprimido na hora de tomar — quem toma seis
                remédios tem três brancos e redondos na gaveta. */}
            <Text style={[styles.fieldLabel, { marginTop: 18 }]}>Foto do medicamento (opcional)</Text>
            <Text style={styles.wizHint}>Ajuda a reconhecer o comprimido na hora de tomar</Text>
            <View style={styles.fotoRow}>
              {temFoto(fotoUri) ? (
                <>
                  <Image source={{ uri: fotoUri as string }} style={styles.fotoPreview} />
                  <View style={{ flex: 1, gap: 8 }}>
                    <TouchableOpacity style={styles.fotoBtn} onPress={() => pegarFoto(tirarFoto)}>
                      <Text style={styles.fotoBtnText}>🔄 Trocar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.fotoBtn, styles.fotoBtnRemover]} onPress={() => {
                      apagarFoto(fotoMedId()); setFotoUri(null);
                    }}>
                      <Text style={[styles.fotoBtnText, styles.fotoBtnRemoverText]}>Remover</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <TouchableOpacity style={styles.fotoBtn} onPress={() => pegarFoto(tirarFoto)}>
                    <Text style={styles.fotoBtnText}>📷 Tirar foto</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.fotoBtn} onPress={() => pegarFoto(escolherFoto)}>
                    <Text style={styles.fotoBtnText}>🖼 Escolher</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 18 }]}>Observações (opcional)</Text>
            <TextInput
              style={[styles.fieldInput, { minHeight: 60, textAlignVertical: 'top', marginTop: 4 }]}
              value={form.notes}
              onChangeText={v => setForm(f => ({ ...f, notes: v }))}
              multiline
            />
          </>
        );

      case 'period': {
        const periodOptions = [
          { p: 'day'   as ReminderPeriod, icon: '☀️', label: 'Todo Dia',  hint: 'Repetição diária' },
          { p: 'week'  as ReminderPeriod, icon: '📅', label: 'Semanal',   hint: 'Alguns dias da semana' },
          { p: 'month' as ReminderPeriod, icon: '🗓',  label: 'Mensal',    hint: 'Alguns dias do mês' },
          { p: 'year'  as ReminderPeriod, icon: '♾️', label: 'Livre',     hint: 'A cada N meses' },
        ];
        return (
          <>
            <Text style={styles.wizLabel}>Com que frequência?</Text>
            <View style={[styles.periodCardRow, { marginTop: 16 }]}>
              {periodOptions.map(({ p, icon, label }) => {
                const isActive = editingId !== null && homeReminderEnabled && reminderPeriod === p;
                return (
                  <TouchableOpacity
                    key={p}
                    style={[styles.periodCardBtn, isActive && styles.periodCardBtnActive]}
                    onPress={() => { lockOnlyRef.current = false; homeReminderRef.current = true; setHomeReminderEnabled(true); setReminderPeriod(p); wizGoNext(p); }}
                  >
                    <Text style={styles.periodCardIcon}>{icon}</Text>
                    <Text style={[styles.periodCardText, isActive && styles.periodCardTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Card LARGO, fora da grade 2×2 (os cards são width 47% com flexWrap — um quinto
                ficaria órfão). A largura inteira também comporta o subtítulo, que é o que faz
                a pessoa se reconhecer: "Com pausa" sozinho não diz nada a quem só sabe que
                toma anticoncepcional. E o título NÃO é "cartela" de propósito — senão quem
                toma corticoide cíclico nunca clicaria aqui. */}
            <TouchableOpacity
              style={[styles.periodWideBtn, comPausa && styles.periodWideBtnActive]}
              onPress={() => {
                lockOnlyRef.current = false; homeReminderRef.current = true;
                setHomeReminderEnabled(true); setComPausa(true);
                wizGoNext(undefined, true);
              }}
            >
              {/* NÃO usar ⏸ aqui: o símbolo de pause significa "parado", e o card acabava
                  sendo lido como "este remédio está pausado" — estado, não ritmo. O padrão
                  •••‖••• mostra o que de fato acontece: toma uma sequência, interrompe,
                  volta a tomar. A barra sai no laranja de alerta, que é a interrupção. */}
              <Text style={styles.periodPausaIcone}>
                •••<Text style={styles.periodPausaBarra}>‖</Text>•••
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.periodCardText, comPausa && styles.periodCardTextActive]}>Com pausa</Text>
                {/* Exemplos de TRATAMENTO, não de formato: é assim que a pessoa reconhece a
                    própria situação. Cartela/adesivo/anel já aparecem no passo seguinte. */}
                <Text style={[styles.periodWideHint, comPausa && styles.periodCardTextActive]}>
                  ex.: anticoncepcional, quimioterápico
                </Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.lockOnlyBtn, editingId !== null && !homeReminderEnabled && styles.lockOnlyBtnActive]}
              onPress={() => { lockOnlyRef.current = true; homeReminderRef.current = false; handleSave(); }}
            >
              <Text style={[styles.lockOnlyBtnText, editingId !== null && !homeReminderEnabled && styles.lockOnlyBtnTextActive]}>
                {IS_IOS ? '🍎 Apenas na Ficha Médica' : '🔒 Apenas Tela de Bloqueio'}
              </Text>
            </TouchableOpacity>
            {/* Um medicamento lock-only não fica suspended, então continua entrando no
                buildMedListText — no iPhone a opção segue útil, só muda o nome do destino. */}
            <Text style={styles.lockOnlyHint}>{IS_IOS
              ? 'Apenas na Ficha Médica: o medicamento só entra na lista que você copia para a Ficha Médica do app Saúde — sem alarme e sem registro no Histórico.'
              : 'Apenas Tela de Bloqueio: o medicamento só aparece na ficha médica para socorristas — sem alarme e sem registro no Histórico.'}
            </Text>
          </>
        );
      }

      case 'cycle_preset': {
        return (
          <>
            <Text style={styles.wizLabel}>Qual é o tratamento?</Text>
            <Text style={styles.wizHint}>Os números já vêm prontos — você confere na próxima tela</Text>
            {CYCLE_PRESETS.map(p => (
              <TouchableOpacity
                key={p.kind}
                style={[styles.presetBtn, cycleKind === p.kind && styles.presetBtnActive]}
                onPress={() => {
                  setCycleKind(p.kind);
                  setCycleOn(String(p.on));
                  setCycleOff(String(p.off));
                  setReminderPeriod(p.period);
                  // O anel é 1 colocação por ciclo: 1 horário basta, e "vezes por dia" perde
                  // o sentido. O adesivo cai em 'week' e a pessoa escolhe o dia da semana.
                  if (p.kind === 'ring') { setTimesPerDay(1); setTimesPerDayTouched(true); }
                  wizGoNext(p.period, true, p.kind);
                }}
              >
                <Text style={styles.presetIcon}>{p.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.presetLabel, cycleKind === p.kind && styles.periodCardTextActive]}>{p.label}</Text>
                  <Text style={[styles.presetHint, cycleKind === p.kind && styles.periodCardTextActive]}>{p.hint}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        );
      }

      case 'cycle_setup': {
        const on = parseInt(cycleOn, 10) || 0;
        const off = parseInt(cycleOff, 10) || 0;
        const diaAtual = Math.min(Math.max(parseInt(cycleDiaAtual, 10) || 1, 1), Math.max(1, on + off));
        const ancora = ancoraPorDiaAtual(diaAtual);
        const valido = on >= 1 && off >= 1;
        // Prévia com DATAS REAIS: é a única forma de a pessoa conferir o que configurou contra
        // a cartela que tem na mão. Sem isto, um erro de 1 dia só aparece semanas depois.
        const prev = valido ? (() => {
          const st = cycleState({ kind: cycleKind, daysOn: on, daysOff: off, anchor: ancora });
          const d = (n: number) => { const x = new Date(); x.setDate(x.getDate() + n); return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`; };
          return st.active
            ? `Toma até ${d(st.daysUntilFlip - 1)} · pausa até ${d(st.daysUntilFlip + off - 1)} · recomeça ${d(st.daysUntilFlip + off)}`
            : `Em pausa até ${d(st.daysUntilFlip - 1)} · recomeça ${d(st.daysUntilFlip)}`;
        })() : null;
        return (
          <>
            <Text style={styles.wizLabel}>Confira o ciclo</Text>
            <View style={styles.cycleRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Dias tomando</Text>
                <TextInput style={styles.fieldInput} value={cycleOn} onChangeText={setCycleOn} keyboardType="number-pad" maxLength={3} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Dias de pausa</Text>
                <TextInput style={styles.fieldInput} value={cycleOff} onChangeText={setCycleOff} keyboardType="number-pad" maxLength={3} />
              </View>
            </View>

            {/* Perguntar "em que dia você está" em vez de pedir a data de início: quem tem a
                cartela na mão sabe o comprimido, mas erra o calendário. */}
            <Text style={[styles.fieldLabel, { marginTop: 18 }]}>
              {cycleKind === 'ring' ? 'Há quantos dias está com o anel?' : 'Que dia da cartela você está HOJE?'}
            </Text>
            <TextInput style={styles.fieldInput} value={cycleDiaAtual} onChangeText={setCycleDiaAtual} keyboardType="number-pad" maxLength={3} />
            <Text style={styles.wizHint}>
              Se começa hoje, deixe 1. {on + off === 28 ? 'Um ciclo de 28 dias recomeça sempre no mesmo dia da semana.' : ''}
            </Text>

            {prev && <View style={styles.cyclePreview}><Text style={styles.cyclePreviewText}>{prev}</Text></View>}
            {!valido && <Text style={styles.cycleErro}>Tomando e pausa precisam de pelo menos 1 dia cada.</Text>}
          </>
        );
      }

      case 'times_per_day': {
        if (mealMode) {
          const mealItems = [
            { label: '☕ Café da manhã', value: mealCafe, setter: setMealCafe, defaultH: 7 },
            { label: '🍽 Almoço', value: mealAlmoco, setter: setMealAlmoco, defaultH: 12 },
            { label: '🌙 Jantar', value: mealJanta, setter: setMealJanta, defaultH: 19 },
          ];
          return (
            <>
              <Text style={styles.wizLabel}>Horários das refeições</Text>
              <Text style={styles.wizHint}>Informe 1, 2 ou 3 horários</Text>
              {mealItems.map((item, idx) => (
                <View key={idx} style={{ marginTop: 14 }}>
                  <Text style={styles.fieldLabel}>
                    {item.label}
                    {idx > 0 ? <Text style={{ color: '#bbb', fontWeight: '400' }}> (opcional)</Text> : null}
                  </Text>
                  <TouchableOpacity
                    style={[styles.wizTimePicker, { padding: 16, marginTop: 6 }]}
                    onPress={() => setMealPickerTarget(mealPickerTarget === idx ? null : idx)}
                  >
                    <Text style={[styles.wizTimePickerText, { fontSize: 36 }]}>{item.value || '——:——'}</Text>
                    <Text style={styles.wizTimePickerHint}>{item.value ? 'Toque para alterar' : 'Toque para definir'}</Text>
                  </TouchableOpacity>
                  {mealPickerTarget === idx && (
                    <PickerDataHora
                      aoAparecer={revelarPicker}
                      valor={(() => {
                        const d = new Date();
                        if (item.value) { const [h, m] = item.value.split(':').map(Number); d.setHours(h, m, 0, 0); }
                        else d.setHours(item.defaultH, 0, 0, 0);
                        return d;
                      })()}
                      onMudar={(d) => item.setter(fmtHM(d.getHours(), d.getMinutes()))}
                      onFechar={() => setMealPickerTarget(null)}
                    />
                  )}
                </View>
              ))}
              <TouchableOpacity style={{ marginTop: 20 }} onPress={() => setMealMode(false)}>
                <Text style={[styles.wizBackBtnText, { color: '#888' }]}>‹ Outras opções</Text>
              </TouchableOpacity>
            </>
          );
        }
        return (
          <>
            <Text style={styles.wizLabel}>Vezes por dia</Text>
            <Text style={styles.wizHint}>Toque em uma opção para continuar</Text>
            {(() => {
              const registered = customTimes.trim()
                ? customTimes.trim().split(/\s+/).filter(t => /^\d{1,2}:\d{2}$/.test(t))
                : pickerH !== null ? [fmtHM(pickerH, pickerM ?? 0)] : [];
              if (registered.length === 0) return null;
              return (
                <Text style={{ marginTop: 10, color: '#555', fontSize: 13, textAlign: 'center' }}>
                  Registrado: {registered.join('  ·  ')}
                </Text>
              );
            })()}
            <View style={[styles.timesRow, { marginTop: 20 }]}>
              {TIMES_PER_DAY_OPTIONS.map(n => {
                const interval = 24 / n;
                const active = timesPerDayTouched && timesPerDay === n;
                return (
                  <TouchableOpacity
                    key={n}
                    style={[styles.timesBtn, active && styles.timesBtnActive]}
                    onPress={() => {
                      // Só descarta os horários quando a QUANTIDADE muda: aí eles serão
                      // recalculados espaçados por igual, e os antigos não servem mais.
                      // Tocando no número que já está valendo, a pessoa está confirmando,
                      // não pedindo para refazer — e limpar ali apagava horários que ela
                      // escolheu um a um (o caso das refeições: 07:00/12:00/19:00 não é
                      // "de 8 em 8h", e recalcular destruía a escolha em silêncio).
                      if (n !== timesPerDay) { setCustomTimes(''); setSpecificModeActive(false); }
                      setTimesPerDay(n);
                      setTimesPerDayTouched(true);
                      wizGoNext();
                    }}
                  >
                    <Text style={[styles.timesBtnText, active && styles.timesBtnTextActive]}>{n}x</Text>
                    {n > 1 && (
                      <Text style={[styles.timesBtnSub, active && styles.timesBtnSubActive]}>de {interval} em {interval}h</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            <TouchableOpacity
              style={[styles.yesNoBtn, { marginTop: 20, borderColor: '#E07B4F', width: '100%' }]}
              onPress={() => { setMealMode(true); setTimesPerDayTouched(false); }}
            >
              <Text style={[styles.yesNoBtnText, { color: '#E07B4F', fontSize: 14 }]}>🍽 Usar horários das refeições</Text>
            </TouchableOpacity>
          </>
        );
      }

      case 'weekdays':
        return (
          <>
            <Text style={styles.wizLabel}>Dias da semana</Text>
            <Text style={styles.wizHint}>Selecione um ou mais dias</Text>
            <View style={[styles.weekdayRow, { marginTop: 16 }]}>
              {WEEKDAYS.map(wd => {
                const sel = selectedWeekdays.includes(wd.value);
                return (
                  <TouchableOpacity
                    key={wd.value}
                    style={[styles.weekdayBtn, sel && styles.weekdayBtnActive]}
                    onPress={() => setSelectedWeekdays(prev =>
                      sel ? prev.filter(v => v !== wd.value) : [...prev, wd.value]
                    )}
                  >
                    <Text style={[styles.weekdayBtnText, sel && styles.weekdayBtnTextActive]}>{wd.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );

      case 'month_days':
        return (
          <>
            <Text style={styles.wizLabel}>Dias do mês</Text>
            <Text style={styles.wizHint}>Selecione um ou mais dias</Text>
            <View style={[styles.monthGrid, { marginTop: 16 }]}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => {
                const sel = selectedMonthDays.includes(d);
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.monthDayBtn, sel && styles.monthDayBtnActive]}
                    onPress={() => setSelectedMonthDays(prev =>
                      sel ? prev.filter(v => v !== d) : [...prev, d]
                    )}
                  >
                    <Text style={[styles.monthDayBtnText, sel && styles.monthDayBtnTextActive]}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        );

      case 'n_months':
        return (
          <>
            <Text style={styles.wizLabel}>Intervalo livre</Text>
            <Text style={styles.wizHint}>Para uso esporádico (ex: vitamina trimestral)</Text>
            <Text style={[styles.fieldLabel, { marginTop: 18 }]}>Repetir a cada quantos meses</Text>
            <TextInput
              style={[styles.fieldInput, styles.wizBigInput]}
              value={nMonths}
              onChangeText={setNMonths}
              keyboardType="number-pad"
              maxLength={2}
            />
            <Text style={[styles.fieldLabel, { marginTop: 14 }]}>No dia do mês (1–28)</Text>
            <TextInput
              style={[styles.fieldInput, styles.wizBigInput]}
              value={monthDay}
              onChangeText={setMonthDay}
              keyboardType="number-pad"
              maxLength={2}
            />
          </>
        );

      case 'time':
        return (
          <>
            <Text style={styles.wizLabel}>Horário do primeiro aviso</Text>
            <Text style={styles.wizHint}>Obrigatório — toque no relógio para definir</Text>
            <TouchableOpacity
              style={styles.wizTimePicker}
              onPress={() => {
                // Ancora os horários ANTES de abrir: o deslocamento abaixo passou a rodar a
                // cada giro da roda, e precisa medir sempre a partir dos MESMOS horários
                // originais. Medindo do customTimes vivo, cada giro deslocaria o já
                // deslocado e o erro se acumularia.
                horariosAoAbrirRef.current = customTimes;
                setShowHorarioPicker(v => !v);
              }}
            >
              <Text style={styles.wizTimePickerText}>{pickerDisplay || '——:——'}</Text>
              <Text style={styles.wizTimePickerHint}>{pickerDisplay ? 'Toque para alterar' : 'Toque para definir o horário'}</Text>
            </TouchableOpacity>
            {customTimes.trim() !== '' && (
              <Text style={{ marginTop: 12, color: '#555', fontSize: 13, textAlign: 'center' }}>
                Horários do dia: {customTimes.trim().split(/\s+/).join('  ·  ')}
              </Text>
            )}
            {showHorarioPicker && (
              <PickerDataHora
                aoAparecer={revelarPicker}
                valor={(() => { const d = new Date(); d.setHours(pickerH ?? 8, pickerM ?? 0, 0, 0); return d; })()}
                onMudar={(d) => {
                  setPickerH(d.getHours()); setPickerM(d.getMinutes());
                  // Edição com vários horários/dia: customTimes guarda os horários antigos
                  // e vence no doSaveWizard — sem isto, o horário novo era ignorado.
                  // Desloca todos mantendo os intervalos (08:00/20:00 → 09:00/21:00).
                  //
                  // Mede SEMPRE a partir dos horários de quando o picker abriu (a âncora),
                  // nunca do customTimes vivo: como isto roda a cada giro da roda, medir do
                  // vivo deslocaria o já deslocado e o erro se acumularia a cada minuto
                  // passado. Com a âncora fixa, rodar 1 ou 60 vezes dá o mesmo resultado.
                  const base = horariosAoAbrirRef.current;
                  if (base.trim()) {
                    const times = base.trim().split(/[\s,]+/).filter(t => /^\d{1,2}:\d{2}$/.test(t)).sort();
                    if (times.length > 0) {
                      const [oh, om] = times[0].split(':').map(Number);
                      const delta = (d.getHours() * 60 + d.getMinutes()) - (oh * 60 + om);
                      const shifted = times.map(t => {
                        const [h, m] = t.split(':').map(Number);
                        const total = ((h * 60 + m + delta) % 1440 + 1440) % 1440;
                        return fmtHM(Math.floor(total / 60), total % 60);
                      });
                      setCustomTimes(shifted.join(' '));
                    }
                  }
                }}
                onFechar={() => setShowHorarioPicker(false)}
              />
            )}
          </>
        );

      case 'deadline':
        return (
          <>
            <Text style={styles.wizLabel}>Prazo do tratamento</Text>
            <Text style={styles.wizHint}>O tratamento tem uma data para terminar?</Text>
            <View style={[styles.yesNoRow, { marginTop: 20 }]}>
              <TouchableOpacity
                style={[styles.yesNoBtn, deadlineTouched && hasDeadline && styles.yesNoBtnActive]}
                onPress={() => { setHasDeadline(true); setDeadlineTouched(true); }}
              >
                <Text style={[styles.yesNoBtnText, deadlineTouched && hasDeadline && styles.yesNoBtnTextActive]}>Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yesNoBtn, deadlineTouched && !hasDeadline && styles.yesNoBtnActive]}
                onPress={() => { setHasDeadline(false); setDeadlineTouched(true); wizGoNext(); }}
              >
                <Text style={[styles.yesNoBtnText, deadlineTouched && !hasDeadline && styles.yesNoBtnTextActive]}>Não</Text>
              </TouchableOpacity>
            </View>
            {hasDeadline && (
              <>
                <Text style={[styles.fieldLabel, { marginTop: 18 }]}>Duração em dias</Text>
                <TextInput
                  style={[styles.fieldInput, styles.wizBigInput]}
                  value={durationDays}
                  onChangeText={setDurationDays}
                  keyboardType="number-pad"
                  placeholder="Ex: 7"
                  placeholderTextColor="#bbb"
                />
                {durationDays.trim() !== '' && !isNaN(parseInt(durationDays)) && (
                  <Text style={styles.stockEndDatePreview}>
                    Termina em: {formatEndDate(addDays(parseInt(durationDays)))}
                  </Text>
                )}
              </>
            )}
          </>
        );

      case 'sound':
        return (
          <>
            <Text style={styles.wizLabel}>Alarme sonoro</Text>
            <View style={[styles.yesNoRow, { marginTop: 10 }]}>
              <TouchableOpacity
                style={[styles.yesNoBtnSm, soundTouched && withSound && styles.yesNoBtnActive]}
                onPress={() => { setWithSound(true); setSoundTouched(true); }}
              >
                <Text style={[styles.yesNoBtnText, soundTouched && withSound && styles.yesNoBtnTextActive]}>🔔 Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yesNoBtnSm, soundTouched && !withSound && styles.yesNoBtnActive]}
                onPress={() => { setWithSound(false); setRepeatInterval(0); setSoundTouched(true); }}
              >
                <Text style={[styles.yesNoBtnText, soundTouched && !withSound && styles.yesNoBtnTextActive]}>🔕 Não</Text>
              </TouchableOpacity>
            </View>

            {/* O texto acompanha a CURVA_COBRANCA do notifications.ts (5/20/60/180 min).
                Mexeu na curva, mexa aqui: é o que a pessoa lê para decidir. */}
            <Text style={[styles.wizLabel, { marginTop: 22, fontSize: 16 }]}>Repetir alarme — 4 vezes durante 3 horas</Text>
            <View style={[styles.yesNoRow, { marginTop: 10 }]}>
              <TouchableOpacity
                style={[styles.yesNoBtnSm, repeatTouched && repeatInterval > 0 && styles.yesNoBtnActive, !withSound && styles.yesNoBtnDisabled]}
                disabled={!withSound}
                onPress={() => { setRepeatInterval(5); setRepeatTouched(true); }}
              >
                <Text style={[styles.yesNoBtnText, repeatTouched && repeatInterval > 0 && styles.yesNoBtnTextActive]}>🔁 Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.yesNoBtnSm, repeatTouched && repeatInterval === 0 && styles.yesNoBtnActive]}
                onPress={() => { setRepeatInterval(0); setRepeatTouched(true); }}
              >
                <Text style={[styles.yesNoBtnText, repeatTouched && repeatInterval === 0 && styles.yesNoBtnTextActive]}>Não</Text>
              </TouchableOpacity>
            </View>
          </>
        );

      case 'stock':
        return (
          <>
            <View style={[styles.fieldLabelRow, { marginTop: 0 }]}>
              <Text style={styles.wizLabel}>Controle de estoque</Text>
              <TouchableOpacity onPress={() => setShowStockHelp(true)} style={{ marginLeft: 8 }}>
                <Text style={styles.stockHelpBtn}>?</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.fieldInput, styles.wizBigInput, { marginTop: 16 }]}
              value={stockInput}
              onChangeText={setStockInput}
              keyboardType="number-pad"
              placeholder="Ex: 30    (Opcional)"
              placeholderTextColor="#bbb"
            />
            <Text style={{ fontSize: 12, color: '#999', marginTop: 6, marginLeft: 2 }}>
              Deixe em branco para não controlar o estoque
            </Text>
            {!!stockInput.trim() && (
              <>
                <View style={styles.unitsPerDoseRow}>
                  <Text style={styles.unitsPerDoseText}>1 dose =</Text>
                  <TextInput
                    style={styles.unitsPerDoseInput}
                    value={unitsPerDoseInput}
                    onChangeText={v => { setUnitsPerDoseInput(v.replace(/\D/g, '')); setUnitsPerDoseTouched(true); }}
                    keyboardType="number-pad"
                    selectTextOnFocus
                  />
                  <Text style={styles.unitsPerDoseText}>
                    {(parseInt(unitsPerDoseInput, 10) || 1) === 1 ? 'cápsula/comprimido' : 'cápsulas/comprimidos'}
                  </Text>
                </View>
                {!unitsPerDoseTouched && doseUnit === 'cáps' && parseInt(doseValue.trim(), 10) >= 1 && (
                  <Text style={{ fontSize: 12, color: '#999', marginTop: 6, marginLeft: 2 }}>
                    Pela dose que você informou ({form.dose}). Pode corrigir se não for isso.
                  </Text>
                )}
              </>
            )}
          </>
        );

      case 'summary': {
        const rows = computeSummaryRows();
        return (
          <>
            <Text style={styles.wizLabel}>O que deseja alterar?</Text>
            <Text style={styles.wizHint}>Toque em um item para editar. Salvar aplica todas as alterações.</Text>
            <View style={{ marginTop: 14 }}>
              {rows.map(r => {
                const changed = editingId !== null && !!editSnapshot && editSnapshot[r.step] !== r.value;
                return (
                  <TouchableOpacity key={r.label} style={[styles.sumRow, changed && styles.sumRowChanged]} activeOpacity={0.7} onPress={() => setWizardStep(r.step)}>
                    <Text style={styles.sumIcon}>{r.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sumLabel}>{r.label}</Text>
                      <Text style={styles.sumValue} numberOfLines={3}>{r.value}</Text>
                      {!!r.warn && <Text style={styles.sumWarn}>⚠️ {r.warn} Toque para conferir.</Text>}
                    </View>
                    <Text style={styles.sumChevron}>›</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {editingId !== null && !medications.find(m => m.id === editingId)?.suspended && (
              <TouchableOpacity style={styles.suspendBtn} onPress={handleSuspend}>
                <Text style={styles.suspendBtnText}>⏸ Colocar em stand-by</Text>
                <Text style={styles.suspendBtnHint}>{IS_IOS
                  ? 'Pausa alarmes e sai da Ficha Médica sem perder o setup'
                  : 'Pausa alarmes e tela de bloqueio sem perder o setup'}</Text>
              </TouchableOpacity>
            )}
          </>
        );
      }

      default:
        return null;
    }
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={medications}
        keyExtractor={item => String(item.id)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            {loading
              ? <ActivityIndicator size="large" color="#1C3F7A" />
              : <>
                  <Text style={styles.emptyText}>Nenhum medicamento cadastrado.</Text>
                  <Text style={styles.emptyHint}>Toque em + para adicionar.</Text>
                </>
            }
          </View>
        }
        renderItem={({ item }) => {
          // Stand-by: card compacto de uma linha — só nome + Retomar
          if (item.suspended) {
            return (
              <TouchableOpacity
                style={styles.suspendedCard}
                activeOpacity={0.85}
                onPress={() => openEdit(item)}
                accessibilityLabel={`${item.generic_name} em stand-by. Toque para editar.`}
              >
                <Text style={styles.suspendedIcon}>⏸</Text>
                <Text style={styles.suspendedName} numberOfLines={1}>
                  {item.commercial_name ? `${item.commercial_name} — ${item.generic_name}` : item.generic_name}
                </Text>
                <TouchableOpacity
                  style={styles.resumeBtn}
                  onPress={() => handleResume(item)}
                  accessibilityLabel={`Retomar ${item.generic_name}`}
                  accessibilityRole="button"
                >
                  <Text style={styles.resumeBtnText}>Retomar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id, item.generic_name)} accessibilityLabel={`Remover ${item.generic_name}`} accessibilityRole="button">
                  <Text style={styles.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }
          const times = reminderTimes.get(item.id) ?? [];
          const hasSound = reminderHasSound.get(item.id) ?? false;
          const meta = reminderMeta.get(item.id);
          const periodType = meta?.periodType ?? 'day';
          const repeatInt = meta?.repeat ?? 0;
          const dailyDoses = periodType === 'day' ? (times.length || 1) : 1;
          const unitsPerDose = item.units_per_dose || 1;
          // Com pausa a conta muda: 21 comprimidos cobrem 28 dias de calendário, porque os 7
          // de pausa não consomem dose. Mesma correção já feita na Home.
          const cicloItem = cicloDoMedicamento(item);
          const daysLeft = item.stock_quantity == null ? null
            : cicloItem
              ? diasDeEstoque(cicloItem, item.stock_quantity, dailyDoses * unitsPerDose)
              : Math.floor(item.stock_quantity / (dailyDoses * unitsPerDose));
          const stockLow = daysLeft != null && daysLeft <= 3;

          let scheduleStr = '';
          if (times.length > 0) {
            if (periodType === 'day') {
              scheduleStr = times.join('  ·  ') + (times.length > 1 ? `  (${times.length}×/dia)` : '  · diário');
            } else if (periodType === 'week') {
              const t = times[0]?.split(' · ')[0] ?? '';
              const days = times.map(s => s.split(' · ')[1] ?? '').filter(Boolean);
              scheduleStr = `${t} · ${days.join(', ')}  (semanal)`;
            } else {
              scheduleStr = times[0] ?? '';
              if (times.length > 1) scheduleStr += `  +${times.length - 1}`;
            }
          }

          const hasAnyInfo = item.dose || times.length > 0 || item.notes || item.stock_quantity != null || item.end_date;

          return (
          <TouchableOpacity style={styles.medCard} activeOpacity={0.85} onPress={() => openEdit(item)}>
            {/* Header: name + delete */}
            <View style={styles.medHeader}>
              {/* Mesma troca da Home: a foto entra no lugar do emoji, no mesmo tamanho.
                  Quem tem seis remédios cadastrados precisa distinguir as LINHAS da lista,
                  não só a dose da vez. */}
              {/* O card inteiro abre a edição; a foto tem toque PRÓPRIO para ampliar. Em RN o
                  Touchable interno vence e não propaga, então um não atrapalha o outro. */}
              <FotoMini
                uri={item.photo_uri} size={26} radius={5} style={{ marginRight: 6 }}
                fallback={<Text style={styles.criticalIcon}>{isPhytotherapic(item.generic_name) ? '🌿' : '💊'}</Text>}
                onAmpliar={uri => setFotoZoom({ uri, nome: item.commercial_name || item.generic_name })}
              />
              <Text style={styles.medGeneric} numberOfLines={2}>
                {item.commercial_name ? `${item.commercial_name} — ${item.generic_name}` : item.generic_name}
              </Text>
              {/* Não basta o nome EXATO da base: quem cadastra "Losartana Potássica" — como está
                  escrito na caixa — ficava sem nem o botão da bula. nomeDaBaseParaBula ignora o
                  sal, que é o que o getBulaUrl usa para achar o PDF. */}
              {(!!nomeDaBaseParaBula(item.generic_name) || isPhytotherapic(item.generic_name)) && (
                <TouchableOpacity
                  style={styles.bulaCardBtn}
                  accessibilityLabel={`Ver bula de ${item.generic_name}`}
                  accessibilityRole="button"
                  onPress={() => {
                    const url = isPhytotherapic(item.generic_name)
                      ? getPhytoBulaUrl(item.generic_name, item.commercial_name || undefined)
                      : getBulaUrl(item.generic_name, item.commercial_name || undefined);
                    openBula(url, item.generic_name);
                  }}
                >
                  <Text style={styles.bulaCardBtnText}>📋</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id, item.generic_name)} accessibilityLabel={`Remover ${item.generic_name}`} accessibilityRole="button">
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            {/* Setup info */}
            <View style={styles.medInfo}>
              {scheduleStr ? <Text style={styles.medDetail}>🕐 {scheduleStr}</Text> : null}
              {item.dose ? <Text style={styles.medDetail}>⚖️ {item.dose}</Text> : null}
              {item.stock_quantity != null && (
                <Text style={[styles.medDetail, stockLow && styles.stockTextLow]}>
                  {'💊 '}{item.stock_quantity} restante{item.stock_quantity !== 1 ? 's' : ''}
                  {unitsPerDose > 1 ? ` (1 dose = ${unitsPerDose})` : ''}
                  {daysLeft != null ? ` · ~${daysLeft} dia${daysLeft !== 1 ? 's' : ''}` : ''}
                  {stockLow ? '  ⚠ baixo' : ''}
                </Text>
              )}
              {item.end_date && (
                <Text style={[styles.medDetail, daysRemaining(item.end_date) <= 0 && styles.endDateDone]}>
                  {daysRemaining(item.end_date) > 0
                    ? `📅 ${formatEndDate(item.end_date)} · ${daysRemaining(item.end_date)} dia${daysRemaining(item.end_date) !== 1 ? 's' : ''} restantes`
                    : `📅 ${formatEndDate(item.end_date)} · encerrado`}
                </Text>
              )}
              {times.length > 0 && (
                <Text style={styles.medDetail}>
                  {hasSound ? '🔔' : '🔕'} Alarme: {hasSound ? 'Sim' : 'Não'}  ·  Repete: {repeatInt > 0 ? 'Sim' : 'Não'}
                </Text>
              )}
              {item.notes ? <Text style={styles.medNotes}>📝 {item.notes}</Text> : null}
              {times.length === 0 && hasAnyInfo && (
                <Text style={styles.medNoReminderHint}>{IS_IOS
                  ? '🍎 Sem lembrete nem histórico — aparece só na lista da Ficha Médica'
                  : '🔒 Sem lembrete nem histórico — aparece só na ficha da tela de bloqueio'}</Text>
              )}
              {!hasAnyInfo && <Text style={styles.medEditHint}>Toque para configurar →</Text>}
            </View>
          </TouchableOpacity>
          );
        }}
      />

      <TouchableOpacity style={[styles.fab, { bottom: 24 + insets.bottom }]} onPress={openWizard} accessibilityLabel="Adicionar medicamento" accessibilityRole="button">
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

      {/* Wizard modal */}
      {/* onRequestClose = wizGoBack, e não fechar o modal: o voltar do Android tem de fazer o
          MESMO que o botão "‹ Voltar" da tela, que é recuar um passo. Sem isto o voltar era
          simplesmente ENGOLIDO — apertar não fazia nada, e a única saída do wizard era andar
          até o primeiro passo. Fechar tudo de uma vez seria o outro extremo: jogaria fora o
          que a pessoa já preencheu, sem perguntar. */}
      <Modal visible={showModal} animationType="slide" transparent onRequestClose={wizGoBack}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <View style={styles.modalOverlay}>
            <View style={styles.wizModalBox}>
              {/* Progress bar — só no cadastro novo; a edição navega pelo resumo */}
              {editingId === null && (() => {
                const seq = getStepSequence(reminderPeriod, true, mealMode, comPausa, cycleKind);
                const idx = Math.max(0, seq.indexOf(wizardStep));
                const pct = `${Math.round((idx + 1) / seq.length * 100)}%`;
                return (
                  <View style={styles.wizProgress}>
                    <View style={[styles.wizProgressBar, { width: pct as any }]} />
                  </View>
                );
              })()}

              {/* Header */}
              <View style={styles.wizHeader}>
                <Text style={styles.wizHeaderLabel}>
                  {editingId !== null
                    ? (entryType === 'fitoterapico' ? '✏️ Editando Fitoterápico' : '✏️ Editando Medicamento')
                    : (entryType === 'fitoterapico' ? '🌿 Novo Fitoterápico' : '💊 Novo Medicamento')}
                </Text>
                {form.generic_name.trim() ? (
                  <Text style={styles.wizHeaderName} numberOfLines={1}>
                    {form.commercial_name.trim()
                      ? `${form.commercial_name.trim()} — ${form.generic_name.trim()}`
                      : form.generic_name.trim()}
                  </Text>
                ) : null}
              </View>

              {/* Step content */}
              <ScrollView
                ref={wizStepScrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={[styles.wizContent, { paddingBottom: insets.bottom + 24 }]}
                keyboardShouldPersistTaps="handled"
              >
                {renderWizardStep()}

                {/* Footer — dentro do scroll para não ocupar espaço fixo com o teclado aberto */}
                <View style={styles.wizFooter}>
                  <TouchableOpacity
                    style={[styles.wizBackBtn, !stepNeedsNext() && { flex: 0, paddingHorizontal: 24, borderColor: '#ddd' }]}
                    onPress={wizGoBack}
                  >
                    <Text style={styles.wizBackBtnText}>
                      {editingId !== null
                        ? (wizardStep === 'summary' ? 'Cancelar' : '‹ Resumo')
                        : '‹ Voltar'}
                    </Text>
                  </TouchableOpacity>
                  {stepNeedsNext() && (() => {
                    // Editando: "OK"/"Próximo" só volta pro resumo, não salva nada ainda —
                    // fica com a mesma cor neutra do "Resumo" pra não parecer que já confirmou.
                    const isEditIntermediate = editingId !== null && wizardStep !== 'summary';
                    return (
                      <TouchableOpacity
                        style={[styles.wizNextBtn, isEditIntermediate && styles.wizNextBtnPlain]}
                        onPress={() => (wizardStep === 'summary' ? handleSave() : wizGoNext())}
                      >
                        <Text style={[styles.wizNextBtnText, isEditIntermediate && styles.wizNextBtnTextPlain]}>
                          {(() => {
                            if (editingId !== null) {
                              if (wizardStep === 'summary') return 'Salvar ✓';
                              return editNextStep(wizardStep, reminderPeriod) === 'summary' ? 'OK ✓' : 'Próximo ›';
                            }
                            const seq = getStepSequence(reminderPeriod, true, mealMode, comPausa, cycleKind);
                            const idx = seq.indexOf(wizardStep);
                            return idx >= seq.length - 1 ? 'Salvar ✓' : 'Próximo ›';
                          })()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })()}
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
        {/* No iOS só um Modal aparece por vez (apresentação por UIViewController): aberta de
            dentro do wizard, a bula precisa ser filha DESTE Modal para vir por cima. Fora do
            wizard, renderiza no root. As duas condições são mutuamente exclusivas — nunca monta duas. */}
        {showModal && bulaModal}
      </Modal>

      {!showModal && bulaModal}

      {/* Ampliar a foto só existe na LISTA, que fica fora do wizard — então o modal vai no
          root, sem a condição que a bula precisa. Se um dia der para ampliar de dentro do
          wizard, terá de seguir o mesmo padrão do bulaModal acima. */}
      <ModalFoto uri={fotoZoom?.uri ?? null} nome={fotoZoom?.nome} onFechar={() => setFotoZoom(null)} />

      {/* Stock help modal */}
      <Modal visible={showStockHelp} animationType="slide" transparent onRequestClose={() => setShowStockHelp(false)}>
        <View style={styles.intModalOverlay}>
          <View style={[styles.intModalBox, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.intModalTitle}>Controle de estoque</Text>
            <ScrollView>
              <Text style={styles.stockHelpText}>
                O controle de estoque ajuda você a saber quantos comprimidos ou doses restam e quando precisa comprar mais.
              </Text>
              <Text style={styles.stockHelpSubtitle}>Como funciona</Text>
              <Text style={styles.stockHelpText}>
                1. Informe a quantidade atual de comprimidos ou cápsulas que você tem em casa.{'\n\n'}
                2. Se cada dose for mais de 1 cápsula/comprimido, informe quantas em "1 dose = ".{'\n\n'}
                3. A cada vez que tomar o medicamento, toque em <Text style={{ fontWeight: '700' }}>Tomei</Text> no aviso de alarme ou em <Text style={{ fontWeight: '700' }}>Tomar</Text> no card. O estoque diminui automaticamente de acordo com a dose.{'\n\n'}
                4. Quando o estoque ficar baixo (menos de 3 dias de doses), você verá um aviso.
              </Text>
              <View style={styles.stockHelpTip}>
                <Text style={styles.stockHelpTipText}>
                  💡 O controle de estoque requer que a repetição de alarme esteja ativa.
                </Text>
              </View>
            </ScrollView>
            <TouchableOpacity style={styles.intModalClose} onPress={() => setShowStockHelp(false)}>
              <Text style={styles.intModalCloseText}>Entendi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F4F8' },
  list: { padding: 16, paddingBottom: 160 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyText: { fontSize: 16, color: '#999', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#bbb' },
  medCard: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
    elevation: 1, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 3,
  },
  medCardRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  medInfo: { flex: 1, paddingTop: 2, paddingBottom: 4 },
  medHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 2 },
  criticalIcon: { fontSize: 16 },
  medGeneric: { fontSize: 15, fontWeight: '600', color: '#222', flex: 1 },
  medDetail: { fontSize: 13, color: '#555', marginTop: 2 },
  medNotes: { fontSize: 12, color: '#888', marginTop: 4, fontStyle: 'italic' },
  medEditHint: { fontSize: 12, color: '#1C3F7A', marginTop: 4, fontStyle: 'italic' },
  medNoReminderHint: { fontSize: 12, color: '#8A8F9D', marginTop: 4, fontStyle: 'italic' },
  medActionsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  // Stock
  stockSection: { marginTop: 16, borderTopWidth: 1, borderTopColor: '#f0f0f0', paddingTop: 14 },
  stockSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  stockSectionTitle: { fontSize: 13, fontWeight: '700', color: '#1C3F7A' },
  stockHelpText: { fontSize: 13, color: '#444', lineHeight: 20, marginBottom: 8 },
  stockHelpSubtitle: { fontSize: 13, fontWeight: '700', color: '#1C3F7A', marginTop: 8, marginBottom: 4 },
  stockHelpTip: { backgroundColor: '#FFF8E7', borderRadius: 8, padding: 10, marginTop: 8, borderLeftWidth: 3, borderLeftColor: '#E07B4F' },
  stockHelpTipText: { fontSize: 12, color: '#7a5200', lineHeight: 18 },
  stockEndDatePreview: { fontSize: 12, color: '#1a6b3a', marginTop: 4, fontStyle: 'italic' },
  stockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  stockText: { fontSize: 12, color: '#555', flex: 1 },
  stockTextLow: { color: '#E07B4F', fontWeight: '600' },
  unitsPerDoseRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  unitsPerDoseText: { fontSize: 14, color: '#444' },
  unitsPerDoseInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8,
    fontSize: 15, fontWeight: '600', color: '#222', backgroundColor: '#fafafa', textAlign: 'center', width: 48,
  },
  takenBtn: { backgroundColor: '#1C3F7A', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 5 },
  takenBtnText: { fontSize: 12, color: '#fff', fontWeight: '700' },
  endDateText: { fontSize: 12, color: '#888', marginTop: 4 },
  endDateDone: { color: '#CC0000' },
  intModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  intModalBox: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '70%' },
  intModalTitle: { fontSize: 16, fontWeight: '700', color: '#1C3F7A', marginBottom: 16 },
  intModalItem: { borderLeftWidth: 3, borderRadius: 8, padding: 10, marginBottom: 10, backgroundColor: '#fafafa' },
  intModalBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 4 },
  intModalBadgeText: { fontSize: 10, fontWeight: '600' },
  intModalDrugs: { fontSize: 13, fontWeight: '700', color: '#222', marginBottom: 2 },
  intModalDesc: { fontSize: 12, color: '#555', fontStyle: 'italic' },
  intModalMechanismBox: { borderRadius: 8, padding: 10, marginTop: 8, backgroundColor: '#F2F4F8' },
  intModalMechanismTitle: { fontSize: 11, fontWeight: '700', color: '#444', marginBottom: 4 },
  intModalMechanismText: { fontSize: 12, color: '#333', lineHeight: 18 },
  intModalClose: { marginTop: 12, backgroundColor: '#1C3F7A', borderRadius: 10, padding: 14, alignItems: 'center' },
  intModalCloseText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  bellBtn: { padding: 8, marginLeft: 4, borderRadius: 8 },
  bellBtnText: { fontSize: 18 },
  bulaCardBtn: { padding: 8, marginLeft: 4 },
  bulaCardBtnText: { fontSize: 18 },
  deleteBtn: { padding: 8, marginLeft: 4 },
  deleteBtnText: { fontSize: 16, color: '#ccc' },
  fab: {
    position: 'absolute', bottom: 80, right: 24, width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#1C3F7A', justifyContent: 'center', alignItems: 'center',
    elevation: 4, shadowColor: '#1C3F7A', shadowOpacity: 0.4, shadowRadius: 6,
  },
  fabText: { fontSize: 28, color: '#fff', lineHeight: 30 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  // Wizard modal
  wizModalBox: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    height: '90%',
  },
  wizProgress: { height: 4, backgroundColor: '#f0f0f0', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  wizProgressBar: { height: 4, backgroundColor: '#1C3F7A' },
  wizHeader: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  wizHeaderLabel: { fontSize: 12, color: '#999', fontWeight: '500', letterSpacing: 0.3 },
  wizHeaderName: { fontSize: 15, fontWeight: '700', color: '#1C3F7A', marginTop: 2 },
  wizContent: { padding: 20 },
  wizLabel: { fontSize: 20, fontWeight: '700', color: '#1C3F7A', marginBottom: 6 },
  wizHint: { fontSize: 14, color: '#666', lineHeight: 20 },
  wizBigInput: { fontSize: 18, fontWeight: '600', marginTop: 8 },
  wizTimePicker: {
    marginTop: 24, backgroundColor: '#F2F4F8', borderRadius: 16,
    padding: 28, alignItems: 'center', borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  wizTimePickerText: { fontSize: 48, fontWeight: '700', color: '#1C3F7A', letterSpacing: 2 },
  wizTimePickerHint: { fontSize: 13, color: '#999', marginTop: 8 },
  wizFooter: {
    flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: '#f0f0f0', backgroundColor: '#fff',
    marginHorizontal: -20,
  },
  wizBackBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ccc', borderRadius: 10, padding: 14, alignItems: 'center' },
  wizBackBtnText: { fontSize: 15, color: '#666', fontWeight: '600' },
  wizNextBtn: { flex: 2, backgroundColor: '#1C3F7A', borderRadius: 10, padding: 14, alignItems: 'center' },
  wizNextBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  wizNextBtnPlain: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#ccc' },
  wizNextBtnTextPlain: { color: '#666' },
  // Type selection cards
  typeCardBtn: {
    borderWidth: 1.5, borderColor: '#ddd', borderRadius: 16, padding: 24,
    alignItems: 'center', backgroundColor: '#fff',
  },
  typeCardIcon: { fontSize: 36, marginBottom: 8 },
  typeCardText: { fontSize: 18, fontWeight: '700', color: '#1C3F7A' },
  typeCardHint: { fontSize: 13, color: '#888', marginTop: 4 },
  // Yes/No
  yesNoRow: { flexDirection: 'row', gap: 12 },
  yesNoBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12, paddingVertical: 22, alignItems: 'center' },
  yesNoBtnSm: { flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  yesNoBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  yesNoBtnDisabled: { opacity: 0.4 },
  yesNoBtnText: { fontSize: 16, color: '#555', fontWeight: '700' },
  yesNoBtnTextActive: { color: '#fff' },
  // Period cards
  periodCardRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  periodCardBtn: {
    width: '47%', borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12,
    paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center',
  },
  periodCardBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  periodCardIcon: { fontSize: 28, marginBottom: 6 },
  periodCardText: { fontSize: 14, color: '#333', fontWeight: '700' },
  periodCardTextActive: { color: '#fff' },
  periodCardHint: { fontSize: 11, color: '#888', textAlign: 'center' },
  lockOnlyBtn: {
    marginTop: 12, borderWidth: 1.5, borderColor: '#C8CDD8', borderRadius: 10,
    paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center',
  },
  lockOnlyBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  lockOnlyBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  lockOnlyBtnTextActive: { color: '#fff' },
  lockOnlyHint: { fontSize: 12, color: '#8A8F9D', marginTop: 8, lineHeight: 17, paddingHorizontal: 2 },
  // Autocomplete
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 4 },
  fieldLabel: { fontSize: 13, color: '#555' },
  fieldInput: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, color: '#222', backgroundColor: '#fafafa',
  },
  suggestionsBox: { marginTop: 6, gap: 4 },
  // Largura inteira, fora da grade 2×2 — e é a largura que permite o subtítulo.
  periodWideBtn: {
    marginTop: 8, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  periodWideBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  periodWideHint: { fontSize: 12, color: '#888', marginTop: 2 },
  periodPausaIcone: { fontSize: 15, color: '#1C3F7A', letterSpacing: 1, fontWeight: '900' },
  periodPausaBarra: { color: '#E07B4F' },

  presetBtn: {
    marginTop: 10, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  presetBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  presetIcon: { fontSize: 24 },
  presetLabel: { fontSize: 15, fontWeight: '700', color: '#333' },
  presetHint: { fontSize: 12, color: '#888', marginTop: 2 },

  cycleRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  medFoto: { width: 26, height: 26, borderRadius: 5, marginRight: 6, backgroundColor: '#eee' },
  fotoRow: { flexDirection: 'row', gap: 10, marginTop: 8, alignItems: 'center' },
  fotoPreview: { width: 84, height: 84, borderRadius: 10, backgroundColor: '#eee' },
  fotoBtn: {
    flex: 1, borderWidth: 1.5, borderColor: '#C8CDD8', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  fotoBtnText: { fontSize: 14, fontWeight: '700', color: '#1C3F7A' },
  fotoBtnRemover: { borderColor: '#E0B4A4' },
  fotoBtnRemoverText: { color: '#B03A2E' },
  cyclePreview: {
    marginTop: 18, backgroundColor: '#EEF2FA', borderRadius: 10, padding: 12,
    borderWidth: 0.5, borderColor: 'rgba(28,63,122,0.15)',
  },
  cyclePreviewText: { fontSize: 13, color: '#1C3F7A', fontWeight: '600', lineHeight: 19 },
  cycleErro: { fontSize: 13, color: '#C0392B', marginTop: 10, fontWeight: '600' },

  suggestionsInline: { marginTop: 12, gap: 4 },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  suggestionChip: { flex: 1, backgroundColor: '#e8edf7', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#c0ccdf' },
  suggestionChipBrand: { backgroundColor: '#f0e8f7', borderColor: '#c8b0dd' },
  suggestionChipText: { fontSize: 14, color: '#1C3F7A', fontWeight: '600' },
  suggestionChipTextBrand: { color: '#6b1a8a' },
  suggestionCategory: { fontSize: 11, color: '#7a92b8', marginTop: 1 },
  suggestionCategoryBrand: { color: '#9a72b8' },
  suggestionChipTyped: { backgroundColor: '#fbe8dd', borderColor: '#E07B4F' },
  suggestionChipTextTyped: { color: '#b45526' },
  suggestionCategoryTyped: { color: '#c46a3a' },
  bulaBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#f0f4ff', borderWidth: 1, borderColor: '#c0ccdf', justifyContent: 'center', alignItems: 'center' },
  bulaBtnText: { fontSize: 16 },
  reportMissingBtn: { marginTop: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#b0b8c8', alignSelf: 'flex-start' },
  reportMissingText: { fontSize: 12, color: '#7a8099' },
  reportedText: { fontSize: 12, color: '#5a9a6a', marginTop: 6 },
  reportConfirmBox: { marginTop: 8, padding: 10, backgroundColor: '#f5f6fa', borderRadius: 8, borderWidth: 1, borderColor: '#dde' },
  reportConfirmLabel: { fontSize: 12, color: '#555', marginBottom: 6 },
  reportConfirmInput: { borderWidth: 1, borderColor: '#ccd', borderRadius: 6, padding: 8, fontSize: 14, backgroundColor: '#fff' },
  reportConfirmBtns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8, gap: 8 },
  reportCancelBtn: { paddingVertical: 6, paddingHorizontal: 14 },
  reportCancelText: { fontSize: 13, color: '#888' },
  reportSendBtn: { paddingVertical: 6, paddingHorizontal: 14, backgroundColor: '#4a6fa5', borderRadius: 6 },
  reportSendText: { fontSize: 13, color: '#fff', fontWeight: '600' },
  // Reminder day config
  horarioInlineRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 4, gap: 12 },
  horarioLabel: { fontSize: 15, fontWeight: '700', color: '#1C3F7A' },
  timeFieldInputInline: { fontSize: 20, fontWeight: '700', color: '#1C3F7A', paddingVertical: 2, minWidth: 72, letterSpacing: 2, textAlign: 'center' },
  timeFieldPlaceholder: { color: '#BEC8E0' },
  timesRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  doseRow: { gap: 12 },
  doseValueInput: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  doseUnitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  doseUnitBtn: { borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center' },
  doseUnitBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  doseUnitText: { fontSize: 14, color: '#555', fontWeight: '600' },
  doseUnitTextActive: { color: '#fff' },
  timesBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  timesBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  timesBtnText: { fontSize: 14, color: '#555', fontWeight: '600' },
  timesBtnTextActive: { color: '#fff' },
  timesBtnSub: { fontSize: 10, color: '#888', marginTop: 3, textAlign: 'center' },
  timesBtnSubActive: { color: 'rgba(255,255,255,0.8)' },
  specificTimesRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 12, marginBottom: 4 },
  specificTimesLabel: { fontSize: 13, color: '#555', fontWeight: '600' },
  specificTimesInput: { fontSize: 16, fontWeight: '700', color: '#1C3F7A', textAlign: 'center', minWidth: 56, paddingVertical: 1 },
  addTimeBtn: { marginLeft: 8, backgroundColor: '#1C3F7A', borderRadius: 6, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  addTimeBtnText: { color: '#fff', fontSize: 20, fontWeight: '700', lineHeight: 26 },
  customTimesBox: { backgroundColor: '#F2F4F8', borderRadius: 8, padding: 10, marginTop: 4, borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.1)' },
  customTimesText: { fontSize: 15, color: '#1C3F7A', fontWeight: '600', letterSpacing: 1 },
  timesChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  timesChip: { backgroundColor: '#1C3F7A', color: '#fff', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 3, fontSize: 14, fontWeight: '700' },
  timesPreview: { backgroundColor: '#f0f4ff', borderRadius: 8, padding: 12, marginTop: 12 },
  timesPreviewLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  weekdayRow: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  weekdayBtn: { borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, alignItems: 'center', minWidth: 44 },
  weekdayBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  weekdayBtnText: { fontSize: 12, color: '#555', fontWeight: '600' },
  weekdayBtnTextActive: { color: '#fff' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  monthDayBtn: { width: 40, height: 36, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  monthDayBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  monthDayBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  monthDayBtnTextActive: { color: '#fff' },
  typeRow: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 4 },
  typeBtn: { flex: 1, borderWidth: 1.5, borderColor: '#ddd', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  typeBtnActive: { backgroundColor: '#1C3F7A', borderColor: '#1C3F7A' },
  typeBtnActiveGreen: { backgroundColor: '#1a6b3a', borderColor: '#1a6b3a' },
  typeBtnText: { fontSize: 13, color: '#555', fontWeight: '600' },
  typeBtnTextActive: { color: '#fff' },
  phytoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 4 },
  phytoCard: { width: '47%', backgroundColor: '#f0f7f0', borderRadius: 10, borderWidth: 1, borderColor: '#a8d5a8', padding: 10 },
  phytoCardName: { fontSize: 13, fontWeight: '700', color: '#1a6b3a', marginBottom: 2 },
  phytoCardScientific: { fontSize: 10, color: '#5a9a6a', fontStyle: 'italic' },
  phytoCardTyped: { backgroundColor: '#fbe8dd', borderColor: '#E07B4F' },
  phytoCardNameTyped: { color: '#b45526' },
  phytoCardScientificTyped: { color: '#c46a3a', fontStyle: 'normal' },
  stockActionBtn: { backgroundColor: '#1C3F7A', borderRadius: 10, padding: 16, marginBottom: 12 },
  stockActionBtnText: { fontSize: 15, color: '#fff', fontWeight: '700' },
  stockActionBtnHint: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 3 },
  stockActionEditRow: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 12 },
  stockActionEditLabel: { fontSize: 13, fontWeight: '600', color: '#1C3F7A', marginBottom: 8 },
  stockActionEditInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stockActionEditInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18, color: '#222', backgroundColor: '#fafafa', textAlign: 'center' },
  stockActionSaveBtn: { backgroundColor: '#E07B4F', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  stockActionSaveBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },
  stockActionInfo: { backgroundColor: '#FFF8E7', borderRadius: 8, padding: 12, marginBottom: 14, borderLeftWidth: 3, borderLeftColor: '#E07B4F' },
  stockActionInfoText: { fontSize: 12, color: '#7a5200', lineHeight: 18 },
  stockHelpBtn: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#1C3F7A', textAlign: 'center', lineHeight: 16, fontSize: 11, fontWeight: '700', color: '#1C3F7A' },
  // Resumo de edição
  sumRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#F2F4F8', borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)',
  },
  sumRowChanged: { borderLeftWidth: 3, borderLeftColor: '#1C3F7A' },
  sumIcon: { fontSize: 20, width: 26, textAlign: 'center' },
  sumLabel: { fontSize: 11, color: '#8A8F9D', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  sumValue: { fontSize: 14, color: '#1A1F2E', fontWeight: '600', marginTop: 2 },
  sumChevron: { fontSize: 22, color: '#C0C5D0' },
  sumWarn: { fontSize: 12, color: '#E07B4F', fontWeight: '600', marginTop: 4 },
  // Stand-by
  suspendBtn: {
    marginTop: 6, borderRadius: 12, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#C0C5D0', borderStyle: 'dashed',
  },
  suspendBtnText: { fontSize: 14, fontWeight: '600', color: '#8A8F9D' },
  suspendBtnHint: { fontSize: 11, color: '#B0B5C0', marginTop: 2 },
  suspendedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#fff', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(0,0,0,0.06)', opacity: 0.75,
  },
  suspendedIcon: { fontSize: 14, color: '#8A8F9D' },
  suspendedName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#8A8F9D' },
  resumeBtn: {
    borderWidth: 1, borderColor: '#1C3F7A', borderRadius: 14,
    paddingVertical: 4, paddingHorizontal: 12,
  },
  resumeBtnText: { fontSize: 12, fontWeight: '700', color: '#1C3F7A' },
});
