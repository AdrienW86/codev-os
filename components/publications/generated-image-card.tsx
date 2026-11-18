'use client';
import {useActionState} from 'react';
import {decideGeneratedImageAction} from '@/app/(cockpit)/publications/image-actions';
import type {PendingImage} from '@/lib/publications/photo-agent/service';
const platforms:Record<string,string>={facebook:'Facebook',instagram:'Instagram',google_business_profile:'Google Business Profile',tiktok:'TikTok',snapchat:'Snapchat'};
export function GeneratedImageCard({item}:{item:PendingImage}){
 const [state,action,pending]=useActionState(decideGeneratedImageAction,{});
 const done=state.ok===true;
 return <article className="grid gap-5 rounded-2xl border border-border bg-surface p-5 shadow-card md:grid-cols-[minmax(0,320px)_1fr]">
  <div>
   {/* Aperçu signé (15 min) d'un stockage privé : pas d'optimisation next/image sur une URL à durée limitée. */}
   {/* eslint-disable-next-line @next/next/no-img-element */}
   {item.preview?<img src={item.preview} alt="Image d’illustration générée par l’Agent Photo" className="aspect-square w-full rounded-xl border border-border object-cover"/>:<p className="rounded-xl border border-border p-6 text-sm text-muted">Aperçu indisponible. Rechargez la page.</p>}
   <p className="mt-2 text-xs text-muted">Image d’illustration générée par IA ({item.model}). Elle sera marquée comme telle, jamais présentée comme une photo d’un chantier du client.</p>
  </div>
  <div className="min-w-0 space-y-4">
   <div><p className="text-xs font-semibold tracking-wide text-accent-hover uppercase">{item.clientName}</p><p className="text-sm text-muted">Proposée le {new Date(item.createdAt).toLocaleString('fr-FR',{timeZone:'Europe/Paris',dateStyle:'medium',timeStyle:'short'})}</p></div>
   <ul className="space-y-3">{item.publications.map((pub,index)=><li key={`${pub.id}-${pub.platform}-${index}`} className="rounded-xl border border-border bg-background p-3 text-sm">
    <p className="font-medium">{platforms[pub.platform]??pub.platform}{pub.targetDate?` · ${pub.targetDate}`:''}</p><p className="mt-1 whitespace-pre-line text-muted">{pub.text}</p></li>)}</ul>
   <details className="text-sm"><summary className="cursor-pointer text-muted">Description donnée au générateur</summary><p className="mt-2 text-muted">{item.prompt}</p></details>
   {done?<p role="status" className="text-sm text-success">{state.message}</p>:<form action={action} className="space-y-3">
    <input type="hidden" name="image_id" value={item.id}/>
    <label className="block text-sm">Motif du refus (facultatif)<input name="reason" maxLength={500} className="mt-1 block w-full rounded-lg border border-border bg-background p-2"/></label>
    <div className="flex flex-wrap gap-2">
     <button name="decision" value="approve_publish" disabled={pending} className="rounded-lg bg-accent-strong px-4 py-2 text-accent-foreground">Valider l’image et la publication</button>
     <button name="decision" value="approve" disabled={pending} className="rounded-lg border border-border px-4 py-2">Valider l’image seulement</button>
     <button name="decision" value="reject" disabled={pending} className="rounded-lg border border-border px-4 py-2 text-danger">Refuser</button>
    </div>
    <p className="text-xs text-muted">« Valider l’image seulement » l’attache et laisse la publication « À valider ». Refuser : l’Agent Photo propose une autre image (3 propositions au plus par préparation).</p>
    {state.message&&<p role="status" className="text-sm">{state.message}</p>}
   </form>}
  </div>
 </article>;
}
