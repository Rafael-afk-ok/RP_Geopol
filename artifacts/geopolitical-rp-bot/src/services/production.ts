import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import { inTransaction } from "../db/index.js";
import { audit } from "./audit.js";
import { changeInventory } from "./inventory.js";
import { adjustBalance } from "./economy.js";
import { requireCountryOrNarratorPermission } from "./permissions.js";
import { runIdempotently } from "./idempotency.js";

export function startProduction(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  itemId: number,
  quantity: number,
  requestId?: string,
): { orderId: string; instant: boolean } {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "production.start", () =>
      startProduction(db, guildId, actorId, countryId, itemId, quantity),
    );
  }
  assertDomain(Number.isFinite(quantity) && quantity > 0, "A quantidade precisa ser maior que zero.");
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "production", "start");
  return inTransaction(db, () => {
    const item = db.prepare(
      `SELECT id, name, guild_id, production_cost, production_years, max_parallel_orders
       FROM items WHERE id = ?`,
    ).get(itemId) as
      | { id: number; name: string; guild_id: string; production_cost: number; production_years: number; max_parallel_orders: number }
      | undefined;
    assertDomain(item && item.guild_id === guildId, "Produto não encontrado.");
    const activeCount = db.prepare(
      "SELECT COUNT(*) AS count FROM production_orders WHERE country_id = ? AND item_id = ? AND status = 'in_progress'",
    ).get(countryId, itemId) as { count: number };
    assertDomain(activeCount.count < item.max_parallel_orders, "O limite de produção simultânea deste produto foi atingido.");

    const requirements = db.prepare(
      "SELECT material_item_id, quantity FROM item_requirements WHERE item_id = ?",
    ).all(itemId) as Array<{ material_item_id: number; quantity: number }>;
    for (const requirement of requirements) {
      const required = requirement.quantity * quantity;
      const stock = db.prepare(
        "SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?",
      ).get(countryId, requirement.material_item_id) as { quantity: number } | undefined;
      assertDomain((stock?.quantity ?? 0) + 1e-9 >= required, `Estoque insuficiente do material #${requirement.material_item_id}.`);
    }

    const productionCost = item.production_cost * quantity;
    if (productionCost > 0) {
      adjustBalance(db, countryId, guildId, actorId, -productionCost, "production_cost", `Custo inicial de produção de ${item.name}`);
    }
    for (const requirement of requirements) {
      changeInventory(db, countryId, requirement.material_item_id, -requirement.quantity * quantity);
    }

    const orderId = randomUUID();
    db.prepare(
      `INSERT INTO production_orders (id, country_id, item_id, quantity, remaining_years, total_years, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?)`,
    ).run(orderId, countryId, itemId, quantity, item.production_years, item.production_years, actorId);
    audit(db, guildId, actorId, item.production_years === 0 ? "queue_instant_production" : "start_production", "production_order", orderId, {
      countryId,
      itemId,
      quantity,
      productionCost,
      delivery: item.production_years === 0 ? "next annual processing" : "timed",
    });
    return { orderId, instant: item.production_years === 0 };
  });
}

export function cancelProduction(
  db: Database.Database,
  guildId: string,
  actorId: string,
  orderId: string,
  requestId?: string,
): number {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "production.cancel", () =>
      cancelProduction(db, guildId, actorId, orderId),
    );
  }
  const order = db.prepare(
    `SELECT o.id, o.country_id, o.item_id, o.quantity, o.status, c.guild_id,
       s.cancellation_refund_percent
     FROM production_orders o
     JOIN countries c ON c.id = o.country_id
     JOIN guild_settings s ON s.guild_id = c.guild_id
     WHERE o.id = ?`,
  ).get(orderId) as
    | { id: string; country_id: number; item_id: number; quantity: number; status: string; guild_id: string; cancellation_refund_percent: number }
    | undefined;
  assertDomain(order && order.guild_id === guildId, "Fila de produção não encontrada.");
  assertDomain(order.status === "in_progress", "A produção não está em andamento.");
  requireCountryOrNarratorPermission(db, guildId, order.country_id, actorId, "production", "cancel");
  return inTransaction(db, () => {
    const requirements = db.prepare(
      "SELECT material_item_id, quantity FROM item_requirements WHERE item_id = ?",
    ).all(order.item_id) as Array<{ material_item_id: number; quantity: number }>;
    let returned = 0;
    for (const requirement of requirements) {
      const refund = requirement.quantity * order.quantity * order.cancellation_refund_percent / 100;
      if (refund > 0) {
        changeInventory(db, order.country_id, requirement.material_item_id, refund);
        returned += refund;
      }
    }
    db.prepare("UPDATE production_orders SET status = 'cancelled' WHERE id = ? AND status = 'in_progress'").run(orderId);
    audit(db, guildId, actorId, "cancel_production", "production_order", orderId, {
      refundPercent: order.cancellation_refund_percent,
      returnedMaterials: returned,
    });
    return returned;
  });
}

export function listProductionQueue(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
): Array<{ id: string; item: string; quantity: number; remaining_years: number; total_years: number; status: string }> {
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "production", "read");
  return db.prepare(
    `SELECT o.id, i.name AS item, o.quantity, o.remaining_years, o.total_years, o.status
     FROM production_orders o JOIN items i ON i.id = o.item_id
     JOIN countries c ON c.id = o.country_id
     WHERE c.guild_id = ? AND o.country_id = ? ORDER BY o.created_at`,
  ).all(guildId, countryId) as Array<{
    id: string;
    item: string;
    quantity: number;
    remaining_years: number;
    total_years: number;
    status: string;
  }>;
}
