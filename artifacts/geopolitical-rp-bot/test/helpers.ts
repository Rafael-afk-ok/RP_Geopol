import { openDatabase } from "../src/db/index.js";
import type Database from "better-sqlite3";

let countryCounter = 0;

export function createTestDatabase(): Database.Database {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO guild_settings (guild_id, main_narrator_id) VALUES ('guild', 'narrator')").run();
  return db;
}

export function insertCountry(
  db: Database.Database,
  options: {
    id?: number;
    name?: string;
    treasury?: number;
    maxMoney?: number | null;
    debtLimit?: number;
    annualIncome?: number;
    population?: number;
    growth?: number;
    foodPerPerson?: number;
    revolt?: number;
    roleId?: string;
  } = {},
): number {
  const result = db.prepare(
    `INSERT INTO countries
      (guild_id, role_id, name, treasury, max_money, debt_limit, annual_income, population,
       annual_population_growth, food_per_person, revolt_counter, created_by)
     VALUES ('guild', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'narrator')`,
  ).run(
    options.roleId ?? `role-${options.id ?? countryCounter++}`,
    options.name ?? `Country ${options.id ?? "new"}`,
    options.treasury ?? 0,
    options.maxMoney ?? null,
    options.debtLimit ?? 0,
    options.annualIncome ?? 0,
    options.population ?? 0,
    options.growth ?? 0,
    options.foodPerPerson ?? 1,
    options.revolt ?? 0,
  );
  return Number(result.lastInsertRowid);
}

export function closeTestDatabase(db: Database.Database): void {
  db.close();
}
