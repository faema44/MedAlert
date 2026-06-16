import * as SQLite from 'expo-sqlite';
import { Profile, Medication, EmergencyContact } from '../types';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('medalert.db');
    await initSchema(db);
  }
  return db;
}

async function initSchema(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;

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
  `);
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
  return rows.map(r => ({ ...r, is_critical: Boolean(r.is_critical) }));
}

export async function addMedication(med: Omit<Medication, 'id'>): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `INSERT INTO medications (generic_name, commercial_name, dose, frequency, is_critical, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    [med.generic_name, med.commercial_name, med.dose, med.frequency, med.is_critical ? 1 : 0, med.notes]
  );
}

export async function updateMedication(med: Medication): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE medications SET generic_name=?, commercial_name=?, dose=?, frequency=?, is_critical=?, notes=? WHERE id=?`,
    [med.generic_name, med.commercial_name, med.dose, med.frequency, med.is_critical ? 1 : 0, med.notes, med.id]
  );
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

export async function deleteContact(id: number): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM emergency_contacts WHERE id=?', [id]);
}
