import assert from "node:assert/strict";
import test from "node:test";
import { commandBuilders } from "../src/commands/definitions.js";

type CommandOption = { name: string; required?: boolean; options?: CommandOption[]; autocomplete?: boolean };
function options(value: unknown): CommandOption[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is CommandOption =>
    typeof entry === "object" && entry !== null && "name" in entry && typeof entry.name === "string");
}

test("only the four core systems are exposed as slash commands", () => {
  const names = commandBuilders.map(command => command.name);
  assert.deepEqual(names, ["configurar","narrador","pais","jogador","inventario","economia","saldo","ajuda","ping"]);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z0-9-]{1,32}$/);
  const forbidden = ["mercado","comercio","produzir","populacao","exercito","militar","ano","dados","negociacao","transferir","ranking","indicador","renda"];
  for (const name of forbidden) assert.ok(!names.includes(name), `Comando legado ainda exposto: ${name}`);
});

test("inventory operations are grouped under one country command with autocomplete item selection", () => {
  const inventory = commandBuilders.find(command => command.name === "inventario");
  const inventoryOptions = options(inventory?.options);
  assert.deepEqual(inventoryOptions.map(option => option.name), ["painel","criar-item","deletar-item","pais"]);
  const group = inventoryOptions.find(option => option.name === "pais");
  assert.deepEqual(options(group?.options).map(option => option.name), ["estoque","producao","consumo"]);
  for (const sub of options(group?.options)) {
    const fields = options(sub.options);
    assert.ok(fields.find(field => field.name === "item")?.autocomplete);
    assert.ok(fields.some(field => field.name === "operacao"));
    assert.ok(fields.some(field => field.name === "valor"));
    assert.ok(fields.some(field => field.name === "motivo"));
  }
  assert.ok(options(inventoryOptions.find(option => option.name === "deletar-item")?.options).find(option => option.name === "item")?.autocomplete);
});

test("economy has one country group and three financial categories with add/rem/set operations", () => {
  const economy = commandBuilders.find(command => command.name === "economia");
  const group = options(economy?.options).find(option => option.name === "pais");
  assert.ok(group);
  assert.deepEqual(options(group.options).map(option => option.name), ["renda","gastos","dinheiro"]);
  for (const sub of options(group.options)) {
    const fields = options(sub.options);
    assert.ok(fields.find(field => field.name === "nacao")?.autocomplete);
    assert.ok(fields.some(field => field.name === "operacao"));
    assert.ok(fields.some(field => field.name === "valor"));
    assert.ok(fields.some(field => field.name === "motivo"));
  }
});

test("country deletion and lookup use autocomplete, while narrator management remains restricted", () => {
  const country = commandBuilders.find(command => command.name === "pais");
  const countrySubs = options(country?.options);
  assert.deepEqual(countrySubs.map(option => option.name), ["criar","listar","ver","deletar"]);
  for (const name of ["ver","deletar"]) {
    assert.ok(options(countrySubs.find(option => option.name === name)?.options).find(option => option.name === "pais")?.autocomplete);
  }
  const narrator = commandBuilders.find(command => command.name === "narrador");
  assert.deepEqual(options(narrator?.options).map(option => option.name), ["adicionar","remover"]);
});
