import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients/data";
import { getActiveScenario } from "@/lib/simulation/server";
import { PageHeading, Panel, Badge } from "@/components/ui/primitives";
import { financeCatalog, financeContracts, euro, euroInput, contractTotalCents } from "@/lib/finance/data";
import { financeFrequencies, financeStatuses, financeUnits, financeUUID } from "@/lib/finance/validation";
import { saveFinanceCatalog, saveFinanceContract, changeFinanceCatalogArchive } from "./actions";
import type { FinanceCatalogRow, FinanceContractRow } from "@/lib/supabase/finance.types";

export const metadata: Metadata = {title:"Finance — tarifs & contrats"};
const input="mt-1.5 block min-h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";
const label="block text-xs text-muted";
const money="text-sm tabular-nums";
const frequencyLabels: Record<string,string>={ponctuel:"Ponctuel",mensuel:"Mensuel",annuel:"Annuel"};
const statusLabels: Record<string,string>={draft:"Brouillon",active:"Actif",paused:"En pause",ended:"Terminé"};
const units: Record<string,string>={forfait:"Forfait",projet:"Projet",article:"Article",support:"Support",dossier:"Dossier",heure:"Heure",mois:"Mois",an:"An",mise_en_place:"Mise en place"};
const frequencies = financeFrequencies.map(value=>({value,label:frequencyLabels[value]}));
const statuses = financeStatuses.map(value=>({value,label:statusLabels[value]}));
const formNote="Les prix du PDF sont indicatifs. Le tarif facturé est celui convenu avec le client, jamais une valeur estimée.";

