import * as SQLite from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import { Profile, Medication, EmergencyContact, MedicationReminder, Activity, ActivityReminder, ActivityType, Appointment } from '../types';

let db: SQLite.SQLiteDatabase | null = null;
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// O objeto NATIVO do SQLite pode morrer por baixo do JS. Quando o Android destrói a Activity
// (a Samsung faz isso agressivamente), o registro de shared objects do Expo vai junto — mas este
// módulo continua segurando o handle antigo, e o JS do app sobrevive: os lembretes rodam com a
// tela fechada. A consulta seguinte estoura com "Cannot use shared object that was already
// released", e como quase toda gravação de log sai de handler de notificação, o erro ia parar
// numa promise sem dono. Falhava CALADO: 9 eventos no Sentry, em 3 aparelhos reais.
//
// Aqui o handle morto é reconhecido e o banco reaberto — uma vez só, para não virar laço.
const HANDLE_MORTO = /already released|shared object/i;
const OPERACOES = ['runAsync', 'execAsync', 'getAllAsync', 'getFirstAsync'] as const;
type Operacao = (typeof OPERACOES)[number];

const ORIGINAIS = new WeakMap<SQLite.SQLiteDatabase, Record<Operacao, Function>>();

// Dentro de uma transação NÃO se reabre. O único uso é o restore do backup: reabrir no meio
// aplicaria o resto num banco novo e deixaria os dados pela metade. Ali a falha tem que subir.
let emTransacao = false;

function ehHandleMorto(erro: unknown): boolean {
  return HANDLE_MORTO.test(String((erro as { message?: string })?.message ?? erro));
}

function blindar(database: SQLite.SQLiteDatabase): SQLite.SQLiteDatabase {
  const originais = {} as Record<Operacao, Function>;

  for (const nome of OPERACOES) {
    const original = (database[nome] as Function).bind(database);
    originais[nome] = original;
    (database as unknown as Record<string, unknown>)[nome] = async (...args: unknown[]) => {
      try {
        return await original(...args);
      } catch (erro) {
        if (emTransacao || !ehHandleMorto(erro)) throw erro;
        Sentry.captureMessage(`SQLite reaberto após handle liberado (${nome})`, 'warning');
        // Só descarta se ninguém já descartou: com duas consultas falhando juntas, a segunda
        // apagaria a reabertura em curso da primeira e o banco seria aberto duas vezes.
        if (db === database) {
          db = null;
          dbInitPromise = null;
        }
        const novo = await getDb();
        // Chama o método CRU do banco novo: uma tentativa, e se ela falhar o erro sobe.
        return await ORIGINAIS.get(novo)![nome](...args);
      }
    };
  }

  const transacaoOriginal = database.withTransactionAsync.bind(database);
  (database as unknown as Record<string, unknown>).withTransactionAsync = async (fn: () => Promise<void>) => {
    emTransacao = true;
    try {
      return await transacaoOriginal(fn);
    } finally {
      emTransacao = false;
    }
  };

  ORIGINAIS.set(database, originais);
  return database;
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      const database = await SQLite.openDatabaseAsync('medalert.db');
      await initSchema(database);
      await runMigrations(database);
      db = blindar(database);
      return db;
    })();
  }
  return dbInitPromise;
}

// Substitui o `.catch(() => {})` das gravações de log. Uma dose que o usuário respondeu e que o
// banco não gravou é justamente o bug que estamos caçando ("Tomei" que ninguém marcou, alerta
// que some sem deixar rastro) — engolir esse erro é apagar a única prova.
export function falhaDeBanco(contexto: string) {
  return (erro: unknown) => {
    console.warn(`[db] falhou: ${contexto}`, erro);
    Sentry.captureException(erro, { tags: { db_contexto: contexto } });
  };
}

