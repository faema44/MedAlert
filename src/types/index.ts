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
}

export interface EmergencyContact {
  id: number;
  name: string;
  phone: string;
  relationship: string;
  is_primary: boolean;
}

export interface DrugInteraction {
  id: string;
  drug1: string;
  drug2: string;
  risk_level: 'critical' | 'high' | 'moderate';
  risk_description: string;
  mechanism: string;
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
}

export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Desconhecido'];
