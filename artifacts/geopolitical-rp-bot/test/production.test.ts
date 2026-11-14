import assert from "node:assert/strict";
import test from "node:test";
import { startProduction, cancelProduction } from "../src/services/production.js";
import { processAnnualTurn } from "../src/services/annual.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

test("timed production charges costs and materials up front, then refunds only materials on cancel", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Producer", treasury: 100 });
    db.prepare(
      `INSERT INTO country_memberships (country_id, user_id, permissions_json, created_by)
       VALUES (?, 'player', '{"read":true,"production.start":true,"production.cancel":true}', 'narrator')`,
    ).run(countryId);
    const materialId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, created_by) VALUES ('guild', 'Iron', 'common', 'narrator')",
    ).run().lastInsertRowid);
    const productId = Number(db.prepare(
      `INSERT INTO items
       (guild_id, name, category, production_cost, annual_maintenance, production_years, max_parallel_orders, created_by)
       VALUES ('guild', 'Vehicle', 'military', 10, 4, 2, 1, 'narrator')`,
    ).run().lastInsertRowid);
    db.prepare("INSERT INTO item_requirements (item_id, material_item_id, quantity) VALUES (?, ?, 2)")
      .run(productId, materialId);
    db.prepare("INSERT INTO country_inventory (country_id, item_id, quantity) VALUES (?, ?, 10)")
      .run(countryId, materialId);

    const started = startProduction(db, "guild", "player", countryId, productId, 2, "start-request");
    assert.equal(started.instant, false);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 80);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, materialId) as { quantity: number }).quantity, 6);
    assert.equal(db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, productId), undefined);
    assert.equal(startProduction(db, "guild", "player", countryId, productId, 2, "start-request").orderId, started.orderId);
    assert.throws(() => startProduction(db, "guild", "player", countryId, productId, 1), /limite de produção simultânea/);

    db.prepare(
      "UPDATE item_requirements SET quantity = 1 WHERE item_id = ? AND material_item_id = ?",
    ).run(productId, materialId);
    const returnedMaterials = cancelProduction(db, "guild", "player", started.orderId, "cancel-request");
    assert.equal(returnedMaterials, 2);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, materialId) as { quantity: number }).quantity, 8);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 80);
    assert.equal((db.prepare("SELECT status FROM production_orders WHERE id = ?").get(started.orderId) as { status: string }).status, "cancelled");
  } finally {
    closeTestDatabase(db);
  }
});

test("instant production is delivered during the next annual processing", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Producer", treasury: 100 });
    db.prepare(
      `INSERT INTO country_memberships (country_id, user_id, permissions_json, created_by)
       VALUES (?, 'player', '{"read":true,"production.start":true}', 'narrator')`,
    ).run(countryId);
    const itemId = Number(db.prepare(
      `INSERT INTO items
       (guild_id, name, category, production_cost, production_years, created_by)
       VALUES ('guild', 'Tools', 'common', 2, 0, 'narrator')`,
    ).run().lastInsertRowid);
    const result = startProduction(db, "guild", "player", countryId, itemId, 3);
    assert.equal(result.instant, true);
    assert.notEqual(result.orderId, "instant");
    assert.equal(db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, itemId), undefined);
    assert.equal((db.prepare("SELECT status FROM production_orders WHERE id = ?").get(result.orderId) as { status: string }).status, "in_progress");
    processAnnualTurn(db, "guild", "narrator", "instant-production-year");
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, itemId) as { quantity: number }).quantity, 3);
    assert.equal((db.prepare("SELECT status FROM production_orders WHERE id = ?").get(result.orderId) as { status: string }).status, "completed");
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 94);
  } finally {
    closeTestDatabase(db);
  }
});


test("craft automatically buys missing materials from the global market when affordable", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Buyer", treasury: 10 });
    const materialId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, global_tradeable, created_by) VALUES ('guild', 'Steel', 'common', 1, 'narrator')",
    ).run().lastInsertRowid);
    const productId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, production_cost, production_years, created_by) VALUES ('guild', 'Tank', 'military', 0, 1, 'narrator')",
    ).run().lastInsertRowid);
    db.prepare("INSERT INTO item_requirements (item_id, material_item_id, quantity) VALUES (?, ?, 3)")
      .run(productId, materialId);
    db.prepare(
      "INSERT INTO global_stock (guild_id, item_id, quantity, current_price, base_price, min_price, max_price, max_quantity) VALUES ('guild', ?, 5, 2, 2, 1, 10, 5)",
    ).run(materialId);
    const order = startProduction(db, "guild", "narrator", countryId, productId, 1);
    assert.ok(order.orderId);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 4);
    assert.equal((db.prepare("SELECT quantity FROM global_stock WHERE item_id = ?").get(materialId) as { quantity: number }).quantity, 2);
    assert.equal((db.prepare("SELECT quantity FROM production_order_materials WHERE order_id = ? AND item_id = ?").get(order.orderId, materialId) as { quantity: number }).quantity, 3);
  } finally {
    closeTestDatabase(db);
  }
});

