import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { assertDomain } from "../domain/errors.js";
import { inTransaction } from "../db/index.js";
import { audit } from "./audit.js";
import { adjustBalance } from "./economy.js";
import { changeInventory } from "./inventory.js";
import { requireCountryOrNarratorPermission, requireNarratorPermission } from "./permissions.js";

export function createTradeContract(db:Database.Database,guildId:string,actorId:string,sellerId:number,buyerId:number,itemId:number,quantity:number,unitPrice:number,duration:number,terms:string):string {
  assertDomain(sellerId!==buyerId && quantity>0 && unitPrice>0 && Number.isFinite(quantity) && Number.isFinite(unitPrice) && Number.isInteger(duration) && duration>=0,"Dados do contrato inválidos.");
  requireCountryOrNarratorPermission(db,guildId,sellerId,actorId,"market","sell");
  const item=db.prepare("SELECT id FROM items WHERE id=? AND guild_id=?").get(itemId,guildId);
  const countries=db.prepare("SELECT id FROM countries WHERE guild_id=? AND status='active' AND id IN (?,?)").all(guildId,sellerId,buyerId) as Array<{id:number}>;
  assertDomain(item && countries.length===2,"País ou item não encontrado.");
  const id=randomUUID();
  db.prepare(`INSERT INTO trade_contracts (id,guild_id,seller_country_id,buyer_country_id,item_id,quantity_per_year,unit_price,duration_years,remaining_years,status,created_by,terms)
    VALUES (?,?,?,?,?,?,?,?,?,'pending',?,?)`).run(id,guildId,sellerId,buyerId,itemId,quantity,unitPrice,duration,duration,actorId,terms.slice(0,200));
  audit(db,guildId,actorId,"create_trade_contract","trade_contract",id,{sellerId,buyerId,itemId,quantity,unitPrice,duration});
  return id;
}

export function acceptTradeContract(db:Database.Database,guildId:string,actorId:string,contractId:string):void {
  const row=db.prepare("SELECT id,seller_country_id,buyer_country_id,status FROM trade_contracts WHERE guild_id=? AND id LIKE ? AND status='pending'")
    .get(guildId,contractId+"%") as {id:string;seller_country_id:number;buyer_country_id:number;status:string}|undefined;
  assertDomain(row,"Contrato pendente não encontrado.");
  requireCountryOrNarratorPermission(db,guildId,row.buyer_country_id,actorId,"market","buy");
  db.prepare("UPDATE trade_contracts SET status='active',accepted_by=?,last_result='Contrato aceito' WHERE id=?").run(actorId,row.id);
  audit(db,guildId,actorId,"accept_trade_contract","trade_contract",row.id);
}

export function cancelTradeContract(db:Database.Database,guildId:string,actorId:string,contractId:string):void {
  const row=db.prepare("SELECT id,seller_country_id,buyer_country_id,status FROM trade_contracts WHERE guild_id=? AND id LIKE ? AND status IN ('pending','active')")
    .get(guildId,contractId+"%") as {id:string;seller_country_id:number;buyer_country_id:number}|undefined;
  assertDomain(row,"Contrato ativo ou pendente não encontrado.");
  const sellerAccess=hasCountry(db,guildId,actorId,row.seller_country_id);
  const buyerAccess=hasCountry(db,guildId,actorId,row.buyer_country_id);
  const narrator=hasNarrator(db,guildId,actorId);
  assertDomain(sellerAccess||buyerAccess||narrator,"Somente as partes envolvidas ou um narrador podem cancelar.");
  db.prepare("UPDATE trade_contracts SET status='cancelled',last_result='Cancelado' WHERE id=?").run(row.id);
  audit(db,guildId,actorId,"cancel_trade_contract","trade_contract",row.id);
}

function hasCountry(db:Database.Database,guildId:string,userId:string,countryId:number):boolean {
  return Boolean(db.prepare("SELECT 1 FROM country_memberships WHERE country_id=? AND user_id=?").get(countryId,userId)) ||
    hasNarrator(db,guildId,userId);
}
function hasNarrator(db:Database.Database,guildId:string,userId:string):boolean {
  const row=db.prepare("SELECT 1 FROM narrator_grants WHERE guild_id=? AND user_id=?").get(guildId,userId);
  const main=db.prepare("SELECT 1 FROM guild_settings WHERE guild_id=? AND main_narrator_id=?").get(guildId,userId);
  return Boolean(row||main);
}

