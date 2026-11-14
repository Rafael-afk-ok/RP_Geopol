# Bot de RP Geopolítico

Bot Discord em TypeScript para roleplay geopolítico, com economia persistente, inventário, mercado, permissões e avanço anual.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/geopolitical-rp-bot run dev` — run the Discord bot
- `pnpm --filter @workspace/geopolitical-rp-bot run deploy:commands` — register Discord slash commands
- `pnpm --filter @workspace/geopolitical-rp-bot run test` — run bot service tests
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DISCORD_BOT_TOKEN`
- Optional env: `DATABASE_PATH` (defaults to `data/game.sqlite` relative to the bot package), `DISCORD_GUILD_ID` (guild-scoped command registration), `DISCORD_OWNER_ID` (initial narrator bootstrap)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- API DB: PostgreSQL + Drizzle ORM
- Bot DB: SQLite via better-sqlite3 with versioned migrations
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/geopolitical-rp-bot/src/commands/` — Discord slash-command definitions and handlers
- `artifacts/geopolitical-rp-bot/src/db/` — SQLite connection and migrations
- `artifacts/geopolitical-rp-bot/src/services/` — permissions, economy, inventory, production, markets, population, annual processing
- `artifacts/geopolitical-rp-bot/test/` — domain and permission tests

## Architecture decisions

- The Discord OAuth connection is not a bot Gateway credential; the running bot uses `DISCORD_BOT_TOKEN` from Secrets.
- Each annual run stores a full state snapshot; undo restores game state and appends reversal/audit records rather than deleting history.

## Product

Countries are private by default. The bot provides scoped narrators, per-country player permissions, editable countries, custom item categories and operational income/expenses, a configurable economy, production, food and revolt indicators, player/global markets, and reversible annual turns.

## User preferences

- Do not implement AI features or military simulation in this version.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
