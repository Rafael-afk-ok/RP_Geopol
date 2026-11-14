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
      "INSERT INTO country_memberships (country_id, user_id, permissions_json, created_by) VALUES (?, 'player', '{\\"read\\":true}', 'narrator')",
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
