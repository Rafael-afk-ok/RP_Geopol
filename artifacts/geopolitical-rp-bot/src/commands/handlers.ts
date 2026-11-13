import {
  EmbedBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import type Database from "better-sqlite3";
import { assertDomain, DomainError } from "../domain/errors.js";
import { audit } from "../services/audit.js";
import { processAnnualTurn, undoAnnualTurn, listAnnualRuns } from "../services/annual.js";
import { addEconomyEntry, configureCountryEconomy, configureInflation, issueInflation, repayInflation, transferBetweenCountries } from "../services/economy.js";
import { archiveCountry, createCountry, getAccessibleCountry, listAccessibleCountries, listNarratedCountries } from "../services/countries.js";
import { createIndicator, createIndicatorCategory, listIndicators, setIndicatorValue } from "../services/indicators.js";
import { adjustInventory, addItemRequirement, defineItem, listCountryInventory, setCountryProduction, setGlobalStock } from "../services/inventory.js";
import { buyPlayerOffer, cancelPlayerOffer, configureCurrency, createPlayerOffer, listOffers, setMarketSettings, tradeGlobalMarket } from "../services/market.js";
import { configurePopulation, configurePopulationRules, getPopulation } from "../services/population.js";
import { associatePlayer, bootstrapMainNarrator, grantNarratorPermission, hasNarratorPermission, removePlayer, requireCountryOrNarratorPermission, requireCountryPermission, requireNarratorPermission, revokeNarratorPermission, setCountryPermission } from "../services/permissions.js";
import { cancelProduction, listProductionQueue, startProduction } from "../services/production.js";
import { validNarratorPermission } from "./definitions.js";

type Handler = (interaction: ChatInputCommandInteraction, db: Database.Database) => Promise<void>;

function id(interaction: ChatInputCommandInteraction): string {
  assertDomain(interaction.guildId, "Este comando só pode ser usado em um servidor Discord.");
  return interaction.guildId;
}

function countryNumber(interaction: ChatInputCommandInteraction, name = "pais_id"): number {
  return interaction.options.getInteger(name, true);
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
    .setDescription(rows.length ? rows.map((row) => `**${row.name}** — ID \`${row.id}\``).join("\n") : "Nenhum país disponível.")
    .setColor(0x315e56);
}

async function reply(interaction: ChatInputCommandInteraction, content: string, ephemeral = true): Promise<void> {
  await interaction.reply({
    content: content.slice(0, 1900),
    flags: ephemeral ? MessageFlags.Ephemeral : undefined,
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

function formatNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: decimals }).format(value);
}

const handlers: Record<string, Handler> = {
  configurar: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "principal") {
      assertDomain(interaction.guild, "Servidor não encontrado.");
      bootstrapMainNarrator(db, guildId, interaction.user.id, interaction.guild.ownerId);
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
      const countryId = createCountry(
        db,
        guildId,
        interaction.user.id,
        interaction.options.getString("nome", true),
        role.id,
      );
      await reply(interaction, `País criado. ID interno: **${countryId}**. Jogadores com o cargo serão associados automaticamente ao usar o bot.`);
      return;
    }
    if (subcommand === "arquivar") {
      const countryId = countryNumber(interaction);
      archiveCountry(db, guildId, interaction.user.id, countryId);
      await reply(interaction, `País ${countryId} arquivado.`);
      return;
    }
    if (subcommand === "listar") {
      const countries = hasNarratorPermission(db, guildId, interaction.user.id, "countries", "read")
        ? listNarratedCountries(db, guildId, interaction.user.id)
        : listAccessibleCountries(db, guildId, interaction.user.id);
      await interaction.reply({ embeds: [userCountriesEmbed("Países acessíveis", countries)], flags: MessageFlags.Ephemeral });
      return;
    }
    const countryId = countryNumber(interaction);
    const country = getCountryForView(db, guildId, interaction.user.id, countryId);
    const settings = db.prepare("SELECT currency_symbol, current_year FROM guild_settings WHERE guild_id = ?").get(guildId) as
      | { currency_symbol: string; current_year: number }
      | undefined;
    const embed = new EmbedBuilder()
      .setTitle(country.name)
      .setDescription(`ID interno: ${country.id} · Ano atual: ${settings?.current_year ?? 0}`)
      .addFields(
        { name: "Tesouro", value: `${formatNumber(country.treasury, 2)} ${settings?.currency_symbol ?? ""}`, inline: true },
        { name: "Renda anual", value: `${formatNumber(country.annual_income, 2)} ${settings?.currency_symbol ?? ""}`, inline: true },
        { name: "População", value: formatNumber(country.population, 0), inline: true },
        { name: "Contador de revolta", value: formatNumber(country.revolt_counter, 2), inline: true },
        { name: "Inflação acumulada", value: formatNumber(country.inflation_issued, 2), inline: true },
        { name: "Cargo associado", value: `<@&${country.role_id}>`, inline: true },
      )
      .setColor(0x315e56);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },

  jogador: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "meus-paises") {
      await interaction.reply({
        embeds: [userCountriesEmbed("Seus países", listAccessibleCountries(db, guildId, interaction.user.id))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const countryId = countryNumber(interaction);
    const target = interaction.options.getUser("jogador", true);
    if (!playerCanManageCountry(db, guildId, interaction.user.id, countryId)) {
      throw new DomainError("Você não tem permissão para gerenciar jogadores neste país.");
    }
    if (subcommand === "associar") {
      associatePlayer(db, guildId, countryId, interaction.user.id, target.id);
      await reply(interaction, `<@${target.id}> foi associado ao país ${countryId}.`);
    } else {
      requireNarratorPermission(db, guildId, interaction.user.id, "players", "manage");
      removePlayer(db, guildId, countryId, interaction.user.id, target.id);
      await reply(interaction, `<@${target.id}> foi removido do país ${countryId}.`);
    }
  },

  permissao: async (interaction, db) => {
    const guildId = id(interaction);
    if (interaction.options.getSubcommand() === "narrador") {
      const target = interaction.options.getUser("jogador", true);
      const system = interaction.options.getString("sistema", true);
      const action = interaction.options.getString("acao", true);
      assertDomain(validNarratorPermission(system, action), "Esta ação não existe para o sistema escolhido.");
      if (interaction.options.getBoolean("permitir", true)) {
        grantNarratorPermission(db, guildId, interaction.user.id, target.id, system, action);
        await reply(interaction, `Permissão **${system}/${action}** concedida a <@${target.id}>.`);
      } else {
        revokeNarratorPermission(db, guildId, interaction.user.id, target.id, system, action);
        await reply(interaction, `Permissão **${system}/${action}** revogada de <@${target.id}>.`);
      }
      return;
    }
    const countryId = countryNumber(interaction);
    assertDomain(
      playerCanManageCountry(db, guildId, interaction.user.id, countryId),
      "Você não pode alterar permissões de jogadores neste país.",
    );
    const target = interaction.options.getUser("alvo", true);
    const system = interaction.options.getString("sistema", true) as Parameters<typeof setCountryPermission>[4];
    const action = interaction.options.getString("acao", true);
    const allowed = interaction.options.getBoolean("permitir", true);
    setCountryPermission(db, countryId, interaction.user.id, target.id, system, action, allowed);
    await reply(interaction, `Permissão **${system}/${action}** ${allowed ? "concedida" : "revogada"} para <@${target.id}> no país ${countryId}.`);
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
        countryNumber(interaction),
        indicatorId,
        jsonValue(interaction.options.getString("valor", true)),
      );
      await reply(interaction, "Indicador atualizado.");
      return;
    }
    const countryId = countryNumber(interaction);
    const rows = listIndicators(db, guildId, interaction.user.id, countryId);
    const embed = new EmbedBuilder()
      .setTitle(`Indicadores do país ${countryId}`)
      .setDescription(rows.length
        ? rows.map((row) => `**${row.category} · ${row.name}** (${row.data_type})\n${String(row.value ?? "—")}${row.description ? `\n${row.description}` : ""}`).join("\n\n").slice(0, 4000)
        : "Nenhum indicador foi configurado.")
      .setColor(0x315e56);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  economia: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
    const countryId = countryNumber(interaction);
    if (subcommand === "configurar") {
      configureCountryEconomy(db, guildId, interaction.user.id, countryId, {
        maxMoney: interaction.options.getNumber("limite_saldo"),
        debtLimit: interaction.options.getNumber("limite_divida", true),
        annualIncome: interaction.options.getNumber("renda_anual", true),
      });
      await reply(interaction, `Limites e rendimento anual do país ${countryId} atualizados.`);
      return;
    }
    if (subcommand === "lancar") {
      const settings = db.prepare("SELECT current_year FROM guild_settings WHERE guild_id = ?").get(guildId) as
        | { current_year: number }
        | undefined;
      const dueYear = interaction.options.getInteger("ano") ?? (settings?.current_year ?? 0) + 1;
      const entryId = addEconomyEntry(
        db,
        guildId,
        interaction.user.id,
        countryId,
        interaction.options.getString("tipo", true) as "income" | "expense",
        interaction.options.getNumber("valor", true),
        interaction.options.getString("descricao", true),
        interaction.options.getString("frequencia", true) as "recurring" | "one_time",
        dueYear,
        interaction.id,
      );
      await reply(interaction, `Lançamento financeiro #${entryId} registrado para o ano ${dueYear}.`);
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
      interaction.options.getInteger("origem", true),
      interaction.options.getInteger("destino", true),
      interaction.options.getNumber("valor", true),
      interaction.options.getString("descricao") ?? "Transferência entre países",
      interaction.id,
    );
    await reply(interaction, `Transferência atômica concluída. Referência: \`${transactionId.slice(0, 8)}\`.`);
  },

  inventario: async (interaction, db) => {
    const guildId = id(interaction);
    const subcommand = interaction.options.getSubcommand();
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
        description: interaction.options.getString("descricao") ?? "",
        properties,
        productionCost: interaction.options.getNumber("custo", true),
        annualMaintenance: interaction.options.getNumber("manutencao", true),
        productionYears: interaction.options.getInteger("duracao_anos", true),
        maxParallelOrders: interaction.options.getInteger("filas_simultaneas", true),
        isFood: interaction.options.getBoolean("alimento", true),
        globalTradeable: interaction.options.getBoolean("mercado_global", true),
      });
      await reply(interaction, `Item criado. ID: **${itemId}**.`);
      return;
    }
    if (subcommand === "ajustar") {
      adjustInventory(db, guildId, interaction.user.id, countryNumber(interaction), interaction.options.getInteger("item_id", true),
        interaction.options.getNumber("variacao", true), interaction.options.getString("motivo", true));
      await reply(interaction, "Estoque atualizado.");
      return;
    }
    if (subcommand === "producao-anual") {
      setCountryProduction(
        db,
        guildId,
        interaction.user.id,
        countryNumber(interaction),
        interaction.options.getInteger("item_id", true),
        interaction.options.getNumber("produz", true),
        interaction.options.getNumber("consome", true),
      );
      await reply(interaction, "Produção e consumo anual atualizados.");
      return;
    }
    if (subcommand === "requisito") {
      addItemRequirement(
        db,
        guildId,
        interaction.user.id,
        interaction.options.getInteger("produto_id", true),
        interaction.options.getInteger("material_id", true),
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
        interaction.options.getInteger("item_id", true),
        interaction.options.getNumber("estoque", true),
        interaction.options.getNumber("preco", true),
        interaction.options.getNumber("preco_minimo", true),
        interaction.options.getNumber("preco_maximo", true),
      );
      await reply(interaction, "Estoque e preços globais atualizados.");
      return;
    }
    const rows = listCountryInventory(db, guildId, interaction.user.id, countryNumber(interaction));
    const embed = new EmbedBuilder()
      .setTitle(`Inventário do país ${countryNumber(interaction)}`)
      .setDescription(rows.length
        ? rows.map((row) => `**${row.name}** · ${row.category}: ${formatNumber(row.quantity, 2)}${row.unit ? ` ${row.unit}` : ""} (ID ${row.id})`).join("\n").slice(0, 4000)
        : "Nenhum item configurado.")
      .setColor(0x315e56);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  produzir: async (interaction, db) => {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "iniciar") {
      const result = startProduction(
        db,
        id(interaction),
        interaction.user.id,
        countryNumber(interaction),
        interaction.options.getInteger("item_id", true),
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
    const countryId = countryNumber(interaction);
    const rows = listProductionQueue(db, id(interaction), interaction.user.id, countryId);
    const embed = new EmbedBuilder()
      .setTitle(`Fila de produção · país ${countryId}`)
      .setDescription(rows.length
        ? rows.map((row) => `**${row.item}** × ${formatNumber(row.quantity, 2)} · ${row.status === "in_progress" ? `${row.remaining_years} ano(s) restante(s)` : row.status} · \`${row.id.slice(0, 8)}\``).join("\n").slice(0, 4000)
        : "Nenhum pedido de produção.")
      .setColor(0x315e56);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
    if (subcommand === "ofertar") {
      const offerId = createPlayerOffer(
        db,
        guildId,
        interaction.user.id,
        countryNumber(interaction),
        interaction.options.getInteger("item_id", true),
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
        countryNumber(interaction),
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
        countryNumber(interaction),
        interaction.options.getInteger("item_id", true),
        subcommand === "global-comprar" ? "buy" : "sell",
        interaction.options.getNumber("quantidade", true),
        interaction.id,
      );
      await reply(interaction, `${subcommand === "global-comprar" ? "Compra" : "Venda"} global concluída. Preço unitário ${formatNumber(result.unitPrice, 2)} · total ${formatNumber(result.total, 2)}.`);
      return;
    }
    const offers = listOffers(db, guildId);
    const stock = db.prepare(
      `SELECT i.id, i.name, g.quantity, g.current_price, g.min_price, g.max_price
       FROM global_stock g JOIN items i ON i.id = g.item_id WHERE g.guild_id = ? ORDER BY i.name`,
    ).all(guildId) as Array<{ id: number; name: string; quantity: number; current_price: number; min_price: number; max_price: number }>;
    const embed = new EmbedBuilder()
      .setTitle("Mercado")
      .addFields(
        { name: "Ofertas entre países", value: offers.length
          ? offers.slice(0, 10).map((offer) => `\`${offer.id.slice(0, 8)}\` · ${offer.item} × ${formatNumber(offer.remaining_quantity, 2)} · ${formatNumber(offer.unit_price, 2)} ${offer.currency_symbol} · expira no ano ${offer.expires_year}`).join("\n").slice(0, 1000)
          : "Nenhuma oferta aberta." },
        { name: "Mercado global", value: stock.length
          ? stock.slice(0, 10).map((item) => `**${item.name}** (ID ${item.id}) · estoque ${formatNumber(item.quantity, 2)} · preço ${formatNumber(item.current_price, 2)} [${formatNumber(item.min_price, 2)}–${formatNumber(item.max_price, 2)}]`).join("\n").slice(0, 1000)
          : "Nenhum produto global configurado." },
      )
      .setColor(0x315e56);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  populacao: async (interaction, db) => {
    const guildId = id(interaction);
    if (interaction.options.getSubcommand() === "definir") {
      configurePopulation(db, guildId, interaction.user.id, countryNumber(interaction), {
        population: interaction.options.getNumber("populacao", true),
        annualGrowthPercent: interaction.options.getNumber("crescimento_percentual", true),
        foodPerPerson: interaction.options.getNumber("alimento_por_pessoa", true),
        revoltCounter: interaction.options.getNumber("contador_revolta", true),
      });
      await reply(interaction, "População, crescimento e contador de revolta atualizados.");
      return;
    }
    const countryId = countryNumber(interaction);
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
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  ano: async (interaction, db) => {
    const guildId = id(interaction);
    if (interaction.options.getSubcommand() === "avancar") {
      const result = processAnnualTurn(db, guildId, interaction.user.id, interaction.id);
      await reply(
        interaction,
        `Ano **${result.year}** processado atomicamente.\nPaíses: ${result.summary.countries} · Receitas: ${formatNumber(result.summary.revenue, 2)} · Despesas: ${formatNumber(result.summary.expenses, 2)} · Produções concluídas: ${result.summary.completedOrders} · Déficit alimentar: ${formatNumber(result.summary.foodDeficit, 2)} · Ofertas expiradas: ${result.summary.expiredOffers}\nRegistro: \`${result.runId}\``,
      );
      return;
    }
    const result = undoAnnualTurn(db, guildId, interaction.user.id, interaction.id);
    await reply(interaction, `Ano ${result.year} desfeito. O estado anterior foi restaurado; registros e reversões financeiras foram preservados.`);
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
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    const countryId = countryNumber(interaction);
    requireCountryOrNarratorPermission(db, guildId, countryId, interaction.user.id, "economy", "read");
    const page = interaction.options.getInteger("pagina") ?? 1;
    const rows = db.prepare(
      `SELECT year, kind, amount, note, actor_id, created_at FROM financial_ledger
       WHERE guild_id = ? AND country_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 10 OFFSET ?`,
    ).all(guildId, countryId, (page - 1) * 10) as Array<{ year: number; kind: string; amount: number; note: string; actor_id: string; created_at: string }>;
    const embed = new EmbedBuilder()
      .setTitle(`Extrato · país ${countryId} · página ${page}`)
      .setDescription(rows.length
        ? rows.map((row) => `Ano ${row.year} · ${row.amount >= 0 ? "+" : ""}${formatNumber(row.amount, 2)} · ${row.kind} · <@${row.actor_id}>\n${row.note}`).join("\n\n").slice(0, 4000)
        : "Nenhum lançamento financeiro.")
      .setColor(0x315e56);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },

  ajuda: async (interaction) => {
    const embed = new EmbedBuilder()
      .setTitle("Bot de RP Geopolítico")
      .setDescription("Use `/configurar principal` como dono do servidor para iniciar. Depois, configure a moeda, crie países e associe cargos do Discord. Países são privados; administradores podem delegar permissões por sistema e ação.")
      .addFields(
        { name: "Países e jogadores", value: "`/pais` · `/jogador` · `/permissao`" },
        { name: "Economia e itens", value: "`/economia` · `/transferir` · `/inventario` · `/produzir`" },
        { name: "Mercado e população", value: "`/mercado` · `/populacao` · `/indicador`" },
        { name: "Turnos e registros", value: "`/ano avancar` · `/ano desfazer` · `/historico`" },
      )
      .setFooter({ text: "Desfazer um ano é bloqueado se o estado do jogo tiver mudado depois dele." })
      .setColor(0x315e56);
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }
  }
}