async function initSchema(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      name TEXT NOT NULL DEFAULT '',
      blood_type TEXT DEFAULT 'Desconhecido',
      birth_date TEXT DEFAULT '',
      allergies TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS medications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generic_name TEXT NOT NULL,
      commercial_name TEXT DEFAULT '',
      dose TEXT DEFAULT '',
      frequency TEXT DEFAULT '',
      is_critical INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS emergency_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      relationship TEXT DEFAULT '',
      is_primary INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS medication_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER,
      time TEXT NOT NULL,
      days TEXT DEFAULT '["seg","ter","qua","qui","sex","sab","dom"]',
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'custom',
      name TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      time TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doctor_name TEXT NOT NULL,
      specialty TEXT DEFAULT '',
      date TEXT NOT NULL,
      time TEXT NOT NULL DEFAULT '08:00',
      location TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER,
      activity_name TEXT NOT NULL,
      activity_type TEXT NOT NULL DEFAULT 'custom',
      realized INTEGER DEFAULT 1,
      value TEXT DEFAULT '',
      logged_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS medication_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medication_id INTEGER,
      medication_name TEXT NOT NULL,
      dose TEXT DEFAULT '',
      notification_id TEXT,
      scheduled_at TEXT NOT NULL,
      taken INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  try {
    await database.execAsync('ALTER TABLE medication_reminders ADD COLUMN with_sound INTEGER DEFAULT 1');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN stock_quantity INTEGER');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN end_date TEXT');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE medication_reminders ADD COLUMN repeat_interval INTEGER DEFAULT 0');
  } catch {}
  // Add with_sound to activity_reminders
  try {
    await database.execAsync('ALTER TABLE activity_reminders ADD COLUMN with_sound INTEGER DEFAULT 1');
  } catch {}
  // Add period to activity_reminders for weekday scheduling
  try {
    await database.execAsync("ALTER TABLE activity_reminders ADD COLUMN period TEXT DEFAULT 'day'");
  } catch {}
  // Repair: restore is_active=1 for reminders broken by previous bell-mute implementation
  try {
    await database.execAsync('UPDATE medication_reminders SET is_active=1 WHERE is_active=0');
  } catch {}
  try {
    await database.execAsync('UPDATE activity_reminders SET is_active=1 WHERE is_active=0');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE emergency_contacts ADD COLUMN is_doctor INTEGER DEFAULT 0');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE emergency_contacts ADD COLUMN show_on_lock INTEGER DEFAULT 0');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN archived INTEGER DEFAULT 0');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE profile ADD COLUMN emergency_card_enabled INTEGER DEFAULT 1');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN home_reminder INTEGER DEFAULT 1');
  } catch {}
  // Unique index so INSERT OR IGNORE works for background-notification upsert
  try {
    await database.execAsync(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_medlog_notif ON medication_log(notification_id) WHERE notification_id IS NOT NULL'
    );
  } catch {}
  // medication_overdue_log: tabela criada para a feature de "não informados", que nunca foi
  // ligada — logOverdueAlert() jamais foi chamado, então a tabela sempre esteve VAZIA em
  // qualquer instalação. A necessidade que a motivou (saber quais doses ficaram sem
  // resposta) é atendida por reconcileMissedDoses(), que grava direto no medication_log.
  // Drop é seguro: não há dado a perder.
  try {
    await database.execAsync('DROP TABLE IF EXISTS medication_overdue_log');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE medication_log ADD COLUMN taken_at TEXT');
  } catch {}
  // created_at nunca existiu nesta tabela — sem ela, reminderExistedBeforeSlot()
  // (HomeScreen) nunca conseguia detectar lembrete recém-criado e cobrava dose
  // retroativa em qualquer instalação nova ou restore de backup
  try {
    await database.execAsync('ALTER TABLE medication_reminders ADD COLUMN created_at TEXT');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN save_history INTEGER DEFAULT 1');
  } catch {}
  // Distingue tomei/não tomei/dispensado/tratamento encerrado no histórico
  // (antes só existia o campo "taken" 1/0/null, que não cobria dispensado nem fim de tratamento)
  try {
    await database.execAsync('ALTER TABLE medication_log ADD COLUMN status TEXT');
  } catch {}
  // Atividade "Ciclo Menstrual": guarda o 1º dia do ciclo atual e as durações usadas
  // para calcular a fase do dia (ver getCyclePhase em AgendaScreen.tsx)
  try {
    await database.execAsync('ALTER TABLE activities ADD COLUMN cycle_start_date TEXT');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE activities ADD COLUMN cycle_length_days INTEGER DEFAULT 28');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE activities ADD COLUMN period_length_days INTEGER DEFAULT 5');
  } catch {}
  // Quantas unidades (cápsulas/comprimidos) equivalem a 1 dose — antes o controle
  // de estoque sempre assumia 1 dose = 1 unidade, errando a contagem para doses
  // de mais de 1 cápsula/comprimido
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN units_per_dose INTEGER DEFAULT 1');
  } catch {}
  // Stand-by: medicamento pausado temporariamente — sem alarmes, fora da tela de
  // bloqueio e da ficha de emergência, mas com o setup (lembretes) preservado
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN suspended INTEGER DEFAULT 0');
  } catch {}
}

// Profile
export async function getProfile(): Promise<Profile | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<Profile>('SELECT * FROM profile WHERE id = 1');
  return row ?? null;
}

export async function saveProfile(data: Partial<Profile>): Promise<void> {
  const database = await getDb();
  const existing = await getProfile();

  if (existing) {
    await database.runAsync(
      `UPDATE profile SET name=?, blood_type=?, birth_date=?, allergies=?, notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=1`,
      [data.name ?? '', data.blood_type ?? 'Desconhecido', data.birth_date ?? '', data.allergies ?? '', data.notes ?? '']
    );
  } else {
    await database.runAsync(
      `INSERT INTO profile (id, name, blood_type, birth_date, allergies, notes) VALUES (1, ?, ?, ?, ?, ?)`,
      [data.name ?? '', data.blood_type ?? 'Desconhecido', data.birth_date ?? '', data.allergies ?? '', data.notes ?? '']
    );
  }
}

