import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import { audit } from "./audit.js";
import { requireCountryOrNarratorPermission, requireNarratorPermission } from "./permissions.js";

export function createIndicatorCategory(
  db: Database.Database,
  guildId: string,
  actorId: string,
  name: string,
  description: string,
): number {
  requireNarratorPermission(db, guildId, actorId, "indicators", "configure");
  assertDomain(name.trim().length >= 2 && name.length <= 80, "Nome de categoria inválido.");
  const result = db.prepare("INSERT INTO indicator_categories (guild_id, name, description) VALUES (?, ?, ?)").run(
    guildId,
    name.trim(),
    description.trim().slice(0, 250),
  );
  const id = Number(result.lastInsertRowid);
  audit(db, guildId, actorId, "create_indicator_category", "indicator_category", id, { name: name.trim() });
  return id;
}

export function createIndicator(
  db: Database.Database,
  guildId: string,
  actorId: string,
  categoryId: number,
  name: string,
  description: string,
  dataType: "number" | "text" | "boolean" | "json",
  defaultValue: unknown,
): number {
  requireNarratorPermission(db, guildId, actorId, "indicators", "configure");
  const category = db.prepare("SELECT id FROM indicator_categories WHERE id = ? AND guild_id = ?").get(categoryId, guildId);
  assertDomain(category, "Categoria de indicador não encontrada.");
  assertIndicatorValue(dataType, defaultValue);
  const result = db.prepare(
    `INSERT INTO indicator_definitions (category_id, name, description, data_type, default_value_json)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(categoryId, name.trim(), description.trim().slice(0, 250), dataType, JSON.stringify(defaultValue));
  const id = Number(result.lastInsertRowid);
  audit(db, guildId, actorId, "create_indicator", "indicator", id, { categoryId, name, dataType });
  return id;
}

export function setIndicatorValue(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  indicatorId: number,
  value: unknown,
): void {
  requireNarratorPermission(db, guildId, actorId, "indicators", "edit");
  const definition = db.prepare(
    `SELECT d.id, d.data_type FROM indicator_definitions d
     JOIN indicator_categories c ON c.id = d.category_id
     WHERE d.id = ? AND c.guild_id = ?`,
  ).get(indicatorId, guildId) as { id: number; data_type: "number" | "text" | "boolean" | "json" } | undefined;
  assertDomain(definition, "Indicador não encontrado.");
  assertIndicatorValue(definition.data_type, value);
  const country = db.prepare("SELECT id FROM countries WHERE id = ? AND guild_id = ?").get(countryId, guildId);
  assertDomain(country, "País não encontrado.");
  db.prepare(
    `INSERT INTO country_indicators (country_id, indicator_id, value_json, updated_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (country_id, indicator_id) DO UPDATE
     SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`,
  ).run(countryId, indicatorId, JSON.stringify(value), actorId);
  audit(db, guildId, actorId, "set_indicator_value", "country_indicator", `${countryId}:${indicatorId}`, { value });
}

export function listIndicators(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
): Array<{ category: string; name: string; description: string; data_type: string; value: unknown }> {
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "indicators", "read");
  const rows = db.prepare(
    `SELECT c.name AS category, d.name, d.description, d.data_type,
       COALESCE(v.value_json, d.default_value_json) AS value_json
     FROM indicator_definitions d
     JOIN indicator_categories c ON c.id = d.category_id
     LEFT JOIN country_indicators v ON v.indicator_id = d.id AND v.country_id = ?
     WHERE c.guild_id = ? ORDER BY c.name COLLATE NOCASE, d.name COLLATE NOCASE`,
  ).all(countryId, guildId) as Array<{
    category: string;
    name: string;
    description: string;
    data_type: string;
    value_json: string | null;
  }>;
  return rows.map(({ value_json, ...row }) => ({ ...row, value: value_json === null ? null : JSON.parse(value_json) }));
}

export function assertIndicatorValue(type: string, value: unknown): void {
  if (value === null || value === undefined) {
    assertDomain(type === "json", "Este tipo de indicador precisa de um valor.");
    return;
  }
  if (type === "number") assertDomain(typeof value === "number" && Number.isFinite(value), "Informe um valor numérico.");
  else if (type === "text") assertDomain(typeof value === "string" && value.length <= 2000, "Informe um texto de até 2.000 caracteres.");
  else if (type === "boolean") assertDomain(typeof value === "boolean", "Informe verdadeiro ou falso.");
  else assertDomain(typeof value === "object" && value !== null, "Informe um objeto JSON.");
}
