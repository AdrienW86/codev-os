'use client';
import {useActionState} from 'react';
import {Panel} from '@/components/ui/primitives';
import {prepareOccurrencesAction,type OccurrencePrepareState} from '@/app/(cockpit)/publications/occurrence-actions';
import {DEFAULT_PREPARE_WEEKS,PREPARE_WEEK_OPTIONS} from '@/lib/publications/occurrence-model';

// Explicit admin action: creates the missing dated occurrences for the next weeks. No content, no publication.
export function OccurrencePrepareForm({projectId}:{projectId:string}){
 const [state,prepare,pending]=useActionState(prepareOccurrencesAction,{} as OccurrencePrepareState);
 return <Panel className="mt-6 p-5"><form action={prepare} className="flex flex-wrap items-end gap-3"><input type="hidden" name="project_id" value={projectId}/>
  <div className="flex-1"><h2 className="font-semibold">Préparer les prochaines semaines</h2><p className="mt-1 text-sm text-muted">Crée les occurrences manquantes à partir du planning de chaque canal actif. Les occurrences existantes ne sont jamais déplacées.</p></div>
  <label className="grid gap-1 text-sm">Période<select name="weeks" defaultValue={DEFAULT_PREPARE_WEEKS} className="rounded-lg border border-border bg-background p-2">{PREPARE_WEEK_OPTIONS.map(w=><option key={w} value={w}>{w} semaine{w>1?'s':''}</option>)}</select></label>
  <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background">{pending?'Préparation…':'Préparer les prochaines semaines'}</button>
  {state.message&&<p role={state.ok?'status':'alert'} className={`w-full text-sm ${state.ok?'':'text-red-400'}`}>{state.message}</p>}</form></Panel>;
}
