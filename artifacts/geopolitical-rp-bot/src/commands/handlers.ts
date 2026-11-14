import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type Database from "better-sqlite3";
import { assertDomain, DomainError } from "../domain/errors.js";
import { audit } from "../services/audit.js";
import { processAnnualTurn, undoAnnualTurn, listAnnualRuns } from "../services/annual.js";
import { adjustBalance, configureCountryEconomy, configureInflation, issueInflation, repayInflation, transferBetweenCountries } from "../services/economy.js";
import { archiveCountry, createCountry, getAccessibleCountry, listAccessibleCountries, listNarratedCountries, updateCountry } from "../services/countries.js";
import { createIndicator, createIndicatorCategory, listIndicators, setIndicatorValue } from "../services/indicators.js";
import { adjustInventory, addItemRequirement, createCustomItemCategory, defineItem, listCountryInventory, ensureDefaultCatalog, setCountryProduction, setGlobalStock } from "../services/inventory.js";
import { buyPlayerOffer, cancelPlayerOffer, configureCurrency, createPlayerOffer, listOffers, setMarketSettings, tradeGlobalMarket } from "../services/market.js";
import { assignArmyEquipment, configureArmySize, configureConsumptionRule, configurePopulation, configurePopulationRules, getPopulation } from "../services/population.js";
import { associatePlayer, bootstrapMainNarrator, grantNarratorPermission, hasNarratorPermission, isMainNarrator, removePlayer, requireCountryOrNarratorPermission, requireCountryPermission, requireNarratorPermission } from "../services/permissions.js";
import { cancelProduction, listProductionQueue, startProduction } from "../services/production.js";

type Handler = (interaction: ChatInputCommandInteraction, db: Database.Database) => Promise<void>;

function id(interaction: ChatInputCommandInteraction): string {
  assertDomain(interaction.guildId, "Este comando só pode ser usado em um servidor Discord.");
  return interaction.guildId;
}

function countryNumber(interaction: ChatInputCommandInteraction, db: Database.Database, name = "pais"): number {
  const guildId = id(interaction);
  const nameValue = interaction.options.getString(name, true).trim();
  const narrator = hasNarratorPermission(db, guildId, interaction.user.id, "countries", "read");
  const country = narrator
    ? db.prepare("SELECT id FROM countries WHERE guild_id = ? AND status = 'active' AND lower(name) = lower(?)").get(guildId, nameValue) as { id: number } | undefined
    : db.prepare("SELECT c.id FROM countries c JOIN country_memberships m ON m.country_id = c.id WHERE c.guild_id = ? AND c.status = 'active' AND lower(c.name) = lower(?) AND m.user_id = ?").get(guildId, nameValue, interaction.user.id) as { id: number } | undefined;
  assertDomain(country, "País não encontrado ou você não está associado a ele.");
  return country.id;
}

function jsonValue(value: string | null): unknown {
  if (value === null) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new DomainError("O valor informado não é um JSON válido.");
  }
}

function userCountriesEmbed(title: string, rows: Array<{ id: number; name: string }>): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(rows.length ? rows.map((row) => `**${row.name}**`).join("\n") : "Nenhum país disponível.")
    .setColor(0x315e56);
}

async function reply(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
  await interaction.editReply({
    content: content.slice(0, 1900),
    allowedMentions: { parse: [] },
  });
}

function playerCanManageCountry(db: Database.Database, guildId: string, userId: string, countryId: number): boolean {
  return hasNarratorPermission(db, guildId, userId, "players", "manage") ||
    (() => {
      try {
        requireCountryPermission(db, guildId, countryId, userId, "players", "manage");
        return true;
      } catch {
        return false;
      }
    })();
}

function getCountryForView(db: Database.Database, guildId: string, userId: string, countryId: number) {
  if (hasNarratorPermission(db, guildId, userId, "countries", "read")) {
    const country = db.prepare(
      "SELECT * FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'",
    ).get(countryId, guildId);
    assertDomain(country, "País não encontrado ou arquivado.");
    return country as {
      id: number; name: string; treasury: number; population: number; annual_income: number;
      revolt_counter: number; inflation_issued: number; role_id: string;
    };
  }
  return getAccessibleCountry(db, guildId, userId, countryId);
}

function itemIdByName(db: Database.Database, guildId: string, name: string): number {
  const item = db.prepare("SELECT id FROM items WHERE guild_id = ? AND lower(name) = lower(?)")
    .get(guildId, name.trim()) as { id: number } | undefined;
  assertDomain(item, "Item não encontrado neste servidor.");
  return item.id;
}

function countryIdByName(db: Database.Database, guildId: string, name: string): number {
  const country = db.prepare("SELECT id FROM countries WHERE guild_id = ? AND status = 'active' AND lower(name) = lower(?)")
    .get(guildId, name.trim()) as { id: number } | undefined;
  assertDomain(country, "País não encontrado ou arquivado.");
  return country.id;
}

function resolveCommandCountry(db: Database.Database, guildId: string, userId: string, requestedName?: string) {
  if (requestedName) {
    const country = db.prepare("SELECT id, name, treasury FROM countries WHERE guild_id = ? AND status = 'active' AND lower(name) = lower(?)").get(guildId, requestedName.trim()) as { id: number; name: string; treasury: number } | undefined;
    assertDomain(country, "País não encontrado.");
    const isNarrator = hasNarratorPermission(db, guildId, userId, "countries", "read");
    const membership = db.prepare("SELECT 1 FROM country_memberships WHERE country_id = ? AND user_id = ?").get(country.id, userId);
    assertDomain(isNarrator || membership, "Você não está associado a este país.");
    return country;
  }
  const rows = db.prepare("SELECT c.id, c.name, c.treasury FROM countries c JOIN country_memberships m ON m.country_id = c.id WHERE c.guild_id = ? AND c.status = 'active' AND m.user_id = ? ORDER BY c.name").all(guildId, userId) as Array<{ id: number; name: string; treasury: number }>;
  assertDomain(rows.length > 0, "Nenhum país associado à sua conta. Informe o nome do país se você for narrador.");
  assertDomain(rows.length === 1, "Você controla mais de um país. Informe o nome em pais.");
  return rows[0]!;
}

function formatNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: decimals }).format(value);
}