export function setImportTariff(db:Database.Database,guildId:string,actorId:string,countryId:number,percent:number):void {
  assertDomain(Number.isFinite(percent)&&percent>=0&&percent<=100,"A tarifa precisa ficar entre 0% e 100%.");
  requireCountryOrNarratorPermission(db,guildId,countryId,actorId,"market","sell");
  db.prepare(`INSERT INTO country_trade_settings(country_id,import_tariff_percent) VALUES(?,?)
    ON CONFLICT(country_id) DO UPDATE SET import_tariff_percent=excluded.import_tariff_percent`).run(countryId,percent);
  audit(db,guildId,actorId,"set_import_tariff","country",countryId,{percent});
}

export function setTradeRestriction(db:Database.Database,guildId:string,actorId:string,imposingId:number,targetId:number,kind:"embargo"|"blockade",itemId:number|null,reason:string):string {
  assertDomain(imposingId!==targetId,"A restrição precisa indicar outro país.");
  requireCountryOrNarratorPermission(db,guildId,imposingId,actorId,"market","sell");
  const target=db.prepare("SELECT id FROM countries WHERE id=? AND guild_id=? AND status='active'").get(targetId,guildId);
  assertDomain(target,"País alvo não encontrado.");
  if(itemId!==null) assertDomain(db.prepare("SELECT id FROM items WHERE id=? AND guild_id=?").get(itemId,guildId),"Item não encontrado.");
  assertDomain(kind!=="blockade"||itemId===null,"Bloqueios comerciais se aplicam a todos os itens.");
  const id=randomUUID();
  db.prepare("INSERT INTO trade_restrictions(id,guild_id,imposing_country_id,target_country_id,item_id,kind,reason,created_by) VALUES(?,?,?,?,?,?,?,?)")
    .run(id,guildId,imposingId,targetId,itemId,kind,reason.slice(0,200),actorId);
  audit(db,guildId,actorId,`impose_${kind}`,"trade_restriction",id,{imposingId,targetId,itemId,reason});
  return id;
}

export function liftTradeRestriction(db:Database.Database,guildId:string,actorId:string,restrictionId:string):void {
  const row=db.prepare("SELECT id,imposing_country_id FROM trade_restrictions WHERE guild_id=? AND id LIKE ? AND status='active'")
    .get(guildId,restrictionId+"%") as {id:string;imposing_country_id:number}|undefined;
  assertDomain(row,"Restrição ativa não encontrada.");
  requireCountryOrNarratorPermission(db,guildId,row.imposing_country_id,actorId,"market","sell");
  db.prepare("UPDATE trade_restrictions SET status='lifted' WHERE id=?").run(row.id);
  audit(db,guildId,actorId,"lift_trade_restriction","trade_restriction",row.id);
}

export function listTradeContracts(db:Database.Database,guildId:string):Array<{id:string;seller:string;buyer:string;item:string;quantity_per_year:number;unit_price:number;remaining_years:number;status:string;last_result:string;terms:string}> {
  return db.prepare(`SELECT t.id,a.name seller,b.name buyer,i.name item,t.quantity_per_year,t.unit_price,t.remaining_years,t.status,t.last_result,t.terms
    FROM trade_contracts t JOIN countries a ON a.id=t.seller_country_id JOIN countries b ON b.id=t.buyer_country_id JOIN items i ON i.id=t.item_id
    WHERE t.guild_id=? AND t.status IN ('pending','active') ORDER BY t.created_at DESC LIMIT 30`).all(guildId) as Array<{id:string;seller:string;buyer:string;item:string;quantity_per_year:number;unit_price:number;remaining_years:number;status:string;last_result:string;terms:string}>;
}

export function listSupplierDependencies(db:Database.Database,guildId:string,buyerId:number):Array<{item:string;supplier:string;quantity:number;share:number}> {
  const current=(db.prepare("SELECT current_year FROM guild_settings WHERE guild_id=?").get(guildId) as {current_year:number}|undefined)?.current_year ?? 0;
  const rows=db.prepare(`SELECT i.name item,s.name supplier,SUM(h.quantity) quantity
    FROM international_trade_history h JOIN items i ON i.id=h.item_id JOIN countries s ON s.id=h.seller_country_id
    WHERE h.guild_id=? AND h.buyer_country_id=? AND h.voided_at IS NULL AND h.year>? AND h.year<=?
    GROUP BY h.item_id,h.seller_country_id ORDER BY i.name,quantity DESC`).all(guildId,buyerId,current-5,current) as Array<{item:string;supplier:string;quantity:number}>;
  const totals=new Map<string,number>();
  for(const row of rows) totals.set(row.item,(totals.get(row.item)??0)+row.quantity);
  return rows.map(row=>({...row,share:totals.get(row.item)!>0?row.quantity/totals.get(row.item)!:0}));
}

