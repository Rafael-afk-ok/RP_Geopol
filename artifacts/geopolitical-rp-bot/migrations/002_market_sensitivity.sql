ALTER TABLE guild_settings
  ADD COLUMN global_market_price_sensitivity REAL NOT NULL DEFAULT 0.15
  CHECK (global_market_price_sensitivity BETWEEN 0 AND 5);
