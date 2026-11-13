export type PermissionSystem =
  | "countries"
  | "economy"
  | "inventory"
  | "production"
  | "population"
  | "market"
  | "players"
  | "indicators"
  | "year";

export interface GuildSettings {
  guild_id: string;
  main_narrator_id: string | null;
  current_year: number;
  currency_name: string;
  currency_symbol: string;
  currency_decimals: number;
  inflation_rate_percent: number;
  inflation_penalty_mode: "linear" | "exponential";
  inflation_penalty_percent_per_1000: number;
  cancellation_refund_percent: number;
  market_expiration_years: number;
  revolt_normalization_per_year: number;
  food_shortage_severity: number;
}

export interface Country {
  id: number;
  guild_id: string;
  role_id: string;
  name: string;
  status: "active" | "archived";
  treasury: number;
  max_money: number | null;
  debt_limit: number;
  annual_income: number;
  population: number;
  annual_population_growth: number;
  food_per_person: number;
  revolt_counter: number;
  inflation_issued: number;
}
