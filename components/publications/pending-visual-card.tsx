'use client';
import {useActionState} from 'react';
import {decideVisualAction} from '@/app/(cockpit)/publications/image-actions';
import type {PendingVisual} from '@/lib/visual-agent/service';
// Visuel planifié de l'Agent Visuels en attente : rien ne rejoint le Drive ni la photothèque sans « Valider ».
export function PendingVisualCard({item}:{item:PendingVisual}){
 const [state,action,pending]=useActionState(decideVisualAction,{});
 const done=state.ok===true;
 return <article className="grid gap-5 rounded-2xl border border-border bg-surface p-5 shadow-card md:grid-cols-[minmax(0,280px)_1fr]">
  <div>
   {/* Aperçu signé (15 min) d'un stockage privé : pas d'optimisation next/image sur une URL à durée limitée. */}
   {/* eslint-disable-next-line @next/next/no-img-element */}
   {item.preview?<img src={item.preview} alt={`Visuel « ${item.headline} »`} className="aspect-[4/5] w-full rounded-xl border border-border object-cover"/>:<p className="rounded-xl border border-border p-6 text-sm text-muted">Aperçu indisponible. Rechargez la page.</p>}
   <p className="mt-2 text-xs text-muted">{item.withPhoto?'Mise en page à la charte sur une vraie photo de la photothèque du client.':'Mise en page graphique à la charte (aucune photo correspondante dans la photothèque).'}</p>
  </div>
  <div className="min-w-0 space-y-4">
   <div><p className="text-xs font-semibold tracking-wide text-accent-hover uppercase">{item.clientName}</p>
    <p className="text-sm text-muted">{item.service} · proposé le {new Date(item.createdAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris',dateStyle:'medium',timeStyle:'short'})}</p></div>
   <div className="rounded-xl border border-border bg-background p-3 text-sm"><p className="font-medium">{item.headline}</p>{item.subline&&<p className="mt-1 text-muted">{item.subline}</p>}</div>
   {item.reviewScore!==null&&<p className="text-sm text-muted">Auto-contrôle : {item.reviewScore}/100{item.reviewIssues.length?` · ${item.reviewIssues.join(' ; ')}`:''}</p>}
   {done?<p role="status" className="text-sm text-success">{state.message}</p>:<form action={action} className="space-y-3">
    <input type="hidden" name="visual_id" value={item.id}/>
    <label className="block text-sm">Motif du refus (facultatif)<input name="reason" maxLength={500} className="mt-1 block w-full rounded-lg border border-border bg-background p-2"/></label>
    <div className="flex flex-wrap gap-2">
     <button name="decision" value="approve" disabled={pending} className="rounded-lg bg-accent-strong px-4 py-2 text-accent-foreground">Valider (déposer dans la photothèque)</button>
     <button name="decision" value="reject" disabled={pending} className="rounded-lg border border-border px-4 py-2 text-danger">Refuser</button>
    </div>
    {state.message&&<p role="status" className="text-sm">{state.message}</p>}
   </form>}
  </div>
 </article>;
}
