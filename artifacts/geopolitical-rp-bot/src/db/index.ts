import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate.js";

export function openDatabase(path = process.env.DATABASE_PATH ?? "artifacts/geopolitical-rp-bot/data/game.sqlite"): Database.Database {
  const absolutePath = path === ":memory:" ? path : resolve(path);
  if (path !== ":memory:") mkdirSync(dirname(absolutePath), { recursive: true });
  const db = new Database(absolutePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  runMigrations(db);
  return db;
}

export function inTransaction<T>(db: Database.Database, operation: () => T): T {
  const transaction = db.transaction(operation);
  return transaction.immediate();
}
