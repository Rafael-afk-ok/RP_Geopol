import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import { inTransaction } from "../db/index.js";
import { audit } from "./audit.js";
import type { PermissionSystem } from "../domain/types.js";
import { requireCountryOrNarratorPermission, requireNarratorPermission } from "./permissions.js";
import { runIdempotently } from "./idempotency.js";

export interface ItemInput {
  name: string;
  category: "military" | "common" | "custom";
  customCategoryId?: number;
  description: string;
  properties: Record<string, unknown>;
  productionCost: number;
  annualMaintenance: number;
  annualIncomePerUnit?: number;
  annualExpensePerUnit?: number;
  productionYears: number;
  maxParallelOrders: number;
  isFood: boolean;
  globalTradeable: boolean;
}

export function createCustomItemCategory(
  db: Database.Database,
  guildId: string,
  actorId: string,
  name: string,
  description: string,
): number {
  requireNarratorPermission(db, guildId, actorId, "inventory", "create");
  assertDomain(name.trim().length >= 2 && name.trim().length <= 60, "O nome da categoria deve ter entre 2 e 60 caracteres.");
  assertDomain(description.length <= 250, "A descrição deve ter até 250 caracteres.");
  const result = db.prepare(
    "INSERT INTO custom_item_categories (guild_id, name, description, created_by) VALUES (?, ?, ?, ?)",
  ).run(guildId, name.trim(), description.trim(), actorId);
  const id = Number(result.lastInsertRowid);
  audit(db, guildId, actorId, "create_custom_item_category", "item_category", id, { name: name.trim() });
  return id;
}

