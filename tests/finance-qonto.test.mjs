import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import vm from "node:vm";
import ts from "typescript";
const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const compiled=ts.transpileModule(read("lib/finance/qonto/normalize.ts"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const out={};
vm.runInNewContext(compiled,{exports:out,Date,RegExp,Set});
const {invoiceFromQonto,creditFromQonto,exactReferenceCandidates}=out;
const time="2026-11-10T12:00:00.000Z";
const sampleInvoice={id:"qonto-inv-1",number:"FV-2026-00001",status:"unpaid",currency:"EUR",total_amount_cents:25000,issue_date:"2026-11-01",due_date:"2026-11-15",updated_at:time,
 client:{id:"qonto-customer-1",name:"Société Test",email:"ignored@test.invalid",address:"1 rue privée"}};
const sampleCredit={id:"tx-1",side:"credit",status:"completed",currency:"EUR",amount_cents:25000,reference:"Règlement FV-2026-00001",label:"VIREMENT CLIENT",settled_at:time,updated_at:time,transfer:{counterparty_account_number:"FR...secret"}};
test("normalisation des factures Qonto limitée aux colonnes minimales et à EUR",()=>{
 const row=invoiceFromQonto(sampleInvoice,time);
 assert.equal(row.total_cents,25000);
 assert.equal(row.external_client_id,"qonto-customer-1");
 assert.equal(row.number,"FV-2026-00001");
 assert.equal(row.due_on,"2026-11-15");
 assert.doesNotMatch(JSON.stringify(row),/ignored@test|rue privée/);
 assert.equal(invoiceFromQonto({...sampleInvoice,currency:"USD"},time),null);
 assert.throws(()=>invoiceFromQonto({...sampleInvoice,total_amount_cents:25.5},time));
 assert.throws(()=>invoiceFromQonto({...sampleInvoice,due_date:"2026-02-30"},time));
 assert.throws(()=>invoiceFromQonto({...sampleInvoice,id:null},time));
});
test("crédits uniquement : pas de débit, en attente, devises ou comptes réels exposés",()=>{
 const credit=creditFromQonto(sampleCredit,"bank-test",time);
 assert.equal(credit.amount_cents,25000);
 assert.equal(credit.status,"completed");
 assert.doesNotMatch(JSON.stringify(credit),/counterparty_account_number|FR\.\.\./);
 assert.equal(creditFromQonto({...sampleCredit,side:"debit"},"bank-test",time),null);
 assert.equal(creditFromQonto({...sampleCredit,status:"pending"},"bank-test",time),null);
 assert.equal(creditFromQonto({...sampleCredit,currency:"GBP"},"bank-test",time),null);
 assert.equal(creditFromQonto({...sampleCredit,status:"reversed"},"bank-test",time).status,"reversed");
 assert.throws(()=>creditFromQonto({...sampleCredit,settled_at:null},"bank-test",time));
});
test("suggestion de rapprochement : exacte, unique, client associé et non déjà allouée",()=>{
 const invoice={id:"i1",number:"FV-2026-00001",client_id:"cl1",status:"unpaid",total_cents:25000};
 const credit={id:"t1",reference:"FV-2026-00001",status:"completed",amount_cents:25000};
 const plain=x=>JSON.parse(JSON.stringify(x));
 assert.deepEqual(plain(exactReferenceCandidates([invoice],[credit],new Set(),new Set())),[{invoice_id:"i1",transaction_id:"t1",amount_cents:25000}]);
 assert.equal(exactReferenceCandidates([invoice],[{...credit,id:"a"},{...credit,id:"b"}],new Set(),new Set()).length,0);
 assert.equal(exactReferenceCandidates([{...invoice,id:"i2"},invoice],[credit],new Set(),new Set()).length,0);
 assert.equal(exactReferenceCandidates([{...invoice,client_id:null}],[credit],new Set(),new Set()).length,0);
 assert.equal(exactReferenceCandidates([invoice],[{...credit,reference:"FV-2026-000010"}],new Set(),new Set()).length,0);
 assert.equal(exactReferenceCandidates([invoice],[{...credit,status:"reversed"}],new Set(),new Set()).length,0);
 assert.equal(exactReferenceCandidates([invoice],[credit],new Set(["i1"]),new Set()).length,0);
});
test("migration Qonto : allocations atomiques, contrôle clients, RLS et aucun privilège navigateur",()=>{
 const sql=read("supabase/migrations/20261203000000_finance_qonto_readonly.sql");
 for(const table of ["finance_qonto_invoices","finance_qonto_transactions","finance_qonto_allocations","finance_qonto_sync_state"]){
  assert.match(sql,new RegExp("create table public\\."+table));
  assert.match(sql,new RegExp("alter table public\\."+table+" enable row level security"));
 }
 assert.match(sql,/security invoker/);
 assert.match(sql,/for update/);
 assert.match(sql,/v_invoice\.client_id is null/);
 assert.match(sql,/v_invoiced\+p_amount_cents>v_invoice\.total_cents/);
 assert.match(sql,/v_allocated_tx\+p_amount_cents>v_transaction\.amount_cents/);
 assert.match(sql,/revoke all on function .* from public,anon,authenticated/);
 assert.match(sql,/grant execute on function .* to service_role/);
 assert.doesNotMatch(sql,/\bdrop table\b|\btruncate\b|\bdelete from public\./i);
});
test("API Qonto en lecture seule, avec domaines fixes et jamais d'action de paiement",()=>{
 const source=read("lib/finance/qonto/provider.ts");
 const sync=read("lib/finance/qonto/service.ts");
 const actions=read("app/(cockpit)/finance/qonto/actions.ts");
 assert.match(source,/https:\/\/thirdparty\.qonto\.com/);
 assert.match(source,/QONTO_EXPECTED_ORGANIZATION_SLUG/);
 assert.match(source,/\/v2\/organization/);
 assert.match(source,/\/v2\/client_invoices/);
 assert.match(source,/\/v2\/transactions/);
 assert.match(source,/method:"GET"/);
 assert.doesNotMatch(source,/method:"POST"|method:"PATCH"|method:"DELETE"/);
 assert.match(source,/maxPages=100/);
 assert.match(sync,/\.upsert\(batch,\{onConflict:"external_id"\}\)/);
 assert.match(actions,/requireAdminWriter/);
 assert.match(actions,/finance_qonto_allocate_credit/);
 assert.doesNotMatch(actions,/activateService|deactivateService|transferMoney|sendEmail|suspendService/);
 const page=read("app/(cockpit)/finance/qonto/page.tsx");
 assert.match(page,/Confirmer cette correspondance/);
 assert.match(page,/Aucun virement, prélèvement, relance ou suspension/);
});
