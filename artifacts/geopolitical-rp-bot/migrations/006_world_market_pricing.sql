ALTER TABLE global_stock ADD COLUMN base_price REAL NOT NULL DEFAULT 1 CHECK (base_price > 0);
UPDATE global_stock SET base_price = current_price;

ALTER TABLE guild_settings ADD COLUMN global_market_max_annual_increase_percent REAL NOT NULL DEFAULT 25
  CHECK (global_market_max_annual_increase_percent BETWEEN 0 AND 500);
ALTER TABLE guild_settings ADD COLUMN global_market_price_decay_percent REAL NOT NULL DEFAULT 20
  CHECK (global_market_price_decay_percent BETWEEN 0 AND 100);
