import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import type { Country } from "../domain/types.js";
import { audit } from "./audit.js";
import { requireNarratorPermission } from "./permissions.js";

export function createCountry(
  db: Database.Database,
  guildId: string,
  actorId: string,
  name: string,
  roleId: string,
): number {
  requireNarratorPermission(db, guildId, actorId, "countries", "create");
  assertDomain(name.trim().length >= 2 && name.trim().length <= 80, "O nome deve ter entre 2 e 80 caracteres.");
  const result = db.prepare(
    "INSERT INTO countries (guild_id, role_id, name, created_by) VALUES (?, ?, ?, ?)",
  ).run(guildId, roleId, name.trim(), actorId);
  const id = Number(result.lastInsertRowid);
  audit(db, guildId, actorId, "create_country", "country", id, { name: name.trim(), roleId });
  return id;
}

export function archiveCountry(db: Database.Database, guildId: string, actorId: string, countryId: number): void {
  requireNarratorPermission(db, guildId, actorId, "countries", "archive");
  const result = db.prepare(
    "UPDATE countries SET status = 'archived' WHERE id = ? AND guild_id = ? AND status = 'active'",
  ).run(countryId, guildId);
  assertDomain(result.changes > 0, "País não encontrado ou já arquivado.");
  audit(db, guildId, actorId, "archive_country", "country", countryId);
}

export function updateCountry(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  values: { name?: string; roleId?: string },
): void {
  requireNarratorPermission(db, guildId, actorId, "countries", "edit");
  const name = values.name?.trim();
  const roleId = values.roleId?.trim();
  assertDomain(name !== undefined || roleId !== undefined, "Informe um novo nome, um novo cargo ou ambos.");
  if (name !== undefined) {
    assertDomain(name.length >= 2 && name.length <= 80, "O nome deve ter entre 2 e 80 caracteres.");
  }
  if (roleId !== undefined) assertDomain(roleId.length > 0, "O cargo associado é inválido.");
  const result = db.prepare(
    `UPDATE countries SET name = COALESCE(?, name), role_id = COALESCE(?, role_id)
     WHERE id = ? AND guild_id = ? AND status = 'active'`,
  ).run(name ?? null, roleId ?? null, countryId, guildId);
  assertDomain(result.changes > 0, "País não encontrado ou arquivado.");
  audit(db, guildId, actorId, "edit_country", "country", countryId, {
    ...(name !== undefined ? { name } : {}),
    ...(roleId !== undefined ? { roleId } : {}),
  });
}

export function listAccessibleCountries(db: Database.Database, guildId: string, userId: string): Country[] {
  return db.prepare(
    `SELECT c.* FROM countries c
     JOIN country_memberships m ON m.country_id = c.id
     WHERE c.guild_id = ? AND c.status = 'active' AND m.user_id = ?
     ORDER BY c.name COLLATE NOCASE`,
  ).all(guildId, userId) as Country[];
}

export function getAccessibleCountry(
  db: Database.Database,
  guildId: string,
  userId: string,
  countryId: number,
): Country {
  const country = db.prepare(
    `SELECT c.* FROM countries c
     JOIN country_memberships m ON m.country_id = c.id
     WHERE c.guild_id = ? AND c.status = 'active' AND c.id = ? AND m.user_id = ?`,
  ).get(guildId, countryId, userId) as Country | undefined;
  assertDomain(country, "País não encontrado ou privado.", "COUNTRY_PRIVATE");
  return country;
}

export function listNarratedCountries(db: Database.Database, guildId: string, actorId: string): Country[] {
  requireNarratorPermission(db, guildId, actorId, "countries", "read");
  return db.prepare("SELECT * FROM countries WHERE guild_id = ? ORDER BY name COLLATE NOCASE").all(guildId) as Country[];
}
