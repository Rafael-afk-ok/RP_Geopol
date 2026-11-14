CREATE TABLE IF NOT EXISTS production_order_materials (
  order_id TEXT NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (order_id, item_id)
);

INSERT OR IGNORE INTO production_order_materials (order_id, item_id, quantity)
SELECT o.id, r.material_item_id, r.quantity * o.quantity
FROM production_orders o
JOIN item_requirements r ON r.item_id = o.item_id
WHERE o.status = 'in_progress';
