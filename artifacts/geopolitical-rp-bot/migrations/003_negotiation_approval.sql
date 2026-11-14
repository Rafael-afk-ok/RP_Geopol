ALTER TABLE scheduled_transfers ADD COLUMN proposed_by_country_id INTEGER REFERENCES countries(id);
ALTER TABLE scheduled_transfers ADD COLUMN accepted_by TEXT;
ALTER TABLE scheduled_transfers ADD COLUMN accepted INTEGER NOT NULL DEFAULT 1 CHECK (accepted IN (0, 1));

UPDATE scheduled_transfers SET proposed_by_country_id = from_country_id WHERE proposed_by_country_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_transfers_acceptance
  ON scheduled_transfers (guild_id, status, accepted);
