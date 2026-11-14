import assert from "node:assert/strict";
import test from "node:test";
import { createCountry } from "../src/services/countries.js";
import { configureConsumptionRule, configureGlobalConsumptionRule, listGlobalConsumptionRules } from "../src/services/population.js";
import { closeTestDatabase, createTestDatabase } from "./helpers.js";

test("new countries inherit global consumption defaults without changing existing country overrides", () => {
  const db = createTestDatabase();
  try {
    const foodId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, is_food, created_by) VALUES ('guild', 'Grãos', 'common', 1, 'narrator')",
    ).run().lastInsertRowid);
    const existingCountry = createCountry(db, "guild", "narrator", "Existing", "existing-role");

    configureGlobalConsumptionRule(db, "guild", "narrator", foodId, "population", 0.002);
    const globalRows = listGlobalConsumptionRules(db, "guild");
    assert.deepEqual(globalRows.map((row) => ({
      item_name: row.item_name,
      target: row.target,
      quantity_per_unit: row.quantity_per_unit,
    })), [{ item_name: "Grãos", target: "population", quantity_per_unit: 0.002 }]);

    const newCountry = createCountry(db, "guild", "narrator", "New", "new-role");
    const inherited = db.prepare(
      "SELECT item_id, target, quantity_per_unit FROM country_consumption_rules WHERE country_id = ?",
    ).all(newCountry) as Array<{ item_id: number; target: string; quantity_per_unit: number }>;
    assert.deepEqual(inherited, [{ item_id: foodId, target: "population", quantity_per_unit: 0.002 }]);

    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM country_consumption_rules WHERE country_id = ?").get(existingCountry) as { count: number }).count, 0);

    configureConsumptionRule(db, "guild", "narrator", newCountry, foodId, "population", 0.003);
    configureGlobalConsumptionRule(db, "guild", "narrator", foodId, "population", 0.004);

    assert.equal((db.prepare(
      "SELECT quantity_per_unit FROM country_consumption_rules WHERE country_id = ? AND item_id = ? AND target = 'population'",
    ).get(newCountry, foodId) as { quantity_per_unit: number }).quantity_per_unit, 0.003);
    const laterCountry = createCountry(db, "guild", "narrator", "Later", "later-role");
    assert.equal((db.prepare(
      "SELECT quantity_per_unit FROM country_consumption_rules WHERE country_id = ? AND item_id = ? AND target = 'population'",
    ).get(laterCountry, foodId) as { quantity_per_unit: number }).quantity_per_unit, 0.004);

    assert.throws(
      () => configureGlobalConsumptionRule(db, "guild", "player", foodId, "population", 1),
      /permissão de narrador/,
    );
  } finally {
    closeTestDatabase(db);
  }
});
