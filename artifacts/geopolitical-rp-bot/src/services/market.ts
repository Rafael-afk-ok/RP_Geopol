import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import { inTransaction } from "../db/index.js";
import { audit } from "./audit.js";
import { adjustBalance } from "./economy.js";
import { changeInventory } from "./inventory.js";
import { hasNarratorPermission, requireCountryOrNarratorPermission, requireNarratorPermission } from "./permissions.js";
import { runIdempotently } from "./idempotency.js";

function roundMoney(amount: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round((amount + Number.EPSILON) * scale) / scale;
}

export function setMarketSettings(
  db: Database.Database,
  guildId: string,
  actorId: string,
  expirationYears: number,
  sensitivity: number,
): void {
  requireNarratorPermission(db, guildId, actorId, "market", "configure");
  assertDomain(Number.isInteger(expirationYears) && expirationYears >= 3 && expirationYears <= 5, "Ofertas devem expirar entre 3 e 5 anos.");
  assertDomain(Number.isFinite(sensitivity) && sensitivity >= 0 && sensitivity <= 5, "A sensibilidade de preços deve ficar entre 0 e 5.");
  db.prepare(
    `UPDATE guild_settings SET market_expiration_years = ?, global_market_price_sensitivity = ?,
     updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
  ).run(expirationYears, sensitivity, guildId);
  audit(db, guildId, actorId, "configure_market", "guild", guildId, { expirationYears, sensitivity });
}

export function createPlayerOffer(
  db: Database.Database,
  guildId: string,
  actorId: string,
  sellerCountryId: number,
  itemId: number,
  quantity: number,
  unitPrice: number,
  description = "",
  requestId?: string,
): string {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "market.create-offer", () =>
      createPlayerOffer(db, guildId, actorId, sellerCountryId, itemId, quantity, unitPrice, description),
    );
  }
  assertDomain(Number.isFinite(quantity) && quantity > 0, "A quantidade ofertada precisa ser maior que zero.");
  assertDomain(Number.isFinite(unitPrice) && unitPrice > 0, "O preço unitário precisa ser maior que zero.");
  requireCountryOrNarratorPermission(db, guildId, sellerCountryId, actorId, "market", "sell");
  return inTransaction(db, () => {
    const country = db.prepare("SELECT id FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'").get(
      sellerCountryId,
      guildId,
    );
    const item = db.prepare("SELECT id, name FROM items WHERE id = ? AND guild_id = ?").get(itemId, guildId) as
      | { id: number; name: string }
      | undefined;
    assertDomain(country && item, "País ou item não encontrado.");
    const settings = db.prepare(
      "SELECT current_year, market_expiration_years, currency_symbol FROM guild_settings WHERE guild_id = ?",
    ).get(guildId) as { current_year: number; market_expiration_years: number; currency_symbol: string } | undefined;
    assertDomain(settings, "Configuração do servidor não encontrada.");
    changeInventory(db, sellerCountryId, itemId, -quantity);
    const offerId = randomUUID();
    db.prepare(
      `INSERT INTO player_offers
       (id, guild_id, seller_country_id, item_id, original_quantity, remaining_quantity,
        unit_price, currency_symbol, description, expires_year, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    ).run(
      offerId,
      guildId,
      sellerCountryId,
      itemId,
      quantity,
      quantity,
      unitPrice,
      settings.currency_symbol,
      description.slice(0, 200),
      settings.current_year + settings.market_expiration_years,
      actorId,
    );
    audit(db, guildId, actorId, "create_market_offer", "market_offer", offerId, { itemId, quantity, unitPrice });
    return offerId;
  });
}

