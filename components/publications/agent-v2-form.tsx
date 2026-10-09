'use client';
/* eslint-disable @next/next/no-img-element -- Private signed URLs are short-lived and must not be cached by an image proxy. */
import Link from 'next/link';
import {useActionState} from 'react';
import {prepareNextPublicationsAction,retryAgentV2MediaAction,type AgentV2MediaRetryState,type AgentV2State} from '@/app/(cockpit)/publications/agent-v2-actions';
import {MEDIA_STATE_LABELS,type AgentV2MediaView} from '@/lib/publications/agent-v2/media-view';

// Selected media of a preparation: state, category and short-lived signed preview only (never a Drive id or path).
export function AgentV2MediaSummary({media}:{media:AgentV2MediaView}){
 const warning=media.state==='failed'||media.state==='pending';
 return <div className="flex flex-wrap items-center gap-3" data-agent-v2-media={media.state}>
  {media.preview&&<img src={media.preview} alt="Aperçu du média attaché aux brouillons" className="h-16 w-16 rounded object-cover"/>}
  <span className={warning?'text-red-400':''}>{MEDIA_STATE_LABELS[media.state]}</span>
  {media.category&&<span className="text-muted">Catégorie : {media.category}</span>}
  {media.state!=='attached'&&<span className="text-muted">Média requis avant validation.</span>}</div>;
}
// Agent Publications v2 trigger: explicit AI authorization, drafts only, links to the created publications.
export function AgentV2Form({projectId,disabled}:{projectId:string;disabled:boolean}){
 const [state,prepare,pending]=useActionState(prepareNextPublicationsAction,{} as AgentV2State);
 const warning=state.ok&&(state.media?.state==='failed'||state.media?.state==='pending');
 return <form action={prepare} className="mt-4 space-y-3 text-sm"><input type="hidden" name="project_id" value={projectId}/>
  <label className="block"><input type="checkbox" name="authorize_ai" required disabled={disabled}/> J’autorise un appel IA réel pour préparer ces brouillons (aucune publication n’est diffusée).</label>
  <button disabled={disabled||pending} className="rounded-lg bg-accent px-4 py-2 font-semibold text-background disabled:opacity-50">{pending?'Préparation…':'Préparer les prochaines publications'}</button>
  {state.message&&<p role={state.ok&&!warning?'status':'alert'} className={state.ok&&!warning?'':'text-red-400'}>{state.message}</p>}
  {state.ok&&state.media&&<AgentV2MediaSummary media={state.media}/>}
  {state.ok&&state.publications&&state.publications.length>0&&<ul className="space-y-1" data-agent-v2-created="true">{state.publications.map(p=><li key={p.id}><Link className="text-accent" href={`/publications?publication=${p.id}`}>{p.label} · brouillon à relire</Link></li>)}</ul>}</form>;
}
// Explicit retry of the media step only (same drafts, no AI call).
export function AgentV2MediaRetryForm({runId}:{runId:string}){
 const [state,retry,pending]=useActionState(retryAgentV2MediaAction,{} as AgentV2MediaRetryState);
 return <form action={retry} className="flex flex-wrap items-center gap-2"><input type="hidden" name="run_id" value={runId}/>
  <button disabled={pending} className="rounded-lg border border-border px-3 py-1 disabled:opacity-50">{pending?'Attachement…':'Réessayer l’attachement du média'}</button>
  {state.message&&<span role={state.ok?'status':'alert'} className={state.ok?'':'text-red-400'}>{state.message}</span>}</form>;
}
