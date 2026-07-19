import * as SQLite from 'expo-sqlite';
import * as Sentry from '@sentry/react-native';
import { Profile, Medication, EmergencyContact, MedicationReminder, Activity, ActivityReminder, ActivityType, Appointment } from '../types';
import { diaTemDose } from '../utils/medCycle';

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
//
// O handle morto chega em DOIS sabores, e por muito tempo só o primeiro era reconhecido:
//   1. o registro do JS já perdeu o objeto → o Expo barra antes do nativo, com a mensagem
//      "shared object ... already released";
//   2. o registro do JS ainda alcança o objeto, mas o C++ por baixo já foi destruído
//      (NativeDatabase.close() → mHybridData.resetNative()) → a chamada chega no JNI e volta
//      "NativeDatabase.prepareAsync has been rejected → Caused by: NullPointerException".
// O sabor 2 não casava com o regex: o erro subia, o banco NUNCA reabria e a Home ficava
// falhando de 60 em 60 s até o app ser reiniciado.
//
// Exigir a NPE é o que mantém o padrão estreito: erro de SQL de verdade também vem embrulhado
// em "has been rejected", mas como SQLiteErrorException (ERR_INTERNAL_SQLITE_ERROR), nunca como
// NullPointerException. Casar com "has been rejected" sozinho reabriria o banco e REPETIRIA a
// escrita em cima de um erro legítimo.
const HANDLE_MORTO = /already released|shared object|NativeDatabase\.\w+' has been rejected[\s\S]*NullPointerException/i;
const OPERACOES = ['runAsync', 'execAsync', 'getAllAsync', 'getFirstAsync'] as const;
type Operacao = (typeof OPERACOES)[number];

const ORIGINAIS = new WeakMap<SQLite.SQLiteDatabase, Record<Operacao, Function>>();

// Dentro de uma transação NÃO se reabre. O único uso é o restore do backup: reabrir no meio
// aplicaria o resto num banco novo e deixaria os dados pela metade. Ali a falha tem que subir.
let emTransacao = false;

