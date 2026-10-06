/* eslint-disable @next/next/no-img-element -- Private signed URLs are short-lived and must not be cached by an image proxy. */
'use client';
import {useActionState,useState} from 'react';
import {approveFromCardAction,editFromCardAction,rejectFromCardAction,type ReviewCardState} from '@/app/(cockpit)/publications/review-actions';
import {AgentPrepareForm} from './agent-forms';
import {DebugDetails} from '@/components/projects/debug-details';
import type {ReviewCardData} from '@/lib/publications/review-cards';
const input='mt-1 block w-full rounded-lg border border-border bg-background p-3 text-sm';
const statusLabels={pending_review:'À valider',rejected:'Rejeté'} as const;
export function formatLongDate(date:string){const d=new Date(date+'T00:00:00Z');return Number.isNaN(d.getTime())?date:new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(d);}
// Hidden identifiers are required by the existing Server Actions; they are never rendered as visible text.
function Ids({card}:{card:ReviewCardData}){return <><input type="hidden" name="publication_id" value={card.publicationId}/><input type="hidden" name="revision_id" value={card.revisionId}/><input type="hidden" name="project_id" value={card.projectId}/></>;}
export function ReviewEditForm({card,onCancel}:{card:ReviewCardData;onCancel?:()=>void}){
 const [state,action,pending]=useActionState<ReviewCardState,FormData>(editFromCardAction,{});
 return <form action={action} className="mt-4 space-y-4"><Ids card={card}/><input type="hidden" name="client_id" value={card.clientId}/><input type="hidden" name="title" value={card.editorial.title}/><input type="hidden" name="angle" value={card.editorial.angle}/><input type="hidden" name="source" value={card.editorial.source}/><input type="hidden" name="target_date" value={card.editorial.targetDate}/>
 {card.variants.map(v=><fieldset key={v.platform} className="space-y-2 rounded-lg border border-border p-4"><legend className="px-1 text-sm font-semibold">{v.label}</legend><input type="hidden" name={`${v.platform}_enabled`} value="on"/>{v.assetIds.map(id=><input key={id} type="hidden" name={`${v.platform}_assets`} value={id}/>)}
  <label className="block text-sm">Texte<textarea className={input} name={`${v.platform}_text`} required maxLength={10000} rows={6} defaultValue={v.text}/></label>
  {v.title!==null&&<label className="block text-sm">Titre<input className={input} name={`${v.platform}_title`} maxLength={500} defaultValue={v.title}/></label>}
  {v.cta!==null&&<label className="block text-sm">CTA<input className={input} name={`${v.platform}_cta`} maxLength={500} defaultValue={v.cta}/></label>}</fieldset>)}
 <p className="text-xs text-muted">Une nouvelle version est créée et soumise à validation. Les versions précédentes restent inchangées dans l’historique.</p>
 <div className="flex flex-wrap gap-3"><button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-background">{pending?'Enregistrement…':'Enregistrer les modifications'}</button>{onCancel&&<button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2">Annuler</button>}</div>{state.message&&<p role="status" className="text-sm">{state.message}</p>}</form>;
}
export function ReviewRejectForm({card,onCancel}:{card:ReviewCardData;onCancel?:()=>void}){
 const [state,action,pending]=useActionState<ReviewCardState,FormData>(rejectFromCardAction,{});
 return <form action={action} className="mt-4 space-y-3"><Ids card={card}/><label className="block text-sm">Motif du rejet<textarea className={input} name="reason" required minLength={10} maxLength={3000} rows={3} placeholder="Expliquez ce qui doit changer (10 caractères minimum)."/></label>
 <div className="flex flex-wrap gap-3"><button disabled={pending} className="rounded-lg border border-red-600 px-4 py-2 text-red-700">{pending?'Enregistrement…':'Confirmer le rejet'}</button>{onCancel&&<button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2">Annuler</button>}</div>{state.message&&<p role="status" className="text-sm">{state.message}</p>}</form>;
}
export function ReviewApproveForm({card}:{card:ReviewCardData}){
 const [state,action,pending]=useActionState<ReviewCardState,FormData>(approveFromCardAction,{});
 return <form action={action}><Ids card={card}/><button disabled={pending} className="rounded-lg bg-accent px-4 py-2 text-background">{pending?'Validation…':'Valider'}</button>{state.message&&<p role="status" className="mt-2 text-sm">{state.message}</p>}</form>;
}
export function ReviewCard({card,showContext=false}:{card:ReviewCardData;showContext?:boolean}){
 const [platform,setPlatform]=useState(card.variants[0]?.platform),[mode,setMode]=useState<'view'|'edit'|'reject'>('view');
 return <article className="rounded-xl border border-border p-5" data-review-card={card.status}>
 <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
  {card.image?<img src={card.image} alt="Photo associée à la publication" className="max-h-48 w-full rounded-lg object-contain"/>:<div role="img" aria-label="Image indisponible" className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted">Image indisponible</div>}
  <div><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted">{formatLongDate(card.date)}</p><span className="rounded-full border border-border px-2 py-0.5 text-xs">{statusLabels[card.status]}</span></div>
   {showContext&&<p className="mt-1 text-xs text-muted">{card.clientName} · {card.projectName}</p>}
   <h3 className="mt-2 font-semibold">{card.subject}</h3><p className="mt-1 text-xs text-muted">{card.variants.map(v=>v.label).join(' · ')}</p>
   {card.rejection&&<p className="mt-3 rounded-lg border border-red-600/40 p-3 text-sm"><span className="font-medium">Motif du rejet :</span> {card.rejection}</p>}</div></div>
 {mode==='edit'?<ReviewEditForm card={card} onCancel={()=>setMode('view')}/>:<>
  <div role="tablist" aria-label="Plateformes" className="mt-4 flex flex-wrap gap-1 border-b border-border">{card.variants.map(v=><button key={v.platform} type="button" role="tab" aria-selected={v.platform===platform} onClick={()=>setPlatform(v.platform)} className={`-mb-px rounded-t-lg border px-3 py-1.5 text-sm ${v.platform===platform?'border-border border-b-background font-semibold':'border-transparent text-muted'}`}>{v.label}</button>)}</div>
  {card.variants.map(v=><section key={v.platform} role="tabpanel" data-platform={v.platform} hidden={v.platform!==platform} className="mt-3 space-y-2 text-sm">{v.title&&<p className="font-semibold">{v.title}</p>}<p className="whitespace-pre-wrap">{v.text}</p>{v.cta&&<p className="rounded-lg border border-border p-2"><span className="text-xs text-muted">CTA · </span>{v.cta}</p>}</section>)}
  {card.status==='pending_review'&&(mode==='reject'?<ReviewRejectForm card={card} onCancel={()=>setMode('view')}/>:<div className="mt-5 flex flex-wrap items-start justify-between gap-3"><button type="button" onClick={()=>setMode('edit')} className="rounded-lg border border-border px-4 py-2">Modifier</button><button type="button" onClick={()=>setMode('reject')} className="rounded-lg border border-red-600 px-4 py-2 text-red-700">Rejeter</button><ReviewApproveForm card={card}/></div>)}
  {card.status==='rejected'&&<div className="mt-5 rounded-lg border border-border p-4"><h4 className="text-sm font-semibold">Régénérer</h4><p className="mt-1 text-xs text-muted">Une seule publication, en tenant compte du motif du rejet. La nouvelle version sera soumise à validation.</p><AgentPrepareForm projectId={card.projectId} publicationId={card.publicationId} regenerate/></div>}</>}
 <details className="mt-5 text-sm"><summary className="cursor-pointer text-muted">Historique des versions</summary><ol className="mt-2 space-y-1">{card.versions.map(v=><li key={v.number}>Version {v.number} · {v.origin} · {formatLongDate(v.date.slice(0,10))}{v.decision?` · ${v.decision}`:''}{v.reason?` · ${v.reason}`:''}{v.current?' · actuelle':''}</li>)}</ol></details>
 {card.debug&&<DebugDetails enabled data={card.debug}/>}</article>;
}
