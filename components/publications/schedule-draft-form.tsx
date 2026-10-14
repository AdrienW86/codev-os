'use client';
import Link from 'next/link';
import {useActionState} from 'react';
import {scheduleDraftAction,type ScheduleDraftState} from '@/app/(cockpit)/publications/[id]/schedule-actions';
import type {ScheduleChoice} from '@/lib/publications/draft-scheduling-model';
import {platformLabels} from '@/lib/publications/editor';
import type {PublicationPlatform} from '@/lib/publications/types';

// « Planifier ce brouillon » : un créneau ouvert du calendrier par plateforme du brouillon. Les créneaux pris,
// ignorés ou passés ne sont pas proposés ; la base les refuse aussi en cas de course.
export function ScheduleDraftForm({publicationId,revisionId,choices}:{publicationId:string;revisionId:string;choices:ScheduleChoice[]}){
 const [state,schedule,pending]=useActionState(scheduleDraftAction,{} as ScheduleDraftState);
 const missing=choices.filter(c=>!c.options.length);
 if(state.ok)return <div role="status" className="space-y-2 text-sm"><p>{state.message}</p><ul className="space-y-1">{state.publications?.map(p=><li key={p.publicationId}><Link className="text-accent" href={`/publications/${p.publicationId}`}>Ouvrir la publication {platformLabels[p.platform as PublicationPlatform]??'—'}</Link></li>)}</ul></div>;
 return <form action={schedule} className="space-y-3 text-sm"><input type="hidden" name="publication_id" value={publicationId}/><input type="hidden" name="revision_id" value={revisionId}/>
  {choices.map(c=><label key={c.platform} className="block"><span className="font-medium">{c.label}</span>
   <select name={`occurrence_${c.platform}`} required disabled={!c.options.length} className="mt-1 block w-full rounded-lg border border-border bg-background p-2">
    <option value="">{c.options.length?'Choisir un créneau':'Aucun créneau ouvert sur 12 semaines'}</option>{c.options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>)}
  {choices.length>1&&<p className="text-muted">Une publication sera créée par plateforme, chacune sur son créneau ; le brouillon d’origine sera archivé et restera consultable.</p>}
  <p className="text-muted">Planifier fixe une date : une nouvelle révision est créée et doit être soumise à validation, même si ce brouillon était déjà approuvé.</p>
  {missing.length>0&&<p role="alert" className="text-danger">Préparez d’abord des créneaux pour {missing.map(c=>c.label).join(', ')} dans le calendrier du projet.</p>}
  <button disabled={pending||missing.length>0} className="rounded-lg border border-border px-3 py-1">{pending?'Planification…':'Planifier ce brouillon'}</button>
  {state.message&&<p role="alert" className="text-danger">{state.message}</p>}</form>;
}
