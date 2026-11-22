import assert from "node:assert/strict";
import test from "node:test";
import { adjustBalance, transferBetweenCountries } from "../src/services/economy.js";
import { requireCountryPermission } from "../src/services/permissions.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

test("debt limits reject an oversized debit without changing the balance", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "A", treasury: 10, debtLimit: 20 });
    adjustBalance(db, countryId, "guild", "narrator", -25, "test", "test debit");
    assert.equal(
      (db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury,
      -15,
    );
    assert.throws(() => adjustBalance(db, countryId, "guild", "narrator", -6, "test", "over limit"), /limite de dívida/);
    assert.equal(
      (db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number }).treasury,
      -15,
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("transfers are atomic and duplicate interaction IDs do not debit twice", () => {
  const db = createTestDatabase();
  try {
    const sender = insertCountry(db, { name: "Sender", treasury: 100 });
    const receiver = insertCountry(db, { name: "Receiver", maxMoney: 10 });
    assert.throws(
      () => transferBetweenCountries(db, "guild", "narrator", sender, receiver, 25, "limit test"),
      /limite de saldo/,
    );
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(sender) as { treasury: number }).treasury, 100);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(receiver) as { treasury: number }).treasury, 0);

    const first = transferBetweenCountries(db, "guild", "narrator", sender, receiver, 8, "valid", "discord-interaction-1");
    const retry = transferBetweenCountries(db, "guild", "narrator", sender, receiver, 8, "valid", "discord-interaction-1");
    assert.equal(first, retry);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(sender) as { treasury: number }).treasury, 92);
    assert.equal((db.prepare("SELECT treasury FROM countries WHERE id = ?").get(receiver) as { treasury: number }).treasury, 8);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM financial_ledger").get() as { count: number }).count, 2);
  } finally {
    closeTestDatabase(db);
  }
});

test("country membership grants full control only within that country", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db);
    db.prepare(
      "INSERT INTO country_memberships (country_id, user_id, permissions_json, created_by) VALUES (?, 'player', '{}', 'narrator')",
    ).run(countryId);
    assert.doesNotThrow(() => requireCountryPermission(db, "guild", countryId, "player", "economy", "transfer"));
    assert.throws(
      () => requireCountryPermission(db, "guild", countryId, "outsider", "economy", "transfer"),
      /não está associado/,
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("signed narrator adjustments update the treasury and current-year ledger immediately", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Testland", treasury: 100 });
    adjustBalance(db, countryId, "guild", "narrator", 500, "narrator_income", "Exportação de ferro");
    adjustBalance(db, countryId, "guild", "narrator", -125, "narrator_expense", "Importação de grãos");
    const country = db.prepare("SELECT treasury FROM countries WHERE id = ?").get(countryId) as { treasury: number };
    const ledger = db.prepare("SELECT amount, note FROM financial_ledger WHERE country_id = ? ORDER BY rowid").all(countryId) as Array<{ amount: number; note: string }>;
    assert.equal(country.treasury, 475);
    assert.deepEqual(ledger.map((entry) => [entry.amount, entry.note]), [
      [500, "Exportação de ferro"],
      [-125, "Importação de grãos"],
    ]);
  } finally {
    closeTestDatabase(db);
  }
});


test("annual income and expenses are independent of treasury and support add/rem/set", async () => {
  const { adjustAnnualFinance } = await import("../src/services/economy.js");
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { name: "Annual Finance", treasury: 250, annualIncome: 100 });
    assert.deepEqual(adjustAnnualFinance(db, "guild", "narrator", countryId, "income", "add", 50, "New tax revenue"), { previous: 100, next: 150 });
    assert.deepEqual(adjustAnnualFinance(db, "guild", "narrator", countryId, "income", "rem", 20, "Tax reduction"), { previous: 150, next: 130 });
    assert.deepEqual(adjustAnnualFinance(db, "guild", "narrator", countryId, "income", "set", 200, "Budget revision"), { previous: 130, next: 200 });
    assert.deepEqual(adjustAnnualFinance(db, "guild", "narrator", countryId, "expenses", "add", 80, "Administration"), { previous: 0, next: 80 });
    assert.deepEqual(adjustAnnualFinance(db, "guild", "narrator", countryId, "expenses", "rem", 30, "Cost reduction"), { previous: 80, next: 50 });
    assert.deepEqual(adjustAnnualFinance(db, "guild", "narrator", countryId, "expenses", "set", 75, "Revised budget"), { previous: 50, next: 75 });
    const country = db.prepare("SELECT treasury, annual_income, annual_expenses FROM countries WHERE id = ?").get(countryId) as { treasury: number; annual_income: number; annual_expenses: number };
    assert.deepEqual(country, { treasury: 250, annual_income: 200, annual_expenses: 75 });
    assert.throws(() => adjustAnnualFinance(db, "guild", "narrator", countryId, "expenses", "rem", 100, "Invalid reduction"), /não podem ficar negativos/);
    assert.throws(() => adjustAnnualFinance(db, "guild", "player", countryId, "income", "add", 10, "Unauthorized"), /permissão de narrador/);
  } finally {
    closeTestDatabase(db);
  }
});
