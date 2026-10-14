import Link from 'next/link';
import {SUPERVISION_VIEWS,SUPERVISION_VIEW_LABELS,supervisionHref,type SupervisionView} from '@/lib/publications/supervision-view';

// Socle Publications, lot 7 (mobile) : onglets compacts collants de la supervision (une seule page, aucun JavaScript
// requis) et filtre par client (formulaire GET : le lien obtenu est partageable et utilisable par l'assistant).
export function SupervisionTabs({current,client,badges}:{current:SupervisionView;client:string|null;badges:Record<SupervisionView,number|null>}){
 return <nav aria-label="Sections de la supervision" className="sticky top-0 z-20 -mx-5 border-b border-border bg-background/95 px-5 py-2 backdrop-blur sm:-mx-8 sm:px-8" data-supervision-tabs="true">
  <ul className="flex gap-1.5 overflow-x-auto pb-0.5">{SUPERVISION_VIEWS.map(view=>{const active=view===current,count=badges[view];
   return <li key={view} className="shrink-0"><Link href={supervisionHref(view,client)} aria-current={active?'page':undefined} scroll={false}
    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap ${active?'border-accent bg-accent/12 font-semibold text-foreground':'border-border text-muted hover:text-foreground'}`}>
    {SUPERVISION_VIEW_LABELS[view]}{count!==null&&count>0&&<span className="rounded-full bg-surface-raised px-1.5 text-xs font-medium text-foreground">{count}</span>}</Link></li>;})}</ul>
 </nav>;
}
export function ClientFilter({view,client,clients}:{view:SupervisionView;client:string|null;clients:{id:string;name:string}[]}){
 return <form method="get" action="/publications/supervision" className="mt-3 flex flex-wrap items-center gap-2" data-client-filter="true" role="search">
  {view!=='overview'&&<input type="hidden" name="view" value={view}/>}
  <label htmlFor="supervision-client" className="text-sm text-muted">Client</label>
  <select id="supervision-client" name="client" defaultValue={client??''} className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm sm:max-w-xs">
   <option value="">Tous les clients</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
  </select>
  <button className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-border/40">Filtrer</button>
  {client&&<Link href={supervisionHref(view,null)} className="text-sm text-accent hover:underline">Retirer le filtre</Link>}
 </form>;
}
