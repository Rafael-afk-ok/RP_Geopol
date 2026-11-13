import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrationDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));
  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => String((row as { version: string }).version)),
  );

  for (const file of readdirSync(migrationDirectory).filter((entry) => entry.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;

    const sql = readFileSync(new URL(`../../migrations/${file}`, import.meta.url), "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(file);
    });
    apply.immediate();
  }
}
