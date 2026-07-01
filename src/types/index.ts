export interface Profile {
  id: number;
  name: string;
  blood_type: string;
  birth_date: string;
  allergies: string;
  notes: string;
  updated_at: string;
}

export interface Medication {
  id: number;
  generic_name: string;
  commercial_name: string;
  dose: string;
  frequency: string;
  is_critical: boolean;
  notes: string;
  stock_quantity: number | null;
  end_date: string | null; // ISO "YYYY-MM-DD"
  home_reminder?: number; // 1 = show overdue banner on HomeScreen (default), 0 = off
}

export interface EmergencyContact {
  id: number;
  name: string;
  phone: string;
  relationship: string;
  is_primary: boolean;
  is_doctor: boolean;
  show_on_lock: boolean;
}

export interface DrugInteraction {
  id: string;
  drug1: string;
  drug2: string;
  risk_level: 'critical' | 'high' | 'moderate';
  risk_description: string;
  mechanism: string;
  // RxCUI (RxNorm) de cada lado — só presentes quando TODO o texto do lado foi resolvido
  // (ver scripts/build_interactions_rxcui.py). Usados apenas para CONFIRMAR matches
  // que o fuzzy já não pegou (sinônimos/grafias sem palavra em comum) — nunca para rejeitar.
  drug1_rxcuis?: string[];
  drug2_rxcuis?: string[];
}

export interface MedicationReminder {
  id: number;
  medication_id: number;
  time: string;        // "HH:MM"
  // period encoding (stored in `days` column):
  //   'day'        → daily
  //   'week:N'     → weekly, N = weekday (1=Sun … 7=Sat)
  //   'month:N'    → monthly, N = day of month
  //   'year:DD/MM' → yearly
  period: string;
  with_sound: boolean;
  is_active: boolean;
  repeat_interval: number; // minutes between repeat alarms (0 = no repeat)
  created_at?: string; // UTC, "YYYY-MM-DD HH:MM:SS" (SQLite CURRENT_TIMESTAMP)
}

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Desconhecido'];

export type ActivityType = 'water' | 'walk' | 'physio' | 'bp' | 'glucose' | 'weight' | 'custom';

export const ACTIVITY_PRESETS: Record<ActivityType, { icon: string; defaultName: string }> = {
  water:   { icon: '💧', defaultName: 'Tomar água' },
  walk:    { icon: '🚶', defaultName: 'Caminhada' },
  physio:  { icon: '🏋️', defaultName: 'Fisioterapia' },
  bp:      { icon: '❤️', defaultName: 'Medir Pressão' },
  glucose: { icon: '🩸', defaultName: 'Medir Glicose' },
  weight:  { icon: '⚖️', defaultName: 'Pesar-se' },
  custom:  { icon: '📌', defaultName: '' },
};

export interface Activity {
  id: number;
  type: ActivityType;
  name: string;
  notes: string;
  created_at: string;
}

export interface ActivityReminder {
  id: number;
  activity_id: number;
  time: string;
  is_active: boolean;
  with_sound: boolean;
  period?: string;  // 'day' | 'week:1,2,3...' (1=Dom, 2=Seg...7=Sáb)
}

export interface Appointment {
  id: number;
  doctor_name: string;
  specialty: string;
  date: string;   // "YYYY-MM-DD"
  time: string;   // "HH:MM"
  location: string;
  notes: string;
  created_at: string;
}
