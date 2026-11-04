'use client';
import Link from 'next/link';
import {useActionState} from 'react';
import {reconcileDeliveryAction,retryDeliveryAction,type DeliveryActionState} from '@/app/(cockpit)/publications/delivery-actions';

// Calendrier, vue « À traiter » : l'action utile directement sur la carte. Échec, blocage ou nouvel essai prévu →
// « Réessayer » (mêmes contrôles serveur que la fiche) ; envoi non confirmé → « Vérifier » chez le réseau (lecture seule,
// jamais un renvoi : un doublon serait pire qu'un oubli), la décision finale restant sur la fiche de la publication.
const initial:DeliveryActionState={};
const button='min-h-9 rounded-lg border border-border px-3 text-xs font-medium disabled:opacity-60';
export function ProblemActions({publicationId,deliveryId,status,label}:{publicationId:string;deliveryId:string;status:string;label:string}){
 const [retried,retry,retrying]=useActionState(retryDeliveryAction,initial);
 const [checked,check,checking]=useActionState(reconcileDeliveryAction,initial);
 const state=status==='uncertain'?checked:retried;
 return <div className="mt-2 flex flex-wrap items-center gap-2" data-problem-actions>
  {status==='uncertain'
   ?<form action={check}><input type="hidden" name="delivery_id" value={deliveryId}/><button disabled={checking} className={button} aria-label={`Vérifier l’envoi ${label}`}>{checking?'Vérification…':`Vérifier ${label}`}</button></form>
   :<form action={retry}><input type="hidden" name="publication_id" value={publicationId}/><input type="hidden" name="delivery_id" value={deliveryId}/>
     <button disabled={retrying||retried.ok===true} className={`${button} bg-accent-strong text-accent-foreground`} aria-label={`Réessayer l’envoi ${label}`}>{retrying?'Planification…':retried.ok?'Relancé':`Réessayer ${label}`}</button></form>}
  {state.message&&<span role={state.ok?'status':'alert'} className={`text-xs ${state.ok?'':'text-danger'}`}>{state.message}{status==='uncertain'&&checked.result==='missing'&&<> <Link href={`/publications/${publicationId}`} className="underline">Décider sur la fiche</Link></>}</span>}
 </div>;
}
