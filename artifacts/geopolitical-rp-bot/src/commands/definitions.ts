import { SlashCommandBuilder } from "discord.js";

const countryOption = (sub: any, required = true) =>
  sub.addStringOption((o: any) => o.setName("pais").setDescription("Nome do país").setRequired(required).setMaxLength(80));

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
    .addSubcommand(s => countryOption(s.setName("ver").setDescription("Consulta uma nação"))),
  new SlashCommandBuilder().setName("jogador").setDescription("Associa jogadores às nações")
    .addSubcommand(s => s.setName("associar").setDescription("Associa uma pessoa a uma nação")
      .addStringOption(o => o.setName("pais").setDescription("Nome da nação").setRequired(true).setMaxLength(80))
      .addUserOption(o => o.setName("jogador").setDescription("Pessoa").setRequired(true)))
    .addSubcommand(s => s.setName("remover").setDescription("Remove a associação de uma pessoa")
      .addStringOption(o => o.setName("pais").setDescription("Nome da nação").setRequired(true).setMaxLength(80))
      .addUserOption(o => o.setName("jogador").setDescription("Pessoa").setRequired(true)))
    .addSubcommand(s => s.setName("meus-paises").setDescription("Lista suas nações")),
  new SlashCommandBuilder().setName("inventario").setDescription("Consulta e administra recursos")
    .addSubcommand(s => s.setName("painel").setDescription("Mostra estoque, produção e consumo")
      .addStringOption(o => o.setName("pais").setDescription("Nação (opcional se controlar apenas uma)").setRequired(false).setMaxLength(80)))
    .addSubcommand(s => s.setName("criar-item").setDescription("Cadastra um recurso")
      .addStringOption(o => o.setName("nome").setDescription("Nome do recurso").setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName("categoria").setDescription("Categoria").setRequired(true)
        .addChoices({name:"Recurso",value:"common"},{name:"Militar",value:"military"}))
      .addStringOption(o => o.setName("unidade").setDescription("Unidade de medida").setRequired(true).setMaxLength(20)))
    .addSubcommand(s => s.setName("ajustar").setDescription("Adiciona ou remove estoque (narrador)")
      .addStringOption(o => o.setName("pais").setDescription("Nação").setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName("item").setDescription("Recurso").setRequired(true).setMaxLength(80))
      .addNumberOption(o => o.setName("variacao").setDescription("Quantidade positiva ou negativa").setRequired(true))
      .addStringOption(o => o.setName("motivo").setDescription("Motivo").setRequired(true).setMaxLength(200)))
    .addSubcommand(s => s.setName("producao").setDescription("Define produção e consumo anuais (narrador)")
      .addStringOption(o => o.setName("pais").setDescription("Nação").setRequired(true).setMaxLength(80))
      .addStringOption(o => o.setName("item").setDescription("Recurso").setRequired(true).setMaxLength(80))
      .addNumberOption(o => o.setName("produz").setDescription("Produção anual").setRequired(true).setMinValue(0))
      .addNumberOption(o => o.setName("consome").setDescription("Consumo anual").setRequired(true).setMinValue(0))),
  new SlashCommandBuilder().setName("economia").setDescription("Configura os parâmetros econômicos")
    .addSubcommand(s => s.setName("configurar").setDescription("Define renda anual e limites financeiros")
      .addStringOption(o => o.setName("pais").setDescription("Nação").setRequired(true).setMaxLength(80))
      .addNumberOption(o => o.setName("renda_anual").setDescription("Renda anual-base").setRequired(true).setMinValue(0))
      .addNumberOption(o => o.setName("limite_divida").setDescription("Dívida máxima").setRequired(true).setMinValue(0))),
  new SlashCommandBuilder().setName("renda").setDescription("Registra rendimentos e despesas")
    .addSubcommand(s => s.setName("adicionar").setDescription("Registra um rendimento ou despesa")
      .addStringOption(o => o.setName("pais").setDescription("Nação").setRequired(true).setMaxLength(80))
      .addNumberOption(o => o.setName("valor").setDescription("Valor positivo = renda; negativo = despesa").setRequired(true))
      .addStringOption(o => o.setName("motivo").setDescription("Motivo").setRequired(true).setMaxLength(200))),
  new SlashCommandBuilder().setName("saldo").setDescription("Consulta o saldo da nação")
    .addStringOption(o => o.setName("pais").setDescription("Nação (opcional se controlar apenas uma)").setRequired(false).setMaxLength(80)),
  new SlashCommandBuilder().setName("ajuda").setDescription("Mostra os comandos disponíveis"),
  new SlashCommandBuilder().setName("ping").setDescription("Verifica a conexão do bot"),
].map(command => command.toJSON());
