import assert from "node:assert/strict";
import test from "node:test";
import { processAnnualTurn, undoAnnualTurn } from "../src/services/annual.js";
import { createTradeContract, acceptTradeContract, setImportTariff, setTradeRestriction, processAnnualTradeContracts } from "../src/services/international-trade.js";
import { modernizeMilitaryEquipment, getMilitaryStatus } from "../src/services/military.js";
import { createPlayerOffer, buyPlayerOffer } from "../src/services/market.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

function addItem(db: ReturnType<typeof createTestDatabase>, name: string, category: "military" | "common" = "common", cost = 0, maintenance = 0): number {
  return Number(db.prepare(
    "INSERT INTO items (guild_id,name,category,production_cost,annual_maintenance,created_by) VALUES ('guild',?,?,?,?, 'narrator')",
  ).run(name, category, cost, maintenance).lastInsertRowid);
}

test("military modernization consumes costs and materials and replaces only unassigned equipment", () => {
  const db = createTestDatabase();
  try {
    const country = insertCountry(db, { name: "Modernia", treasury: 100 });
    const oldItem = addItem(db, "Rifle Mk I", "military");
    const newItem = addItem(db, "Rifle Mk II", "military", 5);
    const steel = addItem(db, "Steel");
    db.prepare("INSERT INTO item_requirements(item_id,material_item_id,quantity) VALUES(?,?,2)").run(newItem, steel);
    db.prepare("INSERT INTO country_inventory(country_id,item_id,quantity) VALUES(?,?,10)").run(country, oldItem);
    db.prepare("INSERT INTO country_inventory(country_id,item_id,quantity) VALUES(?,?,10)").run(country, steel);

    const result = modernizeMilitaryEquipment(db, "guild", "narrator", country, oldItem, newItem, 2);
    assert.equal(result.cost, 10);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(country, oldItem) as {quantity:number}).quantity, 8);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(country, newItem) as {quantity:number}).quantity, 2);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(country, steel) as {quantity:number}).quantity, 6);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id=?").get(country) as {treasury:number}).treasury, 90);

    db.prepare("INSERT INTO army_equipment_assignments(country_id,item_id,assigned_soldiers,updated_by) VALUES(?,?,1,'narrator')").run(country, oldItem);
    assert.throws(() => modernizeMilitaryEquipment(db, "guild", "narrator", country, oldItem, newItem, 1), /Desatribua os soldados/);
  } finally {
    closeTestDatabase(db);
  }
});

test("military maintenance charges assigned equipment and annual readiness reflects equipment coverage", () => {
  const db = createTestDatabase();
  try {
    const country = insertCountry(db, { name: "Readyland", treasury: 500, debtLimit: 1000 });
    const rifle = addItem(db, "Service Rifle", "military", 0, 2);
    db.prepare("UPDATE countries SET army_size=100,military_readiness=80 WHERE id=?").run(country);
    db.prepare("INSERT INTO country_inventory(country_id,item_id,quantity) VALUES(?,?,50)").run(country, rifle);
    db.prepare("INSERT INTO army_equipment_assignments(country_id,item_id,assigned_soldiers,updated_by) VALUES(?,?,50,'narrator')").run(country, rifle);

    processAnnualTurn(db, "guild", "narrator", "military-readiness-test");
    const state = getMilitaryStatus(db, "guild", "narrator", country);
    assert.equal(state.maintenance, 100);
    assert.equal(state.military_readiness, 78);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id=?").get(country) as {treasury:number}).treasury, 400);
  } finally {
    closeTestDatabase(db);
  }
});