// Exportado só para o gate (tests/sqlite-handle-guard.js) poder exercitar o padrão contra as
// mensagens reais de produção — foi um regex que não casava com a realidade, calado, que deixou
// o sabor 2 passar por duas semanas.
export function ehHandleMorto(erro: unknown): boolean {
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
  // 1 = os horários do dia vieram das REFEIÇÕES (café/almoço/jantar), não de "Nx por dia".
  // Sem isto o app só tinha os horários crus e ADIVINHAVA pela hora (<10 café, <15 almoço,
  // senão jantar) — palpite que não distingue 07:00/12:00/19:00 de 08:00/14:00/20:00. O
  // resultado é que editar abria em "Vezes por dia" e a escolha da pessoa se perdia.
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN meal_mode INTEGER DEFAULT 0');
  } catch {}
  // Ritmo com pausa: cartela 21/7, adesivo 3 semanas/1, anel 21/7 — e corticoide cíclico,
  // reposição hormonal, quimio. O ciclo é do MEDICAMENTO, não do lembrete: quem toma em 2
  // horários segue uma cartela só. cycle_kind NULL = sem ciclo, e aí nada muda de comportamento.
  // Cálculo em src/utils/medCycle.ts.
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN cycle_kind TEXT');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN cycle_days_on INTEGER');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN cycle_days_off INTEGER');
  } catch {}
  try {
    await database.execAsync('ALTER TABLE medications ADD COLUMN cycle_anchor TEXT');
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
    meal_mode: r.meal_mode ?? 0,
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
    `INSERT INTO medications (generic_name, commercial_name, dose, frequency, is_critical, notes, stock_quantity, units_per_dose, end_date, home_reminder, save_history, meal_mode, cycle_kind, cycle_days_on, cycle_days_off, cycle_anchor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [med.generic_name ?? '', med.commercial_name ?? '', med.dose ?? '', med.frequency ?? '', med.is_critical ? 1 : 0, med.notes ?? '', med.stock_quantity ?? null, med.units_per_dose ?? 1, med.end_date ?? null, med.home_reminder ?? 1, med.save_history ?? 1, med.meal_mode ?? 0, med.cycle_kind ?? null, med.cycle_days_on ?? null, med.cycle_days_off ?? null, med.cycle_anchor ?? null]
  );
  return result.lastInsertRowId;
}

export async function updateMedication(med: Medication): Promise<void> {
  const database = await getDb();
  await database.runAsync(
    `UPDATE medications SET generic_name=?, commercial_name=?, dose=?, frequency=?, is_critical=?, notes=?, stock_quantity=?, units_per_dose=?, end_date=?, home_reminder=?, save_history=?, meal_mode=?, cycle_kind=?, cycle_days_on=?, cycle_days_off=?, cycle_anchor=? WHERE id=?`,
    [med.generic_name, med.commercial_name, med.dose, med.frequency, med.is_critical ? 1 : 0, med.notes, med.stock_quantity ?? null, med.units_per_dose ?? 1, med.end_date ?? null, med.home_reminder ?? 1, med.save_history ?? 1, med.meal_mode ?? 0, med.cycle_kind ?? null, med.cycle_days_on ?? null, med.cycle_days_off ?? null, med.cycle_anchor ?? null, med.id]
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

// ---------------------------------------------------------------------------
// Ponto ÚNICO por onde as respostas do usuário viram aviso ao cuidador.
//
// As respostas entram no banco por 8 caminhos diferentes (botão da Home, botão da notificação
// com o app vivo, o mesmo botão com o app morto lido no próximo cold-start, modal de atividade,
// medição na Agenda…). Pendurar o envio em cada um deles é convite para esquecer um — e um
// evento esquecido não vira erro, vira SILÊNCIO. O cuidador lê silêncio como "está tudo bem".
// Então o gancho fica aqui, nas três funções por onde toda resposta obrigatoriamente passa.
//
// É um hook, e não um import de caregiver.ts, porque caregiver.ts já importa ESTE arquivo —
// importar de volta fecharia um ciclo. Quem registra é o App.tsx.
// ---------------------------------------------------------------------------
export type LoggedEvent = {
  kind: 'med' | 'activity';
  name: string;
  status: 'taken' | 'skipped' | 'done';
  at: string;
  dose?: string;
  value?: string;
  // Obrigatório em medicamento: é com (medId, horário) que o cuidador identifica a DOSE e cancela
  // o alerta local certo. Sem isso a confirmação chega e não cancela nada — e o cuidador é
  // avisado de uma falta que não houve.
  medId?: number;
};

let logHook: ((e: LoggedEvent) => void) | null = null;

export function setLogHook(h: (e: LoggedEvent) => void): void {
  logHook = h;
}

export async function addActivityLog(log: Omit<ActivityLog, 'id' | 'logged_at'>): Promise<void> {
  const database = await getDb();
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT INTO activity_logs (activity_id, activity_name, activity_type, realized, value, logged_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [log.activity_id ?? null, log.activity_name, log.activity_type, log.realized ? 1 : 0, log.value, now],
  );
  logHook?.({
    kind: 'activity',
    name: log.activity_name,
    status: log.realized ? 'done' : 'skipped',
    at: now,
    value: log.value || undefined,
  });
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
  logHook?.({
    kind: 'med', name, dose: dose || undefined, medId: medicationId,
    status: taken ? 'taken' : 'skipped', at: scheduledAt,
  });
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
  } else {
    await database.runAsync(
      `INSERT OR IGNORE INTO medication_log (medication_id, medication_name, dose, notification_id, scheduled_at, taken_at, taken, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.medication_id, entry.medication_name, entry.dose, entry.notification_id, entry.scheduled_at, entry.taken_at ?? null, entry.taken ? 1 : 0, entry.taken ? 'taken' : 'skipped']
    );
  }
  logHook?.({
    kind: 'med',
    name: entry.medication_name,
    dose: entry.dose || undefined,
    medId: entry.medication_id,
    status: entry.taken ? 'taken' : 'skipped',
    at: entry.scheduled_at,
  });
}

