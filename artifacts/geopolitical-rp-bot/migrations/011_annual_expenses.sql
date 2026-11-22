ALTER TABLE countries
  ADD COLUMN annual_expenses REAL NOT NULL DEFAULT 0
  CHECK (annual_expenses >= 0);

CREATE INDEX IF NOT EXISTS idx_items_guild_name
  ON items (guild_id, name COLLATE NOCASE);
