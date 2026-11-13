CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  main_narrator_id TEXT,
  current_year INTEGER NOT NULL DEFAULT 0 CHECK (current_year >= 0),
  currency_name TEXT NOT NULL DEFAULT 'Crédito',
  currency_symbol TEXT NOT NULL DEFAULT 'CR',
  currency_decimals INTEGER NOT NULL DEFAULT 2 CHECK (currency_decimals BETWEEN 0 AND 6),
  inflation_rate_percent REAL NOT NULL DEFAULT 0 CHECK (inflation_rate_percent BETWEEN 0 AND 100),
  inflation_penalty_mode TEXT NOT NULL DEFAULT 'linear' CHECK (inflation_penalty_mode IN ('linear', 'exponential')),
  inflation_penalty_percent_per_1000 REAL NOT NULL DEFAULT 1 CHECK (inflation_penalty_percent_per_1000 BETWEEN 0 AND 100),
  cancellation_refund_percent REAL NOT NULL DEFAULT 50 CHECK (cancellation_refund_percent BETWEEN 0 AND 100),
  market_expiration_years INTEGER NOT NULL DEFAULT 3 CHECK (market_expiration_years BETWEEN 3 AND 5),
  revolt_normalization_per_year REAL NOT NULL DEFAULT 10 CHECK (revolt_normalization_per_year >= 0),
  food_shortage_severity REAL NOT NULL DEFAULT 10 CHECK (food_shortage_severity >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS narrator_grants (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  system TEXT NOT NULL,
  action TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (guild_id, user_id, system, action)
);

CREATE TABLE IF NOT EXISTS countries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  treasury REAL NOT NULL DEFAULT 0,
  max_money REAL,
  debt_limit REAL NOT NULL DEFAULT 0 CHECK (debt_limit >= 0),
  annual_income REAL NOT NULL DEFAULT 0 CHECK (annual_income >= 0),
  population REAL NOT NULL DEFAULT 0 CHECK (population >= 0),
  annual_population_growth REAL NOT NULL DEFAULT 0,
  food_per_person REAL NOT NULL DEFAULT 1 CHECK (food_per_person >= 0),
  revolt_counter REAL NOT NULL DEFAULT 0 CHECK (revolt_counter >= 0),
  inflation_issued REAL NOT NULL DEFAULT 0 CHECK (inflation_issued >= 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (guild_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_countries_guild_status
  ON countries (guild_id, status);

CREATE TABLE IF NOT EXISTS country_memberships (
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '{"read":true}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (country_id, user_id)
);

CREATE TABLE IF NOT EXISTS indicator_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (guild_id, name)
);

CREATE TABLE IF NOT EXISTS indicator_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES indicator_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data_type TEXT NOT NULL CHECK (data_type IN ('number', 'text', 'boolean', 'json')),
  default_value_json TEXT,
  UNIQUE (category_id, name)
);

CREATE TABLE IF NOT EXISTS country_indicators (
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  indicator_id INTEGER NOT NULL REFERENCES indicator_definitions(id) ON DELETE CASCADE,
  value_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (country_id, indicator_id)
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('military', 'common', 'custom')),
  description TEXT NOT NULL DEFAULT '',
  properties_json TEXT NOT NULL DEFAULT '{}',
  production_cost REAL NOT NULL DEFAULT 0 CHECK (production_cost >= 0),
  annual_maintenance REAL NOT NULL DEFAULT 0 CHECK (annual_maintenance >= 0),
  production_years INTEGER NOT NULL DEFAULT 0 CHECK (production_years >= 0),
  max_parallel_orders INTEGER NOT NULL DEFAULT 1 CHECK (max_parallel_orders >= 1),
  is_food INTEGER NOT NULL DEFAULT 0 CHECK (is_food IN (0, 1)),
  global_tradeable INTEGER NOT NULL DEFAULT 0 CHECK (global_tradeable IN (0, 1)),
  created_by TEXT NOT NULL,
  UNIQUE (guild_id, name)
);

CREATE TABLE IF NOT EXISTS item_requirements (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  material_item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (item_id, material_item_id),
  CHECK (item_id <> material_item_id)
);

CREATE TABLE IF NOT EXISTS country_inventory (
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (country_id, item_id)
);

CREATE TABLE IF NOT EXISTS country_production (
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  annual_production REAL NOT NULL DEFAULT 0 CHECK (annual_production >= 0),
  annual_consumption REAL NOT NULL DEFAULT 0 CHECK (annual_consumption >= 0),
  PRIMARY KEY (country_id, item_id)
);

CREATE TABLE IF NOT EXISTS economy_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('income', 'expense')),
  amount REAL NOT NULL CHECK (amount >= 0),
  description TEXT NOT NULL,
  recurrence TEXT NOT NULL CHECK (recurrence IN ('recurring', 'one_time')),
  due_year INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_orders (
  id TEXT PRIMARY KEY,
  country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  remaining_years INTEGER NOT NULL CHECK (remaining_years >= 0),
  total_years INTEGER NOT NULL CHECK (total_years >= 0),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS financial_ledger (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  country_id INTEGER NOT NULL REFERENCES countries(id),
  year INTEGER NOT NULL,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  note TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  transaction_group TEXT,
  run_id TEXT,
  reversal_of TEXT REFERENCES financial_ledger(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_country_year
  ON financial_ledger (country_id, year DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS player_offers (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  seller_country_id INTEGER NOT NULL REFERENCES countries(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  original_quantity REAL NOT NULL CHECK (original_quantity > 0),
  remaining_quantity REAL NOT NULL CHECK (remaining_quantity >= 0),
  unit_price REAL NOT NULL CHECK (unit_price > 0),
  currency_symbol TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  expires_year INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'cancelled', 'expired')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS player_market_trades (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES player_offers(id),
  guild_id TEXT NOT NULL,
  seller_country_id INTEGER NOT NULL REFERENCES countries(id),
  buyer_country_id INTEGER NOT NULL REFERENCES countries(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price > 0),
  total REAL NOT NULL CHECK (total > 0),
  year INTEGER NOT NULL,
  buyer_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS global_stock (
  guild_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  current_price REAL NOT NULL CHECK (current_price > 0),
  min_price REAL NOT NULL CHECK (min_price > 0),
  max_price REAL NOT NULL CHECK (max_price >= min_price),
  PRIMARY KEY (guild_id, item_id)
);

CREATE TABLE IF NOT EXISTS global_market_trades (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  country_id INTEGER NOT NULL REFERENCES countries(id),
  direction TEXT NOT NULL CHECK (direction IN ('buy', 'sell')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL CHECK (unit_price > 0),
  total REAL NOT NULL CHECK (total > 0),
  year INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS global_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  year INTEGER NOT NULL,
  previous_price REAL NOT NULL,
  new_price REAL NOT NULL,
  run_id TEXT,
  voided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS annual_runs (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  before_snapshot_json TEXT NOT NULL,
  after_snapshot_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  undone_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_annual_run
  ON annual_runs (guild_id, year)
  WHERE undone_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_guild_created
  ON audit_log (guild_id, created_at DESC);
