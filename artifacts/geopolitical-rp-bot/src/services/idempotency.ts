import type Database from "better-sqlite3";
import { inTransaction } from "../db/index.js";
import { assertDomain } from "../domain/errors.js";

export function runIdempotently<T>(
  db: Database.Database,
  guildId: string,
  requestId: string | undefined,
  operation: string,
  execute: () => T,
): T {
  if (!requestId) return execute();
  return inTransaction(db, () => {
    const prior = db.prepare(
      "SELECT operation, result_json FROM operation_receipts WHERE guild_id = ? AND request_id = ?",
    ).get(guildId, requestId) as { operation: string; result_json: string } | undefined;
    if (prior) {
      assertDomain(prior.operation === operation, "Identificador de solicitação reutilizado para outra operação.");
      return JSON.parse(prior.result_json) as T;
    }
    const result = execute();
    db.prepare(
      "INSERT INTO operation_receipts (guild_id, request_id, operation, result_json) VALUES (?, ?, ?, ?)",
    ).run(guildId, requestId, operation, JSON.stringify(result === undefined ? null : result));
    return result;
  });
}
