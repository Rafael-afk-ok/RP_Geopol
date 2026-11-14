import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import type { PermissionSystem } from "../domain/types.js";
import { audit, ensureGuildSettings } from "./audit.js";

export function isMainNarrator(db: Database.Database, guildId: string, userId: string): boolean {
  return db.prepare("SELECT 1 FROM guild_settings WHERE guild_id = ? AND main_narrator_id = ?").get(guildId, userId) !== undefined;
}

export function hasNarratorPermission(
  db: Database.Database,
  guildId: string,
  userId: string,
  system: string,
  action: string,
): boolean {
  if (isMainNarrator(db, guildId, userId)) return true;
  return db.prepare(
    "SELECT 1 FROM narrator_grants WHERE guild_id = ? AND user_id = ? AND system = '*' AND action = '*' LIMIT 1",
  ).get(guildId, userId) !== undefined;
}

export function requireNarratorPermission(
  db: Database.Database,
  guildId: string,
  userId: string,
  system: string,
  action: string,
): void {
  assertDomain(
    hasNarratorPermission(db, guildId, userId, system, action),
    `Você não tem permissão de narrador para ${system}/${action}.`,
    "NARRATOR_PERMISSION_DENIED",
  );
}

export function bootstrapMainNarrator(
  db: Database.Database,
  guildId: string,
  actorId: string,
  guildOwnerId: string,
  actorIsAdministrator = false,
): void {
  ensureGuildSettings(db, guildId);
  const configuredOwner = process.env.DISCORD_OWNER_ID;
  assertDomain(
    (actorId === guildOwnerId || actorId === configuredOwner || actorIsAdministrator),
    "Somente o proprietário ou um administrador do servidor pode configurar o narrador principal.",
    "BOOTSTRAP_DENIED",
  );
  const current = db.prepare("SELECT main_narrator_id FROM guild_settings WHERE guild_id = ?").get(guildId) as
    | { main_narrator_id: string | null }
    | undefined;
  assertDomain(!current?.main_narrator_id, "O narrador principal já foi configurado.", "ALREADY_CONFIGURED");
  db.prepare("UPDATE guild_settings SET main_narrator_id = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?").run(
    actorId,
    guildId,
  );
  audit(db, guildId, actorId, "bootstrap_main_narrator", "guild", guildId);
}

export function grantNarratorPermission(
  db: Database.Database,
  guildId: string,
  actorId: string,
  targetUserId: string,
  system: string,
  action: string,
): void {
  assertDomain(isMainNarrator(db, guildId, actorId), "Somente o Narrador Supremo pode nomear narradores.");
  db.prepare(
    `INSERT INTO narrator_grants (guild_id, user_id, system, action, granted_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, user_id, system, action)
     DO UPDATE SET granted_by = excluded.granted_by, created_at = CURRENT_TIMESTAMP`,
  ).run(guildId, targetUserId, system, action, actorId);
  audit(db, guildId, actorId, "grant_narrator_permission", "narrator", targetUserId, { system, action });
}

export function revokeNarratorPermission(
  db: Database.Database,
  guildId: string,
  actorId: string,
  targetUserId: string,
  system: string,
  action: string,
): void {
  assertDomain(isMainNarrator(db, guildId, actorId), "Somente o Narrador Supremo pode remover narradores.");
  db.prepare(
    "DELETE FROM narrator_grants WHERE guild_id = ? AND user_id = ? AND system = ? AND action = ?",
  ).run(guildId, targetUserId, system, action);
  audit(db, guildId, actorId, "revoke_narrator_permission", "narrator", targetUserId, { system, action });
}

export function setCountryPermission(
  db: Database.Database,
  guildId: string,
  countryId: number,
  actorId: string,
  targetUserId: string,
  system: PermissionSystem,
  action: string,
  allowed: boolean,
): void {
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "players", "manage");
  const countrySystems = new Set(["economy", "inventory", "production", "population", "market", "players", "indicators"]);
  const countryActions = new Set([
    "read", "create", "edit", "configure", "manage", "start", "cancel", "buy", "sell", "transfer", "inflate",
  ]);
  assertDomain(
    countrySystems.has(system) && countryActions.has(action),
    "Esta permissão não pode ser concedida por país.",
    "INVALID_COUNTRY_PERMISSION",
  );
  const country = db.prepare("SELECT id, guild_id FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'").get(
    countryId,
    guildId,
  ) as
    | { id: number; guild_id: string }
    | undefined;
  assertDomain(country, "País não encontrado ou arquivado.");
  const current = db.prepare("SELECT permissions_json FROM country_memberships WHERE country_id = ? AND user_id = ?")
    .get(countryId, targetUserId) as { permissions_json: string } | undefined;
  assertDomain(current, "O jogador não está associado a este país.");
  const permissions = JSON.parse(current.permissions_json) as Record<string, boolean>;
  const key = `${system}.${action}`;
  if (allowed) permissions[key] = true;
  else delete permissions[key];
  db.prepare("UPDATE country_memberships SET permissions_json = ? WHERE country_id = ? AND user_id = ?").run(
    JSON.stringify(permissions),
    countryId,
    targetUserId,
  );
  audit(db, country.guild_id, actorId, "set_country_permission", "membership", `${countryId}:${targetUserId}`, {
    permission: key,
    allowed,
  });
}

