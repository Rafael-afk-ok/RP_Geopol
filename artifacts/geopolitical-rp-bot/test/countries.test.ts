import assert from "node:assert/strict";
import test from "node:test";
import { createCountry, updateCountry } from "../src/services/countries.js";
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
