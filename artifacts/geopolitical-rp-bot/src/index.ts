import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { openDatabase, inTransaction } from "./db/index.js";
import { commandBuilders } from "./commands/definitions.js";
import { handleCommand } from "./commands/handlers.js";
import { ensureGuildSettings } from "./services/audit.js";
import { hasNarratorPermission, syncRoleMemberships } from "./services/permissions.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error("Secret DISCORD_BOT_TOKEN não configurado.");

const db = openDatabase();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async (readyClient) => {
  try {
    const guildId = process.env.DISCORD_GUILD_ID;
    if (guildId) await readyClient.application.commands.set(commandBuilders, guildId);
    else await readyClient.application.commands.set(commandBuilders);
    console.info(`Bot conectado como ${readyClient.user.tag}; comandos registrados.`);
  } catch (error) {
    console.error("Falha ao registrar comandos Discord:", error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith("ajuda:")) {
    const section = interaction.customId.slice("ajuda:".length);
    const pages: Record<string, { title: string; description: string; fields?: Array<{ name: string; value: string }> }> = {
      inicio: { title: "Manual · Começar", description: "Associe seu país pelo cargo do Discord. Use /pais geral para consultar sua situação, /saldo para finanças e /inventario painel para estoques." },
      economia: { title: "Manual · Economia", description: "Jogadores podem consultar o tesouro e registrar gastos próprios. Narradores configuram renda, inflação e ajustes administrativos.", fields: [{ name: "Comandos", value: "`/saldo` · `/gastar` · `/rendimento adicionar` · `/dinheiro` · `/ano definir`" }] },
      inventario: { title: "Manual · Inventário e produção", description: "O inventário separa recursos naturais, indústria e itens militares. Produção anual adiciona estoque; consumo anual remove apenas o que existe. Estoque nunca fica negativo.", fields: [{ name: "Comandos", value: "`/inventario painel` · `/inventario criar-item` · `/inventario producao-anual` · `/produzir`" }] },
      populacao: { title: "Manual · População e abastecimento", description: "O narrador define crescimento e consumo por habitante e por item. Configure padrões com /consumo global: novos países herdam essas regras automaticamente. Use /consumo configurar para personalizar um país; alterações globais não sobrescrevem países já existentes. No fechamento anual, o bot calcula a necessidade, desconta o estoque disponível e aumenta a revolta proporcionalmente à escassez.", fields: [{ name: "Comandos", value: "`/populacao definir` · `/consumo global` · `/consumo configurar` · `/configurar populacao`" }] },
      exercito: { title: "Manual · Exército", description: "Defina o efetivo, configure consumo por soldado e atribua equipamentos. Equipamentos são duráveis: atribuí-los não destrói o item. A soma de soldados equipados não pode exceder o efetivo.", fields: [{ name: "Comandos", value: "`/exercito definir` · `/exercito equipamento` · `/exercito consultar` · `/consumo configurar`" }] },
      negociacoes: { title: "Manual · Negociações anuais", description: "Jogadores podem criar acordos recorrentes de dinheiro ou recursos entre seus países. Duração 0 significa acordo indefinido. Os participantes podem editar ou cancelar os acordos. A transferência ocorre no fechamento anual e só é aplicada se houver saldo ou estoque suficiente.", fields: [{ name: "Comandos", value: "`/negociacao criar` · `/negociacao painel` · `/negociacao editar` · `/negociacao cancelar`" }] },
      exemplo: { title: "Manual · Exemplo de turno", description: "1. O jogador consulta `/pais geral`. 2. Confere `/saldo` e `/inventario painel`. 3. Registra gastos com `/gastar`. 4. Cria um acordo com `/negociacao criar`. 5. O narrador confere consumo, produção e efetivo. 6. O narrador executa `/ano avancar`. 7. Todos consultam novamente a visão geral e os rankings." },
      narrador: { title: "Manual · Narrador", description: "O Narrador Supremo configura o servidor e nomeia narradores. Narradores definem ano, crescimento populacional, efetivo, padrões globais de consumo herdados por novos países, ajustes individuais, produção e regras econômicas. Use /ano desfazer apenas se o estado não tiver sido alterado depois do processamento.", fields: [{ name: "Comandos administrativos", value: "`/configurar` · `/pais criar` · `/consumo global` · `/consumo configurar` · `/exercito definir` · `/ano definir` · `/ano avancar`" }] },
    };
    const page = pages[section] ?? pages.inicio!;
    const embed = new EmbedBuilder().setTitle(page.title).setDescription(page.description).setColor(0x315e56);
    if (page.fields) embed.addFields(page.fields);
    await interaction.update({ embeds: [embed], allowedMentions: { parse: [] } });
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith("inventario_pagina:")) {
    try {
      const [, countryIdRaw, categoryKey] = interaction.customId.split(":");
      const countryId = Number(countryIdRaw);
      if (!interaction.guildId || !Number.isInteger(countryId)) return;
      const buttonMember = interaction.member;
      const buttonRoleIds = buttonMember && "roles" in buttonMember
        ? Array.isArray(buttonMember.roles) ? buttonMember.roles : [...buttonMember.roles.cache.keys()]
        : [];
      inTransaction(db, () => syncRoleMemberships(db, interaction.guildId!, interaction.user.id, buttonRoleIds));
      const allowed = hasNarratorPermission(db, interaction.guildId, interaction.user.id, "inventory", "read") ||
        db.prepare("SELECT 1 FROM country_memberships WHERE country_id = ? AND user_id = ?").get(countryId, interaction.user.id) !== undefined;
      if (!allowed) {
        await interaction.reply({ content: "Você não tem acesso a este país.", flags: MessageFlags.Ephemeral });
        return;
      }
      const country = db.prepare("SELECT name FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'").get(countryId, interaction.guildId) as { name: string } | undefined;
      if (!country) {
        await interaction.reply({ content: "País não encontrado.", flags: MessageFlags.Ephemeral });
        return;
      }
      const categoryName = categoryKey === "resources" ? "Recursos naturais" : categoryKey === "industry" ? "Indústria e bens" : categoryKey === "military" ? "Militar" : null;
      if (!categoryName) {
        await interaction.reply({ content: "Categoria inválida.", flags: MessageFlags.Ephemeral });
        return;
      }
      const rows = db.prepare(
        `SELECT i.name, COALESCE(v.quantity, 0) AS quantity,
          COALESCE(p.annual_production, 0) AS annual_production,
          COALESCE(p.annual_consumption, 0) AS annual_consumption,
          json_extract(i.properties_json, '$.unit') AS unit
         FROM items i
         LEFT JOIN country_inventory v ON v.item_id = i.id AND v.country_id = ?
         LEFT JOIN country_production p ON p.item_id = i.id AND p.country_id = ?
         LEFT JOIN custom_item_categories cc ON cc.id = i.custom_category_id
         WHERE i.guild_id = ? AND
           CASE WHEN i.category = 'military' THEN 'Militar'
                WHEN cc.name = 'Recursos naturais' THEN 'Recursos naturais'
                ELSE 'Indústria e bens' END = ?
         ORDER BY i.name COLLATE NOCASE`,
      ).all(countryId, countryId, interaction.guildId, categoryName) as Array<{ name: string; quantity: number; annual_production: number; annual_consumption: number; unit: string | null }>;
      const description = rows.length ? rows.map((row) => {
        const net = row.annual_production - row.annual_consumption;
        return `**${row.name}**\nEstoque: ${row.quantity.toLocaleString("pt-BR")} ${row.unit ?? ""} · Produção anual: ${row.annual_production.toLocaleString("pt-BR")} · Consumo anual: ${row.annual_consumption.toLocaleString("pt-BR")} · Variação: ${net >= 0 ? "+" : ""}${net.toLocaleString("pt-BR")}`;
      }).join("\n\n").slice(0, 3900) : "Nenhum item nesta categoria.";
      const embed = new EmbedBuilder().setTitle(`Inventário nacional · ${country.name}`).setDescription(description).setFooter({ text: `Categoria: ${categoryName}` }).setColor(0x315e56);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`inventario_pagina:${countryId}:resources`).setLabel("Recursos naturais").setStyle(categoryKey === "resources" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`inventario_pagina:${countryId}:industry`).setLabel("Indústria e bens").setStyle(categoryKey === "industry" ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`inventario_pagina:${countryId}:military`).setLabel("Militar").setStyle(categoryKey === "military" ? ButtonStyle.Primary : ButtonStyle.Secondary),
      );
      await interaction.update({ embeds: [embed], components: [row], allowedMentions: { parse: [] } });
    } catch (error) {
      console.error("Falha ao abrir categoria do inventário", error);
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: "Não foi possível abrir esta categoria.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  if (interaction.isButton() && interaction.customId.startsWith("saldo_detalhes:")) {
    try {
      const [, countryIdRaw, yearRaw] = interaction.customId.split(":");
      const countryId = Number(countryIdRaw), year = Number(yearRaw);
      if (!interaction.guildId || !Number.isInteger(countryId) || !Number.isInteger(year)) return;
      const buttonMember = interaction.member;
      const buttonRoleIds = buttonMember && "roles" in buttonMember
        ? Array.isArray(buttonMember.roles) ? buttonMember.roles : [...buttonMember.roles.cache.keys()]
        : [];
      inTransaction(db, () => syncRoleMemberships(db, interaction.guildId!, interaction.user.id, buttonRoleIds));
      const allowed = hasNarratorPermission(db, interaction.guildId, interaction.user.id, "countries", "read") ||
        db.prepare("SELECT 1 FROM country_memberships WHERE country_id = ? AND user_id = ?").get(countryId, interaction.user.id) !== undefined;
      if (!allowed) {
        await interaction.reply({ content: "Você não tem acesso a este país.", flags: MessageFlags.Ephemeral });
        return;
      }
      const country = db.prepare("SELECT name FROM countries WHERE id = ? AND guild_id = ? AND status = 'active'").get(countryId, interaction.guildId) as { name: string } | undefined;
      if (!country) {
        await interaction.reply({ content: "País não encontrado.", flags: MessageFlags.Ephemeral });
        return;
      }
      const rows = db.prepare("SELECT amount, note FROM financial_ledger WHERE guild_id = ? AND country_id = ? AND year = ? ORDER BY rowid DESC LIMIT 25").all(interaction.guildId, countryId, year) as Array<{ amount: number; note: string }>;
      const description = rows.length
        ? rows.map((row) => `**${row.amount >= 0 ? "+" : "−"} ${Math.abs(row.amount).toLocaleString("pt-BR")}** — ${row.note}`).join("\n").slice(0, 4000)
        : "Nenhuma movimentação financeira registrada neste ano.";
      const embed = new EmbedBuilder().setTitle(`Detalhamento financeiro · ${country.name}`).setDescription(description).setFooter({ text: `Ano ${year} · até 25 movimentações mais recentes` }).setColor(0x315e56);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error("Falha ao abrir detalhamento financeiro", error);
      if (!interaction.replied) await interaction.reply({ content: "Não foi possível abrir o detalhamento.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const commandInteraction: ChatInputCommandInteraction = interaction;

  try {
    // Acknowledge immediately: Discord invalidates unacknowledged interactions after 3 seconds.
    const isPublicCommand = commandInteraction.commandName === "ajuda" ||
      commandInteraction.commandName === "ranking" ||
      (commandInteraction.commandName === "negociacao" && commandInteraction.options.getSubcommand() === "painel") ||
      (commandInteraction.commandName === "pais" && commandInteraction.options.getSubcommand() === "geral") ||
      (commandInteraction.commandName === "mercado" && ["catalogo", "painel"].includes(commandInteraction.options.getSubcommand())) ||
      (commandInteraction.commandName === "ano" && commandInteraction.options.getSubcommand() === "avancar");
    await commandInteraction.deferReply(isPublicCommand ? {} : { flags: MessageFlags.Ephemeral });

    if (!commandInteraction.guildId) {
      await commandInteraction.editReply({
        content: "Este bot funciona somente dentro de um servidor Discord.",
      });
      return;
    }

    const member = commandInteraction.member;
    const roleIds = member && "roles" in member
      ? Array.isArray(member.roles)
        ? member.roles
        : [...member.roles.cache.keys()]
      : [];
    inTransaction(db, () => {
      ensureGuildSettings(db, commandInteraction.guildId!);
      syncRoleMemberships(db, commandInteraction.guildId!, commandInteraction.user.id, roleIds);
    });
    await handleCommand(commandInteraction, db);
  } catch (error) {
    console.error("Falha ao preparar interação Discord", {
      command: commandInteraction.commandName,
      guildId: commandInteraction.guildId,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
      code: typeof error === "object" && error !== null && "code" in error ? error.code : undefined,
    });
    if (commandInteraction.deferred || commandInteraction.replied) {
      await commandInteraction.editReply({
        content: "Não foi possível processar a solicitação.",
        allowedMentions: { parse: [] },
      }).catch(() => undefined);
    } else {
      await commandInteraction.reply({
        content: "Não foi possível processar a solicitação.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => undefined);
    }
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error", { name: error.name });
});

const shutdown = async () => {
  client.destroy();
  db.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await client.login(token);
