ALTER TABLE global_market_trades ADD COLUMN run_id TEXT;
ALTER TABLE global_market_trades ADD COLUMN voided_at TEXT;
CREATE INDEX IF NOT EXISTS idx_global_market_trades_annual_run ON global_market_trades(run_id, voided_at);
