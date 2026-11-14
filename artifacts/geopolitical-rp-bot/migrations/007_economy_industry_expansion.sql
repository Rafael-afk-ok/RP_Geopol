ALTER TABLE country_production ADD COLUMN annual_export_percent REAL NOT NULL DEFAULT 0
  CHECK (annual_export_percent BETWEEN 0 AND 100);

ALTER TABLE global_stock ADD COLUMN max_quantity REAL NOT NULL DEFAULT 0
  CHECK (max_quantity >= 0);
ALTER TABLE global_stock ADD COLUMN annual_replenishment REAL NOT NULL DEFAULT 0
  CHECK (annual_replenishment >= 0);

UPDATE global_stock SET max_quantity = quantity WHERE max_quantity = 0;

ALTER TABLE items ADD COLUMN production_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (production_enabled IN (0, 1));
