import assert from "node:assert/strict";
import test from "node:test";
import { addEconomyEntry } from "../src/services/economy.js";
import { adjustInventory, setCountryProduction } from "../src/services/inventory.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

test("all members can edit only the country they belong to", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db);
    db.prepare(
      `INSERT INTO country_memberships (country_id, user_id, permissions_json, created_by)
       VALUES (?, 'manager', '{"read":true,"economy.edit":true,"inventory.edit":true,"production.configure":true}', 'narrator'),
              (?, 'reader', '{"read":true}', 'narrator')`,
    ).run(countryId, countryId);
    const itemId = Number(db.prepare(
      "INSERT INTO items (guild_id, name, category, created_by) VALUES ('guild', 'Grain', 'common', 'narrator')",
    ).run().lastInsertRowid);

    adjustInventory(db, "guild", "manager", countryId, itemId, 3, "production allocation", "inventory-duplicate");
    adjustInventory(db, "guild", "manager", countryId, itemId, 3, "production allocation", "inventory-duplicate");
    assert.equal(
      (db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, itemId) as { quantity: number }).quantity,
      3,
    );
    setCountryProduction(db, "guild", "manager", countryId, itemId, 5, 1);
    addEconomyEntry(db, "guild", "manager", countryId, "income", 10, "Local income", "recurring", 1);
    assert.doesNotThrow(
      () => adjustInventory(db, "guild", "reader", countryId, itemId, 1, "member edit"),
    );
    assert.doesNotThrow(
      () => addEconomyEntry(db, "guild", "reader", countryId, "income", 10, "Member income", "recurring", 1),
    );
    assert.throws(
      () => adjustInventory(db, "guild", "outsider", countryId, itemId, 1, "outsider edit"),
      /não está associado/,
    );

    assert.equal(
      (db.prepare("SELECT annual_production, annual_consumption FROM country_production WHERE country_id = ? AND item_id = ?").get(countryId, itemId) as { annual_production: number; annual_consumption: number }).annual_production,
      5,
    );
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM economy_entries WHERE country_id = ?").get(countryId) as { count: number }).count, 2);
  } finally {
    closeTestDatabase(db);
  }
});
