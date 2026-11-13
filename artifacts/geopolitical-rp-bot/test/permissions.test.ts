import assert from "node:assert/strict";
import test from "node:test";
import { grantNarratorPermission, hasNarratorPermission } from "../src/services/permissions.js";
import { closeTestDatabase, createTestDatabase } from "./helpers.js";

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
