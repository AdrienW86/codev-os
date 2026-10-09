'use client';
import {useActionState} from 'react';
import {confirmNotPublishedAction,prepareDeliveryAction,reconcileDeliveryAction,retryDeliveryAction,type DeliveryActionState} from '@/app/(cockpit)/publications/delivery-actions';
import {formatDate} from '@/lib/format-date';
import {DELIVERY_ENGINE_NOTICE,type DeliveryView,type DiffusionView} from '@/lib/publications/delivery/model';

// Drawer « Diffusion » (Lot 4.3 P10): status, account, attempts, last safe error, next retry. No per-publication
// « Publier maintenant »: sending goes through the admin trigger « Envoyer les publications dues » (P13).
const initial:DeliveryActionState={};
export function DeliverySection({publicationId,diffusion}:{publicationId:string;diffusion:DiffusionView}){
 return <section className="rounded-xl border border-border p-4" data-diffusion="true"><h3 className="font-semibold">Diffusion</h3>
  <p role="note" className="mt-1 text-xs text-muted" data-engine-mode="manual-trigger">{DELIVERY_ENGINE_NOTICE}</p>
  {diffusion.deliveries.length?<ul className="mt-3 space-y-3 text-sm">{diffusion.deliveries.map(d=><DeliveryRowView key={d.id} publicationId={publicationId} delivery={d}/>)}</ul>
   :<p className="mt-3 text-sm text-muted">Aucune diffusion préparée.</p>}
  {diffusion.canPrepare&&<PrepareForm publicationId={publicationId}/>}</section>;
}
function DeliveryRowView({publicationId,delivery:d}:{publicationId:string;delivery:DeliveryView}){
 return <li className="rounded-lg border border-border p-3" data-delivery-status={d.status}>
  <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{d.platformLabel}</span><span className="text-muted">· {d.accountLabel}</span>
   <span className="rounded-full border border-border px-2 py-0.5 text-xs">{d.statusLabel}</span></p>
  <p className="mt-1 text-xs text-muted">{d.attempts} tentative{d.attempts>1?'s':''}{d.nextRetryAt?` · prochaine tentative le ${formatDate(d.nextRetryAt)}`:''}</p>
  {d.blockedReason&&<p className="mt-1 text-xs">Motif : {d.blockedReason}</p>}
  {d.lastError&&<p className="mt-1 text-xs text-red-400">Dernière erreur : {d.lastError}</p>}
  {d.remoteLabel&&<p className="mt-1 text-xs text-muted">{d.remoteLabel}</p>}
  {d.canRetry&&<RetryForm publicationId={publicationId} deliveryId={d.id}/>}
  {d.canReconcile&&<ReconcileForms deliveryId={d.id}/>}</li>;
}
function PrepareForm({publicationId}:{publicationId:string}){
 const [state,prepare,pending]=useActionState(prepareDeliveryAction,initial);
 return <form action={prepare} className="mt-3 space-y-2 text-sm"><input type="hidden" name="publication_id" value={publicationId}/>
  <button disabled={pending} className="rounded-lg border border-border px-3 py-2">{pending?'Préparation…':'Préparer la diffusion'}</button>
  {state.message&&<p role={state.ok?'status':'alert'} className={state.ok?'':'text-red-400'}>{state.message}</p>}</form>;
}
function RetryForm({publicationId,deliveryId}:{publicationId:string;deliveryId:string}){
 const [state,retry,pending]=useActionState(retryDeliveryAction,initial);
 return <form action={retry} className="mt-2 flex flex-wrap items-center gap-2"><input type="hidden" name="publication_id" value={publicationId}/><input type="hidden" name="delivery_id" value={deliveryId}/>
  <button disabled={pending} className="rounded-lg border border-border px-3 py-1 text-xs">{pending?'Planification…':'Réessayer'}</button>
  {state.message&&<span role={state.ok?'status':'alert'} className={`text-xs ${state.ok?'':'text-red-400'}`}>{state.message}</span>}</form>;
}
// Uncertain: check with the provider (read only), then, if nothing was found, explicitly confirm it was not published.
function ReconcileForms({deliveryId}:{deliveryId:string}){
 const [checked,check,checking]=useActionState(reconcileDeliveryAction,initial);
 const [confirmed,confirm,confirming]=useActionState(confirmNotPublishedAction,initial);
 return <div className="mt-2 space-y-2 text-xs" data-reconcile="true">
  <form action={check} className="flex flex-wrap items-center gap-2"><input type="hidden" name="delivery_id" value={deliveryId}/>
   <button disabled={checking} className="rounded-lg border border-border px-3 py-1">{checking?'Vérification…':'Vérifier chez le fournisseur'}</button>
   {checked.message&&<span role={checked.ok?'status':'alert'} className={checked.ok?'':'text-red-400'}>{checked.message}</span>}</form>
  <form action={confirm} className="flex flex-wrap items-center gap-2"><input type="hidden" name="delivery_id" value={deliveryId}/>
   <button disabled={confirming} className="rounded-lg border border-red-400 px-3 py-1 text-red-400">{confirming?'Enregistrement…':'Confirmer : non publiée'}</button>
   {confirmed.message&&<span role={confirmed.ok?'status':'alert'} className={confirmed.ok?'':'text-red-400'}>{confirmed.message}</span>}</form></div>;
}