function CatalogEditor({item,categories}:{item:FinanceCatalogRow;categories:{code:string;label:string}[]}) {
  return <article className="rounded-xl border border-border p-3" data-finance-catalog-item={item.code}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{item.name}{item.archived_at&&<span className="ml-2 text-xs text-warning">(archivée)</span>}</p>
        <p className="mt-1 text-xs text-muted">{item.description}</p>
        <p className="mt-1 text-xs text-muted">Référence HT : {item.reference_min_cents===null?"—":euro(item.reference_min_cents)}
        {item.reference_max_cents!==null ? " – "+euro(item.reference_max_cents):item.reference_min_cents!==null?" et plus":""} · Tarif global proposé : {euro(item.default_price_cents)} · {units[item.billing_unit]??item.billing_unit}</p>
      </div>
    </div>
    <details className="mt-3"><summary className="cursor-pointer text-sm text-accent">Modifier la prestation</summary>
      <form action={saveFinanceCatalog} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={item.id}/>
        <label className={label}>Désignation<input name="name" required maxLength={160} defaultValue={item.name} className={input}/></label>
        <label className={label}>Famille<select name="category_code" defaultValue={item.category_code} className={input}>{categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}</select></label>
        <label className={label+" sm:col-span-2"}>Livrables / description<textarea name="description" maxLength={3000} rows={2} defaultValue={item.description} className={input}/></label>
        <label className={label}>Unité<select name="billing_unit" defaultValue={item.billing_unit} className={input}>{financeUnits.map(unit=><option key={unit} value={unit}>{units[unit]??unit}</option>)}</select></label>
        <label className={label}>Facturation<select name="billing_frequency" defaultValue={item.billing_frequency} className={input}>{frequencies.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
        <label className={label}>Référence basse HT (€)<input name="reference_min" inputMode="decimal" defaultValue={euroInput(item.reference_min_cents)} className={input}/></label>
        <label className={label}>Référence haute HT (€)<input name="reference_max" inputMode="decimal" defaultValue={euroInput(item.reference_max_cents)} className={input}/></label>
        <label className={label}>Tarif global proposé HT (€), facultatif<input name="default_price" inputMode="decimal" defaultValue={euroInput(item.default_price_cents)} className={input}/></label>
        <div className="flex items-end"><button className="min-h-10 rounded-lg bg-accent-strong px-4 text-sm font-medium text-accent-foreground">Enregistrer</button></div>
      </form>
    </details>
    <form action={changeFinanceCatalogArchive} className="mt-3">
      <input type="hidden" name="id" value={item.id}/><input type="hidden" name="operation" value={item.archived_at?"restore":"archive"}/>
      <button className="text-xs text-muted underline hover:text-foreground">{item.archived_at?"Réactiver":"Archiver"} (sans supprimer l'historique)</button>
    </form>
  </article>;
}
function ContractEditor({contract,clientId}:{contract:FinanceContractRow;clientId:string}) {
  return <article className="rounded-xl border border-border p-4" data-finance-contract={contract.id}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="font-medium">{contract.name}</p><p className="text-xs text-muted">{contract.reference||"Sans référence"} · Depuis le {contract.starts_on} · {frequencyLabels[contract.billing_frequency]} · {statusLabels[contract.status]}</p></div>
      <p className={money}>{euro(contractTotalCents(contract.unit_price_cents,contract.quantity))} HT / {frequencyLabels[contract.billing_frequency]?.toLowerCase()}</p>
    </div>
    <details className="mt-3"><summary className="cursor-pointer text-sm text-accent">Modifier ce contrat</summary>
      <form action={saveFinanceContract} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="id" value={contract.id}/><input type="hidden" name="client_id" value={clientId}/>
        {contract.catalog_item_id?<p className="text-xs text-muted sm:col-span-2">Prestation issue du catalogue : libellé et livrables figés au contrat. Les changements globaux n'affectent pas ce contrat.</p>:<>
          <label className={label}>Désignation<input name="name" required maxLength={160} defaultValue={contract.name} className={input}/></label>
          <label className={label}>Unité<select name="billing_unit" defaultValue={contract.billing_unit} className={input}>{financeUnits.map(u=><option key={u} value={u}>{units[u]??u}</option>)}</select></label>
          <label className={label+" sm:col-span-2"}>Livrables<textarea name="description" rows={2} maxLength={3000} defaultValue={contract.description} className={input}/></label>
        </>}
        <label className={label}>Tarif convenu HT (€)<input name="unit_price" required inputMode="decimal" defaultValue={euroInput(contract.unit_price_cents)} className={input}/></label>
        <label className={label}>Quantité<input name="quantity" required inputMode="decimal" defaultValue={contract.quantity} className={input}/></label>
        <label className={label}>Fréquence<select name="billing_frequency" defaultValue={contract.billing_frequency} className={input}>{frequencies.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
        <label className={label}>État commercial<select name="status" defaultValue={contract.status} className={input}>{statuses.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className={label}>Début<input name="starts_on" type="date" required defaultValue={contract.starts_on} className={input}/></label>
        <label className={label}>Fin (facultative)<input name="ends_on" type="date" defaultValue={contract.ends_on??""} className={input}/></label>
        <label className={label}>Référence devis / contrat<input name="reference" maxLength={160} defaultValue={contract.reference??""} className={input}/></label>
        <label className={label}>Notes<input name="notes" maxLength={3000} defaultValue={contract.notes??""} className={input}/></label>
        <p className="text-xs text-muted sm:col-span-2">Les modifications sont historisées ; elles n'affectent aucun paiement ni service technique.</p>
        <button className="min-h-10 rounded-lg bg-accent-strong px-4 text-sm font-medium text-accent-foreground">Enregistrer l'avenant</button>
      </form>
    </details>
  </article>;
}
export default async function FinancePage({searchParams}:PageProps<"/finance">) {
  await requireAdmin();
  if (await getActiveScenario()) return <PageHeading eyebrow="Finance" title="Module réservé aux données réelles" description="Quittez la simulation pour consulter les tarifs et les contrats. Aucune écriture en simulation."/>;
  const params=await searchParams;
  const requested=typeof params.client==="string" && financeUUID.test(params.client)?params.client:"";
  const q=typeof params.q==="string"?params.q.trim().toLocaleLowerCase("fr-FR").slice(0,80):"";
  const notice=typeof params.notice==="string"?params.notice.slice(0,160):"";
  let categories:Awaited<ReturnType<typeof financeCatalog>>["categories"]=[],items:FinanceCatalogRow[]=[];
  let contracts:FinanceContractRow[]=[];
  let unavailable=false;
  try {({categories,items}=await financeCatalog());if(requested)contracts=await financeContracts(requested);}
  catch {unavailable=true;}
  const clients=await listClients();
  const client=clients.find(c=>c.id===requested);
  const visible=items.filter(item=>!q||[item.name,item.description,item.code].join(" ").toLocaleLowerCase("fr-FR").includes(q));
  const activeContracts=contracts.filter(c=>c.status==="active");
  const monthly=activeContracts.filter(c=>c.billing_frequency==="mensuel").reduce((sum,c)=>sum+contractTotalCents(c.unit_price_cents,c.quantity),0);
  const annual=activeContracts.filter(c=>c.billing_frequency==="annuel").reduce((sum,c)=>sum+contractTotalCents(c.unit_price_cents,c.quantity),0);
  return <>
    <PageHeading eyebrow="Gestion commerciale" title="Prestations & Finance" description="Catalogue global de tarifs indicatifs et contrats commerciaux propres à chaque client. Qonto, relances et URSSAF seront ajoutés sans changer les prestations existantes."/>
    {notice&&<p role="status" className="mb-5 rounded-xl border border-border bg-surface-raised p-3 text-sm">{notice==="prestation-ok"?"Prestation enregistrée.":notice==="contrat-ok"?"Contrat client enregistré.":notice==="archivage-ok"?"État du catalogue mis à jour.":notice==="simulation"?"Aucune écriture en mode simulation.":notice}</p>}
    {unavailable?<Panel className="p-5"><p role="alert" className="text-sm text-warning">Module indisponible : appliquer d'abord la migration finance_catalog_contracts sur Supabase. Aucune donnée client n'a été modifiée.</p></Panel>:<>
      <Panel className="mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Catalogue global</h2><Badge>{items.length} prestations</Badge></div>
        <p className="mt-1 text-sm text-muted">{formNote}</p>
        <form className="mt-4 flex flex-wrap gap-2" method="get" action="/finance">
          {requested&&<input type="hidden" name="client" value={requested}/>}
          <input name="q" defaultValue={q} placeholder="Rechercher une prestation" aria-label="Rechercher" className={input+" min-w-[200px] flex-1"}/>
          <button className="min-h-10 rounded-lg border border-border px-4 text-sm">Filtrer</button>
        </form>
        <div className="mt-5 space-y-6">
          {categories.map(category=>{
            const group=visible.filter(i=>i.category_code===category.code);
            if(!group.length)return null;
            return <section key={category.code}><h3 className="mb-3 font-semibold">{category.label} <span className="text-xs text-muted">({group.length})</span></h3>
              <div className="grid gap-3 lg:grid-cols-2">{group.map(item=><CatalogEditor key={item.id} item={item} categories={categories}/>)}</div>
            </section>;
          })}
        </div>
        <details className="mt-7 rounded-xl border border-border p-4"><summary className="cursor-pointer font-semibold text-accent">+ Ajouter une prestation au catalogue</summary>
          <form action={saveFinanceCatalog} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className={label}>Désignation<input name="name" required maxLength={160} className={input}/></label>
            <label className={label}>Famille<select name="category_code" required defaultValue={categories[0]?.code} className={input}>{categories.map(c=><option key={c.code} value={c.code}>{c.label}</option>)}</select></label>
            <label className={label+" sm:col-span-2"}>Périmètre / livrables<textarea name="description" rows={2} maxLength={3000} className={input}/></label>
            <label className={label}>Unité<select name="billing_unit" defaultValue="forfait" className={input}>{financeUnits.map(u=><option key={u} value={u}>{units[u]??u}</option>)}</select></label>
            <label className={label}>Fréquence<select name="billing_frequency" defaultValue="ponctuel" className={input}>{frequencies.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
            <label className={label}>Borne basse HT (€)<input name="reference_min" inputMode="decimal" className={input}/></label>
            <label className={label}>Borne haute HT (€)<input name="reference_max" inputMode="decimal" className={input}/></label>
            <label className={label}>Prix global proposé HT (€) (facultatif)<input name="default_price" inputMode="decimal" className={input}/></label>
            <div className="flex items-end"><button className="min-h-10 rounded-lg bg-accent-strong px-4 text-sm font-medium text-accent-foreground">Ajouter au catalogue</button></div>
          </form>
        </details>
      </Panel>
      <Panel className="p-5">
        <h2 className="text-lg font-semibold">Prestations facturées par client</h2>
        <p className="mt-1 text-sm text-muted">Un tarif signé reste indépendant du catalogue global. Les contrats existants ne sont pas modifiés par les nouvelles grilles.</p>
        <form action="/finance" method="get" className="mt-4 flex flex-wrap items-end gap-2">
          <label className={label+" min-w-[230px] flex-1"}>Client<select name="client" defaultValue={client?.id??""} className={input} required><option value="" disabled>Choisir un client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <button className="min-h-10 rounded-lg border border-border px-4 text-sm">Ouvrir</button>
        </form>
        {client&&<div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Prestations de {client.name}</h3><Link className="text-sm text-accent underline" href={`/clients/${client.id}`}>Fiche client</Link></div>
          <p className="mt-2 text-xs text-muted">Total théorique des contrats actifs : {euro(monthly)} HT / mois · {euro(annual)} HT / an. Ce ne sont pas des encaissements ni des factures émises.</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">{contracts.map(contract=><ContractEditor key={contract.id} contract={contract} clientId={client.id}/>)}</div>
          {!contracts.length&&<p className="mt-4 text-sm text-muted">Aucune prestation tarifée pour ce client.</p>}
          <details className="mt-5 rounded-xl border border-border p-4"><summary className="cursor-pointer font-semibold text-accent">+ Attribuer une nouvelle prestation à {client.name}</summary>
            <form action={saveFinanceContract} className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="client_id" value={client.id}/>
              <label className={label+" sm:col-span-2"}>Prestation du catalogue<select name="catalog_item_id" defaultValue="" className={input}><option value="">Prestation sur mesure (saisir un intitulé ci-dessous)</option>{items.filter(i=>!i.archived_at).map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
              <label className={label}>Intitulé pour prestation sur mesure<input name="name" maxLength={160} className={input}/></label>
              <label className={label}>Unité pour prestation sur mesure<select name="billing_unit" defaultValue="forfait" className={input}>{financeUnits.map(u=><option key={u} value={u}>{units[u]??u}</option>)}</select></label>
              <label className={label+" sm:col-span-2"}>Description sur mesure<textarea name="description" rows={2} maxLength={3000} className={input}/></label>
              <label className={label}>Tarif convenu HT (€)<input name="unit_price" required placeholder="300,00" inputMode="decimal" className={input}/></label>
              <label className={label}>Quantité<input name="quantity" required defaultValue="1" inputMode="decimal" className={input}/></label>
              <label className={label}>Facturation<select name="billing_frequency" defaultValue="mensuel" className={input}>{frequencies.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
              <label className={label}>Statut<select name="status" defaultValue="draft" className={input}>{statuses.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
              <label className={label}>Début du contrat<input name="starts_on" type="date" required className={input}/></label>
              <label className={label}>Fin (facultative)<input name="ends_on" type="date" className={input}/></label>
              <label className={label}>Référence devis / contrat<input name="reference" maxLength={160} className={input}/></label>
              <label className={label}>Notes<input name="notes" maxLength={3000} className={input}/></label>
              <p className="text-xs text-muted sm:col-span-2">Cette création n'émet aucune facture et n'active aucun agent. Les échanges et paiements Qonto viendront dans une prochaine PR.</p>
              <button className="min-h-10 rounded-lg bg-accent-strong px-4 text-sm font-medium text-accent-foreground">Attribuer la prestation</button>
            </form>
          </details>
        </div>}
      </Panel>
    </>}
  </>;
}
