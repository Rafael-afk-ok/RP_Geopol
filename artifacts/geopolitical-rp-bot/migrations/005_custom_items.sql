CREATE TABLE IF NOT EXISTS custom_item_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  UNIQUE (guild_id, name)
);

ALTER TABLE items
  ADD COLUMN custom_category_id INTEGER REFERENCES custom_item_categories(id) ON DELETE SET NULL;

ALTER TABLE items
  ADD COLUMN annual_income_per_unit REAL NOT NULL DEFAULT 0 CHECK (annual_income_per_unit >= 0);

ALTER TABLE items
  ADD COLUMN annual_expense_per_unit REAL NOT NULL DEFAULT 0 CHECK (annual_expense_per_unit >= 0);
