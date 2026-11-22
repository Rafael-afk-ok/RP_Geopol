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
  let result: Database.RunResult;
  try {
    result = db.prepare(
      "INSERT INTO countries (guild_id, role_id, name, created_by) VALUES (?, ?, ?, ?)",
    ).run(guildId, roleId, name.trim(), actorId);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: countries.guild_id, countries.role_id")) {
      assertDomain(false, "Este cargo já está vinculado a outro país, possivelmente arquivado. Use /pais restaurar para reativá-lo ou escolha outro cargo.");
    }
    throw error;
  }
  const id = Number(result.lastInsertRowid);
  db.prepare(`INSERT INTO country_consumption_rules (country_id, item_id, target, quantity_per_unit, updated_by)
    SELECT ?, item_id, target, quantity_per_unit, ? FROM global_consumption_rules WHERE guild_id = ?`).run(id, actorId, guildId);
  audit(db, guildId, actorId, "create_country", "country", id, { name: name.trim(), roleId, inheritedGlobalConsumptionRules: true });
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


/**
 * Permanently removes a country and every country-scoped transaction or trade record.
 * Server-wide annual snapshots and the audit trail are retained.
 */
export function deleteCountry(db: Database.Database, guildId: string, actorId: string, countryId: number): string {
  requireNarratorPermission(db, guildId, actorId, "countries", "archive");
  const remove = db.transaction(() => {
    const country = db.prepare(
      "SELECT id, name FROM countries WHERE id = ? AND guild_id = ?",
    ).get(countryId, guildId) as { id: number; name: string } | undefined;
    assertDomain(country, "País não encontrado.");

    // Remove dependent records in child-before-parent order. Audit history is intentionally retained.
    db.prepare("DELETE FROM international_trade_history WHERE seller_country_id = ? OR buyer_country_id = ?").run(countryId, countryId);
    db.prepare("DELETE FROM player_market_trades WHERE seller_country_id = ? OR buyer_country_id = ?").run(countryId, countryId);
    db.prepare("DELETE FROM global_market_trades WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM financial_ledger WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM trade_restrictions WHERE imposing_country_id = ? OR target_country_id = ?").run(countryId, countryId);
    db.prepare("DELETE FROM scheduled_transfers WHERE from_country_id = ? OR to_country_id = ?").run(countryId, countryId);
    db.prepare("DELETE FROM player_offers WHERE seller_country_id = ?").run(countryId);
    db.prepare("DELETE FROM trade_contracts WHERE seller_country_id = ? OR buyer_country_id = ?").run(countryId, countryId);
    db.prepare("DELETE FROM annual_runs WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM operation_receipts WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM economy_entries WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM production_order_materials WHERE order_id IN (SELECT id FROM production_orders WHERE country_id = ?)").run(countryId);
    db.prepare("DELETE FROM production_orders WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM country_indicators WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM country_inventory WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM country_production WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM country_consumption_rules WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM army_equipment_assignments WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM country_trade_settings WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM country_memberships WHERE country_id = ?").run(countryId);

    const result = db.prepare("DELETE FROM countries WHERE id = ? AND guild_id = ?").run(countryId, guildId);
    assertDomain(result.changes === 1, "Não foi possível excluir o país.");
    audit(db, guildId, actorId, "delete_country", "country", countryId, { name: country.name, permanent: true });
    return country.name;
  });
  return remove.immediate();
}


export function restoreCountry(db: Database.Database, guildId: string, actorId: string, countryId: number): string {
  requireNarratorPermission(db, guildId, actorId, "countries", "archive");
  const restore = db.transaction(() => {
    const country = db.prepare("SELECT id, name, role_id, status FROM countries WHERE id = ? AND guild_id = ?")
      .get(countryId, guildId) as { id: number; name: string; role_id: string; status: string } | undefined;
    assertDomain(country, "País não encontrado.");
    assertDomain(country.status === "archived", "Este país já está ativo.");
    const roleOwner = db.prepare("SELECT name FROM countries WHERE guild_id = ? AND role_id = ? AND status = 'active'")
      .get(guildId, country.role_id) as { name: string } | undefined;
    assertDomain(!roleOwner, `O cargo deste país já está associado ao país ativo **${roleOwner?.name ?? ""}**.`);
    db.prepare("UPDATE countries SET status = 'active' WHERE id = ? AND guild_id = ?").run(countryId, guildId);
    audit(db, guildId, actorId, "restore_country", "country", countryId, { name: country.name });
    return country.name;
  });
  return restore.immediate();
}