// Medications
// Por padrão exclui suspensos (stand-by): Home, tela de bloqueio, ficha de
// emergência e reagendamento ignoram o medicamento sem precisar filtrar.
// Só a lista de medicamentos passa includeSuspended=true para exibi-los.
export async function getMedications(includeSuspended = false): Promise<Medication[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<Medication>(
    'SELECT * FROM medications WHERE (archived=0 OR archived IS NULL)' +
    (includeSuspended ? '' : ' AND (suspended=0 OR suspended IS NULL)')
  );
  const meds = rows.map(r => ({
    ...r,
    is_critical: Boolean(r.is_critical),
    stock_quantity: r.stock_quantity ?? null,
    units_per_dose: r.units_per_dose ?? 1,
    end_date: r.end_date ?? null,
    home_reminder: r.home_reminder ?? 1,
    save_history: r.save_history ?? 1,
    suspended: r.suspended ?? 0,
  }));
  // Alfabético pelo nome exibido no card (comercial, senão genérico), com
  // acentos tratados; suspensos vão para o fim da lista
  const displayName = (m: Medication) => (m.commercial_name?.trim() || m.generic_name);
  meds.sort((a, b) =>
    (a.suspended ? 1 : 0) - (b.suspended ? 1 : 0) ||
    displayName(a).localeCompare(displayName(b), 'pt-BR', { sensitivity: 'base' })
  );
  return meds;
}

export async function setMedicationSuspended(id: number, suspended: boolean): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE medications SET suspended=? WHERE id=?', [suspended ? 1 : 0, id]);
}

export async function addMedication(med: Omit<Medication, 'id'>): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    `INSERT INTO medications (generic_name, commercial_name, dose, frequency, is_critical, notes, stock_quantity, units_per_dose, end_date, home_reminder, save_history) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [med.generic_name ?? '', med.commercial_name ?? '', med.dose ?? '', med.frequency ?? '', med.is_critical ? 1 : 0, med.notes ?? '', med.stock_quantity ?? null, med.units_per_dose ?? 1, med.end_date ?? null, med.home_reminder ?? 1, med.save_history ?? 1]
  );
  return result.lastInsertRowId;
}

export async function updateMedication(med: Medication): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE medications SET generic_name=?, commercial_name=?, dose=?, frequency=?, is_critical=?, notes=?, stock_quantity=?, units_per_dose=?, end_date=?, home_reminder=?, save_history=? WHERE id=?`,
    [med.generic_name, med.commercial_name, med.dose, med.frequency, med.is_critical ? 1 : 0, med.notes, med.stock_quantity ?? null, med.units_per_dose ?? 1, med.end_date ?? null, med.home_reminder ?? 1, med.save_history ?? 1, med.id]
  );
}

export async function updateMedicationStock(id: number, newQuantity: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE medications SET stock_quantity=? WHERE id=?', [newQuantity, id]);
}

export async function getMedicationById(id: number): Promise<Medication | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<Medication>('SELECT * FROM medications WHERE id=?', [id]);
  if (!row) return null;
  return { ...row, is_critical: Boolean(row.is_critical), stock_quantity: row.stock_quantity ?? null, units_per_dose: row.units_per_dose ?? 1, end_date: row.end_date ?? null, save_history: row.save_history ?? 1 };
}

export async function deleteMedication(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM medications WHERE id=?', [id]);
}

// Emergency Contacts
export async function getContacts(): Promise<EmergencyContact[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<EmergencyContact>(
    'SELECT * FROM emergency_contacts ORDER BY is_primary DESC, name ASC'
  );
  return rows.map(r => ({ ...r, is_primary: Boolean(r.is_primary), is_doctor: Boolean((r as any).is_doctor), show_on_lock: Boolean((r as any).show_on_lock) }));
}

export async function addContact(contact: Omit<EmergencyContact, 'id'>): Promise<void> {
  const database = await getDb();
  if (contact.is_primary) {
    await database.runAsync('UPDATE emergency_contacts SET is_primary=0');
  }
  await database.runAsync(
    `INSERT INTO emergency_contacts (name, phone, relationship, is_primary, is_doctor, show_on_lock) VALUES (?, ?, ?, ?, ?, ?)`,
    [contact.name, contact.phone, contact.relationship, contact.is_primary ? 1 : 0, contact.is_doctor ? 1 : 0, contact.show_on_lock ? 1 : 0]
  );
}

export async function updateContact(contact: EmergencyContact): Promise<void> {
  const database = await getDb();
  if (contact.is_primary) {
    await database.runAsync('UPDATE emergency_contacts SET is_primary=0 WHERE id != ?', [contact.id]);
  }
  await database.runAsync(
    `UPDATE emergency_contacts SET name=?, phone=?, relationship=?, is_primary=?, is_doctor=?, show_on_lock=? WHERE id=?`,
    [contact.name, contact.phone, contact.relationship, contact.is_primary ? 1 : 0, contact.is_doctor ? 1 : 0, contact.show_on_lock ? 1 : 0, contact.id]
  );
}

