import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import { inTransaction } from "../db/index.js";
import { audit, ensureGuildSettings } from "./audit.js";
import { requireCountryOrNarratorPermission, requireNarratorPermission } from "./permissions.js";
import { runIdempotently } from "./idempotency.js";

interface CountryBalance {
  id: number;
  guild_id: string;
  name: string;
  treasury: number;
  max_money: number | null;
  debt_limit: number;
}

export function roundCurrency(db: Database.Database, guildId: string, amount: number): number {
  const settings = db.prepare("SELECT currency_decimals FROM guild_settings WHERE guild_id = ?").get(guildId) as
    | { currency_decimals: number }
    | undefined;
  const scale = 10 ** (settings?.currency_decimals ?? 2);
  return Math.round((amount + Math.sign(amount) * Number.EPSILON) * scale) / scale;
}

export function adjustBalance(
  db: Database.Database,
  countryId: number,
  guildId: string,
  actorId: string,
  delta: number,
  kind: string,
  note: string,
  transactionGroup: string | null = null,
  runId: string | null = null,
  ledgerYear?: number,
): string {
  assertDomain(Number.isFinite(delta) && delta !== 0, "O valor da operação precisa ser diferente de zero.");
  const roundedDelta = roundCurrency(db, guildId, delta);
  assertDomain(roundedDelta !== 0, "O valor é menor que a menor unidade da moeda configurada.");
  const country = db.prepare(
    "SELECT id, guild_id, name, treasury, max_money, debt_limit FROM countries WHERE id = ? AND status = 'active'",
  ).get(countryId) as CountryBalance | undefined;
  assertDomain(country && country.guild_id === guildId, "País não encontrado ou arquivado.");
  const nextBalance = country.treasury + roundedDelta;
  assertDomain(nextBalance >= -country.debt_limit - 1e-9, `A operação ultrapassa o limite de dívida de ${country.name}.`, "DEBT_LIMIT");
  assertDomain(country.max_money === null || nextBalance <= country.max_money + 1e-9, `A operação ultrapassa o limite de saldo de ${country.name}.`, "MONEY_LIMIT");
  db.prepare("UPDATE countries SET treasury = ? WHERE id = ?").run(nextBalance, countryId);
  const entryId = randomUUID();
  const currentYear = db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = ?").get(guildId) as
    | { current_year: number }
    | undefined;
  db.prepare(
    `INSERT INTO financial_ledger
      (id, guild_id, country_id, year, kind, amount, note, actor_id, transaction_group, run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(entryId, guildId, countryId, ledgerYear ?? currentYear?.current_year ?? 0, kind, roundedDelta, note, actorId, transactionGroup, runId);
  return entryId;
}

export function configureCountryEconomy(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  values: { maxMoney: number | null; debtLimit: number; annualIncome: number },
): void {
  requireNarratorPermission(db, guildId, actorId, "economy", "configure");
  assertDomain(values.annualIncome >= 0 && values.debtLimit >= 0, "Rendimento e limite de dívida não podem ser negativos.");
  assertDomain(values.maxMoney === null || values.maxMoney >= 0, "O limite máximo precisa ser positivo ou ilimitado.");
  values = {
    annualIncome: roundCurrency(db, guildId, values.annualIncome),
    debtLimit: roundCurrency(db, guildId, values.debtLimit),
    maxMoney: values.maxMoney === null ? null : roundCurrency(db, guildId, values.maxMoney),
  };
  const country = db.prepare("SELECT treasury FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'").get(
    countryId,
    guildId,
  ) as { treasury: number } | undefined;
  assertDomain(country, "País não encontrado ou arquivado.");
  assertDomain(values.maxMoney === null || country.treasury <= values.maxMoney, "O saldo atual excede o novo limite máximo.");
  assertDomain(country.treasury >= -values.debtLimit, "A dívida atual excede o novo limite de dívida.");
  db.prepare(
    "UPDATE countries SET max_money = ?, debt_limit = ?, annual_income = ? WHERE id = ?",
  ).run(values.maxMoney, values.debtLimit, values.annualIncome, countryId);
  audit(db, guildId, actorId, "configure_country_economy", "country", countryId, values);
}

export function addEconomyEntry(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  direction: "income" | "expense",
  amount: number,
  description: string,
  recurrence: "recurring" | "one_time",
  dueYear: number,
  requestId?: string,
): number {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "economy.add-entry", () =>
      addEconomyEntry(db, guildId, actorId, countryId, direction, amount, description, recurrence, dueYear),
    );
  }
  requireNarratorPermission(db, guildId, actorId, "economy", "edit");
  amount = roundCurrency(db, guildId, amount);
  assertDomain(Number.isFinite(amount) && amount > 0, "O valor precisa ser maior que zero após aplicar as casas decimais da moeda.");
  assertDomain(description.trim().length > 0 && description.length <= 200, "A descrição é obrigatória e deve ter até 200 caracteres.");
  const currentYear = db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = ?").get(guildId) as
    | { current_year: number }
    | undefined;
  assertDomain(dueYear >= (currentYear?.current_year ?? 0) + 1, "O lançamento deve começar no próximo ano ou depois.");
  const result = db.prepare(
    `INSERT INTO economy_entries (country_id, direction, amount, description, recurrence, due_year, created_by)
     SELECT ?, ?, ?, ?, ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM countries WHERE id = ? AND guild_id = ? AND status = 'active')`,
  ).run(countryId, direction, amount, description.trim(), recurrence, dueYear, actorId, countryId, guildId);
  assertDomain(result.changes > 0, "País não encontrado ou arquivado.");
  const id = Number(result.lastInsertRowid);
  audit(db, guildId, actorId, "add_economy_entry", "economy_entry", id, { direction, amount, recurrence, dueYear });
  return id;
}

export function configureInflation(
  db: Database.Database,
  guildId: string,
  actorId: string,
  values: { ratePercent: number; penaltyMode: "linear" | "exponential"; penaltyPercentPer1000: number },
): void {
  requireNarratorPermission(db, guildId, actorId, "economy", "configure");
  assertDomain(values.ratePercent >= 0 && values.ratePercent <= 100, "A inflação precisa estar entre 0 e 100%.");
  assertDomain(
    values.penaltyPercentPer1000 >= 0 && values.penaltyPercentPer1000 <= 100,
    "A penalidade por mil unidades precisa estar entre 0 e 100%.",
  );
  ensureGuildSettings(db, guildId);
  db.prepare(
    `UPDATE guild_settings SET inflation_rate_percent = ?, inflation_penalty_mode = ?,
      inflation_penalty_percent_per_1000 = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?`,
  ).run(values.ratePercent, values.penaltyMode, values.penaltyPercentPer1000, guildId);
  audit(db, guildId, actorId, "configure_inflation", "guild", guildId, values);
}

export function issueInflation(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  amount: number,
  requestId?: string,
): void {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "economy.issue-inflation", () =>
      issueInflation(db, guildId, actorId, countryId, amount),
    );
  }
  amount = roundCurrency(db, guildId, amount);
  assertDomain(Number.isFinite(amount) && amount > 0, "O valor emitido precisa ser maior que zero após aplicar as casas decimais da moeda.");
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "economy", "inflate");
  inTransaction(db, () => {
    const settings = db.prepare("SELECT inflation_rate_percent FROM guild_settings WHERE guild_id = ?").get(guildId) as
      | { inflation_rate_percent: number }
      | undefined;
    assertDomain((settings?.inflation_rate_percent ?? 0) > 0, "O narrador ainda não habilitou a inflação neste servidor.");
    adjustBalance(db, countryId, guildId, actorId, amount, "inflation_issue", "Emissão voluntária de dinheiro");
    db.prepare("UPDATE countries SET inflation_issued = inflation_issued + ? WHERE id = ?").run(amount, countryId);
    audit(db, guildId, actorId, "issue_inflation", "country", countryId, { amount });
  });
}

export function repayInflation(
  db: Database.Database,
  guildId: string,
  actorId: string,
  countryId: number,
  amount: number,
  requestId?: string,
): void {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "economy.repay-inflation", () =>
      repayInflation(db, guildId, actorId, countryId, amount),
    );
  }
  amount = roundCurrency(db, guildId, amount);
  assertDomain(Number.isFinite(amount) && amount > 0, "O valor devolvido precisa ser maior que zero após aplicar as casas decimais da moeda.");
  requireCountryOrNarratorPermission(db, guildId, countryId, actorId, "economy", "inflate");
  inTransaction(db, () => {
    const country = db.prepare("SELECT inflation_issued FROM countries WHERE id = ? AND guild_id = ?").get(
      countryId,
      guildId,
    ) as { inflation_issued: number } | undefined;
    assertDomain(country, "País não encontrado.");
    assertDomain(Math.abs(country.inflation_issued - amount) < 1e-8, "Para remover a inflação, devolva exatamente o total emitido.");
    adjustBalance(db, countryId, guildId, actorId, -amount, "inflation_repayment", "Devolução exata da inflação acumulada");
    db.prepare("UPDATE countries SET inflation_issued = 0 WHERE id = ?").run(countryId);
    audit(db, guildId, actorId, "repay_inflation", "country", countryId, { amount });
  });
}

export function transferBetweenCountries(
  db: Database.Database,
  guildId: string,
  actorId: string,
  fromCountryId: number,
  toCountryId: number,
  amount: number,
  note: string,
  requestId?: string,
): string {
  if (requestId) {
    return runIdempotently(db, guildId, requestId, "economy.transfer", () =>
      transferBetweenCountries(db, guildId, actorId, fromCountryId, toCountryId, amount, note),
    );
  }
  amount = roundCurrency(db, guildId, amount);
  assertDomain(fromCountryId !== toCountryId, "A transferência precisa ser entre países diferentes.");
  assertDomain(Number.isFinite(amount) && amount > 0, "O valor transferido precisa ser maior que zero.");
  requireCountryOrNarratorPermission(db, guildId, fromCountryId, actorId, "economy", "transfer");
  return inTransaction(db, () => {
    const destination = db.prepare(
      "SELECT id FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'",
    ).get(toCountryId, guildId);
    assertDomain(destination, "País destinatário não encontrado ou arquivado.");
    const group = randomUUID();
    adjustBalance(db, fromCountryId, guildId, actorId, -amount, "transfer_out", note, group);
    adjustBalance(db, toCountryId, guildId, actorId, amount, "transfer_in", note, group);
    audit(db, guildId, actorId, "transfer", "transaction", group, { fromCountryId, toCountryId, amount, note });
    return group;
  });
}
