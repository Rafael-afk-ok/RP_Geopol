import assert from "node:assert/strict";
import test from "node:test";
import { processAnnualTurn, undoAnnualTurn } from "../src/services/annual.js";
import { createCustomItemCategory, defineItem, listCountryInventory } from "../src/services/inventory.js";
import { createIndicator, createIndicatorCategory, listIndicators } from "../src/services/indicators.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

test("custom item categories, annual income, expenses, and maintenance are processed and reversible", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Operators" });
    const categoryId = createCustomItemCategory(db, "guild", "narrator", "Infrastructure", "Operational assets");
    const itemId = defineItem(db, "guild", "narrator", {
      name: "Water Plant",
      category: "custom",
      customCategoryId: categoryId,
      description: "Produces clean water",
      properties: { unit: "facility" },
      productionCost: 25,
      annualMaintenance: 1,
      annualIncomePerUnit: 10,
      annualExpensePerUnit: 2,
      productionYears: 1,
      maxParallelOrders: 1,
      isFood: false,
      globalTradeable: false,
    });
    db.prepare("INSERT INTO country_inventory (country_id, item_id, quantity) VALUES (?, ?, 3)")
      .run(countryId, itemId);

    const inventory = listCountryInventory(db, "guild", "narrator", countryId);
    assert.equal(inventory[0]?.category, "Infrastructure");

    const result = processAnnualTurn(db, "guild", "narrator", "custom-item-year");
    assert.equal(result.summary.revenue, 30);
    assert.equal(result.summary.expenses, 9);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 21);

    undoAnnualTurn(db, "guild", "narrator");
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury, 0);
  } finally {
    closeTestDatabase(db);
  }
});

test("typed indicators can be created without a default value", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db);
    const categoryId = createIndicatorCategory(db, "guild", "narrator", "Society", "");
    createIndicator(db, "guild", "narrator", categoryId, "Literacy", "", "number", undefined);
    const rows = listIndicators(db, "guild", "narrator", countryId);
    assert.equal(rows[0]?.value, null);
  } finally {
    closeTestDatabase(db);
  }
});