export async function deleteContact(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM emergency_contacts WHERE id=?', [id]);
}

// Medication Reminders
type ReminderRow = { id: number; medication_id: number; time: string; days: string; with_sound: number; is_active: number; repeat_interval: number; created_at?: string };

export async function getRemindersForMedication(medicationId: number): Promise<MedicationReminder[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<ReminderRow>(
    'SELECT * FROM medication_reminders WHERE medication_id=? ORDER BY time ASC',
    [medicationId]
  );
  return rows.map(r => ({
    ...r,
    period: r.days ?? 'day',
    with_sound: Boolean(r.with_sound),
    is_active: Boolean(r.is_active),
    repeat_interval: r.repeat_interval ?? 0,
  }));
}

export async function addReminder(r: Omit<MedicationReminder, 'id'>): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'INSERT INTO medication_reminders (medication_id, time, days, with_sound, is_active, repeat_interval, created_at) VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)',
    [r.medication_id, r.time, r.period ?? 'day', r.with_sound ? 1 : 0, r.repeat_interval ?? 0]
  );
}

export async function deleteReminder(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM medication_reminders WHERE id=?', [id]);
}

export async function toggleReminderActive(id: number, isActive: boolean): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE medication_reminders SET is_active=? WHERE id=?', [isActive ? 1 : 0, id]);
}

export async function updateAllRemindersSound(medicationId: number, withSound: boolean): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE medication_reminders SET with_sound=? WHERE medication_id=?', [withSound ? 1 : 0, medicationId]);
}

export async function updateReminderSound(id: number, withSound: boolean): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE medication_reminders SET with_sound=? WHERE id=?', [withSound ? 1 : 0, id]);
}

export async function deleteAllRemindersForMedication(medicationId: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM medication_reminders WHERE medication_id=?', [medicationId]);
}

export async function setAllMedicationRemindersActive(medicationId: number, isActive: boolean): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE medication_reminders SET is_active=? WHERE medication_id=?', [isActive ? 1 : 0, medicationId]);
}

export async function setAllActivityRemindersActive(activityId: number, isActive: boolean): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE activity_reminders SET is_active=? WHERE activity_id=?', [isActive ? 1 : 0, activityId]);
}

export async function updateAllRemindersInterval(medicationId: number, intervalMinutes: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE medication_reminders SET repeat_interval=? WHERE medication_id=?', [intervalMinutes, medicationId]);
}

export async function countReminders(medicationId: number): Promise<number> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM medication_reminders WHERE medication_id=? AND is_active=1',
    [medicationId]
  );
  return row?.n ?? 0;
}

// Key-Value store (used by dbSync)
export async function getKV(key: string): Promise<string | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ value: string; updated_at: string }>(
    'SELECT value, updated_at FROM kv_store WHERE key = ?', [key]
  );
  return row?.value ?? null;
}

export async function setKV(key: string, value: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
    [key, value]
  );
}

export async function getKVAge(key: string): Promise<number> {
  const database = await getDb();
  const row = await database.getFirstAsync<{ days: number }>(
    "SELECT CAST((julianday('now') - julianday(updated_at)) AS INTEGER) AS days FROM kv_store WHERE key = ?",
    [key]
  );
  return row?.days ?? 999;
}

// Activities
export async function getActivities(): Promise<Activity[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<Activity>('SELECT * FROM activities ORDER BY name ASC');
  return rows.map(r => ({
    ...r,
    cycle_length_days: r.cycle_length_days ?? 28,
    period_length_days: r.period_length_days ?? 5,
  }));
}

export async function addActivity(a: Omit<Activity, 'id' | 'created_at'>): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    'INSERT INTO activities (type, name, notes, cycle_start_date, cycle_length_days, period_length_days) VALUES (?, ?, ?, ?, ?, ?)',
    [a.type, a.name, a.notes ?? '', a.cycle_start_date ?? null, a.cycle_length_days ?? 28, a.period_length_days ?? 5]
  );
  return result.lastInsertRowId;
}

export async function updateActivity(a: Activity): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE activities SET type=?, name=?, notes=?, cycle_start_date=?, cycle_length_days=?, period_length_days=? WHERE id=?',
    [a.type, a.name, a.notes ?? '', a.cycle_start_date ?? null, a.cycle_length_days ?? 28, a.period_length_days ?? 5, a.id]
  );
}

export async function deleteActivity(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM activities WHERE id=?', [id]);
}

// "Hoje começou": reinicia a contagem do ciclo a partir de hoje
export async function updateCycleStart(activityId: number, isoDate: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE activities SET cycle_start_date=? WHERE id=?', [isoDate, activityId]);
}

// Activity Reminders
type ActivityReminderRow = { id: number; activity_id: number; time: string; is_active: number; with_sound: number; period?: string };

