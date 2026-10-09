'use client';
import {useActionState} from 'react';
import {processDuePublicationsAction,type DeliveryActionState} from '@/app/(cockpit)/publications/delivery-actions';

// Explicit admin trigger (Lot 4.3 P13): sends the deliveries prepared after approval whose time has come, at most a
// few per click. The server refuses while the emergency stop is active or publishing is disabled.
const initial:DeliveryActionState={};
export function ProcessDueForm({stopped}:{stopped:boolean}){
 const [state,run,pending]=useActionState(processDuePublicationsAction,initial);
 return <form action={run} className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border p-4 text-sm" data-process-due="true">
  <div className="min-w-0 flex-1"><p className="font-semibold">Envoi des publications dues</p>
   <p className="text-xs text-muted">{stopped?'Arrêt d’urgence actif ou publication désactivée : rien ne sera envoyé.':'Envoie les diffusions préparées dont l’heure est arrivée (5 au plus par clic).'}</p></div>
  <button disabled={pending} className="rounded-lg border border-border px-3 py-2">{pending?'Envoi…':'Envoyer les publications dues'}</button>
  {state.message&&<p role={state.ok?'status':'alert'} className={`w-full ${state.ok?'':'text-red-400'}`}>{state.message}</p>}</form>;
}
