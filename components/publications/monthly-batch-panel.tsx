import {Panel} from '@/components/ui/primitives';
import {MutationForm} from '@/components/ui/mutation-form';
import {approveMonthlyBatchAction} from '@/app/(cockpit)/publications/review-actions';
import {longDate,shortDate,type MonthlyBatch} from '@/lib/publications/monthly-cycle';
import type {MonthlyReview} from '@/lib/publications/monthly-review';

// Validation par lot du cycle mensuel : un bouton par client et un pour tout. Sans action, tout part quand même.
function deadlineLine(batch:MonthlyBatch,today:string){
 return today<=batch.deadline
  ?`Lot du ${shortDate(batch.from)} au ${shortDate(batch.to)} : à valider avant ${longDate(batch.deadline)}.`
  :`Lot du ${shortDate(batch.from)} au ${shortDate(batch.to)}. Prochain lot préparé le 1er du mois.`;
}
export function MonthlyBatchPanel({review}:{review:MonthlyReview}){
 const {batch,today,clients,pending}=review;
 return <Panel className="mt-6 p-6" data-monthly-batch="true">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Validation du mois</h2>
   <p className="mt-1 text-sm text-muted">{deadlineLine(batch,today)} Sans action de votre part, les publications partent quand même à leur créneau, images générées comprises.</p></div>
   {clients.length>1&&<MutationForm action={approveMonthlyBatchAction} label={`Tout valider (${pending})`} pendingLabel="Validation…" variant="primary" confirm={`Valider les ${pending} publications Google, Facebook et Instagram de tous les clients ?`}/>}</div>
  {!clients.length?<p className="mt-3 text-sm text-muted">Aucune publication Google, Facebook ou Instagram à valider.</p>
  :<ul className="mt-4 divide-y divide-border">{clients.map(c=><li key={c.clientId} className="flex flex-wrap items-center justify-between gap-3 py-3">
   <div><p className="font-medium">{c.clientName}</p><p className="text-sm text-muted">{c.pending} publication(s){c.first&&c.last?` · du ${shortDate(c.first)} au ${shortDate(c.last)}`:''}</p></div>
   <MutationForm action={approveMonthlyBatchAction} fields={{client_id:c.clientId}} label="Tout valider" pendingLabel="Validation…" confirm={`Valider les ${c.pending} publications de ${c.clientName} ?`}/></li>)}</ul>}
 </Panel>;
}
