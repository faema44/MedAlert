import * as SQLite from 'expo-sqlite';
import { Profile, Medication, EmergencyContact, MedicationReminder, Activity, ActivityReminder, ActivityType, Appointment } from '../types';

let db: SQLite.SQLiteDatabase | null = null;
let dbInitPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!dbInitPromise) {
    dbInitPromise = (async () => {
      const database = await SQLite.openDatabaseAsync('medalert.db');
      await initSchema(database);
      await runMigrations(database);
      db = database;
      return database;
    })();
  }
  return dbInitPromise;
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
  // Unique index so INSERT OR IGNORE works for background-notification upsert
  try {
    await database.execAsync(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_medlog_notif ON medication_log(notification_id) WHERE notification_id IS NOT NULL'
    );
  } catch {}
}

// Profile
export async function getProfile(): Promise<Profile | null> {
  const database = await getDb();
  const row = await database.getFirstAsync<any>('SELECT * FROM profile WHERE id = 1');
  if (!row) return null;
  return { ...row, emergency_card_enabled: row.emergency_card_enabled !== 0 };
}

export async function saveProfile(data: Partial<Profile>): Promise<void> {
  const database = await getDb();
  const existing = await getProfile();

  const ecEnabled = data.emergency_card_enabled !== false ? 1 : 0;
  if (existing) {
    await database.runAsync(
      `UPDATE profile SET name=?, blood_type=?, birth_date=?, allergies=?, notes=?, emergency_card_enabled=?, updated_at=CURRENT_TIMESTAMP WHERE id=1`,
      [data.name ?? '', data.blood_type ?? 'Desconhecido', data.birth_date ?? '', data.allergies ?? '', data.notes ?? '', ecEnabled]
    );
  } else {
    await database.runAsync(
      `INSERT INTO profile (id, name, blood_type, birth_date, allergies, notes, emergency_card_enabled) VALUES (1, ?, ?, ?, ?, ?, ?)`,
      [data.name ?? '', data.blood_type ?? 'Desconhecido', data.birth_date ?? '', data.allergies ?? '', data.notes ?? '', ecEnabled]
    );
  }
}

// Medications
export async function getMedications(): Promise<Medication[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<Medication>('SELECT * FROM medications WHERE archived=0 OR archived IS NULL ORDER BY is_critical DESC, generic_name ASC');
  return rows.map(r => ({
    ...r,
    is_critical: Boolean(r.is_critical),
    stock_quantity: r.stock_quantity ?? null,
    end_date: r.end_date ?? null,
  }));
}

export async function addMedication(med: Omit<Medication, 'id'>): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    `INSERT INTO medications (generic_name, commercial_name, dose, frequency, is_critical, notes, stock_quantity, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [med.generic_name ?? '', med.commercial_name ?? '', med.dose ?? '', med.frequency ?? '', med.is_critical ? 1 : 0, med.notes ?? '', med.stock_quantity ?? null, med.end_date ?? null]
  );
  return result.lastInsertRowId;
}

export async function updateMedication(med: Medication): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE medications SET generic_name=?, commercial_name=?, dose=?, frequency=?, is_critical=?, notes=?, stock_quantity=?, end_date=? WHERE id=?`,
    [med.generic_name, med.commercial_name, med.dose, med.frequency, med.is_critical ? 1 : 0, med.notes, med.stock_quantity ?? null, med.end_date ?? null, med.id]
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
  return { ...row, is_critical: Boolean(row.is_critical), stock_quantity: row.stock_quantity ?? null, end_date: row.end_date ?? null };
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
type ReminderRow = { id: number; medication_id: number; time: string; days: string; with_sound: number; is_active: number; repeat_interval: number };

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
    'INSERT INTO medication_reminders (medication_id, time, days, with_sound, is_active, repeat_interval) VALUES (?, ?, ?, ?, 1, ?)',
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
  return rows;
}

export async function addActivity(a: Omit<Activity, 'id' | 'created_at'>): Promise<number> {
  const database = await getDb();
  const result = await database.runAsync(
    'INSERT INTO activities (type, name, notes) VALUES (?, ?, ?)',
    [a.type, a.name, a.notes ?? '']
  );
  return result.lastInsertRowId;
}

export async function updateActivity(a: Activity): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE activities SET type=?, name=?, notes=? WHERE id=?',
    [a.type, a.name, a.notes ?? '', a.id]
  );
}

export async function deleteActivity(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM activities WHERE id=?', [id]);
}

// Activity Reminders
type ActivityReminderRow = { id: number; activity_id: number; time: string; is_active: number; with_sound: number };

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
  taken: number | null;
  created_at: string;
}

export async function addMedicationLog(entry: {
  medication_id: number;
  medication_name: string;
  dose: string;
  notification_id: string;
  scheduled_at: string;
}): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT OR IGNORE INTO medication_log (medication_id, medication_name, dose, notification_id, scheduled_at) VALUES (?, ?, ?, ?, ?)`,
    [entry.medication_id, entry.medication_name, entry.dose, entry.notification_id, entry.scheduled_at]
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
): Promise<void> {
  const database = await getDb();
  const scheduledAt = new Date().toISOString();
  await database.runAsync(
    `INSERT OR IGNORE INTO medication_log (medication_id, medication_name, dose, notification_id, scheduled_at) VALUES (?, ?, ?, ?, ?)`,
    [medicationId, name, dose, notifId, scheduledAt]
  );
  await database.runAsync(
    'UPDATE medication_log SET taken=? WHERE notification_id=?',
    [taken ? 1 : 0, notifId]
  );
}

export async function markMedicationLogTaken(notification_id: string, taken: boolean): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    'UPDATE medication_log SET taken=? WHERE notification_id=?',
    [taken ? 1 : 0, notification_id]
  );
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
    "SELECT * FROM medications WHERE end_date IS NOT NULL AND end_date < date('now') AND (archived IS NULL OR archived=0)"
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
        'INSERT INTO medications (id, generic_name, commercial_name, dose, frequency, is_critical, notes, stock_quantity, end_date, archived) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [m.id, m.generic_name ?? '', m.commercial_name ?? '', m.dose ?? '', m.frequency ?? '', m.is_critical ?? 0, m.notes ?? '', m.stock_quantity ?? null, m.end_date ?? null, m.archived ?? 0]
      );
    }
    for (const r of (medication_reminders ?? [])) {
      await database.runAsync(
        'INSERT INTO medication_reminders (id, medication_id, time, days, with_sound, is_active, repeat_interval) VALUES (?,?,?,?,?,?,?)',
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
