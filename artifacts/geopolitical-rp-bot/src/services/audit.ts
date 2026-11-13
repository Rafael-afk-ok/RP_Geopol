import type Database from "better-sqlite3";

export function audit(
  db: Database.Database,
  guildId: string,
  actorId: string,
  action: string,
  entity: string,
  entityId: string | number,
  details: Record<string, unknown> = {},
): void {
  db.prepare(
    `INSERT INTO audit_log (guild_id, actor_id, action, entity, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(guildId, actorId, action, entity, String(entityId), JSON.stringify(details));
}

export function ensureGuildSettings(db: Database.Database, guildId: string): void {
  db.prepare("INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)").run(guildId);
}
