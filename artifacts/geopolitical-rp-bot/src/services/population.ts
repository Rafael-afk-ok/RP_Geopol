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
