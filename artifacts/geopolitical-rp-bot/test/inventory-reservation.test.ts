import assert from "node:assert/strict";
import test from "node:test";
import { changeInventory } from "../src/services/inventory.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

test("assigned army equipment cannot be removed through shared inventory mutation", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Reserved", treasury: 100 });
    const itemId = Number(db.prepare("INSERT INTO items (guild_id,name,category,created_by) VALUES ('guild','Rifle','military','narrator')").run().lastInsertRowid);
    db.prepare("INSERT INTO country_inventory (country_id,item_id,quantity) VALUES (?,?,10)").run(countryId, itemId);
    db.prepare("INSERT INTO army_equipment_assignments (country_id,item_id,assigned_soldiers,updated_by) VALUES (?,?,8,'narrator')").run(countryId, itemId);
    assert.throws(() => changeInventory(db, countryId, itemId, -3), /equipamentos está atribuída/);
    changeInventory(db, countryId, itemId, -2);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(countryId, itemId) as {quantity:number}).quantity, 8);
  } finally { closeTestDatabase(db); }
});