export function buyPlayerOffer(
  db: Database.Database,
  guildId: string,
  actorId: string,
  buyerCountryId: number,
  offerId: string,
  quantity: number,
  requestId?: string,
): { tradeId: string; total: number } {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "market.buy-offer", () =>
      buyPlayerOffer(db, guildId, actorId, buyerCountryId, offerId, quantity),
    );
  }
  assertDomain(Number.isFinite(quantity) && quantity > 0, "A quantidade comprada precisa ser maior que zero.");
  requireCountryOrNarratorPermission(db, guildId, buyerCountryId, actorId, "market", "buy");
  return inTransaction(db, () => {
    const offer = db.prepare(
      `SELECT id, seller_country_id, item_id, remaining_quantity, unit_price, status
       FROM player_offers WHERE id = ? AND guild_id = ?`,
    ).get(offerId, guildId) as
      | { id: string; seller_country_id: number; item_id: number; remaining_quantity: number; unit_price: number; status: string }
      | undefined;
    assertDomain(offer && offer.status === "open", "Oferta indisponível.");
    assertDomain(offer.seller_country_id !== buyerCountryId, "O país não pode comprar sua própria oferta.");
    assertDomain(quantity <= offer.remaining_quantity + 1e-9, "A quantidade excede o saldo restante da oferta.");
    const seller = db.prepare("SELECT id FROM countries WHERE id = ? AND status = 'active'").get(offer.seller_country_id);
    const buyer = db.prepare("SELECT id FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'").get(
      buyerCountryId,
      guildId,
    );
    assertDomain(seller && buyer, "País comprador ou vendedor indisponível.");
    const settings = db.prepare("SELECT currency_decimals, current_year FROM guild_settings WHERE guild_id = ?").get(
      guildId,
    ) as { currency_decimals: number; current_year: number };
    const total = roundMoney(offer.unit_price * quantity, settings.currency_decimals);
    adjustBalance(db, buyerCountryId, guildId, actorId, -total, "market_purchase", `Compra da oferta ${offerId}`);
    adjustBalance(db, offer.seller_country_id, guildId, actorId, total, "market_sale", `Venda da oferta ${offerId}`);
    changeInventory(db, buyerCountryId, offer.item_id, quantity);
    const remaining = Math.max(0, offer.remaining_quantity - quantity);
    db.prepare(
      "UPDATE player_offers SET remaining_quantity = ?, status = ? WHERE id = ?",
    ).run(remaining, remaining <= 1e-9 ? "completed" : "open", offerId);
    const tradeId = randomUUID();
    db.prepare(
      `INSERT INTO player_market_trades
       (id, offer_id, guild_id, seller_country_id, buyer_country_id, item_id, quantity, unit_price, total, year, buyer_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      tradeId,
      offerId,
      guildId,
      offer.seller_country_id,
      buyerCountryId,
      offer.item_id,
      quantity,
      offer.unit_price,
      total,
      settings.current_year,
      actorId,
    );
    audit(db, guildId, actorId, "buy_market_offer", "market_trade", tradeId, { offerId, quantity, total });
    return { tradeId, total };
  });
}

export function cancelPlayerOffer(
  db: Database.Database,
  guildId: string,
  actorId: string,
  offerId: string,
  requestId?: string,
): number {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "market.cancel-offer", () =>
      cancelPlayerOffer(db, guildId, actorId, offerId),
    );
  }
  return inTransaction(db, () => {
    const offer = db.prepare(
      "SELECT id, seller_country_id, item_id, remaining_quantity, status FROM player_offers WHERE id = ? AND guild_id = ?",
    ).get(offerId, guildId) as
      | { id: string; seller_country_id: number; item_id: number; remaining_quantity: number; status: string }
      | undefined;
    assertDomain(offer && offer.status === "open", "Oferta indisponível ou já encerrada.");
    if (!hasNarratorPermission(db, guildId, actorId, "market", "manage")) {
      requireCountryOrNarratorPermission(db, guildId, offer.seller_country_id, actorId, "market", "cancel");
    }
    if (offer.remaining_quantity > 0) changeInventory(db, offer.seller_country_id, offer.item_id, offer.remaining_quantity);
    db.prepare("UPDATE player_offers SET remaining_quantity = 0, status = 'cancelled' WHERE id = ?").run(offerId);
    audit(db, guildId, actorId, "cancel_market_offer", "market_offer", offerId, { returnedQuantity: offer.remaining_quantity });
    return offer.remaining_quantity;
  });
}

export function tradeGlobalMarket(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  itemId: number,
  direction: "buy" | "sell",
  quantity: number,
  requestId?: string,
): { tradeId: string; total: number; unitPrice: number } {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, `market.global-${direction}`, () =>
      tradeGlobalMarket(db, guildId, actorId, countryId, itemId, direction, quantity),
    );
  }
  assertDomain(Number.isFinite(quantity) && quantity > 0, "A quantidade precisa ser maior que zero.");
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "market", direction);
  return inTransaction(db, () => {
    const stock = db.prepare(
      `SELECT g.quantity, g.current_price, i.name
       FROM global_stock g JOIN items i ON i.id = g.item_id
       WHERE g.guild_id = ? AND g.item_id = ? AND i.global_tradeable = 1`,
    ).get(guildId, itemId) as { quantity: number; current_price: number; name: string } | undefined;
    assertDomain(stock, "Produto não disponível no mercado global.");
    const settings = db.prepare("SELECT currency_decimals, current_year FROM guild_settings WHERE guild_id = ?").get(
      guildId,
    ) as { currency_decimals: number; current_year: number };
    const total = roundMoney(stock.current_price * quantity, settings.currency_decimals);
    if (direction === "buy") {
      assertDomain(quantity <= stock.quantity + 1e-9, "Estoque global insuficiente.");
      adjustBalance(db, countryId, guildId, actorId, -total, "global_purchase", `Compra global de ${stock.name}`);
      changeInventory(db, countryId, itemId, quantity);
      db.prepare("UPDATE global_stock SET quantity = quantity - ? WHERE guild_id = ? AND item_id = ?").run(
        quantity,
        guildId,
        itemId,
      );
    } else {
      changeInventory(db, countryId, itemId, -quantity);
      adjustBalance(db, countryId, guildId, actorId, total, "global_sale", `Venda global de ${stock.name}`);
      db.prepare("UPDATE global_stock SET quantity = quantity + ? WHERE guild_id = ? AND item_id = ?").run(
        quantity,
        guildId,
        itemId,
      );
    }
    const tradeId = randomUUID();
    db.prepare(
      `INSERT INTO global_market_trades
       (id, guild_id, item_id, country_id, direction, quantity, unit_price, total, year, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(tradeId, guildId, itemId, countryId, direction, quantity, stock.current_price, total, settings.current_year, actorId);
    audit(db, guildId, actorId, `global_market_${direction}`, "global_market_trade", tradeId, { itemId, quantity, total });
    return { tradeId, total, unitPrice: stock.current_price };
  });
}

export function listOffers(db: Database.Database, guildId: string): Array<{
  id: string;
  seller_country_id: number;
  seller: string;
  item: string;
  remaining_quantity: number;
  unit_price: number;
  currency_symbol: string;
  description: string;
  expires_year: number;
}> {
  return db.prepare(
    `SELECT o.id, o.seller_country_id, c.name AS seller, i.name AS item,
      o.remaining_quantity, o.unit_price, o.currency_symbol, o.description, o.expires_year
     FROM player_offers o
     JOIN countries c ON c.id = o.seller_country_id
     JOIN items i ON i.id = o.item_id
     WHERE o.guild_id = ? AND o.status = 'open' AND c.status = 'active'
     ORDER BY o.created_at DESC`,
  ).all(guildId) as Array<{
    id: string;
    seller_country_id: number;
    seller: string;
    item: string;
    remaining_quantity: number;
    unit_price: number;
    currency_symbol: string;
    description: string;
    expires_year: number;
  }>;
}

export function configureCurrency(
  db: Database.Database,
  guildId: string,
  actorId: string,
  name: string,
  symbol: string,
  decimals: number,
): void {
  requireNarratorPermission(db, guildId, actorId, "economy", "configure");
  assertDomain(name.trim().length >= 2 && name.length <= 40, "Nome da moeda inválido.");
  assertDomain(symbol.trim().length > 0 && symbol.length <= 8, "Símbolo da moeda inválido.");
  assertDomain(Number.isInteger(decimals) && decimals >= 0 && decimals <= 6, "A moeda aceita de zero a seis casas decimais.");
  db.prepare(
    `UPDATE guild_settings SET currency_name = ?, currency_symbol = ?, currency_decimals = ?,
     updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
  ).run(name.trim(), symbol.trim(), decimals, guildId);
  audit(db, guildId, actorId, "configure_currency", "guild", guildId, { name: name.trim(), symbol: symbol.trim(), decimals });
}

export function requireMarketNarrator(db: Database.Database, guildId: string, actorId: string, action: string): void {
  requireNarratorPermission(db, guildId, actorId, "market", action);
}