export function listTradeRestrictions(db:Database.Database,guildId:string):Array<{id:string;imposer:string;target:string;kind:string;item:string|null;reason:string}> {
  return db.prepare(`SELECT r.id,a.name imposer,b.name target,r.kind,i.name item,r.reason
    FROM trade_restrictions r JOIN countries a ON a.id=r.imposing_country_id JOIN countries b ON b.id=r.target_country_id
    LEFT JOIN items i ON i.id=r.item_id WHERE r.guild_id=? AND r.status='active' ORDER BY r.created_at DESC LIMIT 25`)
    .all(guildId) as Array<{id:string;imposer:string;target:string;kind:string;item:string|null;reason:string}>;
}

export function processAnnualTradeContracts(db:Database.Database,guildId:string,actorId:string,year:number,runId:string):{applied:number;failed:number;tariffs:number;revenue:number;expenses:number} {
  const contracts=db.prepare("SELECT * FROM trade_contracts WHERE guild_id=? AND status='active' ORDER BY created_at,id").all(guildId) as Array<{id:string;seller_country_id:number;buyer_country_id:number;item_id:number;quantity_per_year:number;unit_price:number;remaining_years:number}>;
  const result={applied:0,failed:0,tariffs:0,revenue:0,expenses:0};
  for(const c of contracts) {
    const blocked=db.prepare(`SELECT 1 FROM trade_restrictions r WHERE r.guild_id=? AND r.status='active'
      AND ((r.imposing_country_id=? AND r.target_country_id=?) OR (r.imposing_country_id=? AND r.target_country_id=?))
      AND (r.kind='blockade' OR r.item_id IS NULL OR r.item_id=?) LIMIT 1`)
      .get(guildId,c.seller_country_id,c.buyer_country_id,c.buyer_country_id,c.seller_country_id,c.item_id);
    if(blocked){db.prepare("UPDATE trade_contracts SET last_result='Suspenso por embargo ou bloqueio comercial' WHERE id=?").run(c.id);result.failed++;continue;}
    const tariff=(db.prepare("SELECT import_tariff_percent FROM country_trade_settings WHERE country_id=?").get(c.buyer_country_id) as {import_tariff_percent:number}|undefined)?.import_tariff_percent??0;
    const base=c.quantity_per_year*c.unit_price, tariffAmount=base*tariff/100, total=base+tariffAmount;
    try {
      inTransaction(db,()=>{
        const seller=db.prepare("SELECT id FROM countries WHERE id=? AND guild_id=? AND status='active'").get(c.seller_country_id,guildId);
        const buyer=db.prepare("SELECT id FROM countries WHERE id=? AND guild_id=? AND status='active'").get(c.buyer_country_id,guildId);
        assertDomain(seller&&buyer,"País indisponível.");
        const stock=db.prepare("SELECT quantity FROM country_inventory WHERE country_id=? AND item_id=?").get(c.seller_country_id,c.item_id) as {quantity:number}|undefined;
        const assigned=db.prepare("SELECT assigned_soldiers FROM army_equipment_assignments WHERE country_id=? AND item_id=?").get(c.seller_country_id,c.item_id) as {assigned_soldiers:number}|undefined;
        assertDomain((stock?.quantity??0)-(assigned?.assigned_soldiers??0)+1e-9>=c.quantity_per_year,"Estoque insuficiente do vendedor.");
        adjustBalance(db,c.buyer_country_id,guildId,actorId,-total,"international_import",`Importação contratual · ano ${year}`,null,runId,year);
        adjustBalance(db,c.seller_country_id,guildId,actorId,base,"international_export",`Exportação contratual · ano ${year}`,null,runId,year);
        changeInventory(db,c.seller_country_id,c.item_id,-c.quantity_per_year);
        changeInventory(db,c.buyer_country_id,c.item_id,c.quantity_per_year);
        db.prepare("INSERT INTO international_trade_history(id,guild_id,contract_id,year,seller_country_id,buyer_country_id,item_id,quantity,unit_price,tariff_amount,run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
          .run(randomUUID(),guildId,c.id,year,c.seller_country_id,c.buyer_country_id,c.item_id,c.quantity_per_year,c.unit_price,tariffAmount,runId);
        const left=c.remaining_years>0?c.remaining_years-1:0;
        db.prepare("UPDATE trade_contracts SET remaining_years=?,status=?,last_result=? WHERE id=?")
          .run(left,left===0&&c.remaining_years>0?"completed":"active","Executado no ano "+year,c.id);
      });
      result.applied++;result.tariffs+=tariffAmount;result.revenue+=base;result.expenses+=total;
    } catch (error) {
      const reason=error instanceof Error?error.message:"Falha financeira ou de estoque";
      db.prepare("UPDATE trade_contracts SET last_result=? WHERE id=?").run(("Suspenso: "+reason).slice(0,180),c.id);
      result.failed++;
    }
  }
  return result;
}
