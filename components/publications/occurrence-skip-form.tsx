'use client';
import {useActionState} from 'react';
import {skipOccurrenceAction,type OccurrencePublicationState} from '@/app/(cockpit)/publications/occurrence-actions';
import {SKIP_REASON_MAX} from '@/lib/publications/occurrence-creation-model';

// "Ignorer ce créneau": explicit, one-way, with a reason and a confirmation checkbox (no modal).
export function OccurrenceSkipForm({projectId,occurrenceId}:{projectId:string;occurrenceId:string}){
 const [state,skip,pending]=useActionState(skipOccurrenceAction,{} as OccurrencePublicationState);
 return <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted">Ignorer ce créneau</summary>
  <form action={skip} className="mt-2 space-y-2"><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="occurrence_id" value={occurrenceId}/>
   <input name="reason" required maxLength={SKIP_REASON_MAX} placeholder="Motif (obligatoire)" className="w-full rounded-lg border border-border bg-background p-2"/>
   <label className="block"><input type="checkbox" name="confirm" required/> Je confirme : ce créneau ne pourra pas être rétabli.</label>
   <button disabled={pending} className="rounded-lg border border-border px-3 py-1">{pending?'Enregistrement…':'Ignorer ce créneau'}</button>
   {state.message&&<p role={state.ok?'status':'alert'} className={state.ok?'':'text-red-400'}>{state.message}</p>}</form></details>;
}
