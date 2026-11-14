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
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 1295);
    assert.equal((db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = 'guild'").get() as { current_year: number }).current_year, 1);
    assert.ok(Math.abs((db.prepare("SELECT population FROM countries WHERE id = ?").get(countryId) as { population: number }).population - 110) < 1e-8);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, foodId) as { quantity: number }).quantity, 0);
    const revolt = (db.prepare("SELECT revolt_counter FROM countries WHERE id = ?").get(countryId) as { revolt_counter: number }).revolt_counter;
    assert.ok(Math.abs(revolt - (40 / 110 * 10)) < 1e-8);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM annual_runs WHERE guild_id = 'guild' AND undone_at IS NULL").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM financial_ledger WHERE run_id = ? AND year = 1").get(first.runId) as { count: number }).count, 15);

    const undone = undoAnnualTurn(db, "guild", "narrator");
    assert.equal(undone.year, 1);
    assert.equal((db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = 'guild'").get() as { current_year: number }).current_year, 0);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 0);
    assert.equal((db.prepare("SELECT population FROM countries WHERE id = ?").get(countryId) as { population: number }).population, 100);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, foodId) as { quantity: number }).quantity, 50);
    assert.equal((db.prepare("SELECT revolt_counter FROM countries WHERE id = ?").get(countryId) as { revolt_counter: number }).revolt_counter, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM financial_ledger WHERE reversal_of IS NOT NULL").get() as { count: number }).count, 15);

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


test("global market prices return toward base without purchases and slow below base", () => {
  const db = createTestDatabase();
  try {
    const itemId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, global_tradeable, created_by) VALUES ('guild', 'Iron', 'common', 1, 'narrator')",
    ).run().lastInsertRowid);
    db.prepare(
      "INSERT INTO global_stock (guild_id, item_id, quantity, current_price, base_price, min_price, max_price) VALUES ('guild', ?, 100, 150, 100, 50, 500)",
    ).run(itemId);
    db.prepare("UPDATE guild_settings SET global_market_price_decay_percent = 20 WHERE guild_id = 'guild'").run();

    processAnnualTurn(db, "guild", "narrator", "market-no-buy-1");
    const first = (db.prepare("SELECT current_price FROM global_stock WHERE item_id = ?").get(itemId) as { current_price: number }).current_price;
    assert.equal(first, 140);

    processAnnualTurn(db, "guild", "narrator", "market-no-buy-2");
    const second = (db.prepare("SELECT current_price FROM global_stock WHERE item_id = ?").get(itemId) as { current_price: number }).current_price;
    assert.equal(second, 132);

    db.prepare("UPDATE global_stock SET current_price = 100 WHERE item_id = ?").run(itemId);
    processAnnualTurn(db, "guild", "narrator", "market-below-base");
    const belowBase = (db.prepare("SELECT current_price FROM global_stock WHERE item_id = ?").get(itemId) as { current_price: number }).current_price;
    assert.equal(belowBase, 90);
    assert.ok(belowBase > 50);
  } finally {
    closeTestDatabase(db);
  }
});

test("global market annual price increase is capped even after an oversized purchase", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Buyer", treasury: 100000 });
    const itemId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, global_tradeable, created_by) VALUES ('guild', 'Iron', 'common', 1, 'narrator')",
    ).run().lastInsertRowid);
    db.prepare(
      "INSERT INTO global_stock (guild_id, item_id, quantity, current_price, base_price, min_price, max_price) VALUES ('guild', ?, 100, 100, 80, 10, 1000)",
    ).run(itemId);
    db.prepare("UPDATE guild_settings SET global_market_price_sensitivity = 5, global_market_max_annual_increase_percent = 10 WHERE guild_id = 'guild'").run();
    db.prepare(
      `INSERT INTO global_market_trades
       (id, guild_id, item_id, country_id, direction, quantity, unit_price, total, year, actor_id)
       VALUES ('large-buy', 'guild', ?, ?, 'buy', 1000, 100, 100000, 0, 'player')`,
    ).run(itemId, countryId);

    processAnnualTurn(db, "guild", "narrator", "market-price-cap");
    const price = (db.prepare("SELECT current_price FROM global_stock WHERE item_id = ?").get(itemId) as { current_price: number }).current_price;
    assert.equal(price, 110);
  } finally {
    closeTestDatabase(db);
  }
});