export function defineItem(
  db: Database.Database,
  guildId: string,
  actorId: string,
  input: ItemInput,
): number {
  requireNarratorPermission(db, guildId, actorId, "inventory", "create");
  assertDomain(input.name.trim().length >= 2 && input.name.length <= 80, "O nome do item deve ter entre 2 e 80 caracteres.");
  assertDomain(
    Number.isFinite(input.productionCost) && Number.isFinite(input.annualMaintenance) &&
      input.productionCost >= 0 && input.annualMaintenance >= 0,
    "Custos precisam ser valores finitos não negativos.",
  );
  const annualIncome = input.annualIncomePerUnit ?? 0;
  const annualExpense = input.annualExpensePerUnit ?? 0;
  assertDomain(
    Number.isFinite(annualIncome) && Number.isFinite(annualExpense) && annualIncome >= 0 && annualExpense >= 0,
    "Receitas e despesas anuais precisam ser valores finitos não negativos.",
  );
  assertDomain(input.description.length <= 250, "A descrição deve ter até 250 caracteres.");
  assertDomain(Number.isInteger(input.productionYears) && input.productionYears >= 0, "A duração deve ser um número inteiro de anos.");
  assertDomain(Number.isInteger(input.maxParallelOrders) && input.maxParallelOrders > 0, "O limite de filas deve ser positivo.");
  assertDomain(!input.isFood || input.category === "common", "Alimentos devem pertencer à categoria de bens comuns.");
  if (input.category === "custom") {
    assertDomain(input.customCategoryId !== undefined, "Selecione uma categoria personalizada criada pelo narrador.");
    const category = db.prepare(
      "SELECT id FROM custom_item_categories WHERE id = ? AND guild_id = ?",
    ).get(input.customCategoryId, guildId);
    assertDomain(category, "Categoria personalizada não encontrada neste servidor.");
  } else {
    assertDomain(input.customCategoryId === undefined, "Categorias personalizadas só podem ser usadas em itens personalizados.");
  }
  const result = db.prepare(
    `INSERT INTO items
      (guild_id, name, category, description, properties_json, production_cost, annual_maintenance,
       production_years, max_parallel_orders, is_food, global_tradeable, created_by,
       custom_category_id, annual_income_per_unit, annual_expense_per_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    guildId,
    input.name.trim(),
    input.category,
    input.description.trim(),
    JSON.stringify(input.properties),
    input.productionCost,
    input.annualMaintenance,
    input.productionYears,
    input.maxParallelOrders,
    input.isFood ? 1 : 0,
    input.globalTradeable ? 1 : 0,
    actorId,
    input.customCategoryId ?? null,
    annualIncome,
    annualExpense,
  );
  const id = Number(result.lastInsertRowid);
  audit(db, guildId, actorId, "define_item", "item", id, { name: input.name, category: input.category });
  return id;
}

export function addItemRequirement(
  db: Database.Database,
  guildId: string,
  actorId: string,
  itemId: number,
  materialItemId: number,
  quantity: number,
): void {
  requireNarratorPermission(db, guildId, actorId, "production", "configure");
  assertDomain(quantity > 0 && Number.isFinite(quantity), "A quantidade de material precisa ser maior que zero.");
  const rows = db.prepare("SELECT id, guild_id FROM items WHERE id IN (?, ?)").all(itemId, materialItemId) as Array<{
    id: number;
    guild_id: string;
  }>;
  assertDomain(rows.length === 2 && rows.every((item) => item.guild_id === guildId), "Produto ou material não pertence a este servidor.");
  assertDomain(itemId !== materialItemId, "Um produto não pode exigir a si mesmo como material.");
  db.prepare(
    `INSERT INTO item_requirements (item_id, material_item_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT (item_id, material_item_id) DO UPDATE SET quantity = excluded.quantity`,
  ).run(itemId, materialItemId, quantity);
  audit(db, guildId, actorId, "set_item_requirement", "item", itemId, { materialItemId, quantity });
}

export function adjustInventory(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  itemId: number,
  delta: number,
  reason: string,
  requestId?: string,
): void {
  if (requestId) {
    runIdempotently(db, guildId, requestId, "inventory.adjust", () => {
      adjustInventory(db, guildId, actorId, countryId, itemId, delta, reason);
      return true;
    });
    return;
  }
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "inventory", "edit");
  assertDomain(Number.isFinite(delta) && delta !== 0, "A alteração de estoque precisa ser diferente de zero.");
  assertDomain(reason.trim().length > 0 && reason.length <= 200, "Informe um motivo de até 200 caracteres.");
  inTransaction(db, () => {
    const country = db.prepare("SELECT id FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'").get(
      countryId,
      guildId,
    );
    const item = db.prepare("SELECT id FROM items WHERE id = ? AND guild_id = ?").get(itemId, guildId);
    assertDomain(country && item, "País ou item não encontrado.");
    const current = db.prepare(
      "SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?",
    ).get(countryId, itemId) as { quantity: number } | undefined;
    const next = (current?.quantity ?? 0) + delta;
    const assigned = db.prepare("SELECT assigned_soldiers FROM army_equipment_assignments WHERE country_id = ? AND item_id = ?").get(countryId, itemId) as { assigned_soldiers: number } | undefined;
    assertDomain(Number.isFinite(next) && next >= (assigned?.assigned_soldiers ?? 0) - 1e-9, "O estoque não pode ficar abaixo da quantidade de equipamentos atribuídos. Desatribua-os pelo comando /exercito equipamento antes de removê-los.");

    db.prepare(
      `INSERT INTO country_inventory (country_id, item_id, quantity) VALUES (?, ?, ?)
       ON CONFLICT (country_id, item_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP`,
    ).run(countryId, itemId, Math.max(0, next));
    audit(db, guildId, actorId, "adjust_inventory", "inventory", `${countryId}:${itemId}`, { delta, reason });
  });
}

export function setCountryProduction(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  itemId: number,
  annualProduction: number,
  annualConsumption: number,
  annualExportPercent = 0,
): void {
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "production", "configure");
  assertDomain(
    Number.isFinite(annualProduction) && Number.isFinite(annualConsumption) &&
      Number.isFinite(annualExportPercent) && annualProduction >= 0 && annualConsumption >= 0 &&
      annualExportPercent >= 0 && annualExportPercent <= 100,
    "Produção e consumo precisam ser valores finitos não negativos.",
  );
  const country = db.prepare("SELECT id FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'").get(
    countryId,
    guildId,
  );
  const item = db.prepare("SELECT id FROM items WHERE id = ? AND guild_id = ?").get(itemId, guildId);
  assertDomain(country && item, "País ou item não encontrado.");
  db.prepare(
    `INSERT INTO country_production (country_id, item_id, annual_production, annual_consumption, annual_export_percent)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (country_id, item_id) DO UPDATE
     SET annual_production = excluded.annual_production, annual_consumption = excluded.annual_consumption,
       annual_export_percent = excluded.annual_export_percent`,
  ).run(countryId, itemId, annualProduction, annualConsumption, annualExportPercent);
  audit(db, guildId, actorId, "configure_country_production", "production", `${countryId}:${itemId}`, {
    annualProduction,
    annualConsumption,
    annualExportPercent,
  });
}

export function setGlobalStock(
  db: Database.Database,
  guildId: string,
  actorId: string,
  itemId: number,
  quantity: number,
  currentPrice: number,
  basePrice: number,
  minimumPrice: number,
  maximumPrice: number,
  maximumStock = quantity,
  annualReplenishment = 0,
): void {
  requireNarratorPermission(db, guildId, actorId, "market", "configure");
  assertDomain(
    [quantity, currentPrice, basePrice, minimumPrice, maximumPrice, maximumStock, annualReplenishment].every(Number.isFinite) &&
      quantity >= 0 && maximumStock >= quantity && annualReplenishment >= 0 && currentPrice > 0 && basePrice > 0 && minimumPrice > 0 && maximumPrice >= minimumPrice,
    "Estoque ou faixa de preços inválida.",
  );
  assertDomain(currentPrice >= minimumPrice && currentPrice <= maximumPrice, "O preço atual deve ficar dentro dos limites.");
  assertDomain(basePrice >= minimumPrice && basePrice <= maximumPrice, "O preço-base deve ficar dentro dos limites.");
  const item = db.prepare("SELECT id FROM items WHERE id = ? AND guild_id = ? AND global_tradeable = 1").get(itemId, guildId);
  assertDomain(item, "Item não configurado para o mercado global.");
  db.prepare(
    `INSERT INTO global_stock (guild_id, item_id, quantity, current_price, base_price, min_price, max_price, max_quantity, annual_replenishment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (guild_id, item_id) DO UPDATE SET quantity = excluded.quantity,
       current_price = excluded.current_price, base_price = excluded.base_price,
       min_price = excluded.min_price, max_price = excluded.max_price,
       max_quantity = excluded.max_quantity, annual_replenishment = excluded.annual_replenishment`,
  ).run(guildId, itemId, quantity, currentPrice, basePrice, minimumPrice, maximumPrice, maximumStock, annualReplenishment);
  audit(db, guildId, actorId, "configure_global_stock", "global_stock", `${guildId}:${itemId}`, {
    quantity,
    currentPrice,
    basePrice,
    minimumPrice,
    maximumPrice,
    maximumStock,
    annualReplenishment,
  });
}

export function changeInventory(
  db: Database.Database,
  countryId: number,
  itemId: number,
  delta: number,
): void {
  assertDomain(Number.isFinite(delta), "A variação de estoque precisa ser finita.");
  const current = db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(
    countryId,
    itemId,
  ) as { quantity: number } | undefined;
  const next = (current?.quantity ?? 0) + delta;
  assertDomain(Number.isFinite(next) && next >= -1e-9, "Estoque insuficiente ou quantidade resultante inválida.");
  if (delta < 0) {
    const assigned = db.prepare(
      "SELECT assigned_soldiers FROM army_equipment_assignments WHERE country_id = ? AND item_id = ?",
    ).get(countryId, itemId) as { assigned_soldiers: number } | undefined;
    assertDomain(
      next >= (assigned?.assigned_soldiers ?? 0) - 1e-9,
      "Estoque insuficiente: parte dos equipamentos está atribuída ao exército e não pode ser removida, vendida ou consumida.",
      "RESERVED_MILITARY_STOCK",
    );
  }
  db.prepare(
    `INSERT INTO country_inventory (country_id, item_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT (country_id, item_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP`,
  ).run(countryId, itemId, Math.max(0, next));
}

export function listCountryInventory(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
): Array<{ id: number; name: string; category: string; quantity: number; annual_production: number; annual_consumption: number; unit: string }> {
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "inventory" as PermissionSystem, "read");
  return db.prepare(
    `SELECT i.id, i.name,
      CASE WHEN i.category = 'military' THEN 'Militar' WHEN cc.name = 'Recursos naturais' THEN 'Recursos naturais' ELSE 'Indústria e bens' END AS category,
      COALESCE(v.quantity, 0) AS quantity,
      COALESCE(p.annual_production, 0) AS annual_production,
      COALESCE(p.annual_consumption, 0) AS annual_consumption,
      json_extract(i.properties_json, '$.unit') AS unit
     FROM items i LEFT JOIN country_inventory v ON v.item_id = i.id AND v.country_id = ?
     LEFT JOIN country_production p ON p.item_id = i.id AND p.country_id = ?
     LEFT JOIN custom_item_categories cc ON cc.id = i.custom_category_id
     WHERE i.guild_id = ? ORDER BY CASE WHEN i.category = 'military' THEN 3 WHEN cc.name = 'Recursos naturais' THEN 1 ELSE 2 END, i.name COLLATE NOCASE`,
  ).all(countryId, countryId, guildId) as Array<{ id: number; name: string; category: string; quantity: number; annual_production: number; annual_consumption: number; unit: string }>;
}


export function ensureDefaultCatalog(db: Database.Database, guildId: string, actorId: string): void {
  inTransaction(db, () => {
  const categories = [
    { name: "Recursos naturais", description: "Matérias-primas e recursos básicos." },
    { name: "Indústria e bens", description: "Produtos industriais e bens de consumo." },
  ];
  const categoryIds = new Map<string, number>();
  for (const category of categories) {
    db.prepare("INSERT OR IGNORE INTO custom_item_categories (guild_id, name, description, created_by) VALUES (?, ?, ?, ?)")
      .run(guildId, category.name, category.description, actorId);
    const row = db.prepare("SELECT id FROM custom_item_categories WHERE guild_id = ? AND name = ?")
      .get(guildId, category.name) as { id: number };
    categoryIds.set(category.name, row.id);
  }
  const defaults: Array<{ name: string; category: "common" | "military" | "custom"; group?: string; unit: string; food?: boolean; years?: number; cost?: number; maintenance?: number }> = [
    { name: "Grãos", category: "custom", group: "Recursos naturais", unit: "t", food: true, cost: 12 },
    { name: "Ferro", category: "custom", group: "Recursos naturais", unit: "t", cost: 18 },
    { name: "Petróleo", category: "custom", group: "Recursos naturais", unit: "barris", cost: 22 },
    { name: "Carvão", category: "custom", group: "Recursos naturais", unit: "t", cost: 10 },
    { name: "Madeira", category: "custom", group: "Recursos naturais", unit: "m³", cost: 8 },
    { name: "Borracha", category: "custom", group: "Recursos naturais", unit: "t", cost: 25 },
    { name: "Aço", category: "custom", group: "Indústria e bens", unit: "t", cost: 45, years: 1 },
    { name: "Cimento", category: "custom", group: "Indústria e bens", unit: "t", cost: 20 },
    { name: "Ferramentas", category: "custom", group: "Indústria e bens", unit: "un.", cost: 35 },
    { name: "Máquinas", category: "custom", group: "Indústria e bens", unit: "un.", cost: 120, years: 1 },
    { name: "Tecidos", category: "custom", group: "Indústria e bens", unit: "m", cost: 15 },
    { name: "Fertilizantes", category: "custom", group: "Indústria e bens", unit: "t", cost: 28 },
    { name: "Armas leves", category: "military", unit: "un.", cost: 60, years: 1, maintenance: 2 },
    { name: "Artilharia", category: "military", unit: "un.", cost: 250, years: 2, maintenance: 12 },
    { name: "Munição", category: "military", unit: "lotes", cost: 20 },
    { name: "Uniformes", category: "military", unit: "un.", cost: 18 },
    { name: "Navios", category: "military", unit: "un.", cost: 1800, years: 3, maintenance: 90 },
    { name: "Veículos militares", category: "military", unit: "un.", cost: 500, years: 2, maintenance: 25 },
  ];
  const insert = db.prepare(
    `INSERT OR IGNORE INTO items
      (guild_id, name, category, description, properties_json, production_cost, annual_maintenance,
       production_years, max_parallel_orders, is_food, global_tradeable, created_by,
       custom_category_id, annual_income_per_unit, annual_expense_per_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, ?, 1, ?, ?, 0, 0)`,
  );
  for (const item of defaults) {
    insert.run(
      guildId, item.name, item.category, "Produto padrão do catálogo nacional.",
      JSON.stringify({ unit: item.unit }), item.cost ?? 10, item.maintenance ?? 0,
      item.years ?? 0, item.food ? 1 : 0, actorId,
      item.group ? categoryIds.get(item.group) ?? null : null,
    );
  }
  });
}



export function setItemProductionEnabled(
  db: Database.Database,
  guildId: string,
  actorId: string,
  itemId: number,
  enabled: boolean,
): void {
  requireNarratorPermission(db, guildId, actorId, "production", "configure");
  const result = db.prepare(
    "UPDATE items SET production_enabled = ? WHERE id = ? AND guild_id = ?",
  ).run(enabled ? 1 : 0, itemId, guildId);
  assertDomain(result.changes > 0, "Item não encontrado neste servidor.");
  audit(db, guildId, actorId, "set_item_production_enabled", "item", itemId, { enabled });
}
