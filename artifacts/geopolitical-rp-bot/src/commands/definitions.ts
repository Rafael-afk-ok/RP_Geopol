import { SlashCommandBuilder } from "discord.js";

const countryOption = (sub: any, name = "pais", required = true) =>
  sub.addStringOption((o: any) => o.setName(name).setDescription("Nação").setRequired(required).setMaxLength(80).setAutocomplete(true));

const economySubcommand = (group: any, name: string, description: string) =>
  group.addSubcommand((s: any) => s.setName(name).setDescription(description)
    .addStringOption((o: any) => o.setName("nacao").setDescription("Nação").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addStringOption((o: any) => o.setName("operacao").setDescription("Adicionar, remover ou definir").setRequired(true)
      .addChoices({ name: "Adicionar", value: "add" }, { name: "Remover", value: "rem" }, { name: "Definir valor", value: "set" }))
    .addNumberOption((o: any) => o.setName("valor").setDescription("Valor monetário").setRequired(true).setMinValue(0))
    .addStringOption((o: any) => o.setName("motivo").setDescription("Motivo da alteração").setRequired(true).setMaxLength(200)));

const inventorySubcommand = (group: any, name: string, description: string) =>
  group.addSubcommand((s: any) => s.setName(name).setDescription(description)
    .addStringOption((o: any) => o.setName("nacao").setDescription("Nação").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addStringOption((o: any) => o.setName("item").setDescription("Item do inventário").setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addStringOption((o: any) => o.setName("operacao").setDescription("Adicionar, remover ou definir").setRequired(true)
      .addChoices({ name: "Adicionar", value: "add" }, { name: "Remover", value: "rem" }, { name: "Definir valor", value: "set" }))
    .addNumberOption((o: any) => o.setName("valor").setDescription("Quantidade").setRequired(true).setMinValue(0))
    .addStringOption((o: any) => o.setName("motivo").setDescription("Motivo da alteração").setRequired(true).setMaxLength(200)));

export const commandBuilders = [
  new SlashCommandBuilder().setName("configurar").setDescription("Configuração inicial do servidor")
    .addSubcommand(s => s.setName("principal").setDescription("Define o Narrador Supremo")),
  new SlashCommandBuilder().setName("narrador").setDescription("Gerencia os narradores")
    .addSubcommand(s => s.setName("adicionar").setDescription("Nomeia um narrador")
      .addUserOption(o => o.setName("jogador").setDescription("Pessoa que será narradora").setRequired(true)))
    .addSubcommand(s => s.setName("remover").setDescription("Remove um narrador")
      .addUserOption(o => o.setName("jogador").setDescription("Narrador a remover").setRequired(true))),
  new SlashCommandBuilder().setName("pais").setDescription("Gerencia as nações")
    .addSubcommand(s => s.setName("criar").setDescription("Cria uma nação e vincula um cargo")
      .addStringOption(o => o.setName("nome").setDescription("Nome da nação").setRequired(true).setMaxLength(80))
      .addRoleOption(o => o.setName("cargo").setDescription("Cargo dos membros da nação").setRequired(true)))
    .addSubcommand(s => s.setName("listar").setDescription("Lista suas nações ou todas, se narrador"))
    .addSubcommand(s => countryOption(s.setName("ver").setDescription("Consulta uma nação")))
    .addSubcommand(s => countryOption(s.setName("deletar").setDescription("Apaga definitivamente uma nação"))),
  new SlashCommandBuilder().setName("jogador").setDescription("Associa jogadores às nações")
    .addSubcommand(s => s.setName("associar").setDescription("Associa uma pessoa a uma nação")
      .addStringOption(o => o.setName("pais").setDescription("Nação").setRequired(true).setMaxLength(80).setAutocomplete(true))
      .addUserOption(o => o.setName("jogador").setDescription("Pessoa").setRequired(true)))
    .addSubcommand(s => s.setName("remover").setDescription("Remove a associação de uma pessoa")
      .addStringOption(o => o.setName("pais").setDescription("Nação").setRequired(true).setMaxLength(80).setAutocomplete(true))
      .addUserOption(o => o.setName("jogador").setDescription("Pessoa").setRequired(true)))
    .addSubcommand(s => s.setName("meus-paises").setDescription("Lista suas nações")),
  new SlashCommandBuilder().setName("inventario").setDescription("Consulta e administra recursos")
    .addSubcommand(s => s.setName("painel").setDescription("Mostra estoque, produção e consumo")
      .addStringOption(o => o.setName("pais").setDescription("Nação (opcional se controlar apenas uma)").setRequired(false).setMaxLength(80).setAutocomplete(true)))
    .addSubcommand(s => s.setName("criar-item").setDescription("Cadastra um recurso")
      .addStringOption(o => o.setName("nome").setDescription("Nome do recurso").setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName("categoria").setDescription("Categoria").setRequired(true)
        .addChoices({name:"Recurso",value:"common"},{name:"Militar",value:"military"}))
      .addStringOption(o => o.setName("unidade").setDescription("Unidade de medida").setRequired(true).setMaxLength(20)))
    .addSubcommand(s => s.setName("deletar-item").setDescription("Apaga definitivamente um item do catálogo")
      .addStringOption(o => o.setName("item").setDescription("Item a apagar").setRequired(true).setMaxLength(80).setAutocomplete(true)))
    .addSubcommandGroup(g => {
      g.setName("pais").setDescription("Altera dados de inventário de uma nação");
      inventorySubcommand(g, "estoque", "Altera o estoque de um item");
      inventorySubcommand(g, "producao", "Altera a produção anual de um item");
      inventorySubcommand(g, "consumo", "Altera o consumo anual de um item");
      return g;
    }),
  new SlashCommandBuilder().setName("economia").setDescription("Administra as finanças das nações")
    .addSubcommandGroup(g => {
      g.setName("pais").setDescription("Altera os valores financeiros de uma nação");
      economySubcommand(g, "renda", "Altera a renda anual");
      economySubcommand(g, "gastos", "Altera os gastos anuais");
      economySubcommand(g, "dinheiro", "Altera o tesouro disponível");
      return g;
    }),
  new SlashCommandBuilder().setName("saldo").setDescription("Consulta o resumo financeiro de uma nação")
    .addStringOption(o => o.setName("pais").setDescription("Nação (opcional se controlar apenas uma)").setRequired(false).setMaxLength(80).setAutocomplete(true)),
  new SlashCommandBuilder().setName("ajuda").setDescription("Mostra os comandos disponíveis"),
  new SlashCommandBuilder().setName("ping").setDescription("Verifica a conexão do bot"),
].map(command => command.toJSON());
