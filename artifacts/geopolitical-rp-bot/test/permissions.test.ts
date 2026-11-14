import assert from "node:assert/strict";
import test from "node:test";
import {
  grantNarratorPermission,
  hasNarratorPermission,
  removePlayer,
  associatePlayer,
  syncRoleMemberships,
} from "../src/services/permissions.js";
import { closeTestDatabase, createTestDatabase, insertCountry } from "./helpers.js";

test("only the supreme narrator can appoint full narrators", () => {
  const db = createTestDatabase();
  try {
    grantNarratorPermission(db, "guild", "narrator", "subordinate", "*", "*");
    assert.equal(hasNarratorPermission(db, "guild", "subordinate", "economy", "configure"), true);
    assert.throws(
      () => grantNarratorPermission(db, "guild", "subordinate", "other", "*", "*"),
      /Somente o Narrador Supremo/,
    );
    db.prepare("INSERT INTO narrator_grants (guild_id, user_id, system, action, granted_by) VALUES ('guild', 'legacy', 'economy', 'edit', 'narrator')").run();
    assert.equal(hasNarratorPermission(db, "guild", "legacy", "economy", "edit"), false);
  } finally {
    closeTestDatabase(db);
  }
});

test("country members have full control of their own country", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db);
    db.prepare("INSERT INTO country_memberships (country_id, user_id, created_by) VALUES (?, 'member', 'narrator')").run(countryId);
    associatePlayer(db, "guild", countryId, "member", "new-player");
    assert.equal(
      db.prepare("SELECT 1 FROM country_memberships WHERE country_id = ? AND user_id = 'new-player'").get(countryId) !== undefined,
      true,
    );
    removePlayer(db, "guild", countryId, "member", "new-player");
    assert.equal(
      db.prepare("SELECT 1 FROM country_memberships WHERE country_id = ? AND user_id = 'new-player'").get(countryId),
      undefined,
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("Discord role membership is added and revoked when the role changes", () => {
  const db = createTestDatabase();
  try {
    const countryId = insertCountry(db, { roleId: "nation-role" });
    assert.equal(syncRoleMemberships(db, "guild", "player", ["nation-role"]), 1);
    assert.ok(db.prepare("SELECT 1 FROM country_memberships WHERE country_id = ? AND user_id = 'player'").get(countryId));
    syncRoleMemberships(db, "guild", "player", []);
    assert.equal(db.prepare("SELECT 1 FROM country_memberships WHERE country_id = ? AND user_id = 'player'").get(countryId), undefined);
  } finally {
    closeTestDatabase(db);
  }
});
