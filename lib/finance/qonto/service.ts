import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { fetchQontoSnapshot, qontoConfigured } from "./provider";
import type { FinanceQontoInvoiceRow, FinanceQontoCreditRow, FinanceQontoAllocationRow, FinanceQontoSyncStateRow } from "@/lib/supabase/finance.types";

function readFailure():never {
 console.error("[qonto] Lecture du stockage indisponible.");
 throw new Error("Le stockage Qonto n'est pas prêt. Vérifiez la migration.");
}
export async function qontoOverview():Promise<{
 configured:boolean; invoices:FinanceQontoInvoiceRow[]; credits:FinanceQontoCreditRow[];
 allocations:FinanceQontoAllocationRow[]; state:FinanceQontoSyncStateRow|null
}> {
 await requireAdmin();
 const db=getSupabaseServerClient();
 const [a,b,c,d]=await Promise.all([
  db.from("finance_qonto_invoices").select("*").order("due_on",{ascending:false,nullsFirst:false}).limit(250),
  db.from("finance_qonto_transactions").select("*").order("settled_at",{ascending:false}).limit(250),
  db.from("finance_qonto_allocations").select("*").order("created_at",{ascending:false}).limit(500),
  db.from("finance_qonto_sync_state").select("*").eq("id",true).maybeSingle()
 ]);
 if(a.error||b.error||c.error||d.error)readFailure();
 return {configured:qontoConfigured(),invoices:a.data??[],credits:b.data??[],allocations:c.data??[],state:d.data??null};
}
export async function syncQontoReadOnly(actorId:string):Promise<{invoices:number;credits:number}> {
 if(!qontoConfigured())throw new Error("QONTO_NOT_CONFIGURED");
 const db=getSupabaseServerClient();
 const attempt=new Date().toISOString();
 try {
   // Téléchargement complet du périmètre demandé avant toute mutation locale.
   const snapshot=await fetchQontoSnapshot();
   for(let index=0;index<snapshot.invoices.length;index+=100){
     const batch=snapshot.invoices.slice(index,index+100);
     const {error}=await db.from("finance_qonto_invoices").upsert(batch,{onConflict:"external_id"});
     if(error)throw new Error("QONTO_STORAGE_INVOICES");
   }
   for(let index=0;index<snapshot.credits.length;index+=100){
     const batch=snapshot.credits.slice(index,index+100);
     const {error}=await db.from("finance_qonto_transactions").upsert(batch,{onConflict:"external_id"});
     if(error)throw new Error("QONTO_STORAGE_CREDITS");
   }
   const {error}=await db.from("finance_qonto_sync_state").upsert({
     id:true,status:"ok",last_attempt_at:attempt,last_success_at:new Date().toISOString(),
     invoice_count:snapshot.invoices.length,credit_count:snapshot.credits.length,error_code:null,synced_by:actorId
   });
   if(error)throw new Error("QONTO_STORAGE_STATE");
   return {invoices:snapshot.invoices.length,credits:snapshot.credits.length};
 } catch(err) {
   // Ne pas jamais exposer les réponses API ni les clés.
   const error_code=err instanceof Error && /^QONTO_[A-Z0-9_]+$/.test(err.message)?err.message:"QONTO_SYNC_ERROR";
   await db.from("finance_qonto_sync_state").update({status:"error",last_attempt_at:attempt,error_code,synced_by:actorId}).eq("id",true);
   throw new Error(error_code);
 }
}