export async function getRemindersForActivity(activityId: number): Promise<ActivityReminder[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<ActivityReminderRow>(
    'SELECT * FROM activity_reminders WHERE activity_id=? ORDER BY time ASC',
    [activityId]
  );
  return rows.map(r => ({ ...r, is_active: Boolean(r.is_active), with_sound: r.with_sound !== 0, period: r.period ?? 'day' }));
}

export async function addActivityReminder(r: Omit<ActivityReminder, 'id'>): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'INSERT INTO activity_reminders (activity_id, time, is_active, with_sound, period) VALUES (?, ?, 1, 1, ?)',
    [r.activity_id, r.time, r.period ?? 'day']
  );
}

export async function updateAllActivityRemindersSound(activityId: number, withSound: boolean): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE activity_reminders SET with_sound=? WHERE activity_id=?', [withSound ? 1 : 0, activityId]);
}

export async function deleteActivityReminder(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM activity_reminders WHERE id=?', [id]);
}

export async function deleteAllRemindersForActivity(activityId: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM activity_reminders WHERE activity_id=?', [activityId]);
}

// Appointments
export async function getAppointments(): Promise<Appointment[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<Appointment>(
    "SELECT * FROM appointments ORDER BY date ASC, time ASC"
  );
  return rows;
}

export async function addAppointment(a: Omit<Appointment, 'id' | 'created_at'>): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    'INSERT INTO appointments (doctor_name, specialty, date, time, location, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [a.doctor_name, a.specialty ?? '', a.date, a.time, a.location ?? '', a.notes ?? '']
  );
  return result.lastInsertRowId;
}

export async function updateAppointment(a: Appointment): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE appointments SET doctor_name=?, specialty=?, date=?, time=?, location=?, notes=? WHERE id=?',
    [a.doctor_name, a.specialty ?? '', a.date, a.time, a.location ?? '', a.notes ?? '', a.id]
  );
}

export async function deleteAppointment(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM appointments WHERE id=?', [id]);
}

// Activity Logs
export interface ActivityLog {
  id: number;
  activity_id: number | null;
  activity_name: string;
  activity_type: string;
  realized: boolean;
  value: string;
  logged_at: string;
}

export async function addActivityLog(log: Omit<ActivityLog, 'id' | 'logged_at'>): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT INTO activity_logs (activity_id, activity_name, activity_type, realized, value, logged_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [log.activity_id ?? null, log.activity_name, log.activity_type, log.realized ? 1 : 0, log.value, now],
  );
}

export async function getActivityLogs(limit = 5000): Promise<ActivityLog[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(
    'SELECT * FROM activity_logs ORDER BY logged_at DESC LIMIT ?', [limit],
  );
  return rows.map(r => ({ ...r, realized: Boolean(r.realized) }));
}

export async function getActivityLogsForActivity(activityId: number, limit = 5): Promise<ActivityLog[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<any>(
    'SELECT * FROM activity_logs WHERE activity_id=? ORDER BY logged_at DESC LIMIT ?',
    [activityId, limit],
  );
  return rows.map(r => ({ ...r, realized: Boolean(r.realized) }));
}

export async function deleteActivityLog(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM activity_logs WHERE id=?', [id]);
}

export async function deleteActivityLogsBefore(isoDate: string): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM activity_logs WHERE logged_at < ?', [isoDate]);
}

export async function clearAllActivityLogs(): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM activity_logs');
}

// Medication Log
export interface MedicationLogEntry {
  id: number;
  medication_id: number | null;
  medication_name: string;
  dose: string;
  notification_id: string | null;
  scheduled_at: string;
  taken_at: string | null;
  taken: number | null;
  status: 'taken' | 'skipped' | 'treatment_ended' | 'low_stock' | null;
  created_at: string;
}

export async function addMedicationLog(entry: {
  medication_id: number;
  medication_name: string;
  dose: string;
  notification_id: string;
  scheduled_at: string;
  taken_at?: string;
}): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT OR IGNORE INTO medication_log (medication_id, medication_name, dose, notification_id, scheduled_at, taken_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [entry.medication_id, entry.medication_name, entry.dose, entry.notification_id, entry.scheduled_at, entry.taken_at ?? null]
  );
}

// Garante que a entrada existe (cria se não existir) e atualiza o status taken.
// Necessário quando a notificação disparou em background e o received listener não rodou.
export async function upsertMedicationLogTaken(
  notifId: string,
  medicationId: number,
  name: string,
  dose: string,
  taken: boolean,
  scheduledAtIso?: string,
): Promise<void> {
  const database = await getDb();
  const scheduledAt = scheduledAtIso ?? new Date().toISOString();
  await database.runAsync(
    `INSERT OR IGNORE INTO medication_log (medication_id, medication_name, dose, notification_id, scheduled_at) VALUES (?, ?, ?, ?, ?)`,
    [medicationId, name, dose, notifId, scheduledAt]
  );
  await database.runAsync(
    'UPDATE medication_log SET taken=?, status=? WHERE notification_id=?',
    [taken ? 1 : 0, taken ? 'taken' : 'skipped', notifId]
  );
}

