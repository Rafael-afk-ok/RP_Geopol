ALTER TABLE countries ADD COLUMN military_readiness REAL NOT NULL DEFAULT 100
  CHECK (military_readiness BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS trade_contracts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  seller_country_id INTEGER NOT NULL REFERENCES countries(id),
  buyer_country_id INTEGER NOT NULL REFERENCES countries(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity_per_year REAL NOT NULL CHECK (quantity_per_year > 0),
  unit_price REAL NOT NULL CHECK (unit_price > 0),
  duration_years INTEGER NOT NULL CHECK (duration_years >= 0),
  remaining_years INTEGER NOT NULL CHECK (remaining_years >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending','active','completed','cancelled')),
  created_by TEXT NOT NULL,
  accepted_by TEXT,
  terms TEXT NOT NULL DEFAULT '',
  last_result TEXT NOT NULL DEFAULT 'Aguardando aceite',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (seller_country_id <> buyer_country_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_contracts_guild_status
  ON trade_contracts(guild_id, status);

CREATE TABLE IF NOT EXISTS country_trade_settings (
  country_id INTEGER PRIMARY KEY REFERENCES countries(id) ON DELETE CASCADE,
  import_tariff_percent REAL NOT NULL DEFAULT 0 CHECK (import_tariff_percent BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS trade_restrictions (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  imposing_country_id INTEGER NOT NULL REFERENCES countries(id),
  target_country_id INTEGER NOT NULL REFERENCES countries(id),
  item_id INTEGER REFERENCES items(id),
  kind TEXT NOT NULL CHECK (kind IN ('embargo','blockade')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','lifted')),
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (imposing_country_id <> target_country_id)
);
CREATE INDEX IF NOT EXISTS idx_trade_restrictions_pair
  ON trade_restrictions(guild_id, imposing_country_id, target_country_id, status);

CREATE TABLE IF NOT EXISTS international_trade_history (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  contract_id TEXT NOT NULL REFERENCES trade_contracts(id),
  year INTEGER NOT NULL,
  seller_country_id INTEGER NOT NULL REFERENCES countries(id),
  buyer_country_id INTEGER NOT NULL REFERENCES countries(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price > 0),
  tariff_amount REAL NOT NULL DEFAULT 0 CHECK (tariff_amount >= 0),
  run_id TEXT,
  voided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_international_trade_dependency
  ON international_trade_history(guild_id, item_id, year, buyer_country_id);