// Edição manual pelo usuário na tela de Histórico: só permite alternar entre tomei/não
// tomei e ajustar o horário exibido (mantém taken_at limpo para o card continuar com uma linha só).
//
// O estoque acompanha a edição. Sem isso, uma dose que virou "Sem resposta" (o cartão da
// Home expirou antes do usuário responder) e depois foi corrigida aqui para "Tomei" deixava
// o comprimido na contagem: o histórico ficava certo e o estoque ficava errado PARA MAIS,
// cumulativamente — o app diria que ainda há cartela quando ela já acabou.
//
// O ajuste é pela TRANSIÇÃO, nunca pelo estado final: só mexe no estoque quando o registro
// cruza a fronteira tomou/não-tomou. Reeditar um "Tomei" (p.ex. só para corrigir o horário)
// não desconta de novo, e voltar de "Tomei" para "Não tomei" devolve a unidade.
export async function updateMedicationLogEntry(
  id: number,
  status: 'taken' | 'skipped',
  scheduledAtIso: string,
): Promise<void> {
  const database = await getDb();
  const prev = await database.getFirstAsync<{ medication_id: number | null; taken: number | null; status: string | null }>(
    'SELECT medication_id, taken, status FROM medication_log WHERE id=?',
    [id]
  );
  await database.runAsync(
    'UPDATE medication_log SET status=?, taken=?, scheduled_at=?, taken_at=NULL WHERE id=?',
    [status, status === 'taken' ? 1 : 0, scheduledAtIso, id]
  );
  if (!prev?.medication_id) return;

  const wasTaken = prev.status === 'taken' || (prev.status == null && prev.taken === 1);
  const isTaken = status === 'taken';
  if (wasTaken === isTaken) return;

  const med = await database.getFirstAsync<{ stock_quantity: number | null; units_per_dose: number | null }>(
    'SELECT stock_quantity, units_per_dose FROM medications WHERE id=?',
    [prev.medication_id]
  );
  if (!med || med.stock_quantity == null) return; // sem controle de estoque

  const units = med.units_per_dose || 1;
  const next = isTaken
    ? Math.max(0, med.stock_quantity - units)
    : med.stock_quantity + units;
  await database.runAsync('UPDATE medications SET stock_quantity=? WHERE id=?', [next, prev.medication_id]);
}

