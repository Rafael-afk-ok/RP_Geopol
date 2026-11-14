import assert from "node:assert/strict";
import test from "node:test";
import { commandBuilders } from "../src/commands/definitions.js";

test("all requested slash-command categories are registered with unique valid names", () => {
  const names = commandBuilders.map((command) => command.name);
  const expected = [
    "configurar",
    "configuracoes",
    "pais",
    "jogador",
    "indicador",
    "economia",
    "transferir",
    "inventario",
    "produzir",
    "mercado",
    "populacao",
    "negociacao",
    "consumo",
    "exercito",
    "ano",
    "historico",
    "narrador",
    "saldo",
    "gastar",
    "dinheiro",
    "rendimento",
    "ranking",
    "ajuda",
    "ping",
    "militar",
    "comercio",
  ];
  assert.deepEqual(names, expected);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z0-9-]{1,32}$/);

  const personalSettings = commandBuilders.find((command) => command.name === "configuracoes");
  const personalSubcommands = personalSettings?.options?.map((option) => option.name);
  assert.deepEqual(personalSubcommands, ["pessoais"]);
  const personalOptions = personalSettings?.options?.[0]?.options ?? [];
  assert.deepEqual(personalOptions.map((option) => option.name), ["pais", "inflacao_automatica"]);
  assert.ok(personalOptions.every((option) => option.required === false));
  const economyCommand = commandBuilders.find((command) => command.name === "economia");
  assert.ok(!economyCommand?.options?.some((option) => option.name === "inflacao-automatica"));

  const countryCommand = commandBuilders.find((command) => command.name === "pais");
  const countrySubcommands = countryCommand?.options?.map((option) => option.name);
  assert.ok(countrySubcommands?.includes("editar"));

  const inventoryCommand = commandBuilders.find((command) => command.name === "inventario");
  const inventorySubcommands = inventoryCommand?.options?.map((option) => option.name);
  assert.ok(inventorySubcommands?.includes("categoria"));
  assert.ok(inventorySubcommands?.includes("painel"));
  assert.ok(!names.includes("permissao"));
  assert.ok(names.includes("ranking"));
});
