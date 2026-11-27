import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Keep writable database and evidence outside source and build folders
export const DATA_ROOT = process.env.PCIL_DATA_DIR
  ? path.resolve(process.env.PCIL_DATA_DIR)
  : path.resolve(process.cwd(), 'pcil_data');

export const DB_PATH = path.join(DATA_ROOT, 'pcil_gst.db');
export const UPLOADS_DIR = path.join(DATA_ROOT, 'input_files');
export const EXPORTS_DIR = path.join(DATA_ROOT, 'output_files');
export const TEMPLATES_DIR = path.join(DATA_ROOT, 'government_templates');
export const BACKUPS_DIR = path.join(DATA_ROOT, 'backups');

for (const dir of [DATA_ROOT, UPLOADS_DIR, EXPORTS_DIR, TEMPLATES_DIR, BACKUPS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // Initialize base schema
  const appRoot = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : process.cwd();
  const schemaPath = path.resolve(appRoot, 'database', 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schemaSql);

  // Apply numbered SQL migrations inside transactions
  const migrationsDir = path.resolve(appRoot, 'database', 'migrations');
  if (fs.existsSync(migrationsDir)) {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    for (const file of files) {
      const match = /^(\d+)_(.+)\.sql$/.exec(file);
      if (!match) continue;
      const version = parseInt(match[1], 10);
      const description = match[2].replace(/_/g, ' ');
      if (appliedVersions.has(version)) continue;

      const migrationSql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      const runMigration = db.transaction(() => {
        db.exec(migrationSql);
        db.prepare('INSERT INTO schema_migrations (version, description) VALUES (?, ?)').run(version, description);
      });
      runMigration();
    }
  }

  dbInstance = db;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function reopenDb(): Database.Database {
  closeDb();
  return getDb();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

// Compute valid Mod-36 GSTIN check digit for deterministic test fixtures
export function buildValidGstin(prefix14: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let factor = 2;
  let sum = 0;
  for (let i = 13; i >= 0; i--) {
    let addend = factor * chars.indexOf(prefix14[i]);
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 36) + (addend % 36);
    sum += addend;
  }
  const check = (36 - (sum % 36)) % 36;
  return prefix14 + chars[check];
}

export function logAuditEvent(
  userId: number | null,
  username: string | null,
  action: string,
  entityType: string,
  entityId: string | number | null,
  beforeObj: unknown = null,
  afterObj: unknown = null
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    username,
    action,
    entityType,
    entityId !== null ? String(entityId) : null,
    beforeObj ? JSON.stringify(beforeObj) : null,
    afterObj ? JSON.stringify(afterObj) : null
  );
}
