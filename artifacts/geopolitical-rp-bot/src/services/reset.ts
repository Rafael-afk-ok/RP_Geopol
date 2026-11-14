import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import { audit } from "./audit.js";
import { isMainNarrator, requireNarratorPermission } from "./permissions.js";

function removeCountryRelations(db: Database.Database, guildId: string, countryId: number): void {
  db.prepare("DELETE FROM international_trade_history WHERE seller_country_id = ? OR buyer_country_id = ?").run(countryId, countryId);
  db.prepare("DELETE FROM player_market_trades WHERE seller_country_id = ? OR buyer_country_id = ?").run(countryId, countryId);
  db.prepare("DELETE FROM global_market_trades WHERE country_id = ?").run(countryId);
  db.prepare("DELETE FROM financial_ledger WHERE country_id = ?").run(countryId);
  db.prepare("DELETE FROM trade_contracts WHERE seller_country_id = ? OR buyer_country_id = ?").run(countryId, countryId);
  db.prepare("DELETE FROM trade_restrictions WHERE imposing_country_id = ? OR target_country_id = ?").run(countryId, countryId);
  db.prepare("DELETE FROM scheduled_transfers WHERE from_country_id = ? OR to_country_id = ?").run(countryId, countryId);
  db.prepare("DELETE FROM player_offers WHERE seller_country_id = ?").run(countryId);
  // Annual snapshots are server-wide; discard them so a later undo cannot restore pre-reset data.
  db.prepare("DELETE FROM annual_runs WHERE guild_id = ?").run(guildId);
  db.prepare("DELETE FROM operation_receipts WHERE guild_id = ?").run(guildId);
}

export function resetCountryData(db: Database.Database, guildId: string, actorId: string, countryId: number): string {
  requireNarratorPermission(db, guildId, actorId, "countries", "archive");
  const reset = db.transaction(() => {
    const country = db.prepare("SELECT id, name FROM countries WHERE id = ? AND guild_id = ?")
      .get(countryId, guildId) as { id: number; name: string } | undefined;
    assertDomain(country, "País não encontrado.");
    removeCountryRelations(db, guildId, countryId);
    db.prepare("DELETE FROM country_indicators WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM country_inventory WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM country_production WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM economy_entries WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM production_orders WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM country_consumption_rules WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM army_equipment_assignments WHERE country_id = ?").run(countryId);
    db.prepare("DELETE FROM country_trade_settings WHERE country_id = ?").run(countryId);
    db.prepare(`UPDATE countries SET
      treasury = 0, max_money = NULL, debt_limit = 0, annual_income = 0, population = 0,
      annual_population_growth = 0, food_per_person = 1, revolt_counter = 0, inflation_issued = 0,
      army_size = 0, military_readiness = 100, automatic_inflation_enabled = 1
      WHERE id = ? AND guild_id = ?`).run(countryId, guildId);
    audit(db, guildId, actorId, "reset_country_data", "country", countryId, { name: country.name });
    return country.name;
  });
  return reset.immediate();
}

export function resetGuildData(db: Database.Database, guildId: string, actorId: string, confirmation: string): number {
  assertDomain(confirmation === "ZERAR SERVIDOR", "Confirmação inválida. Digite exatamente ZERAR SERVIDOR.");
  assertDomain(isMainNarrator(db, guildId, actorId), "Somente o Narrador Supremo pode zerar todos os dados do servidor.");
  const reset = db.transaction(() => {
    const count = (db.prepare("SELECT COUNT(*) AS count FROM countries WHERE guild_id = ?").get(guildId) as { count: number }).count;
    db.prepare("DELETE FROM international_trade_history WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM player_market_trades WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM global_market_trades WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM financial_ledger WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM trade_contracts WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM trade_restrictions WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM scheduled_transfers WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM player_offers WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM annual_runs WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM global_price_history WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM operation_receipts WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM countries WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM global_stock WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM item_requirements WHERE item_id IN (SELECT id FROM items WHERE guild_id = ?) OR material_item_id IN (SELECT id FROM items WHERE guild_id = ?)").run(guildId, guildId);
    db.prepare("DELETE FROM items WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM custom_item_categories WHERE guild_id = ?").run(guildId);
    db.prepare("DELETE FROM indicator_categories WHERE guild_id = ?").run(guildId);
    db.prepare("UPDATE guild_settings SET current_year = 0, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?").run(guildId);
    audit(db, guildId, actorId, "reset_guild_data", "guild", guildId, { countriesRemoved: count, gameCatalogRemoved: true });
    return count;
  });
  return reset.immediate();
}
