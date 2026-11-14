import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import { audit } from "./audit.js";
import { requireNarratorPermission } from "./permissions.js";

export function configurePopulation(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  values: { population: number; annualGrowthPercent: number; foodPerPerson: number; revoltCounter: number },
): void {
  requireNarratorPermission(db, guildId, actorId, "population", "edit");
  assertDomain(Number.isSafeInteger(values.population) && values.population >= 0, "A população precisa ser um inteiro seguro não negativo.");
  assertDomain(
    Number.isFinite(values.annualGrowthPercent) && values.annualGrowthPercent >= -100,
    "O crescimento anual precisa ser finito e não pode ficar abaixo de -100%.",
  );
  assertDomain(values.foodPerPerson >= 0 && Number.isFinite(values.foodPerPerson), "Necessidade alimentar inválida.");
  assertDomain(values.revoltCounter >= 0 && Number.isFinite(values.revoltCounter), "Contador de revolta inválido.");
  const result = db.prepare(
    `UPDATE countries SET population = ?, annual_population_growth = ?, food_per_person = ?, revolt_counter = ?
     WHERE id = ? AND guild_id = ? AND status = 'active'`,
  ).run(values.population, values.annualGrowthPercent, values.foodPerPerson, values.revoltCounter, countryId, guildId);
  assertDomain(result.changes > 0, "País não encontrado ou arquivado.");
  audit(db, guildId, actorId, "configure_population", "country", countryId, values);
}

export function configurePopulationRules(
  db: Database.Database,
  guildId: string,
  actorId: string,
  normalizationPerYear: number,
  shortageSeverity: number,
): void {
  requireNarratorPermission(db, guildId, actorId, "population", "configure");
  assertDomain(normalizationPerYear >= 0 && Number.isFinite(normalizationPerYear), "A normalização anual não pode ser negativa.");
  assertDomain(shortageSeverity >= 0 && Number.isFinite(shortageSeverity), "A gravidade da escassez não pode ser negativa.");
  db.prepare(
    `UPDATE guild_settings SET revolt_normalization_per_year = ?, food_shortage_severity = ?,
     updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
  ).run(normalizationPerYear, shortageSeverity, guildId);
  audit(db, guildId, actorId, "configure_population_rules", "guild", guildId, {
    normalizationPerYear,
    shortageSeverity,
  });
}

export function getPopulation(db: Database.Database, guildId: string, countryId: number): {
  name: string;
  population: number;
  annual_population_growth: number;
  food_per_person: number;
  revolt_counter: number;
} {
  const row = db.prepare(
    `SELECT name, population, annual_population_growth, food_per_person, revolt_counter
     FROM countries WHERE guild_id = ? AND id = ? AND status = 'active'`,
  ).get(guildId, countryId) as
    | { name: string; population: number; annual_population_growth: number; food_per_person: number; revolt_counter: number }
    | undefined;
  assertDomain(row, "País não encontrado ou arquivado.");
  return row;
}

export function configureConsumptionRule(
  db: Database.Database, guildId: string, actorId: string, countryId: number,
  itemId: number, target: "population" | "army", quantityPerUnit: number,
): void {
  requireNarratorPermission(db, guildId, actorId, "population", "configure");
  assertDomain(Number.isFinite(quantityPerUnit) && quantityPerUnit >= 0, "O consumo por unidade deve ser um número não negativo.");
  const item = db.prepare("SELECT id, category FROM items WHERE id = ? AND guild_id = ?").get(itemId, guildId) as { id: number; category: string } | undefined;
  assertDomain(item, "Item não encontrado neste servidor.");
  assertDomain(item.category !== "military", "Equipamentos militares são duráveis e não podem ser configurados como consumo anual.");
  const country = db.prepare("SELECT id FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'").get(countryId, guildId);
  assertDomain(country, "País não encontrado ou arquivado.");
  db.prepare(`INSERT INTO country_consumption_rules (country_id, item_id, target, quantity_per_unit, updated_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(country_id, item_id, target) DO UPDATE SET quantity_per_unit = excluded.quantity_per_unit, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
    .run(countryId, itemId, target, quantityPerUnit, actorId);
  audit(db, guildId, actorId, "configure_consumption_rule", "country", countryId, { itemId, target, quantityPerUnit });
}

export function configureArmySize(
  db: Database.Database, guildId: string, actorId: string, countryId: number, armySize: number,
): void {
  requireNarratorPermission(db, guildId, actorId, "population", "configure");
  assertDomain(Number.isSafeInteger(armySize) && armySize >= 0, "O efetivo precisa ser um inteiro não negativo.");
  const assigned = db.prepare("SELECT COALESCE(SUM(assigned_soldiers), 0) AS total FROM army_equipment_assignments WHERE country_id = ?").get(countryId) as { total: number };
  assertDomain(assigned.total <= armySize, "O efetivo não pode ficar abaixo da quantidade de soldados já equipada.");
  const result = db.prepare("UPDATE countries SET army_size = ? WHERE id = ? AND guild_id = ? AND status = 'active'").run(armySize, countryId, guildId);
  assertDomain(result.changes > 0, "País não encontrado ou arquivado.");
  audit(db, guildId, actorId, "configure_army_size", "country", countryId, { armySize });
}

export function assignArmyEquipment(
  db: Database.Database, guildId: string, actorId: string, countryId: number, itemId: number, soldiers: number,
): void {
  requireNarratorPermission(db, guildId, actorId, "population", "configure");
  assertDomain(Number.isSafeInteger(soldiers) && soldiers >= 0, "A quantidade equipada precisa ser um inteiro não negativo.");
  const item = db.prepare("SELECT category FROM items WHERE id = ? AND guild_id = ?").get(itemId, guildId) as { category: string } | undefined;
  assertDomain(item && (item.category === "military" || item.category === "custom"), "O item precisa ser militar ou personalizado para ser atribuído ao exército.");
  const country = db.prepare("SELECT army_size FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'").get(countryId, guildId) as { army_size: number } | undefined;
  assertDomain(country, "País não encontrado ou arquivado.");
  const others = db.prepare("SELECT COALESCE(SUM(assigned_soldiers), 0) AS total FROM army_equipment_assignments WHERE country_id = ? AND item_id <> ?").get(countryId, itemId) as { total: number };
  assertDomain(others.total + soldiers <= country.army_size, "A soma dos soldados equipados não pode exceder o efetivo total.");
  const stock = db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, itemId) as { quantity: number } | undefined;
  assertDomain((stock?.quantity ?? 0) >= soldiers, "O país não possui unidades suficientes desse equipamento no inventário.");
  db.prepare(`INSERT INTO army_equipment_assignments (country_id, item_id, assigned_soldiers, updated_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(country_id, item_id) DO UPDATE SET assigned_soldiers = excluded.assigned_soldiers, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
    .run(countryId, itemId, soldiers, actorId);
  audit(db, guildId, actorId, "assign_army_equipment", "country", countryId, { itemId, soldiers });
}
