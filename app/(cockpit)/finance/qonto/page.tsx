import type {Metadata} from "next";
import Link from "next/link";
import {requireAdmin} from "@/lib/require-admin";
import {getActiveScenario} from "@/lib/simulation/server";
import {listClients} from "@/lib/clients/data";
import {PageHeading,Panel,Badge} from "@/components/ui/primitives";
import {qontoOverview} from "@/lib/finance/qonto/service";
import {exactReferenceCandidates} from "@/lib/finance/qonto/normalize";
import {euro} from "@/lib/finance/data";
import {syncQontoAction,assignQontoInvoiceAction,allocateQontoCreditAction} from "./actions";
export const metadata:Metadata={title:"Qonto — rapprochement des paiements"};
const select="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";
const notices:Record<string,string>={
 "synchronisation-ok":"Synchronisation Qonto terminée. Vérifiez les montants et les états avant tout rapprochement.",
 "synchronisation-erreur":"Synchronisation impossible ou incomplète. Les données existantes restent consultables ; aucune action sur les clients.",
 "qonto-non-configure":"Renseignez les trois variables Qonto côté serveur pour activer la synchronisation.",
 "client-associe":"Facture reliée au client CODE-V OS.",
 "association-impossible":"Association refusée : facture déjà affectée, client invalide ou écriture non confirmée.",
 "rapprochement-ok":"Crédit rapproché après confirmation. Aucun statut Qonto n’a été modifié.",
 "rapprochement-impossible":"Rapprochement refusé : vérifiez la facture, le crédit et les soldes disponibles.",
 "simulation":"Aucune opération effectuée en mode simulation."
};
export default async function QontoPage({searchParams}:PageProps<"/finance/qonto">){
 await requireAdmin();
 if(await getActiveScenario())return <PageHeading eyebrow="Finance" title="Qonto indisponible en simulation" description="Quittez la simulation pour consulter les données bancaires réelles."/>;
 const params=await searchParams;
 const notice=typeof params.notice==="string"?notices[params.notice]:"";
 const clients=await listClients();
 let overview:Awaited<ReturnType<typeof qontoOverview>>|null=null;
 try{overview=await qontoOverview();}catch{ /* Migration non appliquée : échec explicite dans l’interface. */ }
 if(!overview)return <>
   <PageHeading eyebrow="Finance" title="Paiements Qonto" description="Connexion bancaire en lecture seule, rapprochements manuels et preuves conservées."/>
   <Panel className="p-5"><p role="alert" className="text-sm text-warning">Module indisponible. La migration Qonto doit être appliquée avant toute utilisation.</p>
   <Link className="mt-3 inline-block text-sm text-accent underline" href="/finance">Retour aux tarifs</Link></Panel>
 </>;
 const {configured,invoices,credits,allocations,state}=overview;
 const assignedInvoice=new Map<string,number>(),assignedCredit=new Map<string,number>();
 for(const a of allocations){assignedInvoice.set(a.invoice_id,(assignedInvoice.get(a.invoice_id)??0)+a.amount_cents);
 assignedCredit.set(a.transaction_id,(assignedCredit.get(a.transaction_id)??0)+a.amount_cents);}
 const candidates=exactReferenceCandidates(invoices,credits,
   new Set(allocations.map(a=>a.invoice_id)),new Set(allocations.map(a=>a.transaction_id)));
 const candidateByInvoice=new Map(candidates.map(x=>[x.invoice_id,x]));
 const creditById=new Map(credits.map(x=>[x.id,x]));
 const clientById=new Map(clients.map(x=>[x.id,x.name]));
 const remainingCredits=credits.filter(c=>c.status==="completed" && c.amount_cents>(assignedCredit.get(c.id)??0));
 return <>
  <PageHeading eyebrow="Finance · Lecture seule" title="Factures et paiements Qonto"
   description="Synchronisation du compte CODE-V, affectation des factures aux clients et rapprochements de crédits vérifiés. Aucun virement, prélèvement, relance ou suspension."/>
  <p className="mb-4"><Link href="/finance" className="text-sm text-accent underline">← Catalogue des prestations</Link></p>
  {notice&&<p role="status" className="mb-4 rounded-xl border border-border bg-surface-raised p-3 text-sm">{notice}</p>}
  <Panel className="mb-6 p-5">
   <div className="flex flex-wrap items-center justify-between gap-3">
    <h2 className="text-lg font-semibold">Connexion Qonto</h2><Badge tone={configured?"green":"amber"}>{configured?"Variables configurées":"Connexion non configurée"}</Badge>
   </div>
   <p className="mt-2 text-sm text-muted">État de la dernière synchronisation : <strong>{state?.status==="ok"?"Réussie":state?.status==="error"?"Erreur":"Jamais exécutée"}</strong>
   {state?.last_success_at?" · Dernier succès : "+new Date(state.last_success_at).toLocaleString("fr-FR",{timeZone:"Europe/Paris"}):""}.
   Périmètre : dernières mises à jour sur 366 jours ; factures et crédits EUR seulement.</p>
   {state?.status==="error"&&<p className="mt-2 text-xs text-warning">La dernière tentative a échoué. Les données précédemment importées peuvent être périmées : ne pas déclencher de relances.</p>}
   <form action={syncQontoAction} className="mt-4">
    <button type="submit" disabled={!configured} className="min-h-11 rounded-lg bg-accent-strong px-4 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40">Synchroniser maintenant (lecture seule)</button>
   </form>
   {!configured&&<p className="mt-3 text-sm text-muted">Ajouter les variables serveur <code>QONTO_LOGIN</code>, <code>QONTO_SECRET_KEY</code> et <code>QONTO_EXPECTED_ORGANIZATION_SLUG</code> dans Vercel. Ne jamais saisir la clé bancaire dans cette page ou dans GitHub.</p>}
  </Panel>
  <div className="mb-6 grid gap-3 sm:grid-cols-3">
   <Panel className="p-4"><p className="text-xs text-muted">Factures importées</p><p className="mt-1 text-2xl font-semibold tabular-nums">{invoices.length}</p></Panel>
   <Panel className="p-4"><p className="text-xs text-muted">Crédits bancaires importés</p><p className="mt-1 text-2xl font-semibold tabular-nums">{credits.length}</p></Panel>
   <Panel className="p-4"><p className="text-xs text-muted">Rapprochements validés</p><p className="mt-1 text-2xl font-semibold tabular-nums">{allocations.length}</p></Panel>
  </div>
  <Panel className="mb-6 p-5">
   <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Factures clients Qonto</h2><span className="text-xs text-muted">250 dernières lignes maximum</span></div>
   {!invoices.length&&<p className="mt-3 text-sm text-muted">Aucune facture importée sur la période. Il ne s’agit pas d’une confirmation d’absence de facturation.</p>}
   <div className="mt-4 space-y-3">
    {invoices.map(i=>{
     const allocated=assignedInvoice.get(i.id)??0;
     const remaining=Math.max(0,i.total_cents-allocated);
     const candidate=candidateByInvoice.get(i.id);
     const availableCredit=candidate?creditById.get(candidate.transaction_id):null;
     return <article key={i.id} className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
       <div><p className="font-medium">{i.number} · {i.external_client_name??"Client Qonto non indiqué"}</p>
       <p className="mt-1 text-xs text-muted">Statut Qonto : {i.status} · Échéance : {i.due_on??"non fournie"} · {i.client_id? "Dossier CODE-V : "+(clientById.get(i.client_id)??"client introuvable"):"Dossier CODE-V non associé"}</p></div>
       <div className="text-right"><p className="font-medium tabular-nums">{euro(i.total_cents)}</p>
       <p className="text-xs text-muted">Rapproché : {euro(allocated)} · Disponible à rapprocher : {euro(remaining)}</p></div>
      </div>
      {!i.client_id&&<form action={assignQontoInvoiceAction} className="mt-3 flex flex-wrap items-end gap-2">
       <input type="hidden" name="invoice_id" value={i.id}/>
       <label className="min-w-48 flex-1 text-xs text-muted">Associer à un dossier client
        <select name="client_id" defaultValue="" required className={select}><option value="" disabled>Choisir un client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
       </label><button className="min-h-10 rounded-lg border border-border px-4 text-sm">Associer</button>
      </form>}
      {i.client_id&&remaining>0&&<div className="mt-4">
       {candidate&&availableCredit&&<form action={allocateQontoCreditAction} className="mb-3 rounded-lg border border-border bg-surface-raised p-3">
        <p className="mb-2 text-xs">Correspondance proposée : référence exacte de facture et montant identique. Crédit bancaire du {new Date(availableCredit.settled_at).toLocaleDateString("fr-FR",{timeZone:"Europe/Paris"})} ({euro(availableCredit.amount_cents)}). Vérifier avant de confirmer.</p>
        <input type="hidden" name="invoice_id" value={i.id}/><input type="hidden" name="transaction_id" value={candidate.transaction_id}/><input type="hidden" name="amount" value={(candidate.amount_cents/100).toFixed(2)}/>
        <button className="min-h-10 rounded-lg bg-accent-strong px-3 text-sm text-accent-foreground">Confirmer cette correspondance</button>
       </form>}
       <details><summary className="cursor-pointer text-sm text-accent">Rapprocher manuellement un crédit (y compris partiel)</summary>
        <form action={allocateQontoCreditAction} className="mt-3 flex flex-wrap items-end gap-3">
         <input type="hidden" name="invoice_id" value={i.id}/>
         <label className="min-w-[220px] flex-1 text-xs text-muted">Crédit bancaire EUR
          <select required name="transaction_id" defaultValue="" className={select}><option value="" disabled>Choisir un crédit</option>{remainingCredits.map(c=><option key={c.id} value={c.id}>{new Date(c.settled_at).toLocaleDateString("fr-FR",{timeZone:"Europe/Paris"})} · {euro(c.amount_cents-(assignedCredit.get(c.id)??0))} disponibles · {c.reference||c.label}</option>)}</select>
         </label>
         <label className="w-36 text-xs text-muted">Montant (€)<input required name="amount" inputMode="decimal" defaultValue={(remaining/100).toFixed(2)} className={select}/></label>
         <button className="min-h-10 rounded-lg border border-border px-3 text-sm">Valider le rapprochement</button>
        </form>
        <p className="mt-2 text-xs text-muted">Confirmation manuelle obligatoire. PostgreSQL refuse les montants supérieurs au solde de la facture ou du crédit.</p>
       </details>
      </div>}
     </article>;
    })}
   </div>
  </Panel>
  <Panel className="p-5"><h2 className="font-semibold">Crédits bancaires non rapprochés</h2>
   <p className="mt-1 text-xs text-muted">Crédits Qonto EUR terminés, non nécessairement des paiements clients. Une simple entrée d’argent ne valide aucune facture.</p>
   <div className="mt-4 space-y-2">{remainingCredits.slice(0,70).map(c=><div key={c.id} className="flex flex-wrap justify-between gap-3 border-b border-border py-2 text-sm">
    <div><p>{c.reference||c.label||"Sans référence"}</p><p className="text-xs text-muted">{new Date(c.settled_at).toLocaleDateString("fr-FR",{timeZone:"Europe/Paris"})} · {c.label}</p></div>
    <strong className="tabular-nums">{euro(c.amount_cents-(assignedCredit.get(c.id)??0))}</strong></div>)}
   {!remainingCredits.length&&<p className="text-sm text-muted">Aucun crédit disponible dans les données chargées.</p>}</div>
  </Panel>
 </>;
}
