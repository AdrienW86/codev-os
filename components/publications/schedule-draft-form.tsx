'use client';
import Link from 'next/link';
import {useActionState,useState} from 'react';
import {flash} from '@/components/ui/flash';
import {manualScheduleAction,scheduleDraftAction,type ManualScheduleState,type ScheduleDraftState} from '@/app/(cockpit)/publications/[id]/schedule-actions';
import {manualApprovalLabel,manualScheduledLabel,type ManualApproval} from '@/lib/publications/manual-scheduling-model';
import type {ScheduleChoice} from '@/lib/publications/draft-scheduling-model';
import {platformLabels} from '@/lib/publications/editor';
import type {PublicationPlatform} from '@/lib/publications/types';

// « Planifier ce brouillon » : un créneau ouvert du calendrier par plateforme du brouillon. Les créneaux pris,
// ignorés ou passés ne sont pas proposés ; la base les refuse aussi en cas de course.
// Deux façons de programmer un brouillon : maintenant ou à une date libre (hors planning), ou sur un créneau du planning.
export function ScheduleDraftForm({publicationId,revisionId,choices}:{publicationId:string;revisionId:string;choices:ScheduleChoice[]}){
 return <div className="space-y-6"><ManualScheduleForm publicationId={publicationId} revisionId={revisionId}/>
  <div className="space-y-2 border-t border-border pt-4"><h3 className="text-sm font-semibold">Ou sur un créneau du planning</h3><SlotScheduleForm publicationId={publicationId} revisionId={revisionId} choices={choices}/></div></div>;
}
function SlotScheduleForm({publicationId,revisionId,choices}:{publicationId:string;revisionId:string;choices:ScheduleChoice[]}){
 const [state,schedule,pending]=useActionState(async(previous:ScheduleDraftState,form:FormData)=>{
  const result=await scheduleDraftAction(previous,form);
  if(result.ok&&result.message)flash(result.message);
  return result;
 },{} as ScheduleDraftState);
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

// « Publier maintenant » ou « à une date » : le navigateur convertit l'heure locale saisie en instant ISO. Après
// programmation, chaque publication est validée d'office (sauf TikTok : réglages à choisir sur sa fiche).
const pad=(n:number)=>String(n).padStart(2,'0');
const localInput=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function ManualScheduleForm({publicationId,revisionId}:{publicationId:string;revisionId:string}){
 const [when,setWhen]=useState<'now'|'at'>('now');const [local,setLocal]=useState('');
 const [state,schedule,pending]=useActionState(async(previous:ManualScheduleState,form:FormData)=>{
  const result=await manualScheduleAction(previous,form);
  if(result.ok&&result.message)flash(result.message);
  return result;
 },{} as ManualScheduleState);
 if(state.ok)return <div role="status" className="space-y-2 text-sm"><p>{state.message}</p>
  {state.scheduledFor&&<p className="text-muted">Départ prévu : {manualScheduledLabel(state.scheduledFor)}.</p>}
  <ul className="space-y-1">{state.publications?.map(p=><li key={p.publicationId}><Link className="text-accent" href={`/publications/${p.publicationId}`}>{manualApprovalLabel(p.platform as PublicationPlatform,p.approval as ManualApproval)}</Link></li>)}</ul></div>;
 const iso=when==='at'&&local&&!Number.isNaN(new Date(local).getTime())?new Date(local).toISOString():'';
 const now=new Date();
 return <form action={schedule} className="space-y-3 text-sm"><input type="hidden" name="publication_id" value={publicationId}/><input type="hidden" name="revision_id" value={revisionId}/>
  <input type="hidden" name="when" value={when}/>{when==='at'&&<input type="hidden" name="at" value={iso}/>}
  <h3 className="font-semibold">Publier quand je veux</h3>
  <fieldset className="flex flex-wrap gap-4"><legend className="sr-only">Moment de publication</legend>
   <label className="flex items-center gap-2"><input type="radio" name="when_choice" checked={when==='now'} onChange={()=>setWhen('now')}/>Maintenant</label>
   <label className="flex items-center gap-2"><input type="radio" name="when_choice" checked={when==='at'} onChange={()=>setWhen('at')}/>À une date et une heure</label></fieldset>
  {when==='at'&&<label className="block"><span className="font-medium">Date et heure</span>
   <input type="datetime-local" required value={local} min={localInput(now)} max={localInput(new Date(now.getTime()+84*86400000))} onChange={e=>setLocal(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2"/></label>}
  <p className="text-muted">Une publication par réseau du brouillon, en dehors du planning. Elles sont validées d’office, sauf TikTok (réglages à choisir sur sa fiche). L’envoi part dans les 15 minutes qui suivent l’heure choisie.</p>
  <button disabled={pending||(when==='at'&&!iso)} className="rounded-lg bg-accent-strong px-3 py-1 font-semibold text-accent-foreground hover:bg-accent disabled:opacity-60">{pending?'Programmation…':when==='now'?'Publier maintenant':'Programmer à cette date'}</button>
  {state.message&&<p role="alert" className="text-danger">{state.message}</p>}</form>;
}
