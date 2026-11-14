CREATE TABLE IF NOT EXISTS global_consumption_rules (
  guild_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('population', 'army')),
  quantity_per_unit REAL NOT NULL CHECK (quantity_per_unit >= 0),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, item_id, target)
);
