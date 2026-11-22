import assert from "node:assert/strict";
import test from "node:test";
import { commandBuilders } from "../src/commands/definitions.js";

type CommandOption = { name: string; required?: boolean; options?: CommandOption[] };
function options(value: unknown): CommandOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is CommandOption =>
    typeof entry === "object" && entry !== null && "name" in entry && typeof entry.name === "string");
}

test("only the four core systems are exposed as slash commands", () => {
  const names = commandBuilders.map(command => command.name);
  assert.deepEqual(names, ["configurar","narrador","pais","jogador","inventario","economia","renda","saldo","ajuda","ping"]);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z0-9-]{1,32}$/);
  const forbidden = ["mercado","comercio","produzir","populacao","exercito","militar","ano","dados","negociacao","transferir","ranking","indicador"];
  for (const name of forbidden) assert.ok(!names.includes(name), `Comando legado ainda exposto: ${name}`);
});

test("inventory and income commands expose only basic operations", () => {
  const inventory = commandBuilders.find(command => command.name === "inventario");
  assert.deepEqual(options(inventory?.options).map(option => option.name), ["painel","criar-item","ajustar","producao"]);
  const income = commandBuilders.find(command => command.name === "renda");
  assert.deepEqual(options(income?.options).map(option => option.name), ["adicionar"]);
  const economy = commandBuilders.find(command => command.name === "economia");
  assert.deepEqual(options(economy?.options).map(option => option.name), ["configurar"]);
});

test("narrator management remains restricted to explicit add and remove commands", () => {
  const narrator = commandBuilders.find(command => command.name === "narrador");
  assert.deepEqual(options(narrator?.options).map(option => option.name), ["adicionar","remover"]);
});
