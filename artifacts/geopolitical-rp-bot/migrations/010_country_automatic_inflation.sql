ALTER TABLE countries ADD COLUMN automatic_inflation_enabled INTEGER NOT NULL DEFAULT 1 CHECK (automatic_inflation_enabled IN (0, 1));