test("craft finances missing materials through inflation when treasury is insufficient", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Poor", treasury: 1 });
    const materialId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, global_tradeable, created_by) VALUES ('guild', 'Steel', 'common', 1, 'narrator')",
    ).run().lastInsertRowid);
    const productId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, production_years, created_by) VALUES ('guild', 'Tank', 'military', 1, 'narrator')",
    ).run().lastInsertRowid);
    db.prepare("INSERT INTO item_requirements (item_id, material_item_id, quantity) VALUES (?, ?, 3)")
      .run(productId, materialId);
    db.prepare(
      "INSERT INTO global_stock (guild_id, item_id, quantity, current_price, base_price, min_price, max_price, max_quantity) VALUES ('guild', ?, 5, 2, 2, 1, 10, 5)",
    ).run(materialId);
    const order = startProduction(db, "guild", "narrator", countryId, productId, 1);
    assert.ok(order.orderId);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM production_orders").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT quantity FROM global_stock WHERE item_id = ?").get(materialId) as { quantity: number }).quantity, 2);
    assert.equal((db.prepare("SELECT inflation_issued FROM countries WHERE id = ?").get(countryId) as { inflation_issued: number }).inflation_issued, 5);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 1);
  } finally {
    closeTestDatabase(db);
  }
});


test("narrator can disable fabrication for an item", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Restricted", treasury: 100 });
    const itemId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, created_by) VALUES ('guild', 'Restricted item', 'military', 'narrator')",
    ).run().lastInsertRowid);
    db.prepare("UPDATE items SET production_enabled = 0 WHERE id = ?").run(itemId);
    assert.throws(
      () => startProduction(db, "guild", "narrator", countryId, itemId, 1),
      /fabricação deste item foi desativada/,
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM production_orders").get() as { count: number }).count, 0);
  } finally {
    closeTestDatabase(db);
  }
});


test("production buys only unassigned material and uses inflation for the shortfall", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Arsenal", treasury: 0, debtLimit: 0 });
    const materialId = Number(db.prepare(
      "INSERT INTO items (guild_id,name,category,global_tradeable,created_by) VALUES ('guild','Rifle','military',1,'narrator')",
    ).run().lastInsertRowid);
    const productId = Number(db.prepare(
      "INSERT INTO items (guild_id,name,category,production_cost,production_years,created_by) VALUES ('guild','Armored vehicle','military',0,1,'narrator')",
    ).run().lastInsertRowid);
    db.prepare("INSERT INTO item_requirements (item_id,material_item_id,quantity) VALUES (?,?,5)").run(productId, materialId);
    db.prepare("INSERT INTO country_inventory (country_id,item_id,quantity) VALUES (?,?,10)").run(countryId, materialId);
    db.prepare("INSERT INTO army_equipment_assignments (country_id,item_id,assigned_soldiers,updated_by) VALUES (?,?,8,'narrator')").run(countryId, materialId);
    db.prepare("INSERT INTO global_stock (guild_id,item_id,quantity,current_price,base_price,min_price,max_price,max_quantity) VALUES ('guild',?,5,2,2,1,10,5)").run(materialId);
    startProduction(db, "guild", "narrator", countryId, productId, 1);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(countryId,materialId) as {quantity:number}).quantity, 8);
    assert.equal((db.prepare("SELECT quantity FROM global_stock WHERE guild_id='guild' AND item_id=?").get(materialId) as {quantity:number}).quantity, 2);
    assert.equal((db.prepare("SELECT inflation_issued FROM countries WHERE id=?").get(countryId) as {inflation_issued:number}).inflation_issued, 6);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id=?").get(countryId) as {treasury:number}).treasury, 0);
  } finally { closeTestDatabase(db); }
});
