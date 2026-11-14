ALTER TABLE countries ADD COLUMN army_size INTEGER NOT NULL DEFAULT 0 CHECK (army_size >= 0);

CREATE TABLE IF NOT EXISTS country_consumption_rules (
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  target TEXT NOT NULL CHECK (target IN ('population', 'army')),
  quantity_per_unit REAL NOT NULL CHECK (quantity_per_unit >= 0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (country_id, item_id, target)
);

CREATE TABLE IF NOT EXISTS army_equipment_assignments (
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  assigned_soldiers INTEGER NOT NULL CHECK (assigned_soldiers >= 0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (country_id, item_id)
);

CREATE TABLE IF NOT EXISTS scheduled_transfers (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  from_country_id INTEGER NOT NULL REFERENCES countries(id),
  to_country_id INTEGER NOT NULL REFERENCES countries(id),
  transfer_type TEXT NOT NULL CHECK (transfer_type IN ('money', 'item')),
  item_id INTEGER REFERENCES items(id),
  amount REAL NOT NULL CHECK (amount > 0),
  duration_years INTEGER NOT NULL CHECK (duration_years >= 0),
  remaining_years INTEGER NOT NULL CHECK (remaining_years >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'completed')),
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((transfer_type = 'money' AND item_id IS NULL) OR (transfer_type = 'item' AND item_id IS NOT NULL)),
  CHECK (from_country_id <> to_country_id)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_transfers_guild_status
  ON scheduled_transfers (guild_id, status);
