import assert from "node:assert/strict";
import test from "node:test";
import {
  associatePlayer,
  grantNarratorPermission,
  hasNarratorPermission,
  removePlayer,
  setCountryPermission,
} from "../src/services/permissions.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

test("subordinate narrators cannot grant permissions they do not hold", () => {
  const db = createTestDatabase();
  try {
    grantNarratorPermission(db, "guild", "narrator", "subordinate", "narrators", "grant");
    grantNarratorPermission(db, "guild", "narrator", "subordinate", "economy", "edit");
    assert.throws(
      () => grantNarratorPermission(db, "guild", "subordinate", "other", "economy", "configure"),
      /não pode conceder uma permissão que não possui/,
    );
    assert.throws(
      () => grantNarratorPermission(db, "guild", "subordinate", "other", "economy", "*"),
      /não podem conceder acesso amplo/,
    );
    grantNarratorPermission(db, "guild", "subordinate", "other", "economy", "edit");
    assert.equal(hasNarratorPermission(db, "guild", "other", "economy", "edit"), true);
  } finally {
    closeTestDatabase(db);
  }
});

test("only the main narrator has implicit full authority", () => {
  const db = createTestDatabase();
  try {
    assert.equal(hasNarratorPermission(db, "guild", "narrator", "year", "undo"), true);
    assert.equal(hasNarratorPermission(db, "guild", "regular-player", "year", "undo"), false);
  } finally {
    closeTestDatabase(db);
  }
});

test("country player managers can manage membership and scoped permissions only", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db);
    db.prepare(
      `INSERT INTO country_memberships (country_id, user_id, permissions_json, created_by)
       VALUES (?, 'manager', '{"read":true,"players.manage":true}', 'narrator'),
              (?, 'target', '{"read":true}', 'narrator'),
              (?, 'reader', '{"read":true}', 'narrator')`,
    ).run(countryId, countryId, countryId);

    assert.throws(
      () => setCountryPermission(db, "guild", countryId, "reader", "target", "economy", "transfer", true),
      /não tem permissão/,
    );
    setCountryPermission(db, "guild", countryId, "manager", "target", "economy", "transfer", true);
    assert.throws(
      () => setCountryPermission(db, "guild", countryId, "manager", "target", "year", "advance", true),
      /não pode ser concedida por país/,
    );

    associatePlayer(db, "guild", countryId, "manager", "new-player");
    assert.equal(
      db.prepare("SELECT 1 FROM country_memberships WHERE country_id = ? AND user_id = 'new-player'").get(countryId) !== undefined,
      true,
    );
    removePlayer(db, "guild", countryId, "manager", "new-player");
    assert.equal(
      db.prepare("SELECT 1 FROM country_memberships WHERE country_id = ? AND user_id = 'new-player'").get(countryId),
      undefined,
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("delegatable narrator permission matrix includes transfer, market actions, country edits, and year history", async () => {
  const { validNarratorPermission } = await import("../src/commands/definitions.js");
  assert.equal(validNarratorPermission("economy", "transfer"), true);
  assert.equal(validNarratorPermission("economy", "inflate"), true);
  assert.equal(validNarratorPermission("market", "buy"), true);
  assert.equal(validNarratorPermission("market", "sell"), true);
  assert.equal(validNarratorPermission("countries", "edit"), true);
  assert.equal(validNarratorPermission("year", "read"), true);
});
