import assert from "node:assert/strict";
import test from "node:test";
import { deleteItem, defineItem, type ItemInput } from "../src/services/inventory.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

const item = (name: string): ItemInput => ({
  name, category: "common", description: "", properties: { unit: "t" },
  productionCost: 0, annualMaintenance: 0, productionYears: 0,
  maxParallelOrders: 1, isFood: false, globalTradeable: false,
});

test("permanent item deletion removes inventory, production, recipe and consumption references", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Item Test" });
    const materialId = defineItem(db, "guild", "narrator", item("Material"));
    const productId = defineItem(db, "guild", "narrator", item("Product"));
    db.prepare("INSERT INTO country_inventory (country_id, item_id, quantity) VALUES (?, ?, 12)").run(countryId, materialId);
    db.prepare("INSERT INTO country_production (country_id, item_id, annual_production, annual_consumption) VALUES (?, ?, 20, 5)").run(countryId, materialId);
    db.prepare("INSERT INTO item_requirements (item_id, material_item_id, quantity) VALUES (?, ?, 2)").run(productId, materialId);
    db.prepare("INSERT INTO global_consumption_rules (guild_id, item_id, target, quantity_per_unit, updated_by) VALUES ('guild', ?, 'army', 1, 'narrator')").run(materialId);
    assert.equal(deleteItem(db, "guild", "narrator", materialId), "Material");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM items WHERE id = ?").get(materialId) as {count:number}).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM country_inventory WHERE item_id = ?").get(materialId) as {count:number}).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM country_production WHERE item_id = ?").get(materialId) as {count:number}).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM item_requirements WHERE material_item_id = ?").get(materialId) as {count:number}).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM global_consumption_rules WHERE item_id = ?").get(materialId) as {count:number}).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM items WHERE id = ?").get(productId) as {count:number}).count, 1);
    assert.throws(() => deleteItem(db, "guild", "player", productId), /permissão de narrador/);
  } finally {
    closeTestDatabase(db);
  }
});
