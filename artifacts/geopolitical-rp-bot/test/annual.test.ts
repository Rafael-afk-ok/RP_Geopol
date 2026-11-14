import assert from "node:assert/strict";
import test from "node:test";
import { processAnnualTurn, undoAnnualTurn } from "../src/services/annual.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

test("annual processing is atomic and idempotent; undo restores state and preserves ledger history", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, {
      name: "Foodland",
      annualIncome: 100,
      population: 100,
      growth: 10,
      foodPerPerson: 1,
    });
    const foodId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, is_food, created_by) VALUES ('guild', 'Food', 'common', 1, 'narrator')",
    ).run().lastInsertRowid);
    db.prepare("INSERT INTO country_inventory (country_id, item_id, quantity) VALUES (?, ?, 50)")
      .run(countryId, foodId);
    db.prepare(
      `INSERT INTO country_production (country_id, item_id, annual_production, annual_consumption)
       VALUES (?, ?, 20, 0)`,
    ).run(countryId, foodId);
    db.prepare(
      `INSERT INTO economy_entries
       (country_id, direction, amount, description, recurrence, due_year, created_by)
       VALUES (?, 'expense', 10, 'Annual expense', 'recurring', 1, 'narrator')`,
    ).run(countryId);
    db.prepare(
      `INSERT INTO economy_entries
       (country_id, direction, amount, description, recurrence, due_year, created_by)
       VALUES (?, 'income', 5, 'One-off income', 'one_time', 1, 'narrator')`,
    ).run(countryId);

    const first = processAnnualTurn(db, "guild", "narrator", "annual-interaction-1");
    const retry = processAnnualTurn(db, "guild", "narrator", "annual-interaction-1");
    assert.deepEqual(retry, first);
    assert.equal(first.year, 1);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 95);
    assert.equal((db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = 'guild'").get() as { current_year: number }).current_year, 1);
    assert.ok(Math.abs((db.prepare("SELECT population FROM countries WHERE id = ?").get(countryId) as { population: number }).population - 110) < 1e-8);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, foodId) as { quantity: number }).quantity, 0);
    const revolt = (db.prepare("SELECT revolt_counter FROM countries WHERE id = ?").get(countryId) as { revolt_counter: number }).revolt_counter;
    assert.ok(Math.abs(revolt - (40 / 110 * 10)) < 1e-8);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM annual_runs WHERE guild_id = 'guild' AND undone_at IS NULL").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM financial_ledger WHERE run_id = ? AND year = 1").get(first.runId) as { count: number }).count, 3);

    const undone = undoAnnualTurn(db, "guild", "narrator");
    assert.equal(undone.year, 1);
    assert.equal((db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = 'guild'").get() as { current_year: number }).current_year, 0);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 0);
    assert.equal((db.prepare("SELECT population FROM countries WHERE id = ?").get(countryId) as { population: number }).population, 100);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, foodId) as { quantity: number }).quantity, 50);
    assert.equal((db.prepare("SELECT revolt_counter FROM countries WHERE id = ?").get(countryId) as { revolt_counter: number }).revolt_counter, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM financial_ledger WHERE reversal_of IS NOT NULL").get() as { count: number }).count, 3);

    const replay = processAnnualTurn(db, "guild", "narrator", "annual-interaction-2");
    assert.equal(replay.year, 1);
    assert.notEqual(replay.runId, first.runId);
  } finally {
    closeTestDatabase(db);
  }
});

test("undo refuses to overwrite changes made after the annual run", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { annualIncome: 10 });
    processAnnualTurn(db, "guild", "narrator", "annual-state-check");
    db.prepare("UPDATE countries SET treasury = treasury + 1 WHERE id = ?").run(countryId);
    assert.throws(() => undoAnnualTurn(db, "guild", "narrator"), /estado do jogo mudou após o avanço/);
  } finally {
    closeTestDatabase(db);
  }
});

test("annual processing rolls back when population growth exceeds safe numeric limits", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { population: 100, growth: 1e308 });
    assert.throws(
      () => processAnnualTurn(db, "guild", "narrator", "annual-overflow"),
      /excede o limite numérico seguro/,
    );
    assert.equal(
      (db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = 'guild'").get() as { current_year: number }).current_year,
      0,
    );
    assert.equal(
      (db.prepare("SELECT population FROM countries WHERE id = ?").get(countryId) as { population: number }).population,
      100,
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM annual_runs").get() as { count: number }).count, 0);
  } finally {
    closeTestDatabase(db);
  }
});
