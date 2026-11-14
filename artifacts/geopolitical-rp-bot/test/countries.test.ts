import assert from "node:assert/strict";
import test from "node:test";
import { createCountry, deleteCountry, updateCountry } from "../src/services/countries.js";
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
    const auditRow = db.prepare("SELECT action, details_json FROM audit_log WHERE entity = 'country' AND entity_id = ?").get(String(countryId)) as { action: string; details_json: string };
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
