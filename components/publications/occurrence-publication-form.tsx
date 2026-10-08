'use client';
import {useActionState,useState} from 'react';
import {createFromOccurrenceAction,type OccurrencePublicationState} from '@/app/(cockpit)/publications/occurrence-actions';
import {CTA_MAX,SUBJECT_MAX,TEXT_MAX,type GroupChoice,type GroupMode} from '@/lib/publications/occurrence-creation-model';

// One mono-platform draft from one occurrence (Lot 4.3 P4-b). Platform, date and project come from the occurrence;
// the editorial group is optional (none / new / existing group of the same project). Nothing is published.
const input='mt-1 w-full rounded-lg border border-border bg-background p-2 text-sm';
export function OccurrencePublicationForm({projectId,occurrenceId,date,platformLabel,groups}:{projectId:string;occurrenceId:string;date:string;platformLabel:string;groups:GroupChoice[]}){
 const [state,create,pending]=useActionState(createFromOccurrenceAction,{} as OccurrencePublicationState);
 const available=groups.filter(g=>g.available),[mode,setMode]=useState<GroupMode>('none');
 return <form action={create} className="mt-4 space-y-4"><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="occurrence_id" value={occurrenceId}/><input type="hidden" name="date" value={date}/>
  <label className="block text-sm">Sujet<input className={input} name="subject" required maxLength={SUBJECT_MAX}/></label>
  <label className="block text-sm">Texte {platformLabel}<textarea className={input} name="text" required maxLength={TEXT_MAX} rows={8}/></label>
  <label className="block text-sm">CTA (facultatif)<input className={input} name="cta" maxLength={CTA_MAX}/></label>
  <fieldset className="space-y-2 text-sm"><legend className="font-medium">Groupe éditorial</legend>
   <label className="block"><input type="radio" name="group_mode" value="none" checked={mode==='none'} onChange={()=>setMode('none')}/> Aucun groupe</label>
   <label className="block"><input type="radio" name="group_mode" value="new" checked={mode==='new'} onChange={()=>setMode('new')}/> Nouveau groupe (même idée déclinée sur plusieurs plateformes)</label>
   {mode==='new'&&<input className={input} name="new_group_subject" required maxLength={SUBJECT_MAX} placeholder="Idée éditoriale commune"/>}
   <label className="block"><input type="radio" name="group_mode" value="existing" disabled={!available.length} checked={mode==='existing'} onChange={()=>setMode('existing')}/> Groupe existant</label>
   {mode==='existing'&&<select className={input} name="group_id" required defaultValue="">{[<option key="" value="" disabled>Choisir un groupe</option>,...available.map(g=><option key={g.id} value={g.id}>{g.subject}</option>)]}</select>}
   {groups.length>available.length&&<p className="text-xs text-muted">Les groupes ayant déjà une publication {platformLabel} ne sont pas proposés.</p>}
  </fieldset>
  <button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-background">{pending?'Enregistrement…':'Enregistrer en brouillon'}</button>
  {state.message&&<p role="alert" className="text-sm text-red-400">{state.message}</p>}</form>;
}
