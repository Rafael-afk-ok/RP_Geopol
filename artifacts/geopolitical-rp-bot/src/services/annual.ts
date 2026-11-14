import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import { inTransaction } from "../db/index.js";
import { audit } from "./audit.js";
import { adjustBalance } from "./economy.js";
import { requireNarratorPermission } from "./permissions.js";
import { runIdempotently } from "./idempotency.js";

interface AnnualSnapshot {
  currentYear: number;
  countries: Array<{ id: number; treasury: number; population: number; revolt_counter: number; army_size: number }>;
  consumptionRules: Array<{ country_id: number; item_id: number; target: string; quantity_per_unit: number }>;
  equipment: Array<{ country_id: number; item_id: number; assigned_soldiers: number }>;
  transfers: Array<{ id: string; remaining_years: number; status: string }>;
  inventory: Array<{ country_id: number; item_id: number; quantity: number }>;
  productionOrders: Array<{ id: string; remaining_years: number; status: string }>;
  economyEntries: Array<{ id: number; active: number }>;
  globalStock: Array<{ item_id: number; quantity: number; current_price: number }>;
  playerOffers: Array<{ id: string; remaining_quantity: number; status: string }>;
}

function snapshotGuild(db: Database.Database, guildId: string): AnnualSnapshot {
  const settings = db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = ?").get(guildId) as
    | { current_year: number }
    | undefined;
  assertDomain(settings, "Servidor ainda não foi inicializado.");
  return {
    currentYear: settings.current_year,
    countries: db.prepare(
      `SELECT id, treasury, population, revolt_counter, army_size FROM countries
       WHERE guild_id = ? AND status = 'active' ORDER BY id`,
    ).all(guildId) as AnnualSnapshot["countries"],
    consumptionRules: db.prepare(`SELECT r.country_id, r.item_id, r.target, r.quantity_per_unit FROM country_consumption_rules r JOIN countries c ON c.id = r.country_id WHERE c.guild_id = ? ORDER BY r.country_id, r.target, r.item_id`).all(guildId) as AnnualSnapshot["consumptionRules"],
    equipment: db.prepare(`SELECT a.country_id, a.item_id, a.assigned_soldiers FROM army_equipment_assignments a JOIN countries c ON c.id = a.country_id WHERE c.guild_id = ? ORDER BY a.country_id, a.item_id`).all(guildId) as AnnualSnapshot["equipment"],
    transfers: db.prepare("SELECT id, remaining_years, status FROM scheduled_transfers WHERE guild_id = ? ORDER BY id").all(guildId) as AnnualSnapshot["transfers"],
    inventory: db.prepare(
      `SELECT v.country_id, v.item_id, v.quantity FROM country_inventory v
       JOIN countries c ON c.id = v.country_id WHERE c.guild_id = ? ORDER BY v.country_id, v.item_id`,
    ).all(guildId) as AnnualSnapshot["inventory"],
    productionOrders: db.prepare(
      `SELECT o.id, o.remaining_years, o.status FROM production_orders o
       JOIN countries c ON c.id = o.country_id WHERE c.guild_id = ? ORDER BY o.id`,
    ).all(guildId) as AnnualSnapshot["productionOrders"],
    economyEntries: db.prepare(
      `SELECT e.id, e.active FROM economy_entries e
       JOIN countries c ON c.id = e.country_id WHERE c.guild_id = ? ORDER BY e.id`,
    ).all(guildId) as AnnualSnapshot["economyEntries"],
    globalStock: db.prepare(
      "SELECT item_id, quantity, current_price FROM global_stock WHERE guild_id = ? ORDER BY item_id",
    ).all(guildId) as AnnualSnapshot["globalStock"],
    playerOffers: db.prepare(
      "SELECT id, remaining_quantity, status FROM player_offers WHERE guild_id = ? ORDER BY id",
    ).all(guildId) as AnnualSnapshot["playerOffers"],
  };
}

function writeInventory(db: Database.Database, rows: AnnualSnapshot["inventory"]): void {
  const insert = db.prepare(
    `INSERT INTO country_inventory (country_id, item_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT (country_id, item_id) DO UPDATE SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP`,
  );
  for (const row of rows) insert.run(row.country_id, row.item_id, row.quantity);
}