test("bilateral trade contracts apply tariffs, transfer goods annually, and can be undone", () => {
  const db = createTestDatabase();
  try {
    const seller = insertCountry(db, { name: "Exporter", treasury: 0, debtLimit: 100 });
    const buyer = insertCountry(db, { name: "Importer", treasury: 1000, debtLimit: 100 });
    const iron = addItem(db, "Iron");
    db.prepare("INSERT INTO country_inventory(country_id,item_id,quantity) VALUES(?,?,20)").run(seller, iron);

    const contract = createTradeContract(db, "guild", "narrator", seller, buyer, iron, 10, 10, 1, "Annual iron supply");
    acceptTradeContract(db, "guild", "narrator", contract);
    setImportTariff(db, "guild", "narrator", buyer, 10);

    const run = processAnnualTurn(db, "guild", "narrator", "trade-contract-annual");
    assert.equal(run.summary.tradeContractsApplied, 1);
    assert.equal(run.summary.tradeTariffs, 10);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(seller, iron) as {quantity:number}).quantity, 10);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(buyer, iron) as {quantity:number}).quantity, 10);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id=?").get(buyer) as {treasury:number}).treasury, 890);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id=?").get(seller) as {treasury:number}).treasury, 100);
    assert.equal((db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM financial_ledger WHERE country_id=? AND kind='import_tariff'").get(buyer) as {total:number}).total, -10);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM financial_ledger WHERE country_id=? AND kind='import_tariff_revenue'").get(buyer) as {count:number}).count, 0);
    assert.equal((db.prepare("SELECT status FROM trade_contracts WHERE id=?").get(contract) as {status:string}).status, "completed");

    undoAnnualTurn(db, "guild", "narrator");
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id=?").get(buyer) as {treasury:number}).treasury, 1000);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(seller, iron) as {quantity:number}).quantity, 20);
    assert.equal((db.prepare("SELECT status FROM trade_contracts WHERE id=?").get(contract) as {status:string}).status, "active");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM international_trade_history WHERE voided_at IS NOT NULL").get() as {count:number}).count, 1);
  } finally {
    closeTestDatabase(db);
  }
});

test("player-market import tariff is an additional cost paid only by the importer", () => {
  const db = createTestDatabase();
  try {
    const seller = insertCountry(db, { name: "OfferSeller", treasury: 0, debtLimit: 100 });
    const buyer = insertCountry(db, { name: "OfferBuyer", treasury: 1000, debtLimit: 100 });
    const iron = addItem(db, "Market iron");
    db.prepare("INSERT INTO country_inventory(country_id,item_id,quantity) VALUES(?,?,10)").run(seller, iron);
    const offer = createPlayerOffer(db, "guild", "narrator", seller, iron, 10, 10);
    setImportTariff(db, "guild", "narrator", buyer, 10);
    const trade = buyPlayerOffer(db, "guild", "narrator", buyer, offer, 10);
    assert.equal(trade.total, 110);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id=?").get(buyer) as {treasury:number}).treasury, 890);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id=?").get(seller) as {treasury:number}).treasury, 100);
    assert.equal((db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM financial_ledger WHERE country_id=? AND kind='import_tariff'").get(buyer) as {total:number}).total, -10);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM financial_ledger WHERE country_id=? AND kind='import_tariff_revenue'").get(buyer) as {count:number}).count, 0);
  } finally {
    closeTestDatabase(db);
  }
});

test("embargo suspends annual trade without moving money or inventory", () => {
  const db = createTestDatabase();
  try {
    const seller = insertCountry(db, { name: "Seller", treasury: 0 });
    const buyer = insertCountry(db, { name: "Buyer", treasury: 1000 });
    const grain = addItem(db, "Grain");
    db.prepare("INSERT INTO country_inventory(country_id,item_id,quantity) VALUES(?,?,10)").run(seller, grain);
    const contract = createTradeContract(db, "guild", "narrator", seller, buyer, grain, 5, 2, 0, "");
    acceptTradeContract(db, "guild", "narrator", contract);
    setTradeRestriction(db, "guild", "narrator", seller, buyer, "embargo", grain, "Sanctions");

    const result = processAnnualTradeContracts(db, "guild", "narrator", 1, "restriction-test");
    assert.equal(result.applied, 0);
    assert.equal(result.failed, 1);
    assert.equal((db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(seller, grain) as {quantity:number}).quantity, 10);
    assert.match((db.prepare("SELECT last_result FROM trade_contracts WHERE id=?").get(contract) as {last_result:string}).last_result, /embargo/);
  } finally {
    closeTestDatabase(db);
  }
});


test("custom equipment maintenance is charged only for assigned units", () => {
  const db = createTestDatabase();
  try {
    const country = insertCountry(db, { name: "CustomArmy", treasury: 100, debtLimit: 100 });
    const custom = Number(db.prepare("INSERT INTO items (guild_id,name,category,annual_maintenance,created_by) VALUES ('guild','Custom radio','custom',3,'narrator')").run().lastInsertRowid);
    db.prepare("INSERT INTO country_inventory (country_id,item_id,quantity) VALUES (?,?,20)").run(country, custom);
    db.prepare("INSERT INTO army_equipment_assignments (country_id,item_id,assigned_soldiers,updated_by) VALUES (?,?,5,'narrator')").run(country, custom);
    processAnnualTurn(db, "guild", "narrator", "custom-maintenance");
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id=?").get(country) as {treasury:number}).treasury, 85);
  } finally { closeTestDatabase(db); }
});
