'use client';
import Link from 'next/link';
import {useState} from 'react';
import {ReviewApproveForm,ReviewEditForm,ReviewRejectForm,formatLongDate} from './review-card';
import {VariantPreview} from './supervision-preview';
import type {SupervisionReviewItem} from '@/lib/publications/supervision-review';

// Socle Publications, lot 7 (mobile) : carte de validation compacte de la supervision. Aperçu de chaque variante
// (Facebook, Instagram, Google Business Profile, avec sa photo), puis les formulaires EXISTANTS de la file de
// validation : Valider (média requis, re-vérifié par le serveur), Rejeter (motif obligatoire = confirmation),
// Modifier (nouvelle version soumise à validation). Aucune nouvelle action serveur, aucun envoi.
export function SupervisionReviewCard({item}:{item:SupervisionReviewItem}){
 const {card,variants}=item;
 const [platform,setPlatform]=useState(variants[0]?.platform),[mode,setMode]=useState<'view'|'edit'|'reject'>('view');
 const missing=variants.filter(v=>v.media.state==='missing').map(v=>v.label);
 return <article className="rounded-xl border border-border bg-surface p-3 sm:p-4" data-supervision-review={card.publicationId}>
  <header className="flex flex-wrap items-start justify-between gap-2">
   <div className="min-w-0"><p className="text-xs text-muted">{card.clientName} · {formatLongDate(card.date)}</p><h3 className="mt-0.5 font-semibold break-words">{card.subject}</h3></div>
   <Link href={`/publications/${card.publicationId}`} className="shrink-0 text-xs text-accent hover:underline">Fiche</Link>
  </header>
  {missing.length>0&&<p role="note" className="mt-2 rounded-lg border border-warning/50 bg-warning/10 p-2 text-xs text-warning">Photo manquante : {missing.join(', ')}.</p>}
  {mode==='edit'?<ReviewEditForm card={card} onCancel={()=>setMode('view')}/>:<>
   {variants.length>1&&<div role="tablist" aria-label="Aperçu par plateforme" className="mt-3 flex flex-wrap gap-1">{variants.map(v=><button key={v.platform} type="button" role="tab" aria-selected={v.platform===platform}
    onClick={()=>setPlatform(v.platform)} className={`rounded-full border px-3 py-1.5 text-xs ${v.platform===platform?'border-accent bg-accent/10 font-semibold text-foreground':'border-border text-muted'}`}>{v.label}</button>)}</div>}
   {variants.map(v=><section key={v.platform} role="tabpanel" aria-label={`Aperçu ${v.label}`} hidden={v.platform!==platform} className="mt-3"><VariantPreview variant={v} accountName={card.clientName}/></section>)}
   {mode==='reject'?<ReviewRejectForm card={card} onCancel={()=>setMode('view')}/>:<div className="mt-3 flex flex-wrap items-start gap-2">
    <ReviewApproveForm card={card}/>
    <button type="button" onClick={()=>setMode('reject')} className="rounded-lg border border-danger/60 px-4 py-2 text-danger">Rejeter</button>
    <button type="button" onClick={()=>setMode('edit')} className="rounded-lg border border-border px-4 py-2">Modifier</button>
   </div>}</>}
 </article>;
}
