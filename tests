import assert from "node:assert/strict";
import test from "node:test";
import { createCountry, deleteCountry, restoreCountry, updateCountry } from "../src/services/countries.js";
import { resetCountryData, resetGuildData } from "../src/services/reset.js";
import { closeTestDatabase, createTestDatabase } from "./helpers.js";

test("narrators can edit country names and role associations without changing internal IDs", () => {
  const db = createTestDatabase();
  try {
    const countryId = createCountry(db, "guild", "narrator", "Old Name", "old-role");
    updateCountry(db, "guild", "narrator", countryId, { name: "New Name", roleId: "new-role" });
    const updated = db.prepare("SELECT id, name, role_id FROM countries WHERE id = ?").get(countryId) as
      | { id: number; name: string; role_id: string }
      | undefined;
    assert.deepEqual(updated, { id: countryId, name: "New Name", role_id: "new-role" });

    assert.throws(() => updateCountry(db, "guild", "player", countryId, { name: "Unauthorized" }), /permissão de narrador/);
    assert.throws(() => updateCountry(db, "guild", "narrator", countryId, {}), /Informe um novo nome/);
  } finally {
    closeTestDatabase(db);
  }
});


test("permanent country deletion removes dependent records, keeps audit, and releases its name and role", () => {
  const db = createTestDatabase();
  try {
    const countryId = createCountry(db, "guild", "narrator", "Old Empire", "same-role");
    db.prepare("INSERT INTO country_memberships (country_id, user_id, created_by) VALUES (?, 'player', 'narrator')").run(countryId);
    db.prepare(
      "INSERT INTO economy_entries (country_id, direction, amount, description, recurrence, due_year, created_by) VALUES (?, 'income', 10, 'test', 'one_time', 1, 'narrator')",
    ).run(countryId);
    db.prepare(
      "INSERT INTO financial_ledger (id, guild_id, country_id, year, kind, amount, note, actor_id) VALUES ('ledger-test', 'guild', ?, 1, 'test', 10, 'test', 'narrator')",
    ).run(countryId);

    assert.equal(deleteCountry(db, "guild", "narrator", countryId), "Old Empire");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM countries WHERE id = ?").get(countryId) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM country_memberships WHERE country_id = ?").get(countryId) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM economy_entries WHERE country_id = ?").get(countryId) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM financial_ledger WHERE country_id = ?").get(countryId) as { count: number }).count, 0);
    const auditRow = db.prepare("SELECT action, details_json FROM audit_log WHERE entity = 'country' AND entity_id = ? AND action = 'delete_country'").get(String(countryId)) as { action: string; details_json: string };
    assert.equal(auditRow.action, "delete_country");
    assert.equal(JSON.parse(auditRow.details_json).name, "Old Empire");

    const replacementId = createCountry(db, "guild", "narrator", "Old Empire", "same-role");
    assert.notEqual(replacementId, countryId);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM countries WHERE guild_id = 'guild' AND name = 'Old Empire'").get() as { count: number }).count, 1);
    assert.throws(() => deleteCountry(db, "guild", "player", replacementId), /permissão de narrador/);
  } finally {
    closeTestDatabase(db);
  }
});


test("archived countries can be restored and reuse their existing Discord role", () => {
  const db = createTestDatabase();
  try {
    const countryId = createCountry(db, "guild", "narrator", "Archived Nation", "archived-role");
    db.prepare("UPDATE countries SET status = 'archived' WHERE id = ?").run(countryId);
    assert.throws(() => createCountry(db, "guild", "narrator", "Replacement", "archived-role"), /cargo já está vinculado/);
    assert.equal(restoreCountry(db, "guild", "narrator", countryId), "Archived Nation");
    assert.equal((db.prepare("SELECT status FROM countries WHERE id = ?").get(countryId) as { status: string }).status, "active");
    assert.throws(() => restoreCountry(db, "guild", "player", countryId), /permissão de narrador/);
  } finally {
    closeTestDatabase(db);
  }
});

test("country data reset preserves country identity and membership but removes its game state", () => {
  const db = createTestDatabase();
  try {
    const countryId = createCountry(db, "guild", "narrator", "Reset Nation", "reset-role");
    db.prepare("INSERT INTO country_memberships (country_id, user_id, created_by) VALUES (?, 'player', 'narrator')").run(countryId);
    db.prepare("UPDATE countries SET treasury = 500, population = 1000, army_size = 25 WHERE id = ?").run(countryId);
    db.prepare("INSERT INTO financial_ledger (id, guild_id, country_id, year, kind, amount, note, actor_id) VALUES ('reset-ledger', 'guild', ?, 1, 'income', 500, 'test', 'narrator')").run(countryId);
    assert.equal(resetCountryData(db, "guild", "narrator", countryId), "Reset Nation");
    const country = db.prepare("SELECT name, role_id, treasury, population, army_size, status FROM countries WHERE id = ?").get(countryId) as { name: string; role_id: string; treasury: number; population: number; army_size: number; status: string };
    assert.deepEqual(country, { name: "Reset Nation", role_id: "reset-role", treasury: 0, population: 0, army_size: 0, status: "active" });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM country_memberships WHERE country_id = ?").get(countryId) as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM financial_ledger WHERE country_id = ?").get(countryId) as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'reset_country_data'").get() as { count: number }).count, 1);
  } finally {
    closeTestDatabase(db);
  }
});

test("server reset removes campaign setup but preserves core guild settings, narrator grants, and audit", () => {
  const db = createTestDatabase();
  try {
    const countryId = createCountry(db, "guild", "narrator", "Server Reset Nation", "server-role");
    db.prepare("INSERT INTO items (guild_id, name, category, created_by) VALUES ('guild', 'Test Item', 'common', 'narrator')").run();
    const itemId = Number((db.prepare("SELECT id FROM items WHERE name = 'Test Item'").get() as { id: number }).id);
    db.prepare("INSERT INTO global_stock (guild_id, item_id, quantity, current_price, min_price, max_price) VALUES ('guild', ?, 100, 10, 1, 20)").run(itemId);
    db.prepare("INSERT INTO narrator_grants (guild_id, user_id, system, action, granted_by) VALUES ('guild', 'other-narrator', '*', '*', 'narrator')").run();
    db.prepare("UPDATE guild_settings SET current_year = 12, currency_symbol = 'CR' WHERE guild_id = 'guild'").run();
    assert.equal(resetGuildData(db, "guild", "narrator", "ZERAR SERVIDOR"), 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM countries WHERE guild_id = 'guild'").get() as { count: number }).count, 0);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM items WHERE guild_id = 'guild'").get() as { count: number }).count, 0);
    const settings = db.prepare("SELECT current_year, currency_symbol, main_narrator_id FROM guild_settings WHERE guild_id = 'guild'").get() as { current_year: number; currency_symbol: string; main_narrator_id: string };
    assert.deepEqual(settings, { current_year: 0, currency_symbol: "CR", main_narrator_id: "narrator" });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM narrator_grants WHERE guild_id = 'guild'").get() as { count: number }).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'reset_guild_data'").get() as { count: number }).count, 1);
    assert.throws(() => resetGuildData(db, "guild", "other-narrator", "ZERAR SERVIDOR"), /Somente o Narrador Supremo/);
    assert.throws(() => resetGuildData(db, "guild", "narrator", "wrong"), /Confirmação inválida/);
  } finally {
    closeTestDatabase(db);
  }
});
