import {
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
  if (interaction.isButton() && interaction.customId.startsWith("saldo_detalhes:")) {
    try {
      const [, countryIdRaw, yearRaw] = interaction.customId.split(":");
      const countryId = Number(countryIdRaw), year = Number(yearRaw);
      if (!interaction.guildId || !Number.isInteger(countryId) || !Number.isInteger(year)) return;
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
        ? rows.map((row) => `**${row.amount >= 0 ? "+" : "−"} ${Math.abs(row.amount).toLocaleString("pt-BR")}** — ${row.note}`).join("\\n").slice(0, 4000)
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
    await commandInteraction.deferReply({ flags: MessageFlags.Ephemeral });

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
