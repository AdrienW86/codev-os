'use client';
import {useActionState} from 'react';
import {cleanupBoardAction,type CleanupState} from '@/app/(cockpit)/publications/cleanup-actions';
import {cleanupCategories,cleanupLabels,type CleanupCategory} from '@/lib/publications/cleanup-rules';

// Board clean-up: archives finished publications in bulk. Nothing is deleted; they move to the « Archivées » view.
const initial:CleanupState={};
export function CleanupForm({counts,clients}:{counts:Record<CleanupCategory,number>|null;clients:{id:string;name:string}[]}){
 const [state,run,pending]=useActionState(cleanupBoardAction,initial);
 const total=counts?cleanupCategories.reduce((sum,c)=>sum+counts[c],0):0;
 return <details className="mt-4 rounded-xl border border-border p-4 text-sm" data-board-cleanup="true">
  <summary className="cursor-pointer font-semibold">Nettoyer le tableau{counts?` (${total} publication${total>1?'s':''} terminée${total>1?'s':''})`:''}</summary>
  <form action={run} className="mt-3 grid gap-3">
   <p className="text-xs text-muted">Archive en une fois les publications terminées. Elles disparaissent du tableau et du calendrier mais restent consultables (avec leur historique) dans la vue « Archivées ». Les envois programmés pas encore partis sont annulés ; rien n’est supprimé sur Facebook, Instagram ou la fiche Google.</p>
   <fieldset className="flex flex-wrap gap-4">{cleanupCategories.map(c=><label key={c} className="flex items-center gap-2">
    <input type="checkbox" name="category" value={c} defaultChecked={c!=='past'}/>{cleanupLabels[c]}{counts?` (${counts[c]})`:''}</label>)}</fieldset>
   <label className="flex flex-wrap items-center gap-2">Client
    <select name="client_id" defaultValue="" className="rounded-lg border border-border bg-transparent px-2 py-1"><option value="">Tous les clients</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label className="flex items-center gap-2"><input type="checkbox" name="confirm" required/>Je confirme l’archivage des publications cochées.</label>
   <div><button disabled={pending} className="rounded-lg border border-border px-3 py-2">{pending?'Archivage…':'Archiver les publications terminées'}</button></div>
   {state.message&&<p role={state.ok?'status':'alert'} className={state.ok?'':'text-danger'}>{state.message}</p>}
  </form></details>;
}