test("population tax uses the agreed declining per-capita factor", () => {
  const db = createTestDatabase();
  try {
    const cases = [
      { population: 30_000_000, monthly: 30_000_000 },
      { population: 150_000_000, monthly: 120_000_000 },
      { population: 200_000_000, monthly: 160_000_000 },
      { population: 250_000_000, monthly: 25_000_000 },
      { population: 300_000_000, monthly: 30_000_000 },
    ];
    const ids = cases.map((entry, index) =>
      insertCountry(db, { name: `Tax ${index}`, population: entry.population }),
    );
    processAnnualTurn(db, "guild", "narrator", "tax-brackets");
    for (const [index, entry] of cases.entries()) {
      const tax = (db.prepare(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM financial_ledger WHERE country_id = ? AND kind = 'population_tax'",
      ).get(ids[index]) as { total: number }).total;
      assert.equal(tax, entry.monthly * 12);
    }
  } finally {
    closeTestDatabase(db);
  }
});

test("annual exports credit revenue and market stock replenishes without exceeding capacity", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Exporter" });
    const itemId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, global_tradeable, created_by) VALUES ('guild', 'Iron', 'common', 1, 'narrator')",
    ).run().lastInsertRowid);
    db.prepare(
      "INSERT INTO country_production (country_id, item_id, annual_production, annual_consumption, annual_export_percent) VALUES (?, ?, 100, 0, 50)",
    ).run(countryId, itemId);
    db.prepare(
      "INSERT INTO global_stock (guild_id, item_id, quantity, current_price, base_price, min_price, max_price, max_quantity, annual_replenishment) VALUES ('guild', ?, 0, 2, 2, 1, 10, 100, 20)",
    ).run(itemId);
    processAnnualTurn(db, "guild", "narrator", "annual-export-replenish");
    const inventory = (db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, itemId) as { quantity: number }).quantity;
    const stock = (db.prepare("SELECT quantity FROM global_stock WHERE guild_id = 'guild' AND item_id = ?").get(itemId) as { quantity: number }).quantity;
    const treasury = (db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury;
    assert.equal(inventory, 50);
    assert.equal(stock, 70);
    assert.equal(treasury, 100);
    const exportIncome = (db.prepare("SELECT SUM(amount) AS total FROM financial_ledger WHERE country_id = ? AND kind = 'export_income'").get(countryId) as { total: number }).total;
    assert.equal(exportIncome, 100);
  } finally {
    closeTestDatabase(db);
  }
});

test("food shortage buys available global food and finances only the shortfall through inflation", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Hungry", treasury: -1200, debtLimit: 1200, population: 100, foodPerPerson: 1 });
    const foodId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, is_food, global_tradeable, created_by) VALUES ('guild', 'Grain', 'common', 1, 1, 'narrator')",
    ).run().lastInsertRowid);
    db.prepare(
      "INSERT INTO global_stock (guild_id, item_id, quantity, current_price, base_price, min_price, max_price, max_quantity, annual_replenishment) VALUES ('guild', ?, 40, 2, 2, 1, 10, 100, 0)",
    ).run(foodId);
    processAnnualTurn(db, "guild", "narrator", "annual-auto-food");
    const country = db.prepare("SELECT treasury, inflation_issued, revolt_counter FROM countries WHERE id = ?").get(countryId) as { treasury: number; inflation_issued: number; revolt_counter: number };
    const stock = (db.prepare("SELECT quantity FROM global_stock WHERE guild_id = 'guild' AND item_id = ?").get(foodId) as { quantity: number }).quantity;
    assert.equal(country.treasury, 0);
    assert.equal(country.inflation_issued, 80);
    assert.equal(stock, 0);
    assert.equal(country.revolt_counter, 6);
  } finally {
    closeTestDatabase(db);
  }
});


test("non-food population rules do not disable default food consumption", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "MixedNeeds", population: 10, foodPerPerson: 1 });
    const foodId = Number(db.prepare("INSERT INTO items (guild_id, name, category, is_food, created_by) VALUES ('guild', 'Grain', 'common', 1, 'narrator')").run().lastInsertRowid);
    const clothId = Number(db.prepare("INSERT INTO items (guild_id, name, category, is_food, created_by) VALUES ('guild', 'Cloth', 'common', 0, 'narrator')").run().lastInsertRowid);
    db.prepare("INSERT INTO country_inventory (country_id, item_id, quantity) VALUES (?, ?, 100)").run(countryId, foodId);
    db.prepare("INSERT INTO country_inventory (country_id, item_id, quantity) VALUES (?, ?, 100)").run(countryId, clothId);
    db.prepare("INSERT INTO country_consumption_rules (country_id, item_id, target, quantity_per_unit, updated_by) VALUES (?, ?, 'population', 0.5, 'narrator')").run(countryId, clothId);
    processAnnualTurn(db, "guild", "narrator", "mixed-population-needs");
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, foodId) as { quantity: number }).quantity, 90);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, clothId) as { quantity: number }).quantity, 95);
  } finally { closeTestDatabase(db); }
});

