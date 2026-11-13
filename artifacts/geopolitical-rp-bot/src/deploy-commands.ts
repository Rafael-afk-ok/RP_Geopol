import { REST, Routes } from "discord.js";
import { commandBuilders } from "./commands/definitions.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error("Secret DISCORD_BOT_TOKEN não configurado.");

const rest = new REST({ version: "10" }).setToken(token);
const application = await rest.get(Routes.oauth2CurrentApplication()) as { id: string };
const targetRoute = process.env.DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(application.id, process.env.DISCORD_GUILD_ID)
  : Routes.applicationCommands(application.id);

await rest.put(targetRoute, { body: commandBuilders });
console.info(
  process.env.DISCORD_GUILD_ID
    ? `Comandos registrados no servidor ${process.env.DISCORD_GUILD_ID}.`
    : "Comandos globais registrados. A propagação pode levar algum tempo.",
);
