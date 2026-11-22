import {
  EmbedBuilder,
  PermissionFlagsBits,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import type Database from "better-sqlite3";
import { DomainError, assertDomain } from "../domain/errors.js";
import { audit } from "../services/audit.js";
import { ensureDefaultCatalog, adjustInventory, defineItem, deleteItem, listCountryInventory, setCountryProduction, type ItemInput } from "../services/inventory.js";
import { createCountry, deleteCountry, listAccessibleCountries, listNarratedCountries } from "../services/countries.js";
import { adjustAnnualFinance, adjustBalance, roundCurrency } from "../services/economy.js";
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
    ? db.prepare("SELECT id,name,treasury,annual_income,annual_expenses,debt_limit FROM countries WHERE guild_id=? AND status='active' AND lower(name)=lower(?)").get(g,name)
    : db.prepare("SELECT c.id,c.name,c.treasury,c.annual_income,c.annual_expenses,c.debt_limit FROM countries c JOIN country_memberships m ON m.country_id=c.id WHERE c.guild_id=? AND c.status='active' AND lower(c.name)=lower(?) AND m.user_id=?").get(g,name,i.user.id);
  assertDomain(row, "Nação não encontrada ou sem acesso.");
  return row as {id:number;name:string;treasury:number;annual_income:number;annual_expenses:number;debt_limit:number};
};
const ownCountry = (db: Database.Database, i: ChatInputCommandInteraction, name?: string) => {
  if (name) return countryByName(db,i,name);
  const rows = listAccessibleCountries(db,guildId(i),i.user.id);
  assertDomain(rows.length>0,"Você não está associado a uma nação.");
  assertDomain(rows.length===1,"Você está associado a mais de uma nação. Informe o parâmetro pais.");
  const c=rows[0]!;
  return {id:c.id,name:c.name,treasury:c.treasury,annual_income:c.annual_income,annual_expenses:(c as typeof c & {annual_expenses:number}).annual_expenses??0,debt_limit:c.debt_limit};
};
const itemByName = (db: Database.Database, i: ChatInputCommandInteraction, name: string) => {
  const row=db.prepare("SELECT id FROM items WHERE guild_id=? AND lower(name)=lower(?)").get(guildId(i),name) as {id:number}|undefined;
  assertDomain(row,"Item não encontrado.");
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
      if(sub==="deletar"){
        const deleted=deleteCountry(db,g,i.user.id,c.id);
        await i.editReply(`A nação **${deleted}** e todos os seus registros vinculados foram apagados definitivamente.`);
      } else {
        await i.editReply(`**${c.name}**\nTesouro: ${fmt(c.treasury)}\nRenda anual: ${fmt(c.annual_income)}\nGastos anuais: ${fmt(c.annual_expenses)}\nLimite de dívida: ${fmt(c.debt_limit)}`);
      }
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
      await i.editReply(`Item **${name}** cadastrado.`);
      return;
    }
    if(sub==="deletar-item"){
      narrator(db,i,"inventory","create");
      const itemId=itemByName(db,i,i.options.getString("item",true));
      const name=deleteItem(db,g,i.user.id,itemId);
      await i.editReply(`O item **${name}** e seus registros vinculados foram apagados definitivamente.`);
      return;
    }
    if(sub==="painel"){
      ensureDefaultCatalog(db,g,i.user.id);
      const c=ownCountry(db,i,i.options.getString("pais")??undefined);
      const rows=listCountryInventory(db,g,i.user.id,c.id);
      const groups=new Map<string,string[]>();
      for(const row of rows){
        const line=`• **${row.name}** — ${fmt(row.quantity)} ${row.unit??""} | Prod. ${fmt(row.annual_production)} | Cons. ${fmt(row.annual_consumption)} | Δ ${row.annual_production-row.annual_consumption>=0?"+":""}${fmt(row.annual_production-row.annual_consumption)}`;
        const bucket=groups.get(row.category)??[];bucket.push(line);groups.set(row.category,bucket);
      }
      const embed=new EmbedBuilder().setTitle(`INVENTÁRIO NACIONAL · ${c.name}`)
        .setDescription("**ESTOQUE** · **PRODUÇÃO ANUAL** · **CONSUMO ANUAL** · **SALDO ANUAL**")
        .setColor(0x263746).setFooter({text:`${rows.length} itens cadastrados · Valores anuais`});
      for(const category of ["Recursos naturais","Indústria e bens","Militar"]){
        const lines=groups.get(category)??[];
        if(!lines.length)continue;
        let value=lines.join("\n");
        if(value.length>1024){let kept="";let count=0;for(const line of lines){if((kept?kept+"\n":"").length+line.length>930)break;kept+=(kept?"\n":"")+line;count++;}value=kept+`\n… e mais ${lines.length-count} itens.`;}
        embed.addFields({name:category.toUpperCase(),value:value||"Nenhum item."});
      }
      if(!rows.length)embed.addFields({name:"INVENTÁRIO VAZIO",value:"Nenhum recurso cadastrado."});
      await i.editReply({embeds:[embed]});
      return;
    }

    const group=i.options.getSubcommandGroup();
    assertDomain(group==="pais","Categoria de inventário inválida.");
    const subType=sub as "estoque"|"producao"|"consumo";
    narrator(db,i,subType==="estoque"?"inventory":"production",subType==="estoque"?"edit":"configure");
    const country=countryByName(db,i,i.options.getString("nacao",true));
    const itemId=itemByName(db,i,i.options.getString("item",true));
    const operation=i.options.getString("operacao",true) as "add"|"rem"|"set";
    const value=i.options.getNumber("valor",true);
    const reason=i.options.getString("motivo",true);
    assertDomain(Number.isFinite(value)&&(operation==="set"?value>=0:value>0),"Informe um valor válido. Add/rem precisam ser maiores que zero.");
    if(subType==="estoque"){
      const row=db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(country.id,itemId) as {quantity:number}|undefined;
      const current=row?.quantity??0;
      const next=operation==="add"?current+value:operation==="rem"?current-value:value;
      assertDomain(next>=0,"O estoque não pode ficar negativo.");
      if(next!==current)adjustInventory(db,g,i.user.id,country.id,itemId,next-current,reason);
      await i.editReply(`Estoque de **${country.name}** atualizado: **${fmt(current)} → ${fmt(next)}**.`);
      return;
    }
    const row=db.prepare("SELECT annual_production,annual_consumption FROM country_production WHERE country_id=? AND item_id=?").get(country.id,itemId) as {annual_production:number;annual_consumption:number}|undefined;
    const production=row?.annual_production??0,consumption=row?.annual_consumption??0;
    const current=subType==="producao"?production:consumption;
    const next=operation==="add"?current+value:operation==="rem"?current-value:value;
    assertDomain(next>=0,"Produção e consumo não podem ficar negativos.");
    if(next!==current)setCountryProduction(db,g,i.user.id,country.id,itemId,subType==="producao"?next:production,subType==="consumo"?next:consumption);
    audit(db,g,i.user.id,"adjust_inventory_flow","production",`${country.id}:${itemId}`,{type:subType,operation,value:next-current,reason});
    await i.editReply(`${subType==="producao"?"Produção anual":"Consumo anual"} de **${country.name}** atualizado: **${fmt(current)} → ${fmt(next)}**.`);
  },
  economia: async(i,db)=>{
    assertDomain(i.options.getSubcommandGroup()==="pais","Grupo econômico inválido.");
    const sub=i.options.getSubcommand() as "renda"|"gastos"|"dinheiro";
    narrator(db,i,"economy","edit");
    const country=countryByName(db,i,i.options.getString("nacao",true));
    const operation=i.options.getString("operacao",true) as "add"|"rem"|"set";
    const value=i.options.getNumber("valor",true);
    const reason=i.options.getString("motivo",true);
    assertDomain(Number.isFinite(value)&&(operation==="set"?value>=0:value>0),"Informe um valor válido. Add/rem precisam ser maiores que zero.");
    const rounded=roundCurrency(db,guildId(i),value);
    let current:number;
    let next:number;
    if(sub==="dinheiro"){
      const row=db.prepare("SELECT treasury FROM countries WHERE id=? AND guild_id=? AND status='active'").get(country.id,guildId(i)) as {treasury:number}|undefined;
      assertDomain(row,"País não encontrado ou arquivado.");
      current=row.treasury;
      next=operation==="add"?current+rounded:operation==="rem"?current-rounded:rounded;
      assertDomain(Number.isFinite(next)&&next>=-country.debt_limit,"A operação ultrapassa o limite de dívida.");
      const delta=next-current;
      if(delta!==0)adjustBalance(db,country.id,guildId(i),i.user.id,delta,"narrator_treasury_adjustment",reason);
    }else{
      const result=adjustAnnualFinance(db,guildId(i),i.user.id,country.id,sub==="renda"?"income":"expenses",operation,value,reason);
      current=result.previous;
      next=result.next;
    }
    const label=sub==="renda"?"renda anual":sub==="gastos"?"gastos anuais":"tesouro";
    await i.editReply(`${label.charAt(0).toUpperCase()+label.slice(1)} de **${country.name}** atualizado: **${fmt(current)} → ${fmt(next)}**.`);
  },
  saldo: async(i,db)=>{
    const c=ownCountry(db,i,i.options.getString("pais")??undefined);
    const settings=db.prepare("SELECT currency_symbol FROM guild_settings WHERE guild_id=?").get(guildId(i)) as {currency_symbol:string};
    const symbol=settings.currency_symbol;
    const net=c.annual_income-c.annual_expenses;
    const embed=new EmbedBuilder().setTitle(`RESUMO FINANCEIRO · ${c.name}`).setColor(0x263746)
      .addFields(
        {name:"TESOURO DISPONÍVEL",value:`${symbol} ${fmt(c.treasury)}`,inline:true},
        {name:"RENDA ANUAL",value:`${symbol} ${fmt(c.annual_income)}`,inline:true},
        {name:"GASTOS ANUAIS",value:`${symbol} ${fmt(c.annual_expenses)}`,inline:true},
        {name:"RESULTADO ANUAL",value:`${net>=0?"+":"−"} ${symbol} ${fmt(Math.abs(net))}`,inline:true},
        {name:"LIMITE DE DÍVIDA",value:`${symbol} ${fmt(c.debt_limit)}`,inline:true}
      ).setFooter({text:"Renda e gastos são parâmetros anuais; o tesouro só muda por lançamentos de dinheiro."});
    await i.editReply({embeds:[embed]});
  },
  ajuda: async(i)=>{
    await i.editReply({embeds:[new EmbedBuilder().setTitle("Bot de RP Geopolítico").setDescription("Sistemas ativos: nações, inventário, economia e narradores.\n\nNações: /pais criar, /pais listar, /pais ver e /pais deletar.\nInventário: /inventario painel, /inventario criar-item, /inventario deletar-item e /inventario pais.\nEconomia: /economia pais renda, /economia pais gastos e /economia pais dinheiro.\nConsulta: /saldo.\nNarradores: /configurar principal, /narrador adicionar e /narrador remover.") ]});
  },
  ping: async(i)=>{await i.editReply(`Pong · ${i.client.ws.ping} ms`);},
};