export async function markMedicationLogTaken(notification_id: string, taken: boolean): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE medication_log SET taken=?, status=? WHERE notification_id=?',
    [taken ? 1 : 0, taken ? 'taken' : 'skipped', notification_id]
  );
}

// Aviso de estoque baixo: uma linha por medicamento por dia (dedup via notification_id
// com a data, INSERT OR IGNORE) — o alerta pode disparar várias vezes no mesmo dia.
export async function addMedicationLowStockLog(medicationId: number, medicationName: string, daysLeft: number): Promise<void> {
  const database = await getDb();
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await database.runAsync(
    `INSERT OR IGNORE INTO medication_log (medication_id, medication_name, dose, notification_id, scheduled_at, status) VALUES (?, ?, ?, ?, ?, 'low_stock')`,
    [medicationId, medicationName, `restam ~${daysLeft} dia${daysLeft !== 1 ? 's' : ''} de doses`, `low_stock_${medicationId}_${dateStr}`, d.toISOString()]
  );
}

// notification_id fixo (igual ao da notificação de "Tratamento encerrado") para o
// INSERT OR IGNORE evitar duplicar o registro se o app reiniciar antes do medicamento ser arquivado.
export async function addMedicationTreatmentEndedLog(medicationId: number, medicationName: string): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT OR IGNORE INTO medication_log (medication_id, medication_name, dose, notification_id, scheduled_at, status) VALUES (?, ?, '', ?, ?, 'treatment_ended')`,
    [medicationId, medicationName, `treatment_ended_${medicationId}`, new Date().toISOString()]
  );
}

// Resposta dada pelo card da Home: se o disparo da notificação já criou uma linha "sem
// resposta" para o mesmo horário (±50min, mesma janela do isSlotTaken da Home), atualiza essa
// linha em vez de criar uma segunda — evita registro duplicado da mesma dose no histórico.
export async function resolveMedicationLogSlot(entry: {
  medication_id: number;
  medication_name: string;
  dose: string;
  notification_id: string;
  scheduled_at: string;
  taken: boolean;
  taken_at?: string;
}): Promise<void> {
  const database = await getDb();
  const slotSecs = Math.floor(new Date(entry.scheduled_at).getTime() / 1000);
  const existing = await database.getFirstAsync<{ id: number }>(
    `SELECT id FROM medication_log
     WHERE medication_id=? AND taken IS NULL AND status IS NULL
       AND ABS(strftime('%s', scheduled_at) - ?) < 3000
     ORDER BY ABS(strftime('%s', scheduled_at) - ?) LIMIT 1`,
    [entry.medication_id, slotSecs, slotSecs]
  );
  if (existing) {
    await database.runAsync(
      'UPDATE medication_log SET taken=?, status=?, taken_at=? WHERE id=?',
      [entry.taken ? 1 : 0, entry.taken ? 'taken' : 'skipped', entry.taken_at ?? null, existing.id]
    );
    return;
  }
  await database.runAsync(
    `INSERT OR IGNORE INTO medication_log (medication_id, medication_name, dose, notification_id, scheduled_at, taken_at, taken, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [entry.medication_id, entry.medication_name, entry.dose, entry.notification_id, entry.scheduled_at, entry.taken_at ?? null, entry.taken ? 1 : 0, entry.taken ? 'taken' : 'skipped']
  );
}

// Edição manual pelo usuário na tela de Histórico: só permite alternar entre tomei/não
// tomei e ajustar o horário exibido (mantém taken_at limpo para o card continuar com uma linha só).
export async function updateMedicationLogEntry(
  id: number,
  status: 'taken' | 'skipped',
  scheduledAtIso: string,
): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE medication_log SET status=?, taken=?, scheduled_at=?, taken_at=NULL WHERE id=?',
    [status, status === 'taken' ? 1 : 0, scheduledAtIso, id]
  );
}


