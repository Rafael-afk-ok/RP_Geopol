import assert from "node:assert/strict";
import test from "node:test";
import { setAutomaticInflation } from "../src/services/economy.js";
import { processAnnualTurn } from "../src/services/annual.js";
import { startProduction } from "../src/services/production.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

test("country members can switch their own automatic inflation preference", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Preference" });
    db.prepare("INSERT INTO country_memberships (country_id,user_id,created_by) VALUES (?,'player','narrator')").run(countryId);
    setAutomaticInflation(db, "guild", "player", countryId, false);
    assert.equal((db.prepare("SELECT automatic_inflation_enabled FROM countries WHERE id=?").get(countryId) as {automatic_inflation_enabled:number}).automatic_inflation_enabled, 0);
    setAutomaticInflation(db, "guild", "player", countryId, true);
    assert.equal((db.prepare("SELECT automatic_inflation_enabled FROM countries WHERE id=?").get(countryId) as {automatic_inflation_enabled:number}).automatic_inflation_enabled, 1);
  } finally {
    closeTestDatabase(db);
  }
});

test("annual automatic purchases do not issue inflation when a country disables it", () => {
  const db = createTestDatabase();
  try {
    db.prepare("UPDATE guild_settings SET inflation_rate_percent=5 WHERE guild_id='guild'").run();
    const countryId = insertCountry(db, { name: "NoInflation", treasury: -120, debtLimit: 120, population: 10, foodPerPerson: 1 });
    db.prepare("UPDATE countries SET automatic_inflation_enabled=0 WHERE id=?").run(countryId);
    const foodId = Number(db.prepare("INSERT INTO items (guild_id,name,category,is_food,global_tradeable,created_by) VALUES ('guild','Grain','common',1,1,'narrator')").run().lastInsertRowid);
    db.prepare("INSERT INTO global_stock (guild_id,item_id,quantity,current_price,base_price,min_price,max_price,max_quantity) VALUES ('guild',?,10,2,2,1,10,10)").run(foodId);
    const result = processAnnualTurn(db, "guild", "narrator", "no-auto-inflation-annual");
    assert.equal((db.prepare("SELECT inflation_issued FROM countries WHERE id=?").get(countryId) as {inflation_issued:number}).inflation_issued, 0);
    assert.equal((db.prepare("SELECT quantity FROM global_stock WHERE guild_id='guild' AND item_id=?").get(foodId) as {quantity:number}).quantity, 10);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM global_market_trades WHERE run_id=?").get(result.runId) as {n:number}).n, 0);
    assert.equal(result.summary.populationShortage, 10);
  } finally {
    closeTestDatabase(db);
  }
});

test("production cannot use automatic inflation when disabled or global inflation is zero", () => {
  const db = createTestDatabase();
  try {
    db.prepare("UPDATE guild_settings SET inflation_rate_percent=5 WHERE guild_id='guild'").run();
    const countryId = insertCountry(db, { name: "NoInflation", treasury: 1 });
    db.prepare("UPDATE countries SET automatic_inflation_enabled=0 WHERE id=?").run(countryId);
    const materialId = Number(db.prepare("INSERT INTO items (guild_id,name,category,global_tradeable,created_by) VALUES ('guild','Steel','common',1,'narrator')").run().lastInsertRowid);
    const productId = Number(db.prepare("INSERT INTO items (guild_id,name,category,production_years,created_by) VALUES ('guild','Vehicle','military',1,'narrator')").run().lastInsertRowid);
    db.prepare("INSERT INTO item_requirements (item_id,material_item_id,quantity) VALUES (?,?,3)").run(productId, materialId);
    db.prepare("INSERT INTO global_stock (guild_id,item_id,quantity,current_price,base_price,min_price,max_price,max_quantity) VALUES ('guild',?,5,2,2,1,10,5)").run(materialId);
    assert.throws(() => startProduction(db, "guild", "narrator", countryId, productId, 1), /não permite financiamento inflacionário/);
    assert.equal((db.prepare("SELECT quantity FROM global_stock WHERE guild_id='guild' AND item_id=?").get(materialId) as {quantity:number}).quantity, 5);
    assert.equal((db.prepare("SELECT inflation_issued FROM countries WHERE id=?").get(countryId) as {inflation_issued:number}).inflation_issued, 0);
    db.prepare("UPDATE countries SET automatic_inflation_enabled=1 WHERE id=?").run(countryId);
    db.prepare("UPDATE guild_settings SET inflation_rate_percent=0 WHERE guild_id='guild'").run();
    assert.throws(() => startProduction(db, "guild", "narrator", countryId, productId, 1), /inflação global está desativada/);
  } finally {
    closeTestDatabase(db);
  }
});