const handlers: Record<string, Handler> = {
  configurar: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "principal") {
      assertDomain(interaction.guild, "Servidor não encontrado.");
      bootstrapMainNarrator(
        db,
        guildId,
        interaction.user.id,
        interaction.guild.ownerId,
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false,
      );
      await reply(interaction, "Narrador principal configurado. Agora você pode criar países e delegar permissões.");
      return;
    }
    if (subcommand === "moeda") {
      configureCurrency(
        db,
        guildId,
        interaction.user.id,
        interaction.options.getString("nome", true),
        interaction.options.getString("simbolo", true),
        interaction.options.getInteger("casas_decimais", true),
      );
      await reply(interaction, "Moeda do servidor atualizada.");
      return;
    }
    if (subcommand === "inflacao") {
      configureInflation(db, guildId, interaction.user.id, {
        ratePercent: interaction.options.getNumber("taxa_global", true),
        penaltyMode: interaction.options.getString("formula", true) as "linear" | "exponential",
        penaltyPercentPer1000: interaction.options.getNumber("penalidade_por_mil", true),
      });
      await reply(interaction, "Inflação global e fórmula de penalidade atualizadas.");
      return;
    }
    if (subcommand === "mercado") {
      setMarketSettings(
        db,
        guildId,
        interaction.user.id,
        interaction.options.getInteger("validade_anos", true),
        interaction.options.getNumber("sensibilidade", true),
        interaction.options.getNumber("aumento_maximo", true),
        interaction.options.getNumber("recuo_anual", true),
      );
      await reply(interaction, "Regras de validade e preços do mercado atualizadas.");
      return;
    }
    configurePopulationRules(
      db,
      guildId,
      interaction.user.id,
      interaction.options.getNumber("normalizacao", true),
      interaction.options.getNumber("gravidade", true),
    );
    await reply(interaction, "Parâmetros de escassez alimentar e revolta atualizados.");
  },

  pais: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "criar") {
      const role = interaction.options.getRole("cargo", true);
      createCountry(
        db,
        guildId,
        interaction.user.id,
        interaction.options.getString("nome", true),
        role.id,
      );
      await reply(interaction, `País **${interaction.options.getString("nome", true)}** criado. Jogadores com o cargo serão associados automaticamente ao usar o bot.`);
      return;
    }
    if (subcommand === "arquivar" || subcommand === "excluir") {
      const countryId = countryNumber(interaction, db);
      const countryName = getCountryForView(db, guildId, interaction.user.id, countryId).name;
      archiveCountry(db, guildId, interaction.user.id, countryId);
      await reply(interaction, `País **${countryName}** removido dos países ativos. O histórico financeiro e anual foi preservado.`);
      return;
    }
    if (subcommand === "geral") {
      const countryId = countryNumber(interaction, db);
      requireCountryOrNarratorPermission(db, guildId, countryId, interaction.user.id, "countries", "read");
      const country = db.prepare("SELECT name, treasury, annual_income, population, revolt_counter, army_size FROM countries WHERE id = ? AND guild_id = ?").get(countryId, guildId) as { name: string; treasury: number; annual_income: number; population: number; revolt_counter: number; army_size: number };
      const settings = db.prepare("SELECT current_year, currency_symbol FROM guild_settings WHERE guild_id = ?").get(guildId) as { current_year: number; currency_symbol: string };
      const production = db.prepare("SELECT COALESCE(SUM(cp.annual_production * i.production_cost), 0) AS value FROM country_production cp JOIN items i ON i.id = cp.item_id WHERE cp.country_id = ?").get(countryId) as { value: number };
      const stockValue = db.prepare("SELECT COALESCE(SUM(v.quantity * i.production_cost), 0) AS value FROM country_inventory v JOIN items i ON i.id = v.item_id WHERE v.country_id = ?").get(countryId) as { value: number };
      const ranks = db.prepare(`SELECT
        (SELECT COUNT(*) + 1 FROM countries x WHERE x.guild_id = ? AND x.status = 'active' AND x.treasury > c.treasury) AS economy_rank,
        (SELECT COUNT(*) + 1 FROM countries x WHERE x.guild_id = ? AND x.status = 'active' AND x.population > c.population) AS population_rank,
        (SELECT COUNT(*) + 1 FROM (SELECT x.id FROM countries x LEFT JOIN country_production p ON p.country_id = x.id LEFT JOIN items i ON i.id = p.item_id WHERE x.guild_id = ? AND x.status = 'active' GROUP BY x.id HAVING COALESCE(SUM(p.annual_production * i.production_cost), 0) > ?)) AS production_rank
        FROM countries c WHERE c.id = ?`).get(guildId, guildId, guildId, production.value, countryId) as { economy_rank: number; population_rank: number; production_rank: number | null };
      const equipment = db.prepare("SELECT COALESCE(SUM(assigned_soldiers), 0) AS total FROM army_equipment_assignments WHERE country_id = ?").get(countryId) as { total: number };
      const embed = new EmbedBuilder().setTitle(`Visão geral nacional · ${country.name}`).setDescription(`**Ano ${settings.current_year}**`).addFields(
        { name: "Economia", value: `Tesouro: ${settings.currency_symbol} ${formatNumber(country.treasury, 2)}\nRenda anual: ${settings.currency_symbol} ${formatNumber(country.annual_income, 2)}\nValor estimado do estoque: ${settings.currency_symbol} ${formatNumber(stockValue.value, 2)}`, inline: true },
        { name: "População", value: `${formatNumber(country.population, 0)} habitantes\nRevolta: ${formatNumber(country.revolt_counter, 2)}`, inline: true },
        { name: "Exército", value: `Efetivo: ${formatNumber(country.army_size, 0)}\nEquipados: ${formatNumber(equipment.total, 0)}\nSem equipamento: ${formatNumber(Math.max(0, country.army_size - equipment.total), 0)}`, inline: true },
        { name: "Produção", value: `Valor anual estimado: ${settings.currency_symbol} ${formatNumber(production.value, 2)}`, inline: true },
        { name: "Rankings", value: `Economia: #${ranks.economy_rank}\nPopulação: #${ranks.population_rank}\nProdução: ${ranks.production_rank ? `#${ranks.production_rank}` : "—"}`, inline: true },
      ).setColor(country.revolt_counter >= 50 ? 0xa94442 : 0x315e56).setFooter({ text: "Valores de produção e estoque são estimativas pelo custo de produção cadastrado." });
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }
    if (subcommand === "editar") {
      const countryId = countryNumber(interaction, db);
      updateCountry(db, guildId, interaction.user.id, countryId, {
        name: interaction.options.getString("nome") ?? undefined,
        roleId: interaction.options.getRole("cargo")?.id,
      });
      await reply(interaction, `Dados do país atualizados.`);
      return;
    }
    if (subcommand === "listar") {
      const countries = hasNarratorPermission(db, guildId, interaction.user.id, "countries", "read")
        ? listNarratedCountries(db, guildId, interaction.user.id)
        : listAccessibleCountries(db, guildId, interaction.user.id);
      await interaction.editReply({
        embeds: [userCountriesEmbed("Países acessíveis", countries)],
        allowedMentions: { parse: [] },
      });
      return;
    }
    const countryId = countryNumber(interaction, db);
    const country = getCountryForView(db, guildId, interaction.user.id, countryId);
    const settings = db.prepare("SELECT currency_symbol, current_year FROM guild_settings WHERE guild_id = ?").get(guildId) as
      | { currency_symbol: string; current_year: number }
      | undefined;
    const embed = new EmbedBuilder()
      .setTitle(country.name)
      .setDescription(`Ano atual: ${settings?.current_year ?? 0}`)
      .addFields(
        { name: "Tesouro", value: `${formatNumber(country.treasury, 2)} ${settings?.currency_symbol ?? ""}`, inline: true },
        { name: "Renda anual", value: `${formatNumber(country.annual_income, 2)} ${settings?.currency_symbol ?? ""}`, inline: true },
        { name: "População", value: formatNumber(country.population, 0), inline: true },
        { name: "Contador de revolta", value: formatNumber(country.revolt_counter, 2), inline: true },
        { name: "Inflação acumulada", value: formatNumber(country.inflation_issued, 2), inline: true },
        { name: "Cargo associado", value: `<@&${country.role_id}>`, inline: true },
      )
      .setColor(0x315e56);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },

  jogador: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "meus-paises") {
      await interaction.editReply({
        embeds: [userCountriesEmbed("Seus países", listAccessibleCountries(db, guildId, interaction.user.id))],
        allowedMentions: { parse: [] },
      });
      return;
    }
    const countryId = countryNumber(interaction, db);
    const countryName = getCountryForView(db, guildId, interaction.user.id, countryId).name;
    const target = interaction.options.getUser("jogador", true);
    if (!playerCanManageCountry(db, guildId, interaction.user.id, countryId)) {
      throw new DomainError("Você não tem permissão para gerenciar jogadores neste país.");
    }
    if (subcommand === "associar") {
      associatePlayer(db, guildId, countryId, interaction.user.id, target.id);
      await reply(interaction, `<@${target.id}> foi associado ao país **${countryName}**.`);
    } else {
      removePlayer(db, guildId, countryId, interaction.user.id, target.id);
      await reply(interaction, `<@${target.id}> foi removido do país **${countryName}**.`);
    }
  },

  indicador: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "categoria") {
      const categoryId = createIndicatorCategory(
        db,
        guildId,
        interaction.user.id,
        interaction.options.getString("nome", true),
        interaction.options.getString("descricao") ?? "",
      );
      await reply(interaction, `Categoria criada. ID: **${categoryId}**.`);
      return;
    }
    if (subcommand === "criar") {
      const dataType = interaction.options.getString("tipo", true) as "number" | "text" | "boolean" | "json";
      const defaultValue = jsonValue(interaction.options.getString("valor_padrao"));
      const indicatorId = createIndicator(
        db,
        guildId,
        interaction.user.id,
        interaction.options.getInteger("categoria_id", true),
        interaction.options.getString("nome", true),
        interaction.options.getString("descricao") ?? "",
        dataType,
        defaultValue,
      );
      await reply(interaction, `Indicador criado. ID: **${indicatorId}**.`);
      return;
    }
    if (subcommand === "definir") {
      const indicatorId = interaction.options.getInteger("indicador_id", true);
      const definition = db.prepare(
        `SELECT d.data_type FROM indicator_definitions d JOIN indicator_categories c ON c.id = d.category_id
         WHERE d.id = ? AND c.guild_id = ?`,
      ).get(indicatorId, guildId) as { data_type: "number" | "text" | "boolean" | "json" } | undefined;
      assertDomain(definition, "Indicador não encontrado.");
      setIndicatorValue(
        db,
        guildId,
        interaction.user.id,
        countryNumber(interaction, db),
        indicatorId,
        jsonValue(interaction.options.getString("valor", true)),
      );
      await reply(interaction, "Indicador atualizado.");
      return;
    }
    const countryId = countryNumber(interaction, db);
    const rows = listIndicators(db, guildId, interaction.user.id, countryId);
    const embed = new EmbedBuilder()
      .setTitle(`Indicadores nacionais · ${getCountryForView(db, guildId, interaction.user.id, countryId).name}`)
      .setDescription(rows.length
        ? rows.map((row) => `**${row.category} · ${row.name}** (${row.data_type})\n${String(row.value ?? "—")}${row.description ? `\n${row.description}` : ""}`).join("\n\n").slice(0, 4000)
        : "Nenhum indicador foi configurado.")
      .setColor(0x315e56);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },

  economia: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    const countryId = countryNumber(interaction, db);
    if (subcommand === "configurar") {
      configureCountryEconomy(db, guildId, interaction.user.id, countryId, {
        maxMoney: interaction.options.getNumber("limite_saldo"),
        debtLimit: interaction.options.getNumber("limite_divida", true),
        annualIncome: interaction.options.getNumber("renda_anual", true),
      });
      await reply(interaction, `Limites e rendimento anual atualizados.`);
      return;
    }
    if (subcommand === "inflar") {
      const amount = interaction.options.getNumber("valor", true);
      issueInflation(db, guildId, interaction.user.id, countryId, amount, interaction.id);
      await reply(interaction, `Emitidos ${formatNumber(amount, 2)}. O valor foi somado à inflação acumulada do país.`);
    } else {
      const amount = interaction.options.getNumber("valor_exato", true);
      repayInflation(db, guildId, interaction.user.id, countryId, amount, interaction.id);
      await reply(interaction, "O montante exato foi devolvido e a inflação acumulada removida.");
    }
  },

  transferir: async (interaction, db) => {
    const guildId = id(interaction);
    const transactionId = transferBetweenCountries(
      db,
      guildId,
      interaction.user.id,
      countryIdByName(db, guildId, interaction.options.getString("origem", true)),
      countryIdByName(db, guildId, interaction.options.getString("destino", true)),
      interaction.options.getNumber("valor", true),
      interaction.options.getString("descricao") ?? "Transferência entre países",
      interaction.id,
    );
    await reply(interaction, `Transferência atômica concluída. Referência: \`${transactionId.slice(0, 8)}\`.`);
  },

  inventario: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "painel") {
      const country = resolveCommandCountry(db, guildId, interaction.user.id, interaction.options.getString("pais") ?? undefined);
      ensureDefaultCatalog(db, guildId, interaction.user.id);
      const rows = listCountryInventory(db, guildId, interaction.user.id, country.id);
      const selected = "Recursos naturais";
      const filtered = rows.filter((row) => row.category === selected);
      const embed = new EmbedBuilder()
        .setTitle(`Inventário nacional · ${country.name}`)
        .setDescription(filtered.length
          ? filtered.map((row) => {
              const net = row.annual_production - row.annual_consumption;
              return `**${row.name}**\nEstoque: ${formatNumber(row.quantity, 2)} ${row.unit ?? ""} · Produção anual: ${formatNumber(row.annual_production, 2)} · Consumo anual: ${formatNumber(row.annual_consumption, 2)} · Variação: ${net >= 0 ? "+" : ""}${formatNumber(net, 2)}`;
            }).join("\n\n").slice(0, 3900)
          : "Nenhum item nesta categoria.")
        .setFooter({ text: "Selecione uma categoria nos botões abaixo." })
        .setColor(0x315e56);
      const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`inventario_pagina:${country.id}:resources`).setLabel("Recursos naturais").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`inventario_pagina:${country.id}:industry`).setLabel("Indústria e bens").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`inventario_pagina:${country.id}:military`).setLabel("Militar").setStyle(ButtonStyle.Secondary),
      );
      await interaction.editReply({ embeds: [embed], components: [buttons], allowedMentions: { parse: [] } });
      return;
    }
    if (subcommand === "categoria") {
      const categoryId = createCustomItemCategory(
        db,
        guildId,
        interaction.user.id,
        interaction.options.getString("nome", true),
        interaction.options.getString("descricao") ?? "",
      );
      await reply(interaction, `Categoria personalizada criada. ID: **${categoryId}**.`);
      return;
    }
    if (subcommand === "criar-item") {
      let properties: Record<string, unknown> = {};
      const rawProperties = interaction.options.getString("propriedades_json");
      if (rawProperties) {
        const parsed = jsonValue(rawProperties);
        assertDomain(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed), "As propriedades devem ser um objeto JSON.");
        properties = parsed as Record<string, unknown>;
      }
      const itemId = defineItem(db, guildId, interaction.user.id, {
        name: interaction.options.getString("nome", true),
        category: interaction.options.getString("categoria", true) as "military" | "common" | "custom",
        customCategoryId: interaction.options.getInteger("categoria_personalizada_id") ?? undefined,
        description: interaction.options.getString("descricao") ?? "",
        properties,
        productionCost: interaction.options.getNumber("custo", true),
        annualMaintenance: interaction.options.getNumber("manutencao", true),
        annualIncomePerUnit: interaction.options.getNumber("receita_anual") ?? 0,
        annualExpensePerUnit: interaction.options.getNumber("despesa_anual") ?? 0,
        productionYears: interaction.options.getInteger("duracao_anos", true),
        maxParallelOrders: interaction.options.getInteger("filas_simultaneas", true),
        isFood: interaction.options.getBoolean("alimento", true),
        globalTradeable: interaction.options.getBoolean("mercado_global", true),
      });
      await reply(interaction, `Item **${interaction.options.getString("nome", true)}** criado.`);
      return;
    }
    if (subcommand === "ajustar") {
      adjustInventory(db, guildId, interaction.user.id, countryNumber(interaction, db), itemIdByName(db, guildId, interaction.options.getString("item", true)),
        interaction.options.getNumber("variacao", true), interaction.options.getString("motivo", true), interaction.id);
      await reply(interaction, "Estoque atualizado.");
      return;
    }
    if (subcommand === "producao-anual") {
      setCountryProduction(
        db,
        guildId,
        interaction.user.id,
        countryNumber(interaction, db),
        itemIdByName(db, guildId, interaction.options.getString("item", true)),
        interaction.options.getNumber("produz", true),
        interaction.options.getNumber("consome", true),
        interaction.options.getNumber("exportar_percentual") ?? 0,
      );
      await reply(interaction, "Produção, consumo e percentual de exportação anual atualizados.");
      return;
    }
    if (subcommand === "requisito") {
      addItemRequirement(
        db,
        guildId,
        interaction.user.id,
        itemIdByName(db, guildId, interaction.options.getString("produto", true)),
        itemIdByName(db, guildId, interaction.options.getString("material", true)),
        interaction.options.getNumber("quantidade", true),
      );
      await reply(interaction, "Requisito de material configurado.");
      return;
    }
    if (subcommand === "estoque-global") {
      setGlobalStock(
        db,
        guildId,
        interaction.user.id,
        itemIdByName(db, guildId, interaction.options.getString("item", true)),
        interaction.options.getNumber("estoque", true),
        interaction.options.getNumber("preco", true),
        interaction.options.getNumber("preco_base", true),
        interaction.options.getNumber("preco_minimo", true),
        interaction.options.getNumber("preco_maximo", true),
        interaction.options.getNumber("estoque_maximo", true),
        interaction.options.getNumber("reposicao_anual", true),
      );
      await reply(interaction, "Estoque, capacidade, reposição e preços globais atualizados.");
      return;
    }
    const inventoryCountryId = countryNumber(interaction, db);
    const inventoryCountryName = getCountryForView(db, guildId, interaction.user.id, inventoryCountryId).name;
    const rows = listCountryInventory(db, guildId, interaction.user.id, inventoryCountryId);
    const resourceAgreements = db.prepare(`SELECT t.amount, t.remaining_years, a.name AS sender, b.name AS receiver, t.from_country_id, i.name AS item_name
      FROM scheduled_transfers t JOIN countries a ON a.id = t.from_country_id JOIN countries b ON b.id = t.to_country_id JOIN items i ON i.id = t.item_id
      WHERE t.guild_id = ? AND t.status = 'active' AND t.transfer_type = 'item' AND (t.from_country_id = ? OR t.to_country_id = ?)
      ORDER BY t.created_at DESC LIMIT 8`).all(guildId, inventoryCountryId, inventoryCountryId) as Array<{ amount: number; remaining_years: number; sender: string; receiver: string; from_country_id: number; item_name: string }>;
    const resourceAgreementText = resourceAgreements.length
      ? resourceAgreements.map((a) => `${a.from_country_id === inventoryCountryId ? "Envia" : "Recebe"} ${formatNumber(a.amount, 2)} × ${a.item_name} por ano · ${a.from_country_id === inventoryCountryId ? a.receiver : a.sender} · ${a.remaining_years === 0 ? "indefinido" : `${a.remaining_years} ano(s)`}`).join("\n").slice(0, 1000)
      : "Nenhum acordo de recursos ativo.";
    const embed = new EmbedBuilder()
      .setTitle(`Inventário nacional · ${inventoryCountryName}`)
      .setDescription(rows.length
        ? rows.map((row) => `**${row.name}** · ${row.category}: ${formatNumber(row.quantity, 2)}${row.unit ? ` ${row.unit}` : ""}`).join("\n").slice(0, 4000)
        : "Nenhum item configurado.")
      .addFields({ name: "Acordos anuais de recursos", value: resourceAgreementText })
      .setColor(0x315e56);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },

  produzir: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "iniciar") {
      const result = startProduction(
        db,
        id(interaction),
        interaction.user.id,
        countryNumber(interaction, db),
        itemIdByName(db, guildId, interaction.options.getString("item", true)),
        interaction.options.getNumber("quantidade", true),
        interaction.id,
      );
      await reply(interaction, result.instant
        ? `Produção instantânea agendada para entrega no próximo processamento anual: \`${result.orderId}\`.`
        : `Pedido de produção criado: \`${result.orderId}\`.`);
      return;
    }
    if (subcommand === "cancelar") {
      const returned = cancelProduction(db, id(interaction), interaction.user.id, interaction.options.getString("pedido_id", true), interaction.id);
      await reply(interaction, `Pedido cancelado. Materiais devolvidos parcialmente: ${formatNumber(returned, 2)} unidades no total. O custo de produção não é reembolsado.`);
      return;
    }
    const countryId = countryNumber(interaction, db);
    const rows = listProductionQueue(db, id(interaction), interaction.user.id, countryId);
    const embed = new EmbedBuilder()
      .setTitle(`Fila de produção · ${getCountryForView(db, id(interaction), interaction.user.id, countryId).name}`)
      .setDescription(rows.length
        ? rows.map((row) => `**${row.item}** × ${formatNumber(row.quantity, 2)} · ${row.status === "in_progress" ? `${row.remaining_years} ano(s) restante(s)` : row.status} · \`${row.id.slice(0, 8)}\``).join("\n").slice(0, 4000)
        : "Nenhum pedido de produção.")
      .setColor(0x315e56);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },

  mercado: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "historico") {
      const page = interaction.options.getInteger("pagina") ?? 1;
      const offset = (page - 1) * 10;
      const canSeeAll = hasNarratorPermission(db, guildId, interaction.user.id, "market", "read");
      const playerTrades = canSeeAll
        ? db.prepare(
            `SELECT t.year, i.name AS item, s.name AS seller, b.name AS buyer,
              t.quantity, t.unit_price, t.total
             FROM player_market_trades t
             JOIN items i ON i.id = t.item_id
             JOIN countries s ON s.id = t.seller_country_id
             JOIN countries b ON b.id = t.buyer_country_id
             WHERE t.guild_id = ? ORDER BY t.created_at DESC LIMIT 10 OFFSET ?`,
          ).all(guildId, offset)
        : db.prepare(
            `SELECT t.year, i.name AS item, s.name AS seller, b.name AS buyer,
              t.quantity, t.unit_price, t.total
             FROM player_market_trades t
             JOIN items i ON i.id = t.item_id
             JOIN countries s ON s.id = t.seller_country_id
             JOIN countries b ON b.id = t.buyer_country_id
             WHERE t.guild_id = ? AND (
               EXISTS (SELECT 1 FROM country_memberships m WHERE m.country_id = t.seller_country_id AND m.user_id = ?)
               OR EXISTS (SELECT 1 FROM country_memberships m WHERE m.country_id = t.buyer_country_id AND m.user_id = ?)
             ) ORDER BY t.created_at DESC LIMIT 10 OFFSET ?`,
          ).all(guildId, interaction.user.id, interaction.user.id, offset);
      const globalTrades = canSeeAll
        ? db.prepare(
            `SELECT t.year, i.name AS item, c.name AS country, t.direction, t.quantity, t.unit_price, t.total
             FROM global_market_trades t JOIN items i ON i.id = t.item_id JOIN countries c ON c.id = t.country_id
             WHERE t.guild_id = ? ORDER BY t.created_at DESC LIMIT 10 OFFSET ?`,
          ).all(guildId, offset)
        : db.prepare(
            `SELECT t.year, i.name AS item, c.name AS country, t.direction, t.quantity, t.unit_price, t.total
             FROM global_market_trades t JOIN items i ON i.id = t.item_id JOIN countries c ON c.id = t.country_id
             JOIN country_memberships m ON m.country_id = t.country_id
             WHERE t.guild_id = ? AND m.user_id = ? ORDER BY t.created_at DESC LIMIT 10 OFFSET ?`,
          ).all(guildId, interaction.user.id, offset);
      const prices = db.prepare(
        `SELECT h.year, i.name AS item, h.previous_price, h.new_price
         FROM global_price_history h JOIN items i ON i.id = h.item_id
         WHERE h.guild_id = ? AND h.voided_at IS NULL ORDER BY h.id DESC LIMIT 10 OFFSET ?`,
      ).all(guildId, offset) as Array<{ year: number; item: string; previous_price: number; new_price: number }>;
      const playerRows = playerTrades as Array<{ year: number; item: string; seller: string; buyer: string; quantity: number; unit_price: number; total: number }>;
      const globalRows = globalTrades as Array<{ year: number; item: string; country: string; direction: string; quantity: number; unit_price: number; total: number }>;
      const embed = new EmbedBuilder()
        .setTitle(`Histórico de mercado · página ${page}`)
        .addFields(
          { name: "Negociações entre países", value: playerRows.length
            ? playerRows.map((trade) => `Ano ${trade.year} · ${trade.seller} → ${trade.buyer} · ${trade.item} × ${formatNumber(trade.quantity, 2)} · total ${formatNumber(trade.total, 2)}`).join("\n").slice(0, 1000)
            : "Nenhuma negociação visível." },
          { name: "Mercado global", value: globalRows.length
            ? globalRows.map((trade) => `Ano ${trade.year} · ${trade.country} ${trade.direction === "buy" ? "comprou" : "vendeu"} ${trade.item} × ${formatNumber(trade.quantity, 2)} · ${formatNumber(trade.total, 2)}`).join("\n").slice(0, 1000)
            : "Nenhuma transação global visível." },
          { name: "Preços globais", value: prices.length
            ? prices.map((price) => `Ano ${price.year} · ${price.item}: ${formatNumber(price.previous_price, 2)} → ${formatNumber(price.new_price, 2)}`).join("\n").slice(0, 1000)
            : "Nenhum reajuste registrado." },
        )
        .setColor(0x315e56);
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }
    if (subcommand === "ofertar") {
      const offerId = createPlayerOffer(
        db,
        guildId,
        interaction.user.id,
        countryNumber(interaction, db),
        itemIdByName(db, guildId, interaction.options.getString("item", true)),
        interaction.options.getNumber("quantidade", true),
        interaction.options.getNumber("preco_unitario", true),
        interaction.options.getString("descricao") ?? "",
        interaction.id,
      );
      await reply(interaction, `Oferta aberta: \`${offerId}\`. O estoque foi reservado e será devolvido ao cancelar ou expirar.`);
      return;
    }
    if (subcommand === "comprar") {
      const result = buyPlayerOffer(
        db,
        guildId,
        interaction.user.id,
        countryNumber(interaction, db),
        interaction.options.getString("oferta_id", true),
        interaction.options.getNumber("quantidade", true),
        interaction.id,
      );
      await reply(interaction, `Compra concluída. Total: ${formatNumber(result.total, 2)}. Referência: \`${result.tradeId.slice(0, 8)}\`.`);
      return;
    }
    if (subcommand === "cancelar") {
      const returned = cancelPlayerOffer(db, guildId, interaction.user.id, interaction.options.getString("oferta_id", true), interaction.id);
      await reply(interaction, `Oferta cancelada. ${formatNumber(returned, 2)} unidade(s) devolvida(s) ao estoque.`);
      return;
    }
    if (subcommand === "global-comprar" || subcommand === "global-vender") {
      const result = tradeGlobalMarket(
        db,
        guildId,
        interaction.user.id,
        countryNumber(interaction, db),
        itemIdByName(db, guildId, interaction.options.getString("item", true)),
        subcommand === "global-comprar" ? "buy" : "sell",
        interaction.options.getNumber("quantidade", true),
        interaction.id,
      );
      await reply(interaction, `${subcommand === "global-comprar" ? "Compra" : "Venda"} global concluída. Preço unitário ${formatNumber(result.unitPrice, 2)} · total ${formatNumber(result.total, 2)}.`);
      return;
    }
    const offers = listOffers(db, guildId);
    const stock = db.prepare(
      `SELECT i.id, i.name, g.quantity, g.current_price, g.base_price, g.min_price, g.max_price
       FROM global_stock g JOIN items i ON i.id = g.item_id WHERE g.guild_id = ? ORDER BY i.name`,
    ).all(guildId) as Array<{ id: number; name: string; quantity: number; current_price: number; base_price: number; min_price: number; max_price: number }>;
    const embed = new EmbedBuilder()
      .setTitle("Mercado mundial · painel público")
      .setDescription("Ofertas entre países e preços do mercado mundial. As compras e vendas globais influenciam os preços no fechamento de cada ano.")
      .addFields(
        { name: "Ofertas entre países", value: offers.length
          ? offers.slice(0, 10).map((offer) => `\`${offer.id.slice(0, 8)}\` · ${offer.item} × ${formatNumber(offer.remaining_quantity, 2)} · ${formatNumber(offer.unit_price, 2)} ${offer.currency_symbol} · expira no ano ${offer.expires_year}`).join("\n").slice(0, 1000)
          : "Nenhuma oferta aberta." },
        { name: "Mercado global", value: stock.length
          ? stock.slice(0, 10).map((item) => `**${item.name}** · estoque ${formatNumber(item.quantity, 2)} · atual ${formatNumber(item.current_price, 2)} · base ${formatNumber(item.base_price, 2)} [${formatNumber(item.min_price, 2)}–${formatNumber(item.max_price, 2)}]`).join("\n").slice(0, 1000)
          : "Nenhum produto global configurado." },
      )
      .setColor(0x315e56);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },

  populacao: async (interaction, db) => {
    const guildId = id(interaction);
    if (interaction.options.getSubcommand() === "definir") {
      configurePopulation(db, guildId, interaction.user.id, countryNumber(interaction, db), {
        population: interaction.options.getInteger("populacao", true),
        annualGrowthPercent: interaction.options.getNumber("crescimento_percentual", true),
        foodPerPerson: interaction.options.getNumber("alimento_por_pessoa", true),
        revoltCounter: interaction.options.getNumber("contador_revolta", true),
      });
      await reply(interaction, "População, crescimento e contador de revolta atualizados.");
      return;
    }
    const countryId = countryNumber(interaction, db);
    requireCountryOrNarratorPermission(db, guildId, countryId, interaction.user.id, "population", "read");
    const row = getPopulation(db, guildId, countryId);
    const embed = new EmbedBuilder()
      .setTitle(`População · ${row.name}`)
      .addFields(
        { name: "Habitantes", value: formatNumber(row.population, 0), inline: true },
        { name: "Crescimento anual", value: `${formatNumber(row.annual_population_growth, 2)}%`, inline: true },
        { name: "Necessidade alimentar", value: `${formatNumber(row.food_per_person, 2)} por pessoa/ano`, inline: true },
        { name: "Contador de revolta", value: formatNumber(row.revolt_counter, 2), inline: true },
      )
      .setFooter({ text: "Consequências de revoltas são decididas pelo narrador." })
      .setColor(0x315e56);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },

  negociacao: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    const narrator = hasNarratorPermission(db, guildId, interaction.user.id, "countries", "read");
    if (subcommand === "criar") {
      const own = resolveCommandCountry(db, guildId, interaction.user.id, interaction.options.getString("meu_pais") ?? undefined);
      const targetName = interaction.options.getString("pais", true).trim();
      const target = db.prepare("SELECT id, name FROM countries WHERE guild_id = ? AND status = 'active' AND lower(name) = lower(?)").get(guildId, targetName) as { id: number; name: string } | undefined;
      assertDomain(target && target.id !== own.id, "País de destino não encontrado ou igual ao seu país.");
      const direction = interaction.options.getString("direcao", true);
      const type = interaction.options.getString("tipo", true);
      const quantity = interaction.options.getNumber("quantidade", true);
      const duration = interaction.options.getInteger("duracao", true);
      const itemName = interaction.options.getString("item");
      assertDomain(type !== "item" || !!itemName, "Informe o item para transferências de recursos.");
      assertDomain(type !== "money" || !itemName, "Não informe item em uma transferência de dinheiro.");
      const itemId = type === "item" ? itemIdByName(db, guildId, itemName!) : null;
      const fromId = direction === "send" ? own.id : target.id;
      const toId = direction === "send" ? target.id : own.id;
      if (type === "item") {
        const stock = db.prepare("SELECT quantity FROM country_inventory WHERE country_id = ? AND item_id = ?").get(fromId, itemId) as { quantity: number } | undefined;
        const assigned = db.prepare("SELECT assigned_soldiers FROM army_equipment_assignments WHERE country_id = ? AND item_id = ?").get(fromId, itemId) as { assigned_soldiers: number } | undefined;
        assertDomain((stock?.quantity ?? 0) - (assigned?.assigned_soldiers ?? 0) >= quantity, "O país remetente não possui estoque livre suficiente; equipamentos atribuídos ao exército ficam reservados.");
      } else {
        const balance = db.prepare("SELECT treasury, debt_limit FROM countries WHERE id = ?").get(fromId) as { treasury: number; debt_limit: number };
        assertDomain(balance.treasury - quantity >= -balance.debt_limit, "O país remetente não possui saldo ou limite de crédito suficiente.");
      }
      const agreementId = randomUUID();
      db.prepare(`INSERT INTO scheduled_transfers
        (id, guild_id, from_country_id, to_country_id, transfer_type, item_id, amount, duration_years, remaining_years, description, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(agreementId, guildId, fromId, toId, type, itemId, quantity, duration, duration, interaction.options.getString("descricao") ?? "", interaction.user.id);
      audit(db, guildId, interaction.user.id, "create_annual_transfer", "scheduled_transfer", agreementId, { fromId, toId, type, itemId, quantity, duration });
      await reply(interaction, `Acordo anual criado: **${direction === "send" ? own.name : target.name} → ${direction === "send" ? target.name : own.name}** · ${type === "money" ? "Dinheiro" : itemName} × ${formatNumber(quantity, 2)} · ${duration === 0 ? "Duração indefinida" : `${duration} ano(s)`} · ID \`${agreementId.slice(0, 8)}\`.`);
      return;
    }
    if (subcommand === "painel") {
      const rows = narrator
        ? db.prepare(`SELECT t.*, a.name AS sender, b.name AS receiver, i.name AS item_name FROM scheduled_transfers t JOIN countries a ON a.id = t.from_country_id JOIN countries b ON b.id = t.to_country_id LEFT JOIN items i ON i.id = t.item_id WHERE t.guild_id = ? AND t.status = 'active' ORDER BY t.created_at DESC LIMIT 25`).all(guildId)
        : db.prepare(`SELECT t.*, a.name AS sender, b.name AS receiver, i.name AS item_name FROM scheduled_transfers t JOIN countries a ON a.id = t.from_country_id JOIN countries b ON b.id = t.to_country_id LEFT JOIN items i ON i.id = t.item_id WHERE t.guild_id = ? AND t.status = 'active' AND (EXISTS (SELECT 1 FROM country_memberships m WHERE m.country_id = t.from_country_id AND m.user_id = ?) OR EXISTS (SELECT 1 FROM country_memberships m WHERE m.country_id = t.to_country_id AND m.user_id = ?)) ORDER BY t.created_at DESC LIMIT 25`).all(guildId, interaction.user.id, interaction.user.id);
      const agreements = rows as Array<{ id: string; sender: string; receiver: string; transfer_type: string; item_name: string | null; amount: number; remaining_years: number; description: string }>;
      const embed = new EmbedBuilder().setTitle("Negociações · acordos anuais").setDescription(agreements.length ? agreements.map((a) => `**${a.sender} → ${a.receiver}** · ${a.transfer_type === "money" ? "Dinheiro" : a.item_name} × ${formatNumber(a.amount, 2)}\nDuração: ${a.remaining_years === 0 ? "indefinida" : `${a.remaining_years} ano(s) restante(s)`} · ID \`${a.id.slice(0, 8)}\`${a.description ? `\n${a.description}` : ""}`).join("\n\n").slice(0, 4000) : "Nenhum acordo ativo visível para você.").setFooter({ text: "Use /negociacao editar ou /negociacao cancelar com o ID do acordo." }).setColor(0x315e56);
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }
    const agreementId = interaction.options.getString("id", true);
    const agreement = db.prepare("SELECT * FROM scheduled_transfers WHERE guild_id = ? AND id LIKE ? AND status = 'active'").get(guildId, agreementId + "%") as { id: string; from_country_id: number; to_country_id: number } | undefined;
    assertDomain(agreement, "Acordo ativo não encontrado.");
    const member = db.prepare("SELECT 1 FROM country_memberships WHERE user_id = ? AND country_id IN (?, ?)").get(interaction.user.id, agreement.from_country_id, agreement.to_country_id);
    assertDomain(narrator || member, "Somente os países envolvidos ou um narrador podem alterar este acordo.");
    if (subcommand === "cancelar") {
      db.prepare("UPDATE scheduled_transfers SET status = 'cancelled' WHERE id = ?").run(agreement.id);
      audit(db, guildId, interaction.user.id, "cancel_annual_transfer", "scheduled_transfer", agreement.id);
      await reply(interaction, `Acordo \`${agreement.id.slice(0, 8)}\` cancelado.`);
      return;
    }
    const quantity = interaction.options.getNumber("quantidade", true);
    const duration = interaction.options.getInteger("duracao", true);
    db.prepare("UPDATE scheduled_transfers SET amount = ?, duration_years = ?, remaining_years = ? WHERE id = ?").run(quantity, duration, duration, agreement.id);
    audit(db, guildId, interaction.user.id, "edit_annual_transfer", "scheduled_transfer", agreement.id, { quantity, duration });
    await reply(interaction, `Acordo \`${agreement.id.slice(0, 8)}\` atualizado: ${formatNumber(quantity, 2)} por ano · ${duration === 0 ? "duração indefinida" : `${duration} ano(s)`}.`);
  },

  consumo: async (interaction, db) => {
    const guildId = id(interaction);
    requireNarratorPermission(db, guildId, interaction.user.id, "population", "configure");
    const countryId = countryNumber(interaction, db);
    const itemId = itemIdByName(db, guildId, interaction.options.getString("item", true));
    const target = interaction.options.getString("alvo", true) as "population" | "army";
    const quantity = interaction.options.getNumber("quantidade_por_unidade", true);
    configureConsumptionRule(db, guildId, interaction.user.id, countryId, itemId, target, quantity);
    await reply(interaction, `Consumo anual configurado: cada ${target === "population" ? "habitante" : "soldado"} de ${getCountryForView(db, guildId, interaction.user.id, countryId).name} consumirá ${formatNumber(quantity, 4)} unidade(s) de ${interaction.options.getString("item", true)} por ano.`);
  },

  exercito: async (interaction, db) => {
    const guildId = id(interaction);
    const countryId = countryNumber(interaction, db);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "definir") {
      configureArmySize(db, guildId, interaction.user.id, countryId, interaction.options.getInteger("efetivo", true));
      await reply(interaction, "Efetivo militar atualizado.");
      return;
    }
    if (subcommand === "equipamento") {
      assignArmyEquipment(db, guildId, interaction.user.id, countryId, itemIdByName(db, guildId, interaction.options.getString("item", true)), interaction.options.getInteger("soldados", true));
      await reply(interaction, "Atribuição de equipamento atualizada. O equipamento permanece no inventário e não é consumido anualmente.");
      return;
    }
    requireCountryOrNarratorPermission(db, guildId, countryId, interaction.user.id, "population", "read");
    const country = db.prepare("SELECT name, army_size FROM countries WHERE id = ?").get(countryId) as { name: string; army_size: number };
    const equipment = db.prepare(`SELECT i.name, a.assigned_soldiers FROM army_equipment_assignments a JOIN items i ON i.id = a.item_id WHERE a.country_id = ? ORDER BY i.name`).all(countryId) as Array<{ name: string; assigned_soldiers: number }>;
    const equipped = equipment.reduce((sum, row) => sum + row.assigned_soldiers, 0);
    const lines = equipment.map((row) => `**${row.name}:** ${formatNumber(row.assigned_soldiers, 0)} soldados`);
    lines.push(`**Sem equipamento:** ${formatNumber(Math.max(0, country.army_size - equipped), 0)} soldados`);
    const embed = new EmbedBuilder().setTitle(`Forças armadas · ${country.name}`).addFields(
      { name: "Efetivo total", value: formatNumber(country.army_size, 0), inline: true },
      { name: "Equipados", value: formatNumber(equipped, 0), inline: true },
      { name: "Sem equipamento", value: formatNumber(Math.max(0, country.army_size - equipped), 0), inline: true },
    ).setDescription(lines.join("\n") || "Nenhum equipamento atribuído.").setColor(0x315e56);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },

  ano: async (interaction, db) => {
    const guildId = id(interaction);
    if (interaction.options.getSubcommand() === "definir") {
      requireNarratorPermission(db, guildId, interaction.user.id, "year", "advance");
      const targetYear = interaction.options.getInteger("ano", true);
      const duplicate = db.prepare("SELECT id FROM annual_runs WHERE guild_id = ? AND year = ? AND undone_at IS NULL").get(guildId, targetYear);
      assertDomain(!duplicate, `O ano ${targetYear} já possui um processamento ativo.`);
      db.prepare("UPDATE guild_settings SET current_year = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ?").run(targetYear, guildId);
      audit(db, guildId, interaction.user.id, "set_current_year", "guild", guildId, { year: targetYear });
      await reply(interaction, `Ano atual definido para **${targetYear}**. O próximo avanço processará ${targetYear + 1}.`);
      return;
    }
    if (interaction.options.getSubcommand() === "avancar") {
      const result = processAnnualTurn(db, guildId, interaction.user.id, interaction.id);
      const priceChanges = db.prepare(
        `SELECT i.name AS item, h.previous_price, h.new_price
         FROM global_price_history h JOIN items i ON i.id = h.item_id
         WHERE h.run_id = ? AND h.voided_at IS NULL
           AND ABS(h.new_price - h.previous_price) > 0.000001
         ORDER BY i.name COLLATE NOCASE`,
      ).all(result.runId) as Array<{ item: string; previous_price: number; new_price: number }>;
      const priceEmbed = new EmbedBuilder()
        .setTitle(`Mercado mundial · reajustes do ano ${result.year}`)
        .setDescription(priceChanges.length
          ? priceChanges.map((change) => {
              const delta = change.new_price - change.previous_price;
              const percent = change.previous_price > 0 ? delta / change.previous_price * 100 : 0;
              const symbol = delta > 0.000001 ? "▲" : delta < -0.000001 ? "▼" : "•";
              return `${symbol} **${change.item}** · ${formatNumber(change.previous_price, 2)} → ${formatNumber(change.new_price, 2)} (${delta >= 0 ? "+" : ""}${formatNumber(percent, 2)}%)`;
            }).join("\n").slice(0, 4000)
          : "Nenhum preço global foi alterado neste ano.")
        .setColor(0x315e56)
        .setFooter({ text: "Os preços são reajustados no fechamento anual." });
      await interaction.editReply({
        content: `Ano **${result.year}** processado atomicamente.\nPaíses: ${result.summary.countries} · Receitas: ${formatNumber(result.summary.revenue, 2)} · Despesas: ${formatNumber(result.summary.expenses, 2)} · Produções concluídas: ${result.summary.completedOrders}\nDéficit populacional: ${formatNumber(result.summary.populationShortage, 2)} · Déficit militar: ${formatNumber(result.summary.armyShortage, 2)}\nAcordos executados: ${result.summary.transfersApplied} · Parcelas suspensas por falta de saldo/estoque: ${result.summary.transfersFailed} · Ofertas expiradas: ${result.summary.expiredOffers}\nRegistro: \`${result.runId}\``,
        embeds: [priceEmbed],
        allowedMentions: { parse: [] },
      });
      return;
    }
    const result = undoAnnualTurn(db, guildId, interaction.user.id, interaction.id);
    await interaction.editReply({
      content: `Ano ${result.year} desfeito. O estado anterior foi restaurado; registros e reversões financeiras foram preservados.`,
      allowedMentions: { parse: [] },
    });
  },

  historico: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "anos") {
      requireNarratorPermission(db, guildId, interaction.user.id, "year", "read");
      const page = interaction.options.getInteger("pagina") ?? 1;
      const annualRows = listAnnualRuns(db, guildId, page);
      const embed = new EmbedBuilder()
        .setTitle(`Histórico de anos · página ${page}`)
        .setDescription(annualRows.length
          ? annualRows.map((row) => `**Ano ${row.year}** · ${row.undone_at ? "desfeito" : "processado"} · \`${row.id.slice(0, 8)}\`\n${Object.entries(JSON.parse(row.summary_json) as Record<string, number>).map(([key, value]) => `${key}: ${formatNumber(value, 2)}`).join(" · ")}`).join("\n\n").slice(0, 4000)
          : "Nenhum ano processado.")
        .setColor(0x315e56);
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }
    if (subcommand === "auditoria") {
      requireNarratorPermission(db, guildId, interaction.user.id, "players", "read");
      const page = interaction.options.getInteger("pagina") ?? 1;
      const rows = db.prepare(
        `SELECT actor_id, action, entity, entity_id, details_json, created_at
         FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT 10 OFFSET ?`,
      ).all(guildId, (page - 1) * 10) as Array<{ actor_id: string; action: string; entity: string; entity_id: string; details_json: string; created_at: string }>;
      const embed = new EmbedBuilder()
        .setTitle(`Auditoria recente · página ${page}`)
        .setDescription(rows.length
          ? rows.map((row) => `\`${row.created_at}\` · <@${row.actor_id}> · **${row.action}** · ${row.entity} ${row.entity_id}`).join("\n").slice(0, 4000)
          : "Nenhum evento de auditoria.")
        .setColor(0x315e56);
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
      return;
    }
    const countryId = countryNumber(interaction, db);
    requireCountryOrNarratorPermission(db, guildId, countryId, interaction.user.id, "economy", "read");
    const page = interaction.options.getInteger("pagina") ?? 1;
    const rows = db.prepare(
      `SELECT year, kind, amount, note, actor_id, created_at FROM financial_ledger
       WHERE guild_id = ? AND country_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10 OFFSET ?`,
    ).all(guildId, countryId, (page - 1) * 10) as Array<{ year: number; kind: string; amount: number; note: string; actor_id: string; created_at: string }>;
    const embed = new EmbedBuilder()
      .setTitle(`Extrato · ${getCountryForView(db, guildId, interaction.user.id, countryId).name} · página ${page}`)
      .setDescription(rows.length
        ? rows.map((row) => `Ano ${row.year} · ${row.amount >= 0 ? "+" : ""}${formatNumber(row.amount, 2)} · ${row.kind} · <@${row.actor_id}>\n${row.note}`).join("\n\n").slice(0, 4000)
        : "Nenhum lançamento financeiro.")
      .setColor(0x315e56);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },

  ranking: async (interaction, db) => {
    const guildId = id(interaction);
    const type = interaction.options.getString("tipo", true);
    const settings = db.prepare("SELECT current_year, currency_symbol FROM guild_settings WHERE guild_id = ?").get(guildId) as { current_year: number; currency_symbol: string } | undefined;
    const year = settings?.current_year ?? 0;
    let rows: Array<{ name: string; value: number; previous?: number }>;
    let title: string;
    let suffix = settings?.currency_symbol ?? "";
    if (type === "economy") {
      title = "Ranking econômico · saldo do tesouro";
      rows = db.prepare("SELECT name, treasury AS value FROM countries WHERE guild_id = ? AND status = 'active' ORDER BY treasury DESC, name COLLATE NOCASE LIMIT 10")
        .all(guildId) as typeof rows;
    } else if (type === "population") {
      title = "Ranking populacional";
      rows = db.prepare("SELECT name, population AS value FROM countries WHERE guild_id = ? AND status = 'active' ORDER BY population DESC, name COLLATE NOCASE LIMIT 10")
        .all(guildId) as typeof rows;
      suffix = " habitantes";
    } else if (type === "production") {
      title = "Ranking industrial · valor da produção anual";
      rows = db.prepare(
        "SELECT c.name, COALESCE(SUM(p.annual_production * i.production_cost), 0) AS value FROM countries c LEFT JOIN country_production p ON p.country_id = c.id LEFT JOIN items i ON i.id = p.item_id WHERE c.guild_id = ? AND c.status = 'active' GROUP BY c.id ORDER BY value DESC, c.name COLLATE NOCASE LIMIT 10",
      ).all(guildId) as typeof rows;
      suffix = ` ${settings?.currency_symbol ?? ""} (valor estimado)`;
    } else if (type === "stock") {
      title = "Ranking de estoques · valor estimado";
      rows = db.prepare(
        "SELECT c.name, COALESCE(SUM(v.quantity * i.production_cost), 0) AS value FROM countries c LEFT JOIN country_inventory v ON v.country_id = c.id LEFT JOIN items i ON i.id = v.item_id WHERE c.guild_id = ? AND c.status = 'active' GROUP BY c.id ORDER BY value DESC, c.name COLLATE NOCASE LIMIT 10",
      ).all(guildId) as typeof rows;
      suffix = ` ${settings?.currency_symbol ?? ""} (valor estimado)`;
    } else {
      title = `Ranking de variação do resultado financeiro · ano ${year}`;
      rows = db.prepare(
        `SELECT c.name,
          COALESCE(SUM(CASE WHEN l.year = ? THEN l.amount ELSE 0 END), 0) AS value,
          COALESCE(SUM(CASE WHEN l.year = ? THEN l.amount ELSE 0 END), 0) AS previous
         FROM countries c LEFT JOIN financial_ledger l ON l.country_id = c.id
         WHERE c.guild_id = ? AND c.status = 'active'
         GROUP BY c.id ORDER BY value DESC, c.name COLLATE NOCASE LIMIT 10`,
      ).all(year, year - 1, guildId) as typeof rows;
    }
    const lines = rows.map((row, index) => {
      const value = type === "growth" && row.previous !== undefined && row.previous > 0
        ? `${(((row.value - row.previous) / row.previous) * 100).toFixed(1).replace(".", ",")}%`
        : type === "growth" ? "—" : `${formatNumber(row.value, type === "population" ? 0 : 2)}${type === "population" ? suffix : ` ${suffix}`}`;
      return `**${index + 1}. ${row.name}** — ${value}`;
    });
    const embed = new EmbedBuilder().setTitle(title).setDescription(lines.length ? lines.join("\n") : "Nenhum país cadastrado.")
      .setFooter({ text: type === "growth" ? "Variação percentual do resultado financeiro líquido em relação ao ano anterior; — = base anterior nula/negativa." : "Top 10 países · valores atuais" })
      .setColor(0x315e56);
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },

  narrador: async (interaction, db) => {
    const guildId = id(interaction);
    assertDomain(isMainNarrator(db, guildId, interaction.user.id), "Somente o Narrador Supremo pode nomear ou remover narradores.");
    const target = interaction.options.getUser("jogador", true);
    assertDomain(target.id !== interaction.user.id && !isMainNarrator(db, guildId, target.id), "O Narrador Supremo não pode ser removido ou substituído por este comando.");
    if (interaction.options.getSubcommand() === "adicionar") {
      grantNarratorPermission(db, guildId, interaction.user.id, target.id, "*", "*");
      await reply(interaction, `${target.username} agora é narrador e possui acesso administrativo completo.`);
    } else {
      db.prepare("DELETE FROM narrator_grants WHERE guild_id = ? AND user_id = ?").run(guildId, target.id);
      audit(db, guildId, interaction.user.id, "remove_narrator", "narrator", target.id);
      await reply(interaction, `${target.username} deixou de ser narrador.`);
    }
  },

  saldo: async (interaction, db) => {
    const guildId = id(interaction);
    const country = resolveCommandCountry(db, guildId, interaction.user.id, interaction.options.getString("pais") ?? undefined);
    const settings = db.prepare("SELECT current_year, currency_symbol FROM guild_settings WHERE guild_id = ?").get(guildId) as { current_year: number; currency_symbol: string } | undefined;
    const year = settings?.current_year ?? 0;
    const totals = (targetYear: number) => db.prepare("SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS gains, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS expenses FROM financial_ledger WHERE guild_id = ? AND country_id = ? AND year = ?").get(guildId, country.id, targetYear) as { gains: number; expenses: number };
    const current = totals(year), previous = totals(year - 1);
    const net = current.gains - current.expenses, previousNet = previous.gains - previous.expenses;
    const comparison = previousNet > 0 ? `${net >= previousNet ? "+" : ""}${formatNumber(((net - previousNet) / previousNet) * 100, 1)}% em relação ao resultado do ano anterior` : "Comparação percentual indisponível (resultado anterior nulo ou negativo)";
    const symbol = settings?.currency_symbol ?? "";
    const moneyAgreements = db.prepare(`SELECT t.amount, t.remaining_years, a.name AS sender, b.name AS receiver, t.from_country_id
      FROM scheduled_transfers t JOIN countries a ON a.id = t.from_country_id JOIN countries b ON b.id = t.to_country_id
      WHERE t.guild_id = ? AND t.status = 'active' AND t.transfer_type = 'money' AND (t.from_country_id = ? OR t.to_country_id = ?)
      ORDER BY t.created_at DESC LIMIT 8`).all(guildId, country.id, country.id) as Array<{ amount: number; remaining_years: number; sender: string; receiver: string; from_country_id: number }>;
    const moneyAgreementText = moneyAgreements.length
      ? moneyAgreements.map((a) => `${a.from_country_id === country.id ? "Envia" : "Recebe"} ${symbol} ${formatNumber(a.amount, 2)} por ano · ${a.from_country_id === country.id ? a.receiver : a.sender} · ${a.remaining_years === 0 ? "indefinido" : `${a.remaining_years} ano(s)`}`).join("\n").slice(0, 1000)
      : "Nenhum acordo monetário ativo.";
    const embed = new EmbedBuilder().setTitle(`Tesouro nacional · ${country.name}`).setDescription(`**Saldo atual**\n# ${symbol} ${formatNumber(country.treasury, 2)}`).addFields(
      { name: "Ganhos do ano", value: `+ ${symbol} ${formatNumber(current.gains, 2)}`, inline: true },
      { name: "Gastos do ano", value: `− ${symbol} ${formatNumber(current.expenses, 2)}`, inline: true },
      { name: "Resultado anual", value: `${net >= 0 ? "+" : "−"} ${symbol} ${formatNumber(Math.abs(net), 2)}`, inline: true },
      { name: "Comparação", value: comparison },
    ).addFields({ name: "Acordos anuais", value: moneyAgreementText }).setFooter({ text: `Exercício ${year} · Detalhamento disponível pelo botão abaixo` }).setColor(net >= 0 ? 0x27865b : 0xa94442);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`saldo_detalhes:${country.id}:${year}`).setLabel("Detalhamento do ano").setStyle(ButtonStyle.Secondary));
    await interaction.editReply({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
  },

  gastar: async (interaction, db) => {
    const guildId = id(interaction);
    const country = resolveCommandCountry(db, guildId, interaction.user.id, interaction.options.getString("pais") ?? undefined);
    const amount = interaction.options.getNumber("valor", true), reason = interaction.options.getString("motivo", true);
    adjustBalance(db, country.id, guildId, interaction.user.id, -amount, "player_spend", reason);
    await reply(interaction, `Gasto registrado para ${country.name}: − ${formatNumber(amount, 2)}. Motivo: ${reason}`);
  },

  dinheiro: async (interaction, db) => {
    const guildId = id(interaction);
    requireNarratorPermission(db, guildId, interaction.user.id, "economy", "configure");
    const country = resolveCommandCountry(db, guildId, interaction.user.id, interaction.options.getString("pais", true));
    const subcommand = interaction.options.getSubcommand(), reason = interaction.options.getString("motivo", true);
    if (subcommand === "definir") {
      const target = interaction.options.getNumber("saldo", true), delta = target - country.treasury;
      assertDomain(Math.abs(delta) > 1e-9, "O país já possui esse saldo.");
      adjustBalance(db, country.id, guildId, interaction.user.id, delta, "admin_set_balance", reason);
      await reply(interaction, `Saldo de ${country.name} definido para ${formatNumber(target, 2)}. Motivo: ${reason}`);
      return;
    }
    const amount = interaction.options.getNumber("valor", true), delta = subcommand === "adicionar" ? amount : -amount;
    adjustBalance(db, country.id, guildId, interaction.user.id, delta, `admin_${subcommand}`, reason);
    await reply(interaction, `${subcommand === "adicionar" ? "Adicionados" : "Removidos"} ${formatNumber(amount, 2)} em ${country.name}. Motivo: ${reason}`);
  },

  rendimento: async (interaction, db) => {
    const guildId = id(interaction);
    requireNarratorPermission(db, guildId, interaction.user.id, "economy", "edit");
    const country = resolveCommandCountry(db, guildId, interaction.user.id, interaction.options.getString("pais", true));
    const signedAmount = interaction.options.getNumber("valor", true);
    assertDomain(Number.isFinite(signedAmount) && signedAmount !== 0, "O valor precisa ser diferente de zero.");
    const reason = interaction.options.getString("motivo", true);
    adjustBalance(
      db,
      country.id,
      guildId,
      interaction.user.id,
      signedAmount,
      signedAmount > 0 ? "narrator_income" : "narrator_expense",
      reason,
    );
    await reply(interaction, `${signedAmount > 0 ? "Rendimento" : "Despesa"} registrado imediatamente para **${country.name}**: ${signedAmount > 0 ? "+" : "−"} ${formatNumber(Math.abs(signedAmount), 2)}. Motivo: ${reason}`);
  },

  ajuda: async (interaction) => {
    const embed = new EmbedBuilder()
      .setTitle("Manual do RP Geopolítico · Começar")
      .setDescription("O bot administra países, economia, inventário, produção e turnos anuais. Os jogadores controlam os países associados aos seus cargos. Use os botões para consultar cada sistema.")
      .addFields(
        { name: "1. Configuração inicial", value: "`/configurar principal` → `/configurar moeda` → `/pais criar` → `/jogador associar`. O Narrador Supremo pode nomear narradores com `/narrador adicionar`." },
        { name: "2. Rotina do jogador", value: "`/pais geral` → `/saldo` → `/inventario painel` → produzir, gastar e negociar. Consulte o estado do país antes de cada fechamento anual." },
        { name: "3. Rotina do narrador", value: "Configure população, efetivo, consumo, produção e acordos; depois execute `/ano avancar`. Use `/ano desfazer` somente se não houve alterações posteriores." },
      )
      .setFooter({ text: "Os comandos administrativos são privados; manual, rankings e painel de negociações são públicos." })
      .setColor(0x315e56);
    const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ajuda:economia").setLabel("Economia").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ajuda:inventario").setLabel("Inventário").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ajuda:populacao").setLabel("População").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ajuda:exercito").setLabel("Exército").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ajuda:negociacoes").setLabel("Negociações").setStyle(ButtonStyle.Secondary),
    );
    const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ajuda:exemplo").setLabel("Exemplo de turno").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("ajuda:narrador").setLabel("Narrador").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ajuda:inicio").setLabel("Início").setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({ embeds: [embed], components: [row1, row2], allowedMentions: { parse: [] } });
  },

  ping: async (interaction) => {
    await reply(interaction, `Pong. Latência do Gateway: ${interaction.client.ws.ping} ms.`);
  },
};

export async function handleCommand(interaction: ChatInputCommandInteraction, db: Database.Database): Promise<void> {
  const handler = handlers[interaction.commandName];
  if (!handler) throw new DomainError("Comando não reconhecido.");
  try {
    await handler(interaction, db);
  } catch (error) {
    const message = error instanceof DomainError
      ? error.message
      : "O comando falhou; nenhuma alteração parcial foi confirmada.";
    if (!(error instanceof DomainError)) {
      console.error("Slash command failed", {
        command: interaction.commandName,
        guildId: interaction.guildId,
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
    if (interaction.deferred) {
      await interaction.editReply({ content: message, allowedMentions: { parse: [] } });
    } else if (interaction.replied) {
      await interaction.followUp({ content: message, allowedMentions: { parse: [] } });
    } else {
      await interaction.editReply({ content: message, allowedMentions: { parse: [] } });
    }
  }
}
