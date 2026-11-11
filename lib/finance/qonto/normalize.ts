// Normalisation stricte des seules données Qonto utiles à la réconciliation EUR.
// Ne copie pas les IBAN, adresses, e-mails, cartes, PDF ni le JSON bancaire complet.
export type ImportedQontoInvoice = {
  external_id: string; external_client_id: string | null; external_client_name: string | null;
  number: string; status: string; total_cents: number; currency: "EUR";
  issued_on: string | null; due_on: string | null; source_updated_at: string | null; synced_at: string;
};
export type ImportedQontoTransaction = {
  external_id: string; external_bank_account_id: string; amount_cents: number; currency: "EUR";
  side: "credit"; status: "completed" | "reversed";
  label: string; reference: string; settled_at: string; source_updated_at: string | null; synced_at: string;
};
type Raw = Record<string, unknown>;
function object(value: unknown): Raw {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("QONTO_INVALID_RESPONSE");
  return value as Raw;
}
function str(value: unknown, max = 150): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}
function money(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 100000000000) throw new Error("QONTO_INVALID_AMOUNT");
  return value;
}
function iso(value: unknown, time = false): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error("QONTO_INVALID_DATE");
  const d = new Date(value);
  if (!Number.isFinite(d.valueOf())) throw new Error("QONTO_INVALID_DATE");
  if (!time && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || d.toISOString().slice(0,10)!==value))
    throw new Error("QONTO_INVALID_DATE");
  return time ? d.toISOString() : value;
}
export function invoiceFromQonto(raw: unknown, at: string): ImportedQontoInvoice | null {
  const row=object(raw);
  if (row.currency!=="EUR") return null;
  const id=str(row.id),number=str(row.number),status=str(row.status,50);
  if (!id||!number||!status) throw new Error("QONTO_INVALID_INVOICE");
  const client=row.client===null||row.client===undefined?null:object(row.client);
  return {
    external_id:id,external_client_id:client?str(client.id):null,
    external_client_name:client?str(client.name,200):null,
    number,status,total_cents:money(row.total_amount_cents),currency:"EUR",
    issued_on:iso(row.issue_date),due_on:iso(row.due_date),
    source_updated_at:iso(row.updated_at,true),synced_at:at
  };
}
export function creditFromQonto(raw: unknown, accountId: string, at: string): ImportedQontoTransaction | null {
  const row=object(raw);
  if(row.side!=="credit"||row.currency!=="EUR"||!["completed","reversed"].includes(String(row.status)))return null;
  const id=str(row.id),settled=iso(row.settled_at,true);
  if(!id||!settled||!str(accountId))throw new Error("QONTO_INVALID_CREDIT");
  const amount=money(row.amount_cents);
  if(!amount)return null;
  return {external_id:id,external_bank_account_id:accountId,amount_cents:amount,currency:"EUR",side:"credit",
    status:row.status as "completed"|"reversed",label:str(row.label,180)??"",reference:str(row.reference,240)??"",
    settled_at:settled,source_updated_at:iso(row.updated_at,true),synced_at:at};
}
export type MatchCandidate = {invoice_id: string; transaction_id: string; amount_cents: number};
export function exactReferenceCandidates(
 invoices: {id:string;number:string;status:string;total_cents:number;client_id:string|null}[],
 credits: {id:string;reference:string;amount_cents:number;status:string}[],
 allocatedInvoiceIds: Set<string>, allocatedCreditIds: Set<string>
): MatchCandidate[] {
 const results:MatchCandidate[]=[];
 for(const i of invoices){
   if(!i.client_id||["draft","canceled"].includes(i.status)||allocatedInvoiceIds.has(i.id))continue;
   // La référence doit être significative et être délimitée, jamais un simple fragment.
   const ref=i.number.trim().toUpperCase();
   if(ref.length<5||!/[A-Z]/.test(ref)||!/^[A-Z0-9][A-Z0-9-]{3,148}[A-Z0-9]$/.test(ref))continue;
   const pattern=new RegExp("(^|[^A-Z0-9])"+ref+"([^A-Z0-9]|$)");
   const candidates=credits.filter(c=>c.status==="completed"&&!allocatedCreditIds.has(c.id)&&c.amount_cents===i.total_cents&&pattern.test(c.reference.toUpperCase()));
   if(candidates.length===1){
     results.push({invoice_id:i.id,transaction_id:candidates[0].id,amount_cents:i.total_cents});
   }
 }
 // Un crédit ne peut être suggéré à deux factures distinctes.
 return results.filter(r=>results.filter(z=>z.transaction_id===r.transaction_id).length===1);
}
