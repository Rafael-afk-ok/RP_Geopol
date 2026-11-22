import {
  EmbedBuilder,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type Database from "better-sqlite3";
import { DomainError, assertDomain } from "../domain/errors.js";
import { ensureGuildSettings, audit } from "../services/audit.js";
import { createCountry, listAccessibleCountries, listNarratedCountries } from "../services/countries.js";
import { adjustBalance, configureCountryEconomy } from "../services/economy.js";
import { adjustInventory, defineItem, listCountryInventory, setCountryProduction, type ItemInput } from "../services/inventory.js";
import {
  associatePlayer, bootstrapMainNarrator, grantNarratorPermission, isMainNarrator,
  removePlayer, revokeNarratorPermission, hasNarratorPermission,
} from "../services/permissions.js";

type Handler = (i: ChatInputCommandInteraction, db: Database.Database) => Promise<void>;
const guildId = (i: ChatInputCommandInteraction) => {
  assertDomain(i.guildId, "Use este comando dentro de um servidor.");
  return i.guildId;
};
const narrator = (db: Database.Database, i: ChatInputCommandInteraction, system: string, action: string) =>
  assertDomain(hasNarratorPermission(db, guildId(i), i.user.id, system, action), "Somente narradores podem executar esta ação.");
const countryByName = (db: Database.Database, i: ChatInputCommandInteraction, name: string) => {
  const g = guildId(i);
  const canSeeAll = hasNarratorPermission(db, g, i.user.id, "countries", "read");
  const row = canSeeAll
    ? db.prepare("SELECT id,name,treasury,annual_income,debt_limit FROM countries WHERE guild_id=? AND status='active' AND lower(name)=lower(?)").get(g,name)
    : db.prepare("SELECT c.id,c.name,c.treasury,c.annual_income,c.debt_limit FROM countries c JOIN country_memberships m ON m.country_id=c.id WHERE c.guild_id=? AND c.status='active' AND lower(c.name)=lower(?) AND m.user_id=?").get(g,name,i.user.id);
  assertDomain(row, "Nação não encontrada ou sem acesso.");
  return row as {id:number;name:string;treasury:number;annual_income:number;debt_limit:number};
};
const ownCountry = (db: Database.Database, i: ChatInputCommandInteraction, name?: string) => {
  if (name) return countryByName(db,i,name);
  const rows = listAccessibleCountries(db,guildId(i),i.user.id);
  assertDomain(rows.length>0,"Você não está associado a uma nação.");
  assertDomain(rows.length===1,"Você está associado a mais de uma nação. Informe o parâmetro pais.");
  const c=rows[0]!;
  return {id:c.id,name:c.name,treasury:c.treasury,annual_income:c.annual_income,debt_limit:c.debt_limit};
};
const itemByName = (db: Database.Database, i: ChatInputCommandInteraction, name: string) => {
  const row=db.prepare("SELECT id FROM items WHERE guild_id=? AND lower(name)=lower(?)").get(guildId(i),name) as {id:number}|undefined;
  assertDomain(row,"Recurso não encontrado.");
  return row.id;
};
const fmt=(n:number)=>new Intl.NumberFormat("pt-BR",{maximumFractionDigits:2}).format(n);
const handlers: Record<string,Handler> = {
  configurar: async(i,db)=>{
    assertDomain(i.options.getSubcommand()==="principal" && i.guild,"Subcomando inválido.");
    bootstrapMainNarrator(db,guildId(i),i.user.id,i.guild.ownerId,i.memberPermissions?.has(PermissionFlagsBits.Administrator)??false);
    await i.editReply("Narrador Supremo configurado.");
  },
  narrador: async(i,db)=>{
    assertDomain(isMainNarrator(db,guildId(i),i.user.id),"Somente o Narrador Supremo pode gerenciar narradores.");
    const target=i.options.getUser("jogador",true);
    if(i.options.getSubcommand()==="adicionar"){
      grantNarratorPermission(db,guildId(i),i.user.id,target.id,"*","*");
      await i.editReply(`<@${target.id}> agora é narrador e possui acesso administrativo completo.`);
    } else {
      revokeNarratorPermission(db,guildId(i),i.user.id,target.id,"*","*");
      await i.editReply(`Permissões de narrador removidas de <@${target.id}>.`);
    }
  },
  pais: async(i,db)=>{
    const g=guildId(i), sub=i.options.getSubcommand();
    if(sub==="criar"){
      narrator(db,i,"countries","create");
      const name=i.options.getString("nome",true), role=i.options.getRole("cargo",true);
      createCountry(db,g,i.user.id,name,role.id);
      await i.editReply(`Nação **${name}** criada e vinculada ao cargo ${role}.`);
    } else if(sub==="listar"){
      const rows=hasNarratorPermission(db,g,i.user.id,"countries","read")?listNarratedCountries(db,g,i.user.id):listAccessibleCountries(db,g,i.user.id);
      await i.editReply(rows.length?rows.map(c=>`• **${c.name}**`).join("\n"):"Nenhuma nação encontrada.");
    } else {
      const c=countryByName(db,i,i.options.getString("pais",true));
      await i.editReply(`**${c.name}**\nTesouro: ${fmt(c.treasury)}\nRenda anual: ${fmt(c.annual_income)}\nLimite de dívida: ${fmt(c.debt_limit)}`);
    }
  },
  jogador: async(i,db)=>{
    const g=guildId(i),sub=i.options.getSubcommand();
    if(sub==="meus-paises"){
      const rows=listAccessibleCountries(db,g,i.user.id);
      await i.editReply(rows.length?rows.map(c=>`• **${c.name}**`).join("\n"):"Você não está associado a nenhuma nação.");
      return;
    }
    const c=countryByName(db,i,i.options.getString("pais",true));
    narrator(db,i,"players","manage");
    const target=i.options.getUser("jogador",true);
    if(sub==="associar"){associatePlayer(db,g,c.id,i.user.id,target.id);await i.editReply(`<@${target.id}> associado a **${c.name}**.`);}
    else {removePlayer(db,g,c.id,i.user.id,target.id);await i.editReply(`Associação de <@${target.id}> com **${c.name}** removida.`);}
  },
  inventario: async(i,db)=>{
    const g=guildId(i),sub=i.options.getSubcommand();
    if(sub==="criar-item"){
      narrator(db,i,"inventory","create");
      const name=i.options.getString("nome",true),category=i.options.getString("categoria",true) as "common"|"military";
      const unit=i.options.getString("unidade",true);
      const input:ItemInput={name,category,description:"",properties:{unit},productionCost:0,annualMaintenance:0,productionYears:0,maxParallelOrders:1,isFood:false,globalTradeable:false};
      defineItem(db,g,i.user.id,input);
      await i.editReply(`Recurso **${name}** cadastrado.`);
    } else if(sub==="painel"){
      const c=ownCountry(db,i,i.options.getString("pais")??undefined);
      const rows=listCountryInventory(db,g,i.user.id,c.id);
      const lines=rows.map(r=>`**${r.name}** — estoque: ${fmt(r.quantity)} ${r.unit??""} · produção anual: +${fmt(r.annual_production)} · consumo anual: −${fmt(r.annual_consumption)} · saldo projetado: ${fmt(r.annual_production-r.annual_consumption)}`);
      const embed=new EmbedBuilder().setTitle(`Inventário · ${c.name}`).setDescription(lines.join("\n").slice(0,4000)||"Nenhum recurso cadastrado.").setColor(0x315e56);
      await i.editReply({embeds:[embed]});
    } else if(sub==="ajustar"){
      narrator(db,i,"inventory","edit");
      const c=countryByName(db,i,i.options.getString("pais",true));
      const item=itemByName(db,i,i.options.getString("item",true));
      const delta=i.options.getNumber("variacao",true);
      adjustInventory(db,g,i.user.id,c.id,item,delta,i.options.getString("motivo",true));
      await i.editReply(`Estoque de **${c.name}** atualizado em ${delta>0?"+":""}${fmt(delta)}.`);
    } else {
      narrator(db,i,"production","configure");
      const c=countryByName(db,i,i.options.getString("pais",true));
      const item=itemByName(db,i,i.options.getString("item",true));
      setCountryProduction(db,g,i.user.id,c.id,item,i.options.getNumber("produz",true),i.options.getNumber("consome",true));
      await i.editReply(`Produção e consumo anuais de **${i.options.getString("item",true)}** atualizados para **${c.name}**.`);
    }
  },
  economia: async(i,db)=>{
    narrator(db,i,"economy","configure");
    const c=countryByName(db,i,i.options.getString("pais",true));
    configureCountryEconomy(db,guildId(i),i.user.id,c.id,{annualIncome:i.options.getNumber("renda_anual",true),debtLimit:i.options.getNumber("limite_divida",true),maxMoney:null});
    await i.editReply(`Parâmetros financeiros de **${c.name}** atualizados.`);
  },
  renda: async(i,db)=>{
    narrator(db,i,"economy","edit");
    const c=countryByName(db,i,i.options.getString("pais",true));
    const amount=i.options.getNumber("valor",true);
    assertDomain(amount!==0,"O valor precisa ser diferente de zero.");
    adjustBalance(db,c.id,guildId(i),i.user.id,amount,amount>0?"income":"expense",i.options.getString("motivo",true));
    await i.editReply(`${amount>0?"Rendimento":"Despesa"} registrado em **${c.name}**: ${amount>0?"+":"−"} ${fmt(Math.abs(amount))}.`);
  },
  saldo: async(i,db)=>{
    const c=ownCountry(db,i,i.options.getString("pais")??undefined);
    const settings=db.prepare("SELECT currency_name,currency_symbol,current_year FROM guild_settings WHERE guild_id=?").get(guildId(i)) as {currency_name:string;currency_symbol:string;current_year:number};
    await i.editReply(`**${c.name}**\nTesouro: **${settings.currency_symbol} ${fmt(c.treasury)}**\nRenda anual-base: ${settings.currency_symbol} ${fmt(c.annual_income)}\nLimite de dívida: ${settings.currency_symbol} ${fmt(c.debt_limit)}`);
  },
  ajuda: async(i)=>{
    await i.editReply({embeds:[new EmbedBuilder().setTitle("Bot de RP Geopolítico").setDescription("Sistemas ativos: nações, inventário, renda e narradores.\n\nConfigure o Narrador Supremo com /configurar principal. Depois crie nações com /pais criar, associe jogadores com /jogador associar, cadastre recursos com /inventario criar-item e configure saldo e renda.") ]});
  },
  ping: async(i)=>{await i.editReply(`Pong · ${i.client.ws.ping} ms`);},
};
export async function handleCommand(i:ChatInputCommandInteraction,db:Database.Database):Promise<void>{
  const handler=handlers[i.commandName];
  if(!handler) throw new DomainError("Comando não reconhecido.");
  try{await handler(i,db);}catch(error){
    const message=error instanceof DomainError?error.message:"O comando falhou; nenhuma alteração foi confirmada.";
    if(!(error instanceof DomainError)) console.error("Slash command failed",{command:i.commandName,error:error instanceof Error?error.message:"unknown"});
    await i.editReply({content:message,embeds:[],components:[],allowedMentions:{parse:[]}});
  }
}
