import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import vm from "node:vm";
import ts from "typescript";
const read = (path) => readFileSync(new URL("../"+path, import.meta.url),"utf8");
const source = read("lib/finance/validation.ts");
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports = {};
vm.runInNewContext(compiled,{exports,Date,FormData});
const v=exports;
const plain=x=>JSON.parse(JSON.stringify(x));

test("montants précis en centimes sans arrondis flottants et champs sécurisés",()=>{
  assert.equal(v.cents("300,99"),30099);
  assert.equal(v.cents("0,01"),1);
  assert.equal(v.cents("1.2"),120);
  assert.equal(v.cents(""),null);
  assert.equal(v.cents("0",true),0);
  for(const bad of ["-1","1.999","10e2","Infinity","1 000","1,2,3","99999999","001"])assert.throws(()=>v.cents(bad,true));
  assert.throws(()=>v.cents("",true));
  const form=new FormData();form.append("name","  Contrat  ");assert.equal(v.field(form,"name"),"Contrat");
  form.append("name","doublon");assert.throws(()=>v.field(form,"name"));
  const file=new FormData();file.append("binary",new Blob(["x"]));assert.throws(()=>v.field(file,"binary"));
  assert.equal(v.quantity("2,25"),2.25);
  assert.throws(()=>v.quantity("0"));
  assert.throws(()=>v.quantity("-2"));
  assert.throws(()=>v.quantity("1.001"));
  assert.equal(v.isoDay("2026-02-28",true),"2026-02-28");
  assert.throws(()=>v.isoDay("2026-02-30",true));
  assert.throws(()=>v.isoDay("",true));
});

test("migration : 27 références du PDF, aucune vente préremplie, historique et protections RLS",()=>{
  const sql=read("supabase/migrations/20261202000000_finance_catalog_contracts.sql");
  const section=sql.split("from (values\n")[1]?.split("\n) as v(")[0]??"";
  const names=[...section.matchAll(/^ \('([^']+)'/gm)].map(m=>m[1]);
  assert.equal(names.length,27,"27 prestations, sans doublon");
  assert.equal(new Set(names).size,27);
  for(const code of ["site-vitrine","pilotage-google-ads","gestion-reseaux-sociaux","maintenance-automatisations","accompagnement-operationnel"]){
    assert.ok(names.includes(code),code);
  }
  assert.match(sql,/select v\.code,v\.category_code.*null,'reference_pdf_2026'/);
  assert.match(sql,/on conflict\(code\) do nothing/);
  assert.match(sql,/create table if not exists public\.finance_client_contracts/);
  assert.match(sql,/on delete restrict/);
  assert.match(sql,/create trigger finance_catalog_history_trigger after insert or update/);
  assert.match(sql,/create trigger finance_contract_history_trigger after insert or update/);
  assert.match(sql,/revoke all on table .* from public,anon,authenticated/);
  assert.match(sql,/alter table public\.finance_catalog_items enable row level security/);
  assert.match(sql,/alter table public\.finance_client_contracts enable row level security/);
  assert.doesNotMatch(sql,/update\s+public\.client_services|insert\s+into\s+public\.finance_client_contracts/i,"aucun contrat réel inséré");
});

test("les prix négociés ne sont pas recalculés depuis le catalogue modifié",()=>{
  const app=read("app/(cockpit)/finance/actions.ts");
  assert.match(app,/original\.name/);
  assert.match(app,/original\.description/);
  assert.match(app,/unit_price_cents/);
  assert.match(app,/requireAdminWriter/);
  assert.match(app,/\.eq\("client_id",clientId\)/);
  assert.doesNotMatch(app,/activateService|deactivateService|client_services/);
  const data=read("lib/finance/data.ts");
  assert.match(data,/contractTotalCents/);
  const nav=read("components/layout/navigation.tsx");
  assert.match(nav,/href: "\/finance"/);
});