function applyInflationPenalty(
  baseIncome: number,
  issuedAmount: number,
  mode: "linear" | "exponential",
  penaltyPercentPer1000: number,
): number {
  const exposure = Math.max(0, issuedAmount / 1000 * penaltyPercentPer1000 / 100);
  const multiplier = mode === "linear" ? Math.max(0, 1 - exposure) : Math.exp(-exposure);
  return baseIncome * multiplier;
}

export function processAnnualTurn(
  db: Database.Database,
  guildId: string,
  actorId: string,
  requestId?: string,
): { runId: string; year: number; summary: Record<string, number> } {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "year.advance", () =>
      processAnnualTurn(db, guildId, actorId),
    );
  }
  requireNarratorPermission(db, guildId, actorId, "year", "advance");
  return inTransaction(db, () => {
    const settings = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId) as
      | {
          current_year: number;
          inflation_rate_percent: number;
          inflation_penalty_mode: "linear" | "exponential";
          inflation_penalty_percent_per_1000: number;
          food_shortage_severity: number;
          revolt_normalization_per_year: number;
          global_market_price_sensitivity: number;
        }
      | undefined;
    assertDomain(settings, "Servidor ainda não foi inicializado.");
    const year = settings.current_year + 1;
    const duplicate = db.prepare(
      "SELECT id FROM annual_runs WHERE guild_id = ? AND year = ? AND undone_at IS NULL",
    ).get(guildId, year);
    assertDomain(!duplicate, `O ano ${year} já foi processado.`, "DUPLICATE_ANNUAL_RUN");
    const integrity = db.prepare(
      `SELECT c.id FROM countries c
       WHERE c.guild_id = ? AND c.status = 'active'
          AND (
            c.treasury < -c.debt_limit - 1e-9
            OR (c.max_money IS NOT NULL AND c.treasury > c.max_money + 1e-9)
            OR c.population < 0
            OR c.population > 9007199254740991
            OR c.population != CAST(c.population AS INTEGER)
            OR c.annual_population_growth < -100
            OR c.food_per_person < 0
            OR c.inflation_issued < 0
            OR c.revolt_counter < 0
          )
       LIMIT 1`,
    ).get(guildId);
    assertDomain(!integrity, "A verificação de integridade encontrou dados nacionais inválidos.", "INTEGRITY_FAILURE");

    const before = snapshotGuild(db, guildId);
    const runId = randomUUID();
    const summary = { countries: 0, revenue: 0, expenses: 0, completedOrders: 0, expiredOffers: 0, foodDeficit: 0, populationShortage: 0, armyShortage: 0, transfersApplied: 0, transfersFailed: 0 };
    const countries = db.prepare(
      `SELECT id, name, treasury, max_money, debt_limit, annual_income, population,
        annual_population_growth, food_per_person, revolt_counter, inflation_issued, army_size
       FROM countries WHERE guild_id = ? AND status = 'active' ORDER BY id`,
    ).all(guildId) as Array<{
      id: number;
      name: string;
      treasury: number;
      max_money: number | null;
      debt_limit: number;
      annual_income: number;
      population: number;
      annual_population_growth: number;
      food_per_person: number;
      revolt_counter: number;
      army_size: number;
      inflation_issued: number;
    }>;
    summary.countries = countries.length;

    // Annual income, scheduled income/expenses, and maintenance.
    for (const country of countries) {
      const income = applyInflationPenalty(
        country.annual_income,
        country.inflation_issued,
        settings.inflation_penalty_mode,
        settings.inflation_penalty_percent_per_1000,
      );
      if (income > 0) {
        adjustBalance(db, country.id, guildId, actorId, income, "annual_income", `Rendimento anual do ano ${year}`, null, runId, year);
        summary.revenue += income;
      }

      const entries = db.prepare(
        `SELECT id, direction, amount, description, recurrence FROM economy_entries
         WHERE country_id = ? AND active = 1 AND due_year <= ? ORDER BY id`,
      ).all(country.id, year) as Array<{
        id: number;
        direction: "income" | "expense";
        amount: number;
        description: string;
        recurrence: "recurring" | "one_time";
      }>;
      for (const entry of entries) {
        const amount = entry.direction === "income" ? entry.amount : -entry.amount;
        adjustBalance(db, country.id, guildId, actorId, amount, `annual_${entry.direction}`, entry.description, null, runId, year);
        if (amount > 0) summary.revenue += amount;
        else summary.expenses += -amount;
        if (entry.recurrence === "one_time") {
          db.prepare("UPDATE economy_entries SET active = 0 WHERE id = ?").run(entry.id);
        }
      }

      const operatingFlows = db.prepare(
        `SELECT
           COALESCE(SUM(v.quantity * i.annual_maintenance), 0) AS maintenance,
           COALESCE(SUM(v.quantity * i.annual_income_per_unit), 0) AS income,
           COALESCE(SUM(v.quantity * i.annual_expense_per_unit), 0) AS expense
         FROM country_inventory v JOIN items i ON i.id = v.item_id
         WHERE v.country_id = ?`,
      ).get(country.id) as { maintenance: number; income: number; expense: number };
      if (operatingFlows.income > 0) {
        adjustBalance(
          db,
          country.id,
          guildId,
          actorId,
          operatingFlows.income,
          "annual_item_income",
          `Receitas anuais de itens operacionais no ano ${year}`,
          null,
          runId,
          year,
        );
        summary.revenue += operatingFlows.income;
      }
      if (operatingFlows.expense > 0) {
        adjustBalance(
          db,
          country.id,
          guildId,
          actorId,
          -operatingFlows.expense,
          "annual_item_expense",
          `Despesas anuais de itens operacionais no ano ${year}`,
          null,
          runId,
          year,
        );
        summary.expenses += operatingFlows.expense;
      }
      if (operatingFlows.maintenance > 0) {
        adjustBalance(db, country.id, guildId, actorId, -operatingFlows.maintenance, "annual_maintenance", `Manutenção anual do ano ${year}`, null, runId, year);
        summary.expenses += operatingFlows.maintenance;
      }
    }

    // Annual production and normal consumption. Food is consumed after population needs are calculated.
    const productionRows = db.prepare(
      `SELECT cp.country_id, cp.item_id, cp.annual_production, cp.annual_consumption, i.is_food, i.category
       FROM country_production cp JOIN items i ON i.id = cp.item_id
       JOIN countries c ON c.id = cp.country_id
       WHERE c.guild_id = ? AND c.status = 'active' ORDER BY cp.country_id, cp.item_id`,
    ).all(guildId) as Array<{
      country_id: number;
      item_id: number;
      annual_production: number;
      annual_consumption: number;
      is_food: number;
      category: string;
    }>;
    const inventoryDelta = (countryId: number, itemId: number, delta: number): void => {
      const current = db.prepare(
        "SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?",
      ).get(countryId, itemId) as { quantity: number } | undefined;
      const quantity = Math.max(0, (current?.quantity ?? 0) + delta);
      db.prepare(
        `INSERT INTO country_inventory (country_id, item_id, quantity) VALUES (?, ?, ?)
         ON CONFLICT (country_id, item_id) DO UPDATE
         SET quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP`,
      ).run(countryId, itemId, quantity);
    };
    for (const row of productionRows) {
      if (row.annual_production > 0) inventoryDelta(row.country_id, row.item_id, row.annual_production);
      if (!row.is_food && row.category !== 'military' && row.annual_consumption > 0) {
        const current = db.prepare(
          "SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?",
        ).get(row.country_id, row.item_id) as { quantity: number } | undefined;
        const assigned = db.prepare("SELECT assigned_soldiers FROM army_equipment_assignments WHERE country_id = ? AND item_id = ?").get(row.country_id, row.item_id) as { assigned_soldiers: number } | undefined;
        const available = Math.max(0, (current?.quantity ?? 0) - (assigned?.assigned_soldiers ?? 0));
        inventoryDelta(row.country_id, row.item_id, -Math.min(available, row.annual_consumption));
      }
    }

    // Timed orders become operational only after the final year finishes.
    const orders = db.prepare(
      `SELECT o.id, o.country_id, o.item_id, o.quantity, o.remaining_years, i.name, i.annual_maintenance
       FROM production_orders o JOIN items i ON i.id = o.item_id
       JOIN countries c ON c.id = o.country_id
       WHERE c.guild_id = ? AND c.status = 'active' AND o.status = 'in_progress'
       ORDER BY o.created_at, o.id`,
    ).all(guildId) as Array<{
      id: string;
      country_id: number;
      item_id: number;
      quantity: number;
      remaining_years: number;
      name: string;
      annual_maintenance: number;
    }>;
    for (const order of orders) {
      if (order.remaining_years <= 1) {
        inventoryDelta(order.country_id, order.item_id, order.quantity);
        db.prepare("UPDATE production_orders SET remaining_years = 0, status = 'completed' WHERE id = ?").run(order.id);
        summary.completedOrders += 1;
        const firstMaintenance = order.quantity * order.annual_maintenance;
        if (firstMaintenance > 0) {
          adjustBalance(db, order.country_id, guildId, actorId, -firstMaintenance, "annual_maintenance", `Primeira manutenção de ${order.name}`, null, runId, year);
          summary.expenses += firstMaintenance;
        }
      } else {
        db.prepare("UPDATE production_orders SET remaining_years = remaining_years - 1 WHERE id = ?").run(order.id);
      }
    }

    // Apply active bilateral agreements at the annual close. Insufficient funds/stock pauses that installment.
    const transfers = db.prepare("SELECT * FROM scheduled_transfers WHERE guild_id = ? AND status = 'active' AND accepted = 1 ORDER BY created_at, id").all(guildId) as Array<{ id: string; from_country_id: number; to_country_id: number; transfer_type: "money" | "item"; item_id: number | null; amount: number; remaining_years: number; description: string }>;
    for (const transfer of transfers) {
      const from = db.prepare("SELECT treasury, debt_limit FROM countries WHERE id = ? AND status = 'active'").get(transfer.from_country_id) as { treasury: number; debt_limit: number } | undefined;
      const to = db.prepare("SELECT id, treasury, max_money FROM countries WHERE id = ? AND status = 'active'").get(transfer.to_country_id) as { id: number; treasury: number; max_money: number | null } | undefined;
      let applied = false;
      if (from && to && transfer.transfer_type === "money" && from.treasury - transfer.amount >= -from.debt_limit && (to.max_money === null || to.treasury + transfer.amount <= to.max_money)) {
        adjustBalance(db, transfer.from_country_id, guildId, actorId, -transfer.amount, "annual_transfer_out", transfer.description || "Acordo anual", null, runId, year);
        adjustBalance(db, transfer.to_country_id, guildId, actorId, transfer.amount, "annual_transfer_in", transfer.description || "Acordo anual", null, runId, year);
        applied = true;
      } else if (from && to && transfer.transfer_type === "item" && transfer.item_id !== null) {
        const stock = db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(transfer.from_country_id, transfer.item_id) as { quantity: number } | undefined;
        const assigned = db.prepare("SELECT assigned_soldiers FROM army_equipment_assignments WHERE country_id = ? AND item_id = ?").get(transfer.from_country_id, transfer.item_id) as { assigned_soldiers: number } | undefined;
        if ((stock?.quantity ?? 0) - (assigned?.assigned_soldiers ?? 0) >= transfer.amount) {
          inventoryDelta(transfer.from_country_id, transfer.item_id, -transfer.amount);
          inventoryDelta(transfer.to_country_id, transfer.item_id, transfer.amount);
          applied = true;
        }
      }
      if (applied) {
        summary.transfersApplied += 1;
        if (transfer.remaining_years > 0) {
          const left = transfer.remaining_years - 1;
          db.prepare("UPDATE scheduled_transfers SET remaining_years = ?, status = ? WHERE id = ?").run(left, left === 0 ? "completed" : "active", transfer.id);
        }
      } else summary.transfersFailed += 1;
    }

    // Population and army needs are configured per country and item. Shortages never create negative stock.
    const foodItems = db.prepare("SELECT id FROM items WHERE guild_id = ? AND is_food = 1 ORDER BY id").all(guildId) as Array<{ id: number }>;
    for (const country of countries) {
      const projectedPopulation = Math.round(country.population * (1 + country.annual_population_growth / 100));
      assertDomain(
        Number.isSafeInteger(projectedPopulation),
        `O crescimento populacional calculado para ${country.name} excede o limite numérico seguro.`,
        "POPULATION_OVERFLOW",
      );
      const population = Math.max(0, projectedPopulation);
      db.prepare("UPDATE countries SET population = ? WHERE id = ?").run(population, country.id);
      const rules = db.prepare("SELECT item_id, target, quantity_per_unit FROM country_consumption_rules WHERE country_id = ? ORDER BY target, item_id").all(country.id) as Array<{ item_id: number; target: "population" | "army"; quantity_per_unit: number }>;
      const populationRules = rules.filter((rule) => rule.target === "population");
      const armyRules = rules.filter((rule) => rule.target === "army");
      let populationNeed = 0, populationShortage = 0, armyNeed = 0, armyShortage = 0;
      const consumeRule = (itemId: number, need: number): number => {
        const stock = db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(country.id, itemId) as { quantity: number } | undefined;
        const assigned = db.prepare("SELECT assigned_soldiers FROM army_equipment_assignments WHERE country_id = ? AND item_id = ?").get(country.id, itemId) as { assigned_soldiers: number } | undefined;
        const available = Math.max(0, (stock?.quantity ?? 0) - (assigned?.assigned_soldiers ?? 0));
        const consumed = Math.min(available, need);
        if (consumed > 0) inventoryDelta(country.id, itemId, -consumed);
        return Math.max(0, need - consumed);
      };
      if (populationRules.length) {
        for (const rule of populationRules) {
          const need = population * rule.quantity_per_unit;
          populationNeed += need;
          populationShortage += consumeRule(rule.item_id, need);
        }
      } else if (country.food_per_person > 0) {
        let remainingNeed = population * country.food_per_person;
        populationNeed = remainingNeed;
        for (const foodItem of foodItems) {
          if (remainingNeed <= 0) break;
          const shortage = consumeRule(foodItem.id, remainingNeed);
          const consumed = remainingNeed - shortage;
          remainingNeed = shortage;
          void consumed;
        }
        populationShortage = remainingNeed;
      }
      for (const rule of armyRules) {
        const need = country.army_size * rule.quantity_per_unit;
        armyNeed += need;
        armyShortage += consumeRule(rule.item_id, need);
      }
      const populationRatio = populationNeed > 0 ? populationShortage / populationNeed : 0;
      const armyRatio = armyNeed > 0 ? armyShortage / armyNeed : 0;
      summary.foodDeficit += populationShortage;
      summary.populationShortage += populationShortage;
      summary.armyShortage += armyShortage;
      const shortageRatio = Math.max(populationRatio, armyRatio);
      const nextRevolt = shortageRatio > 0
        ? country.revolt_counter + shortageRatio * settings.food_shortage_severity
        : Math.max(0, country.revolt_counter - settings.revolt_normalization_per_year);
      db.prepare("UPDATE countries SET revolt_counter = ? WHERE id = ?").run(nextRevolt, country.id);
    }

    // Return unsold escrow when offers reach their configured expiry year.
    const expired = db.prepare(
      `SELECT id, seller_country_id, item_id, remaining_quantity FROM player_offers
       WHERE guild_id = ? AND status = 'open' AND expires_year <= ? ORDER BY id`,
    ).all(guildId, year) as Array<{ id: string; seller_country_id: number; item_id: number; remaining_quantity: number }>;
    for (const offer of expired) {
      if (offer.remaining_quantity > 0) {
        inventoryDelta(offer.seller_country_id, offer.item_id, offer.remaining_quantity);
      }
      db.prepare("UPDATE player_offers SET remaining_quantity = 0, status = 'expired' WHERE id = ?").run(offer.id);
      summary.expiredOffers += 1;
    }

    // Inflation is global; trade pressure adds demand/supply movement to each shared price.
    const stockRows = db.prepare(
      "SELECT item_id, quantity, current_price, min_price, max_price FROM global_stock WHERE guild_id = ? ORDER BY item_id",
    ).all(guildId) as Array<{
      item_id: number;
      quantity: number;
      current_price: number;
      min_price: number;
      max_price: number;
    }>;
    for (const stock of stockRows) {
      const volume = db.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN direction = 'buy' THEN quantity ELSE 0 END), 0) AS bought,
           COALESCE(SUM(CASE WHEN direction = 'sell' THEN quantity ELSE 0 END), 0) AS sold
         FROM global_market_trades WHERE guild_id = ? AND item_id = ? AND year = ?`,
      ).get(guildId, stock.item_id, settings.current_year) as { bought: number; sold: number };
      const tradedVolume = volume.bought + volume.sold;
      const denominator = Math.max(1, stock.quantity + tradedVolume);
      const demandPressure = (volume.bought - volume.sold) / denominator * settings.global_market_price_sensitivity;
      const inflationPressure = settings.inflation_rate_percent / 100;
      const nextPrice = Math.min(
        stock.max_price,
        Math.max(stock.min_price, stock.current_price * (1 + inflationPressure + demandPressure)),
      );
      db.prepare("UPDATE global_stock SET current_price = ? WHERE guild_id = ? AND item_id = ?").run(
        nextPrice,
        guildId,
        stock.item_id,
      );
      db.prepare(
        `INSERT INTO global_price_history
         (guild_id, item_id, year, previous_price, new_price, run_id) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(guildId, stock.item_id, year, stock.current_price, nextPrice, runId);
    }

    db.prepare("UPDATE guild_settings SET current_year = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?").run(
      year,
      guildId,
    );
    const after = snapshotGuild(db, guildId);
    db.prepare(
      `INSERT INTO annual_runs
       (id, guild_id, year, actor_id, before_snapshot_json, after_snapshot_json, summary_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(runId, guildId, year, actorId, JSON.stringify(before), JSON.stringify(after), JSON.stringify(summary));
    audit(db, guildId, actorId, "process_annual_turn", "annual_run", runId, { year, summary });
    return { runId, year, summary };
  });
}

export function undoAnnualTurn(
  db: Database.Database,
  guildId: string,
  actorId: string,
  requestId?: string,
): { runId: string; year: number } {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "year.undo", () =>
      undoAnnualTurn(db, guildId, actorId),
    );
  }
  requireNarratorPermission(db, guildId, actorId, "year", "undo");
  return inTransaction(db, () => {
    const settings = db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = ?").get(guildId) as
      | { current_year: number }
      | undefined;
    assertDomain(settings && settings.current_year > 0, "Não há ano processado para desfazer.");
    const run = db.prepare(
      `SELECT id, year, before_snapshot_json, after_snapshot_json
       FROM annual_runs WHERE guild_id = ? AND year = ? AND undone_at IS NULL`,
    ).get(guildId, settings.current_year) as
      | { id: string; year: number; before_snapshot_json: string; after_snapshot_json: string }
      | undefined;
    assertDomain(run, "Registro do último processamento anual não encontrado.");
    const current = JSON.stringify(snapshotGuild(db, guildId));
    assertDomain(
      current === run.after_snapshot_json,
      "O estado do jogo mudou após o avanço. Para evitar apagar alterações posteriores, o ano não pode ser desfeito agora.",
      "STATE_CHANGED_AFTER_TURN",
    );
    const before = JSON.parse(run.before_snapshot_json) as AnnualSnapshot;

    for (const country of before.countries) {
      db.prepare("UPDATE countries SET treasury = ?, population = ?, revolt_counter = ?, army_size = ? WHERE id = ?").run(
        country.treasury,
        country.population,
        country.revolt_counter,
        country.army_size,
        country.id,
      );
    }
    const currentCountryIds = db.prepare("SELECT id FROM countries WHERE guild_id = ?").all(guildId) as Array<{ id: number }>;
    const countryIds = currentCountryIds.map((country) => country.id);
    if (countryIds.length > 0) {
      const placeholders = countryIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM country_inventory WHERE country_id IN (${placeholders})`).run(...countryIds);
      writeInventory(db, before.inventory);
      db.prepare("DELETE FROM country_consumption_rules WHERE country_id IN (" + placeholders + ")").run(...countryIds);
      const insertRule = db.prepare("INSERT INTO country_consumption_rules (country_id, item_id, target, quantity_per_unit, updated_by) VALUES (?, ?, ?, ?, 'annual-undo')");
      for (const rule of before.consumptionRules) insertRule.run(rule.country_id, rule.item_id, rule.target, rule.quantity_per_unit);
      db.prepare("DELETE FROM army_equipment_assignments WHERE country_id IN (" + placeholders + ")").run(...countryIds);
      const insertEquipment = db.prepare("INSERT INTO army_equipment_assignments (country_id, item_id, assigned_soldiers, updated_by) VALUES (?, ?, ?, 'annual-undo')");
      for (const row of before.equipment) insertEquipment.run(row.country_id, row.item_id, row.assigned_soldiers);
      for (const transfer of before.transfers) db.prepare("UPDATE scheduled_transfers SET remaining_years = ?, status = ? WHERE id = ?").run(transfer.remaining_years, transfer.status, transfer.id);
      const orderIds = db.prepare(
        `SELECT o.id FROM production_orders o JOIN countries c ON c.id = o.country_id WHERE c.guild_id = ?`,
      ).all(guildId) as Array<{ id: string }>;
      for (const { id } of orderIds) {
        const prior = before.productionOrders.find((order) => order.id === id);
        if (prior) {
          db.prepare("UPDATE production_orders SET remaining_years = ?, status = ? WHERE id = ?").run(
            prior.remaining_years,
            prior.status,
            id,
          );
        }
      }
      const entries = db.prepare(
        `SELECT e.id FROM economy_entries e JOIN countries c ON c.id = e.country_id WHERE c.guild_id = ?`,
      ).all(guildId) as Array<{ id: number }>;
      for (const { id } of entries) {
        const prior = before.economyEntries.find((entry) => entry.id === id);
        if (prior) db.prepare("UPDATE economy_entries SET active = ? WHERE id = ?").run(prior.active, id);
      }
    }
    for (const stock of before.globalStock) {
      db.prepare("UPDATE global_stock SET quantity = ?, current_price = ? WHERE guild_id = ? AND item_id = ?").run(
        stock.quantity,
        stock.current_price,
        guildId,
        stock.item_id,
      );
    }
    for (const offer of before.playerOffers) {
      db.prepare("UPDATE player_offers SET remaining_quantity = ?, status = ? WHERE id = ?").run(
        offer.remaining_quantity,
        offer.status,
        offer.id,
      );
    }
    db.prepare("UPDATE guild_settings SET current_year = ? WHERE guild_id = ?").run(before.currentYear, guildId);

    const annualLedger = db.prepare("SELECT id, country_id, amount, kind FROM financial_ledger WHERE run_id = ?").all(run.id) as Array<{
      id: string;
      country_id: number;
      amount: number;
      kind: string;
    }>;
    const reverse = db.prepare(
      `INSERT INTO financial_ledger
       (id, guild_id, country_id, year, kind, amount, note, actor_id, transaction_group, reversal_of)
       VALUES (?, ?, ?, ?, 'year_undo', ?, ?, ?, ?, ?)`,
    );
    for (const entry of annualLedger) {
      reverse.run(
        randomUUID(),
        guildId,
        entry.country_id,
        run.year,
        -entry.amount,
        `Reversão do lançamento ${entry.kind} do ano ${run.year}`,
        actorId,
        run.id,
        entry.id,
      );
    }
    db.prepare("UPDATE global_price_history SET voided_at = CURRENT_TIMESTAMP WHERE run_id = ?").run(run.id);
    db.prepare("UPDATE annual_runs SET undone_at = CURRENT_TIMESTAMP WHERE id = ?").run(run.id);
    audit(db, guildId, actorId, "undo_annual_turn", "annual_run", run.id, {
      year: run.year,
      reversedLedgerEntries: annualLedger.length,
    });
    return { runId: run.id, year: run.year };
  });
}

export function listAnnualRuns(
  db: Database.Database,
  guildId: string,
  page = 1,
): Array<{ id: string; year: number; summary_json: string; started_at: string; undone_at: string | null }> {
  return db.prepare(
    `SELECT id, year, summary_json, started_at, undone_at
     FROM annual_runs WHERE guild_id = ? ORDER BY year DESC, started_at DESC LIMIT 10 OFFSET ?`,
  ).all(guildId, (page - 1) * 10) as Array<{
    id: string;
    year: number;
    summary_json: string;
    started_at: string;
    undone_at: string | null;
  }>;
}

export function calculateIncomeFactor(
  issuedAmount: number,
  mode: "linear" | "exponential",
  percentPer1000: number,
): number {
  return applyInflationPenalty(1, issuedAmount, mode, percentPer1000);
}
