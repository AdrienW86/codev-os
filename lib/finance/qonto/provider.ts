import "server-only";
import { creditFromQonto, invoiceFromQonto, type ImportedQontoInvoice, type ImportedQontoTransaction } from "./normalize";

const base="https://thirdparty.qonto.com";
const maxPages=100;
const maxAccounts=20;
export function qontoConfigured(): boolean {
  return Boolean(process.env.QONTO_LOGIN && process.env.QONTO_SECRET_KEY && process.env.QONTO_EXPECTED_ORGANIZATION_SLUG);
}
function config(){
 const login=process.env.QONTO_LOGIN,secret=process.env.QONTO_SECRET_KEY,expected=process.env.QONTO_EXPECTED_ORGANIZATION_SLUG;
 if(!login||!secret||!expected||login.includes(":")||login.includes("\n")||secret.includes("\n"))throw new Error("QONTO_NOT_CONFIGURED");
 return {login,secret,expected};
}
async function request(path: string,params:URLSearchParams,authentication:string):Promise<Record<string,unknown>> {
 const u=new URL(base+path);u.search=params.toString();
 const res=await fetch(u.toString(),{method:"GET",headers:{Authorization:authentication,Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(15000),redirect:"error"});
 if(!res.ok)throw new Error("QONTO_HTTP_"+res.status);
 const data:unknown=await res.json();
 if(data===null||typeof data!=="object"||Array.isArray(data))throw new Error("QONTO_INVALID_RESPONSE");
 return data as Record<string,unknown>;
}
function o(x:unknown):Record<string,unknown>{
 if(x===null||typeof x!=="object"||Array.isArray(x))throw new Error("QONTO_INVALID_RESPONSE");
 return x as Record<string,unknown>;
}
async function listPages(path:string,params:URLSearchParams,key:string,auth:string):Promise<unknown[]>{
 const all:unknown[]=[];
 const seen=new Set<number>();
 let page=1;
 for(let iter=0;iter<maxPages;iter++){
   if(seen.has(page))throw new Error("QONTO_PAGINATION_LOOP");
   seen.add(page);params.set("page",String(page));params.set("per_page","100");
   const body=await request(path,params,auth);
   if(!Array.isArray(body[key]))throw new Error("QONTO_INVALID_RESPONSE");
   all.push(...(body[key] as unknown[]));
   const meta=o(body.meta);
   if(meta.next_page===null||meta.next_page===undefined)return all;
   const next=Number(meta.next_page);
   if(!Number.isSafeInteger(next)||next<=page||next>maxPages)throw new Error("QONTO_PAGINATION_LIMIT");
   page=next;
 }
 throw new Error("QONTO_PAGINATION_LIMIT");
}
export async function fetchQontoSnapshot():Promise<{invoices:ImportedQontoInvoice[];credits:ImportedQontoTransaction[]}> {
 const {login,secret,expected}=config();
 const auth=login+":"+secret; // Clé API Qonto, pas de Basic ni de Bearer.
 const orgRoot=await request("/v2/organization",new URLSearchParams(),auth);
 const org=o(orgRoot.organization);
 if(org.slug!==expected)throw new Error("QONTO_WRONG_ORGANIZATION");
 const accounts=org.bank_accounts;
 if(!Array.isArray(accounts)||accounts.length===0||accounts.length>maxAccounts)throw new Error("QONTO_INVALID_ACCOUNTS");
 const from=new Date(Date.now()-366*24*60*60*1000).toISOString();
 const now=new Date().toISOString();
 const invoiceParams=new URLSearchParams({"filter[updated_at_from]":from,exclude_imported:"false"});
 const rawInvoices=await listPages("/v2/client_invoices",invoiceParams,"client_invoices",auth);
 const invoices=rawInvoices.map(x=>invoiceFromQonto(x,now)).filter((x):x is ImportedQontoInvoice=>Boolean(x));
 const credits:ImportedQontoTransaction[]=[];
 for(const value of accounts){
   const acct=o(value);
   if(acct.currency!=="EUR")continue;
   const accountId=typeof acct.id==="string"&&acct.id.length<=150?acct.id:typeof acct.slug==="string"&&acct.slug.length<=150?acct.slug:null;
   const iban=typeof acct.iban==="string"&&/^[A-Z0-9]{12,40}$/.test(acct.iban)?acct.iban:null;
   if(!accountId||!iban)throw new Error("QONTO_INVALID_ACCOUNT_ID");
   const params=new URLSearchParams({iban,side:"credit",updated_at_from:from});
   params.append("status[]","completed");params.append("status[]","reversed");
   const rawTransactions=await listPages("/v2/transactions",params,"transactions",auth);
   for(const item of rawTransactions){const row=creditFromQonto(item,accountId,now);if(row)credits.push(row);}
 }
 if(new Set(invoices.map(x=>x.external_id)).size!==invoices.length||new Set(credits.map(x=>x.external_id)).size!==credits.length)
   throw new Error("QONTO_DUPLICATE_IDS");
 return {invoices,credits};
}
