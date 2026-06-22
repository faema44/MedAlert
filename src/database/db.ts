import * as SQLite from 'expo-sqlite';
import { Profile, Medication, EmergencyContact, MedicationReminder } from '../types';

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
export async function getMedications(): Promise<Medication[]> {
  const database = await getDb();
  const rows = await database.getAllAsync<Medication>('SELECT * FROM medications ORDER BY is_critical DESC, generic_name ASC');
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
  return rows.map(r => ({ ...r, is_primary: Boolean(r.is_primary) }));
}

export async function addContact(contact: Omit<EmergencyContact, 'id'>): Promise<void> {
  const database = await getDb();
  if (contact.is_primary) {
    await database.runAsync('UPDATE emergency_contacts SET is_primary=0');
  }
  await database.runAsync(
    `INSERT INTO emergency_contacts (name, phone, relationship, is_primary) VALUES (?, ?, ?, ?)`,
    [contact.name, contact.phone, contact.relationship, contact.is_primary ? 1 : 0]
  );
}

export async function updateContact(contact: EmergencyContact): Promise<void> {
  const database = await getDb();
  if (contact.is_primary) {
    await database.runAsync('UPDATE emergency_contacts SET is_primary=0 WHERE id != ?', [contact.id]);
  }
  await database.runAsync(
    `UPDATE emergency_contacts SET name=?, phone=?, relationship=?, is_primary=? WHERE id=?`,
    [contact.name, contact.phone, contact.relationship, contact.is_primary ? 1 : 0, contact.id]
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
