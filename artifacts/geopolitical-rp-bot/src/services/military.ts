import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import { inTransaction } from "../db/index.js";
import { audit } from "./audit.js";
import { adjustBalance } from "./economy.js";
import { changeInventory } from "./inventory.js";
import { requireCountryOrNarratorPermission } from "./permissions.js";

export function modernizeMilitaryEquipment(
  db: Database.Database, guildId: string, actorId: string, countryId: number,
  oldItemId: number, newItemId: number, quantity: number,
): { cost: number; materials: Array<{ name: string; quantity: number }> } {
  assertDomain(Number.isFinite(quantity) && quantity > 0, "A quantidade precisa ser maior que zero.");
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "production", "create");
  return inTransaction(db, () => {
    const items = db.prepare("SELECT id, name, category, production_cost, production_enabled FROM items WHERE guild_id = ? AND id IN (?, ?)")
      .all(guildId, oldItemId, newItemId) as Array<{id:number;name:string;category:string;production_cost:number;production_enabled:number}>;
    const oldItem = items.find((item) => item.id === oldItemId);
    const newItem = items.find((item) => item.id === newItemId);
    assertDomain(oldItem && newItem && oldItemId !== newItemId, "Equipamento antigo ou novo não encontrado.");
    assertDomain(oldItem.category === "military" && newItem.category === "military", "A modernização só aceita equipamentos militares.");
    assertDomain(newItem.production_enabled === 1, "A fabricação do equipamento novo está desativada pelo Narrador.");
    const oldStock = db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, oldItemId) as {quantity:number}|undefined;
    assertDomain((oldStock?.quantity ?? 0) + 1e-9 >= quantity, "Estoque insuficiente do equipamento antigo.");
    const assigned = db.prepare("SELECT assigned_soldiers FROM army_equipment_assignments WHERE country_id = ? AND item_id = ?").get(countryId, oldItemId) as {assigned_soldiers:number}|undefined;
    assertDomain((assigned?.assigned_soldiers ?? 0) <= 0, "Desatribua os soldados do equipamento antigo antes de modernizá-lo.");
    const requirements = db.prepare("SELECT r.material_item_id, r.quantity, i.name FROM item_requirements r JOIN items i ON i.id = r.material_item_id WHERE r.item_id = ? ORDER BY i.name")
      .all(newItemId) as Array<{material_item_id:number;quantity:number;name:string}>;
    const materials = requirements.map((r) => ({ name:r.name, quantity:r.quantity*quantity }));
    for (const req of requirements) {
      const stock = db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(countryId, req.material_item_id) as {quantity:number}|undefined;
      assertDomain((stock?.quantity ?? 0) + 1e-9 >= req.quantity*quantity, `Material insuficiente: ${req.name}.`);
    }
    const cost = newItem.production_cost * quantity;
    if (cost > 0) adjustBalance(db, countryId, guildId, actorId, -cost, "military_modernization", `Modernização de ${oldItem.name} para ${newItem.name}`);
    for (const req of requirements) changeInventory(db, countryId, req.material_item_id, -(req.quantity*quantity));
    changeInventory(db, countryId, oldItemId, -quantity);
    changeInventory(db, countryId, newItemId, quantity);
    db.prepare("UPDATE countries SET military_readiness = MIN(100, military_readiness + 5) WHERE id = ?").run(countryId);
    audit(db, guildId, actorId, "modernize_military_equipment", "country", countryId, { oldItemId, newItemId, quantity, cost });
    return { cost, materials };
  });
}

export function getMilitaryStatus(db: Database.Database, guildId: string, actorId: string, countryId: number) {
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "population", "read");
  const country = db.prepare("SELECT name, army_size, military_readiness FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'")
    .get(countryId, guildId) as {name:string;army_size:number;military_readiness:number}|undefined;
  assertDomain(country, "País não encontrado.");
  const equipment = db.prepare(`SELECT i.name, a.assigned_soldiers, i.annual_maintenance
    FROM army_equipment_assignments a JOIN items i ON i.id = a.item_id
    WHERE a.country_id = ? ORDER BY i.name`).all(countryId) as Array<{name:string;assigned_soldiers:number;annual_maintenance:number}>;
  const assigned = equipment.reduce((sum,row)=>sum+row.assigned_soldiers,0);
  const maintenance = equipment.reduce((sum,row)=>sum+row.assigned_soldiers*row.annual_maintenance,0);
  return { ...country, assigned, unassigned:Math.max(0,country.army_size-assigned), maintenance, equipment };
}