export async function handleAutocomplete(i:AutocompleteInteraction,db:Database.Database):Promise<void>{
  if(!i.guildId){await i.respond([]);return;}
  const focused=i.options.getFocused(true);
  const query=String(focused.value??"").trim().toLocaleLowerCase("pt-BR");
  if(focused.name==="pais"||focused.name==="nacao"){
    const canSeeAll=hasNarratorPermission(db,i.guildId,i.user.id,"countries","read");
    const rows=canSeeAll
      ?db.prepare("SELECT name FROM countries WHERE guild_id=? AND status='active' AND lower(name) LIKE ? ORDER BY name COLLATE NOCASE LIMIT 25").all(i.guildId,`%${query}%`)
      :db.prepare("SELECT c.name FROM countries c JOIN country_memberships m ON m.country_id=c.id WHERE c.guild_id=? AND c.status='active' AND m.user_id=? AND lower(c.name) LIKE ? ORDER BY c.name COLLATE NOCASE LIMIT 25").all(i.guildId,i.user.id,`%${query}%`);
    await i.respond((rows as Array<{name:string}>).map(row=>({name:row.name,value:row.name})));
    return;
  }
  if(focused.name==="item"){
    const rows=db.prepare("SELECT name FROM items WHERE guild_id=? AND lower(name) LIKE ? ORDER BY name COLLATE NOCASE LIMIT 25").all(i.guildId,`%${query}%`) as Array<{name:string}>;
    await i.respond(rows.map(row=>({name:row.name,value:row.name})));
    return;
  }
  await i.respond([]);
}

export async function handleCommand(i:ChatInputCommandInteraction,db:Database.Database):Promise<void>{
  const handler=handlers[i.commandName];
  if(!handler) throw new DomainError("Comando não reconhecido.");
  try{await handler(i,db);}catch(error){
    const message=error instanceof DomainError?error.message:"O comando falhou; nenhuma alteração foi confirmada.";
    if(!(error instanceof DomainError)) console.error("Slash command failed",{command:i.commandName,error:error instanceof Error?error.message:"unknown"});
    await i.editReply({content:message,embeds:[],components:[],allowedMentions:{parse:[]}});
  }
}