export function requireCountryPermission(
  db: Database.Database,
  guildId: string,
  countryId: number,
  userId: string,
  _system: PermissionSystem,
  _action: string,
): void {
  const country = db.prepare("SELECT id, guild_id, status FROM countries WHERE id = ?").get(countryId) as
    | { id: number; guild_id: string; status: string }
    | undefined;
  assertDomain(country && country.guild_id === guildId && country.status === "active", "País indisponível.", "COUNTRY_UNAVAILABLE");
  const membership = db.prepare(
    "SELECT 1 FROM country_memberships WHERE country_id = ? AND user_id = ?",
  ).get(countryId, userId);
  assertDomain(membership, "Você não está associado a este país.", "COUNTRY_PRIVATE");
}

export function requireCountryOrNarratorPermission(
  db: Database.Database,
  guildId: string,
  countryId: number,
  userId: string,
  system: PermissionSystem,
  action: string,
): void {
  if (hasNarratorPermission(db, guildId, userId, system, action)) return;
  requireCountryPermission(db, guildId, countryId, userId, system, action);
}

export function syncRoleMemberships(
  db: Database.Database,
  guildId: string,
  userId: string,
  memberRoleIds: readonly string[],
): number {
  if (memberRoleIds.length === 0) {
    db.prepare(
      `DELETE FROM country_memberships
       WHERE created_by = 'discord-role' AND user_id = ?
         AND country_id IN (SELECT id FROM countries WHERE guild_id = ? AND status = 'active')`,
    ).run(userId, guildId);
    return 0;
  }
  const placeholders = memberRoleIds.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM country_memberships
     WHERE created_by = 'discord-role' AND user_id = ?
       AND country_id IN (
         SELECT id FROM countries WHERE guild_id = ? AND status = 'active' AND role_id NOT IN (${placeholders})
       )`,
  ).run(userId, guildId, ...memberRoleIds);
  const roles = db.prepare(
    `SELECT id, name FROM countries
     WHERE guild_id = ? AND status = 'active' AND role_id IN (${placeholders})`,
  ).all(guildId, ...memberRoleIds) as Array<{ id: number; name: string }>;
  let added = 0;
  for (const country of roles) {
    const result = db.prepare(
      `INSERT OR IGNORE INTO country_memberships (country_id, user_id, created_by)
       VALUES (?, ?, 'discord-role')`,
    ).run(country.id, userId);
    if (result.changes > 0) {
      audit(db, guildId, userId, "role_membership", "country", country.id, { country: country.name });
      added += 1;
    }
  }
  return added;
}

export function associatePlayer(
  db: Database.Database,
  guildId: string,
  countryId: number,
  actorId: string,
  targetUserId: string,
): void {
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "players", "manage");
  const country = db.prepare("SELECT id, guild_id, name FROM countries WHERE id = ? AND status = 'active'").get(countryId) as
    | { id: number; guild_id: string; name: string }
    | undefined;
  assertDomain(country && country.guild_id === guildId, "País não encontrado ou arquivado.");
  db.prepare(
    `INSERT INTO country_memberships (country_id, user_id, created_by)
     VALUES (?, ?, ?)
     ON CONFLICT (country_id, user_id) DO NOTHING`,
  ).run(countryId, targetUserId, actorId);
  audit(db, guildId, actorId, "associate_player", "membership", `${countryId}:${targetUserId}`, { country: country.name });
}

export function removePlayer(
  db: Database.Database,
  guildId: string,
  countryId: number,
  actorId: string,
  targetUserId: string,
): void {
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "players", "manage");
  const country = db.prepare("SELECT id, guild_id FROM countries WHERE id = ? AND status = 'active'").get(countryId) as
    | { id: number; guild_id: string }
    | undefined;
  assertDomain(country && country.guild_id === guildId, "País não encontrado.");
  db.prepare("DELETE FROM country_memberships WHERE country_id = ? AND user_id = ?").run(countryId, targetUserId);
  audit(db, guildId, actorId, "remove_player", "membership", `${countryId}:${targetUserId}`);
}
