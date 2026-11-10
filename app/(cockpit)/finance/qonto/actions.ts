"use server";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {requireAdminWriter,SimulationWriteBlocked} from "@/lib/core/guards";
import {getSupabaseServerClient} from "@/lib/supabase/server";
import {cents,field,financeUUID,FinanceInputError} from "@/lib/finance/validation";
import {syncQontoReadOnly} from "@/lib/finance/qonto/service";

const finish=(notice:string):never=>redirect("/finance/qonto?notice="+encodeURIComponent(notice));
async function actor(){
 try{return await requireAdminWriter();}
 catch(error){if(error instanceof SimulationWriteBlocked)finish("simulation");throw error;}
}
function uuid(input:string):string{
 if(!financeUUID.test(input))throw new FinanceInputError("Identifiant invalide.");
 return input;
}
export async function syncQontoAction():Promise<void>{
 const who=await actor();
 let notice="synchronisation-ok";
 try{await syncQontoReadOnly(who.userId);revalidatePath("/finance/qonto");}
 catch(error){
  console.error("[finance/qonto] Synchronisation refusée.");
  notice=error instanceof Error&&error.message==="QONTO_NOT_CONFIGURED"?"qonto-non-configure":"synchronisation-erreur";
 }
 finish(notice);
}
export async function assignQontoInvoiceAction(form:FormData):Promise<void>{
 const who=await actor();
 let notice="client-associe";
 try{
  const invoiceId=uuid(field(form,"invoice_id",40)),clientId=uuid(field(form,"client_id",40));
  const db=getSupabaseServerClient();
  const [inv,cl]=await Promise.all([
    db.from("finance_qonto_invoices").select("id,client_id").eq("id",invoiceId).maybeSingle(),
    db.from("clients").select("id").eq("id",clientId).maybeSingle()
  ]);
  if(inv.error||cl.error||!inv.data||!cl.data)throw new Error("NOT_FOUND");
  if(inv.data.client_id!==null)throw new Error("ALREADY_ASSIGNED");
  const {data,error}=await db.from("finance_qonto_invoices")
    .update({client_id:clientId,assigned_by:who.userId,assigned_at:new Date().toISOString()})
    .eq("id",invoiceId).is("client_id",null).select("id").maybeSingle();
  if(error||!data)throw new Error("ASSIGN_FAILED");
  revalidatePath("/finance/qonto");revalidatePath("/finance?client="+clientId);
 }catch(error){console.error("[finance/qonto] Association facture-client refusée.");
  notice=error instanceof FinanceInputError?error.message:"association-impossible";
 }
 finish(notice);
}
export async function allocateQontoCreditAction(form:FormData):Promise<void>{
 const who=await actor();
 let notice="rapprochement-ok";
 try{
  const invoiceId=uuid(field(form,"invoice_id",40)),transactionId=uuid(field(form,"transaction_id",40));
  const amount=cents(field(form,"amount",25),true)!;
  if(amount<=0)throw new FinanceInputError("Montant positif obligatoire.");
  const {data,error}=await getSupabaseServerClient().rpc("finance_qonto_allocate_credit",{
    p_invoice_id:invoiceId,p_transaction_id:transactionId,p_amount_cents:amount,p_actor:who.userId
  });
  if(error||!data)throw new Error("ALLOCATION_REFUSED");
  revalidatePath("/finance/qonto");
 }catch(error){console.error("[finance/qonto] Rapprochement refusé.");
   notice=error instanceof FinanceInputError?error.message:"rapprochement-impossible";
 }
 finish(notice);
}