test("undo restores inflation and voids only annual market transactions", () => {
  const db = createTestDatabase();
  try {
     db.prepare("UPDATE guild_settings SET inflation_rate_percent = 5 WHERE guild_id = 'guild'").run();
   const countryId = insertCountry(db, { name: "Hungry", treasury: -1200, debtLimit: 1200, population: 100, foodPerPerson: 1 });
    const foodId = Number(db.prepare("INSERT INTO items (guild_id, name, category, is_food, global_tradeable, created_by) VALUES ('guild', 'Grain', 'common', 1, 1, 'narrator')").run().lastInsertRowid);
    db.prepare("INSERT INTO global_stock (guild_id, item_id, quantity, current_price, base_price, min_price, max_price, max_quantity, annual_replenishment) VALUES ('guild', ?, 40, 2, 2, 1, 10, 100, 0)").run(foodId);
    const run = processAnnualTurn(db, "guild", "narrator", "undo-inflation-market");
    assert.equal((db.prepare("SELECT inflation_issued FROM countries WHERE id = ?").get(countryId) as { inflation_issued: number }).inflation_issued, 80);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM global_market_trades WHERE run_id = ? AND voided_at IS NULL").get(run.runId) as { n: number }).n, 1);
    undoAnnualTurn(db, "guild", "narrator");
    assert.equal((db.prepare("SELECT inflation_issued FROM countries WHERE id = ?").get(countryId) as { inflation_issued: number }).inflation_issued, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM global_market_trades WHERE run_id = ? AND voided_at IS NOT NULL").get(run.runId) as { n: number }).n, 1);
  } finally { closeTestDatabase(db); }
});


test("a country hitting its treasury ceiling does not abort the global annual close", () => {
  const db = createTestDatabase();
  try {
    const capped = insertCountry(db, { name: "Capped", maxMoney: 10, annualIncome: 100 });
    const normal = insertCountry(db, { name: "Normal", annualIncome: 5 });
    const result = processAnnualTurn(db, "guild", "narrator", "one-country-money-cap");
    assert.equal(result.summary.blockedFinancialOperations, 1);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(capped) as { treasury: number }).treasury, 0);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(normal) as { treasury: number }).treasury, 5);
    assert.equal((db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = 'guild'").get() as { current_year: number }).current_year, 1);
  } finally { closeTestDatabase(db); }
});


test("annual close automatically buys missing non-food population resources", () => {
  const db = createTestDatabase();
  try {
     db.prepare("UPDATE guild_settings SET inflation_rate_percent = 5 WHERE guild_id = 'guild'").run();
   const countryId = insertCountry(db, { name: "Industrial", treasury: 0, population: 10, foodPerPerson: 0 });
    const itemId = Number(db.prepare(
      "INSERT INTO items (guild_id,name,category,global_tradeable,created_by) VALUES ('guild','Cloth','common',1,'narrator')",
    ).run().lastInsertRowid);
    db.prepare("INSERT INTO country_consumption_rules (country_id,item_id,target,quantity_per_unit,updated_by) VALUES (?,?, 'population',1,'narrator')").run(countryId,itemId);
    db.prepare("INSERT INTO global_stock (guild_id,item_id,quantity,current_price,base_price,min_price,max_price,max_quantity) VALUES ('guild',?,10,2,2,1,10,10)").run(itemId);
    const result = processAnnualTurn(db,"guild","narrator","auto-buy-non-food");
    assert.equal(result.summary.populationShortage,0);
    assert.equal((db.prepare("SELECT quantity FROM global_stock WHERE guild_id='guild' AND item_id=?").get(itemId) as {quantity:number}).quantity,0);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(countryId,itemId) as {quantity:number}).quantity,0);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id=?").get(countryId) as {treasury:number}).treasury,100);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM global_market_trades WHERE run_id=? AND direction='buy'").get(result.runId) as {n:number}).n,1);
  } finally { closeTestDatabase(db); }
});