// ---------------------------------------------------------------------------
// "Sem resposta" no histórico.
//
// A linha do log só era criada dentro do addNotificationReceivedListener, que exige o JS
// VIVO. Quando o Android matava o processo, o lembrete disparava nativamente e NENHUMA
// linha era criada: se o usuário não respondesse, a dose simplesmente não existia no
// histórico. Silêncio, no app cuja função é lembrar de tomar remédio, é o pior modo de
// falha — o paciente não tem como saber o que esqueceu.
//
// Esta reconciliação varre os horários já vencidos e cria a linha faltante com
// taken/status NULL — que é o estado "Sem resposta" que a tela de Histórico já sabe
// exibir. Roda na abertura do app e ao voltar do background.
//
// O notification_id usa EXATAMENTE o mesmo formato do dailyLogId() do App.tsx
// (`<identifier do lembrete>_YYYY-MM-DD`), então o INSERT OR IGNORE colide de propósito
// com a linha do listener: nunca duplica, e responder "Tomei" depois atualiza esta mesma
// linha (upsertMedicationLogTaken faz UPDATE ... WHERE notification_id=?).
// ---------------------------------------------------------------------------
function reminderBaseId(medicationId: number, time: string, period: string): string | null {
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const tp = `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
  if (period === 'day') return `reminder_${medicationId}_${tp}`;
  if (period.startsWith('week:')) return `reminder_${medicationId}_w{WD}_${tp}`;   // {WD} trocado por dia
  if (period.startsWith('month:')) return `reminder_${medicationId}_m{DOM}_${tp}`; // {DOM} trocado por dia
  return null; // 'year:' não tem lembrete diário — fora do escopo
}

function occursOn(period: string, d: Date): boolean {
  if (period === 'day') return true;
  if (period.startsWith('week:')) {
    const wd = d.getDay() + 1; // 1=Dom … 7=Sáb
    return period.split(':')[1].split(',').map(Number).includes(wd);
  }
  if (period.startsWith('month:')) {
    return period.split(':')[1].split(',').map(Number).includes(d.getDate());
  }
  return false;
}

export async function reconcileMissedDoses(lookbackDays = 7): Promise<number> {
  const database = await getDb();
  const now = new Date();
  // Margem: não marca como "sem resposta" uma dose que acabou de vencer — o usuário
  // ainda pode estar respondendo e o listener pode estar criando a linha agora.
  const cutoffMs = now.getTime() - 5 * 60 * 1000;

  const meds = await database.getAllAsync<{
    id: number; generic_name: string; commercial_name: string | null; dose: string | null;
    end_date: string | null; save_history: number | null; created_at: string;
  }>(
    `SELECT id, generic_name, commercial_name, dose, end_date, save_history, created_at
       FROM medications
      WHERE (archived=0 OR archived IS NULL) AND (suspended=0 OR suspended IS NULL)`
  );

  let created = 0;
  for (const med of meds) {
    // save_history=0 → o medicamento é "só alerta", não pergunta nem registra.
    if (med.save_history === 0) continue;

    const reminders = await database.getAllAsync<{ time: string; days: string; is_active: number }>(
      'SELECT time, days, is_active FROM medication_reminders WHERE medication_id=?',
      [med.id]
    );
    if (!reminders.length) continue;

    const createdMs = new Date(med.created_at.replace(' ', 'T') + 'Z').getTime();
    const endMs = med.end_date ? new Date(med.end_date + 'T23:59:59').getTime() : Infinity;
    const name = med.commercial_name?.trim() || med.generic_name;

    for (let back = lookbackDays; back >= 0; back--) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);

      for (const r of reminders) {
        if (!r.is_active) continue;
        const period = r.days || 'day';
        if (!occursOn(period, day)) continue;

        const [h, m] = r.time.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) continue;
        const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
        const slotMs = slot.getTime();

        if (slotMs > cutoffMs) continue;        // ainda não venceu (ou acabou de vencer)
        if (slotMs < createdMs) continue;       // o medicamento nem existia
        if (slotMs > endMs) continue;           // tratamento já encerrado

        let base = reminderBaseId(med.id, r.time, period);
        if (!base) continue;
        base = base.replace('{WD}', String(day.getDay() + 1)).replace('{DOM}', String(day.getDate()));
        const ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const notifId = `${base}_${ymd}`;

        const res = await database.runAsync(
          `INSERT OR IGNORE INTO medication_log
             (medication_id, medication_name, dose, notification_id, scheduled_at)
           VALUES (?, ?, ?, ?, ?)`,
          [med.id, name, med.dose ?? '', notifId, slot.toISOString()]
        );
        if (res.changes > 0) created++;
      }
    }
  }
  return created;
}

export async function getMedicationLog(opts?: { medication_id?: number; since_iso?: string }): Promise<MedicationLogEntry[]> {
  const database = await getDb();
  const conditions: string[] = [];
  const params: any[] = [];
  if (opts?.medication_id != null) { conditions.push('medication_id=?'); params.push(opts.medication_id); }
  if (opts?.since_iso) { conditions.push('scheduled_at >= ?'); params.push(opts.since_iso); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await database.getAllAsync<MedicationLogEntry>(
    `SELECT * FROM medication_log ${where} ORDER BY scheduled_at DESC LIMIT 500`,
    params
  );
  return rows;
}

export async function deleteMedicationLog(mode: 'year' | 'all'): Promise<void> {
  const database = await getDb();
  if (mode === 'all') {
    await database.runAsync('DELETE FROM medication_log');
  } else {
    await database.runAsync("DELETE FROM medication_log WHERE scheduled_at < date('now','-1 year')");
  }
}

export async function archiveMedication(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('UPDATE medications SET archived=1 WHERE id=?', [id]);
}

export async function getExpiredUnarchivedMedications(): Promise<Medication[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<Medication>(
    "SELECT * FROM medications WHERE end_date IS NOT NULL AND end_date < date('now') AND (archived IS NULL OR archived=0) AND (suspended IS NULL OR suspended=0)"
  );
  return rows.map(r => ({
    ...r,
    is_critical: Boolean(r.is_critical),
    stock_quantity: r.stock_quantity ?? null,
    end_date: r.end_date ?? null,
  }));
}

// Backup / Restore
export async function exportBackup(): Promise<string> {
  const database = await getDb();
  const [profile, medications, med_reminders, contacts, activities, act_reminders, appointments] = await Promise.all([
    database.getFirstAsync<any>('SELECT * FROM profile WHERE id=1'),
    database.getAllAsync<any>('SELECT * FROM medications'),
    database.getAllAsync<any>('SELECT * FROM medication_reminders'),
    database.getAllAsync<any>('SELECT * FROM emergency_contacts'),
    database.getAllAsync<any>('SELECT * FROM activities'),
    database.getAllAsync<any>('SELECT * FROM activity_reminders'),
    database.getAllAsync<any>('SELECT * FROM appointments'),
  ]);
  return JSON.stringify({
    version: 1,
    exported_at: new Date().toISOString(),
    data: { profile, medications, medication_reminders: med_reminders, emergency_contacts: contacts, activities, activity_reminders: act_reminders, appointments },
  });
}

export async function importBackup(json: string): Promise<void> {
  const parsed = JSON.parse(json);
  if (!parsed?.data || parsed.version !== 1) throw new Error('Formato de backup inválido');
  const { profile, medications, medication_reminders, emergency_contacts, activities, activity_reminders, appointments } = parsed.data;

  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.execAsync(
      'DELETE FROM activity_reminders; DELETE FROM medication_reminders; DELETE FROM appointments; DELETE FROM activities; DELETE FROM emergency_contacts; DELETE FROM medications; DELETE FROM profile;'
    );

    if (profile) {
      await database.runAsync(
        'INSERT INTO profile (id, name, blood_type, birth_date, allergies, notes) VALUES (?,?,?,?,?,?)',
        [1, profile.name ?? '', profile.blood_type ?? 'Desconhecido', profile.birth_date ?? '', profile.allergies ?? '', profile.notes ?? '']
      );
    }
    for (const m of (medications ?? [])) {
      await database.runAsync(
        'INSERT INTO medications (id, generic_name, commercial_name, dose, frequency, is_critical, notes, stock_quantity, units_per_dose, end_date, archived, home_reminder, save_history, suspended) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [m.id, m.generic_name ?? '', m.commercial_name ?? '', m.dose ?? '', m.frequency ?? '', m.is_critical ?? 0, m.notes ?? '', m.stock_quantity ?? null, m.units_per_dose ?? 1, m.end_date ?? null, m.archived ?? 0, m.home_reminder ?? 1, m.save_history ?? 1, m.suspended ?? 0]
      );
    }
    for (const r of (medication_reminders ?? [])) {
      // created_at = agora (não o do backup): um lembrete restaurado não deve
      // ser cobrado como dose perdida por horários que já passaram hoje
      await database.runAsync(
        'INSERT INTO medication_reminders (id, medication_id, time, days, with_sound, is_active, repeat_interval, created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP)',
        [r.id, r.medication_id, r.time, r.days ?? '["seg","ter","qua","qui","sex","sab","dom"]', r.with_sound ?? 1, r.is_active ?? 1, r.repeat_interval ?? 0]
      );
    }
    for (const c of (emergency_contacts ?? [])) {
      await database.runAsync(
        'INSERT INTO emergency_contacts (id, name, phone, relationship, is_primary, is_doctor, show_on_lock) VALUES (?,?,?,?,?,?,?)',
        [c.id, c.name ?? '', c.phone ?? '', c.relationship ?? '', c.is_primary ?? 0, c.is_doctor ?? 0, c.show_on_lock ?? 0]
      );
    }
    for (const a of (activities ?? [])) {
      await database.runAsync(
        'INSERT INTO activities (id, type, name, notes) VALUES (?,?,?,?)',
        [a.id, a.type ?? 'custom', a.name ?? '', a.notes ?? '']
      );
    }
    for (const r of (activity_reminders ?? [])) {
      await database.runAsync(
        'INSERT INTO activity_reminders (id, activity_id, time, is_active, with_sound, period) VALUES (?,?,?,?,?,?)',
        [r.id, r.activity_id, r.time, r.is_active ?? 1, r.with_sound ?? 1, r.period ?? 'day']
      );
    }
    for (const a of (appointments ?? [])) {
      await database.runAsync(
        'INSERT INTO appointments (id, doctor_name, specialty, date, time, location, notes) VALUES (?,?,?,?,?,?,?)',
        [a.id, a.doctor_name ?? '', a.specialty ?? '', a.date ?? '', a.time ?? '08:00', a.location ?? '', a.notes ?? '']
      );
    }
  });
}
