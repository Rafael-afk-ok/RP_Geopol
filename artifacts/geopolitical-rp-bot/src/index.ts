import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { openDatabase, inTransaction } from "./db/index.js";
import { commandBuilders } from "./commands/definitions.js";
import { handleCommand } from "./commands/handlers.js";
import { ensureGuildSettings } from "./services/audit.js";
import { syncRoleMemberships } from "./services/permissions.js";

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
    console.error("Falha ao registrar comandos Discord", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const commandInteraction: ChatInputCommandInteraction = interaction;
  if (!commandInteraction.guildId) {
    await commandInteraction.reply({
      content: "Este bot funciona somente dentro de um servidor Discord.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
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
    });
    const response = {
      content: "Não foi possível processar a solicitação.",
      flags: MessageFlags.Ephemeral as const,
    };
    if (commandInteraction.replied || commandInteraction.deferred) {
      await commandInteraction.followUp(response).catch(() => undefined);
    } else {
      await commandInteraction.reply(response).catch(() => undefined);
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