// Desfaz a resposta que o card da Home acabou de gravar: devolve a dose para "Sem resposta"
// (taken/status/taken_at NULL) — mesmo estado de um disparo não respondido. O estoque é
// devolvido pelo chamador (que sabe o valor exato antes do desconto), não aqui: a linha só
// carrega taken/status, não a unidade descontada. Casa a linha pelo mesmo ±50min do
// resolveMedicationLogSlot. Retorna se estava marcada como tomada, para o chamador decidir se
// restaura o estoque.
export async function revertMedicationLogSlotToPending(
  medicationId: number,
  scheduledAtIso: string,
): Promise<{ wasTaken: boolean }> {
  const database = await getDb();
  const slotSecs = Math.floor(new Date(scheduledAtIso).getTime() / 1000);
  const row = await database.getFirstAsync<{ id: number; taken: number | null; status: string | null }>(
    `SELECT id, taken, status FROM medication_log
     WHERE medication_id=? AND (taken IS NOT NULL OR status IN ('taken','skipped'))
       AND ABS(strftime('%s', scheduled_at) - ?) < 3000
     ORDER BY ABS(strftime('%s', scheduled_at) - ?) LIMIT 1`,
    [medicationId, slotSecs, slotSecs]
  );
  if (!row) return { wasTaken: false };
  const wasTaken = row.status === 'taken' || row.taken === 1;
  await database.runAsync(
    'UPDATE medication_log SET taken=NULL, status=NULL, taken_at=NULL WHERE id=?',
    [row.id]
  );
  return { wasTaken };
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
    cycle_kind: string | null; cycle_days_on: number | null;
    cycle_days_off: number | null; cycle_anchor: string | null;
  }>(
    `SELECT id, generic_name, commercial_name, dose, end_date, save_history, created_at,
            cycle_kind, cycle_days_on, cycle_days_off, cycle_anchor
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

      // Dia de PAUSA da cartela não é dose esquecida: não tomar ali é o tratamento. Sem
      // isto, toda cartela geraria 7 "sem resposta" por ciclo — sujando o histórico que a
      // pessoa mostra ao médico e disparando o aviso de estoque desatualizado sem motivo.
      if (!diaTemDose(med, day)) continue;

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

// ---------------------------------------------------------------------------
// Cuidador.
//
// Uma pessoa acompanha os avisos do idoso por notificação (ver src/services/caregiver.ts).
// Mora no kv_store como um JSON só: é UM cuidador, e uma tabela para uma linha não se paga.
// O Kotlin lê esta mesma chave (o aviso de "sem resposta" sai com o app morto, sem JS).
//
// `key` é a chave AES compartilhada no pareamento — o que cifra o conteúdo clínico da push.
// Ela viaja no backup junto com o resto; não é um vazamento novo, porque o backup já carrega o
// histórico de doses inteiro em texto puro. Se um dia o backup for cifrado, esta chave entra
// junto e nada muda aqui.
// ---------------------------------------------------------------------------
export interface Caregiver {
  name: string;
  push_token: string;   // ExpoPushToken do APARELHO do cuidador
  // Identifica ESTE pareamento. Um cuidador pode acompanhar várias pessoas, e sem isto o
  // medicamento de id 1 da Vovó e o de id 1 do Vô gerariam a MESMA chave de dose — confirmar a
  // dose de um cancelaria o alerta do outro, em silêncio. Viaja em texto na push (é um id
  // aleatório e opaco: não diz quem é ninguém) para o cuidador saber qual chave usar.
  pid: string;
  key: string;          // XChaCha20-Poly1305, base64, gerada no pareamento
  // Como o cuidador chama o idoso ("Vovó", "Mãe"). É este apelido que viaja, NUNCA o nome do
  // perfil. Não é para o cuidador — ele já sabe quem é a pessoa. É defesa em profundidade: a
  // chave de cifra viaja no arquivo de backup EM TEXTO PURO, e se esse arquivo vazar, o apelido
  // é a diferença entre "alguém toma varfarina" e "Maria Helena Duarte toma varfarina".
  nickname: string;
  delay_minutes: number; // o cuidador é avisado se a dose ficar este tanto sem resposta
  paired_at: string;
}

const KV_CAREGIVER = 'caregiver';

export async function getCaregiver(): Promise<Caregiver | null> {
  const raw = await getKV(KV_CAREGIVER);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Caregiver;
    return c.push_token && c.key ? c : null;
  } catch {
    return null;
  }
}

export async function setCaregiver(c: Caregiver): Promise<void> {
  await setKV(KV_CAREGIVER, JSON.stringify(c));
}

export async function clearCaregiver(): Promise<void> {
  const database = await getDb();
  await database.runAsync('DELETE FROM kv_store WHERE key=?', [KV_CAREGIVER]);
}


// Backup / Restore
// Só estas chaves do kv_store viajam no backup, e cada uma tem motivo.
//   alert_active  — se a ficha de emergência está ligada. Sem ela, o celular novo restaura os
//                   dados e a ficha volta DESLIGADA, em silêncio: a função principal do app
//                   simplesmente não aparece na tela de bloqueio e ninguém avisa.
//   weight_height — a altura da pessoa. Sem ela o IMC para de ser calculado.
//   caregiver     — o pareamento com o cuidador. Mesmo motivo do alert_active: sem ele, o
//                   celular novo restaura tudo e o cuidador para de receber aviso EM SILÊNCIO,
//                   e ninguém percebe justamente porque a ausência de aviso parece "tudo bem".
// As demais NÃO viajam de propósito: `last_notif_response_id` restaurado poderia engolir a
// resposta de uma dose real; os aceites de bula/interação são um reconhecimento que a pessoa
// deve dar de novo no aparelho novo; os "hints" dispensados não são dado de ninguém.
const KV_NO_BACKUP = ['alert_active', 'weight_height', KV_CAREGIVER];

export async function exportBackup(): Promise<string> {
  const database = await getDb();
  const [profile, medications, med_reminders, contacts, activities, act_reminders, appointments, med_log, act_log] = await Promise.all([
    database.getFirstAsync<any>('SELECT * FROM profile WHERE id=1'),
    database.getAllAsync<any>('SELECT * FROM medications'),
    database.getAllAsync<any>('SELECT * FROM medication_reminders'),
    database.getAllAsync<any>('SELECT * FROM emergency_contacts'),
    database.getAllAsync<any>('SELECT * FROM activities'),
    database.getAllAsync<any>('SELECT * FROM activity_reminders'),
    database.getAllAsync<any>('SELECT * FROM appointments'),
    // O HISTÓRICO ficava de fora: quem trocava de celular levava os remédios e perdia todo o
    // registro de doses — justamente o que o app pede para mostrar ao médico na consulta.
    database.getAllAsync<any>('SELECT * FROM medication_log'),
    database.getAllAsync<any>('SELECT * FROM activity_logs'),
  ]);

  const kv: Record<string, string> = {};
  for (const chave of KV_NO_BACKUP) {
    const linha = await database.getFirstAsync<{ value: string }>(
      'SELECT value FROM kv_store WHERE key = ?', [chave]
    );
    if (linha?.value != null) kv[chave] = linha.value;
  }
  return JSON.stringify({
    // Continua version 1 de propósito: os campos novos são ADIÇÕES, e um backup antigo (sem
    // eles) tem que continuar restaurável — o import trata cada bloco como opcional.
    version: 1,
    exported_at: new Date().toISOString(),
    data: {
      profile, medications, medication_reminders: med_reminders, emergency_contacts: contacts,
      activities, activity_reminders: act_reminders, appointments,
      medication_log: med_log, activity_logs: act_log, kv,
    },
  });
}

export async function importBackup(json: string): Promise<void> {
  const parsed = JSON.parse(json);
  if (!parsed?.data || parsed.version !== 1) throw new Error('Formato de backup inválido');
  const { profile, medications, medication_reminders, emergency_contacts, activities, activity_reminders, appointments,
          medication_log, activity_logs, kv } = parsed.data;

  // O histórico do aparelho só é apagado quando o ARQUIVO traz histórico para pôr no lugar.
  // Um backup no formato antigo não tem esses campos: apagar ali destruiria o registro de
  // doses sem repor nada — e a tela avisa que os dados atuais serão substituídos, não que
  // serão perdidos.
  const arquivoTemHistorico = Array.isArray(medication_log) || Array.isArray(activity_logs);

  const database = await getDb();
  await database.withTransactionAsync(async () => {
    await database.execAsync(
      'DELETE FROM activity_reminders; DELETE FROM medication_reminders; DELETE FROM appointments; DELETE FROM activities; DELETE FROM emergency_contacts; DELETE FROM medications; DELETE FROM profile;'
    );
    if (arquivoTemHistorico) {
      await database.execAsync('DELETE FROM medication_log; DELETE FROM activity_logs;');
    }

    if (profile) {
      await database.runAsync(
        'INSERT INTO profile (id, name, blood_type, birth_date, allergies, notes) VALUES (?,?,?,?,?,?)',
        [1, profile.name ?? '', profile.blood_type ?? 'Desconhecido', profile.birth_date ?? '', profile.allergies ?? '', profile.notes ?? '']
      );
    }
    for (const m of (medications ?? [])) {
      await database.runAsync(
        'INSERT INTO medications (id, generic_name, commercial_name, dose, frequency, is_critical, notes, stock_quantity, units_per_dose, end_date, archived, home_reminder, save_history, suspended, meal_mode, cycle_kind, cycle_days_on, cycle_days_off, cycle_anchor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [m.id, m.generic_name ?? '', m.commercial_name ?? '', m.dose ?? '', m.frequency ?? '', m.is_critical ?? 0, m.notes ?? '', m.stock_quantity ?? null, m.units_per_dose ?? 1, m.end_date ?? null, m.archived ?? 0, m.home_reminder ?? 1, m.save_history ?? 1, m.suspended ?? 0, m.meal_mode ?? 0, m.cycle_kind ?? null, m.cycle_days_on ?? null, m.cycle_days_off ?? null, m.cycle_anchor ?? null]
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
      // O ciclo menstrual vive em três colunas que este INSERT ignorava — o exportBackup as
      // salvava (SELECT *) e a restauração as jogava fora. Quem trocava de celular reencontrava
      // "Toque em editar para configurar" e perdia a data do 1º dia, que é o único dado que o
      // app não consegue recalcular sozinho.
      await database.runAsync(
        `INSERT INTO activities (id, type, name, notes, cycle_start_date, cycle_length_days, period_length_days)
         VALUES (?,?,?,?,?,?,?)`,
        [a.id, a.type ?? 'custom', a.name ?? '', a.notes ?? '',
         a.cycle_start_date ?? null, a.cycle_length_days ?? null, a.period_length_days ?? null]
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

    // ── HISTÓRICO ────────────────────────────────────────────────────────────────────────
    // Substitui, como o resto: o usuário confirmou na tela que os dados atuais seriam
    // apagados. Mesclar seria pior — com dois registros para a mesma dose alguém teria que
    // ganhar, e escolher errado significa INVENTAR ou APAGAR uma dose, calado.
    for (const l of (medication_log ?? [])) {
      await database.runAsync(
        `INSERT OR IGNORE INTO medication_log
           (id, medication_id, medication_name, dose, notification_id, scheduled_at, taken, created_at, taken_at, status)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [l.id, l.medication_id ?? null, l.medication_name ?? '', l.dose ?? '', l.notification_id ?? null,
         l.scheduled_at ?? '', l.taken ?? null, l.created_at ?? null, l.taken_at ?? null, l.status ?? null]
      );
    }
    for (const l of (activity_logs ?? [])) {
      await database.runAsync(
        `INSERT OR IGNORE INTO activity_logs
           (id, activity_id, activity_name, activity_type, realized, value, logged_at)
         VALUES (?,?,?,?,?,?,?)`,
        [l.id, l.activity_id ?? null, l.activity_name ?? '', l.activity_type ?? 'custom',
         l.realized ?? 1, l.value ?? '', l.logged_at ?? null]
      );
    }

    // Só as chaves da lista — ver KV_NO_BACKUP. Um backup antigo não tem este bloco, e aí
    // nada acontece (o app segue com o comportamento de antes).
    for (const chave of KV_NO_BACKUP) {
      const valor = kv?.[chave];
      if (valor == null) continue;
      await database.runAsync(
        'INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [chave, String(valor)]
      );
    }
  });
}
