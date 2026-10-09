'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect,useRef,useState,useTransition,type ChangeEvent,type FormEvent} from 'react';
import {platformLabels} from '@/lib/publications/editor';
import {publicationPlatforms} from '@/lib/publications/types';
import {applyFilterChange,boardOriginLabels,boardOrigins,boardSortLabels,boardSorts,boardStatusLabels,boardStatuses,type BoardQuery} from '@/lib/publications/board-query';

type Option={id:string;name:string};
export const SEARCH_DEBOUNCE_MS=400;
const input='w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm';
type Timers={set:(fn:()=>void,ms:number)=>unknown;clear:(handle:unknown)=>void};
const realTimers:Timers={set:(fn,ms)=>setTimeout(fn,ms),clear:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)};
// Trailing debounce: only the last call within the delay runs.
export function createDebounced<T>(fn:(value:T)=>void,ms:number,timers:Timers=realTimers){
 let handle:unknown=null;
 return {call(value:T){if(handle!==null)timers.clear(handle);handle=timers.set(()=>{handle=null;fn(value);},ms);},cancel(){if(handle!==null)timers.clear(handle);handle=null;}};
}

// Only the filter bar is a Client Component: the table and its data stay server-rendered.
// Discrete changes push a history entry (browser back restores the previous view); typing replaces it.
export function BoardFilterBar({query,clients,projects}:{query:BoardQuery;clients:Option[];projects:(Option&{client_id:string})[]}){
 const router=useRouter(),[pending,startTransition]=useTransition();
 const [text,setText]=useState(query.q),[syncedQ,setSyncedQ]=useState(query.q);
 if(query.q!==syncedQ){setSyncedQ(query.q);setText(query.q);}
 const go=(href:string,mode:'push'|'replace'='push')=>startTransition(()=>{if(mode==='push')router.push(href,{scroll:false});else router.replace(href,{scroll:false});});
 const latest=useRef({query,go});
 useEffect(()=>{latest.current={query,go};});
 const debounced=useRef<ReturnType<typeof createDebounced<string>>|null>(null);
 useEffect(()=>{const d=createDebounced<string>(value=>{const {query:current,go:navigate}=latest.current;if(value.trim()!==current.q)navigate(applyFilterChange(current,'q',value),'replace');},SEARCH_DEBOUNCE_MS);debounced.current=d;return ()=>d.cancel();},[]);
 const change=(event:ChangeEvent<HTMLSelectElement|HTMLInputElement>)=>{const {name,value,type}=event.currentTarget;const checked=type==='checkbox'?(event.currentTarget as HTMLInputElement).checked:false;
  go(applyFilterChange(query,name,type==='checkbox'?(checked?'1':''):value,projects));};
 const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();debounced.current?.cancel();go(applyFilterChange(query,'q',text));};
 const key=JSON.stringify({...query,q:''});
 return <form method="get" action="/publications" onSubmit={submit} aria-busy={pending} data-board-filters="instant" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
  <label className="text-xs sm:col-span-2">Recherche<input className={input} type="search" name="q" value={text} onChange={e=>{setText(e.currentTarget.value);debounced.current?.call(e.currentTarget.value);}} placeholder="Sujet, texte, client, projet" autoComplete="off"/></label>
  <div key={key} className="contents">
  <label className="text-xs">Client<select className={input} name="client" defaultValue={query.client} onChange={change}><option value="">Tous</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
  <label className="text-xs">Projet<select className={input} name="project" defaultValue={query.project} onChange={change}><option value="">Tous</option>{projects.filter(p=>!query.client||p.client_id===query.client).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
  <label className="text-xs">Vue<select className={input} name="archived" defaultValue={query.archived?'1':''} onChange={change}><option value="">Actives</option><option value="1">Archivées</option></select></label>
  <label className="text-xs">Statut<select className={input} name="status" defaultValue={query.status} onChange={change}><option value="">Tous</option>{boardStatuses.map(s=><option key={s} value={s}>{boardStatusLabels[s]}</option>)}</select></label>
  <label className="text-xs">Plateforme<select className={input} name="platform" defaultValue={query.platform} onChange={change}><option value="">Toutes</option>{publicationPlatforms.map(p=><option key={p} value={p}>{platformLabels[p]}</option>)}</select></label>
  <label className="text-xs">Origine<select className={input} name="origin" defaultValue={query.origin} onChange={change}><option value="">Toutes</option>{boardOrigins.map(o=><option key={o} value={o}>{boardOriginLabels[o]}</option>)}</select></label>
  <label className="text-xs">Média<select className={input} name="media" defaultValue={query.media} onChange={change}><option value="">Tous</option><option value="with">Avec média</option><option value="without">Sans média</option></select></label>
  <label className="text-xs">Du<input className={input} type="date" name="from" defaultValue={query.from} onChange={change}/></label>
  <label className="text-xs">Au<input className={input} type="date" name="to" defaultValue={query.to} onChange={change}/></label>
  <label className="text-xs">Trier par<select className={input} name="sort" defaultValue={query.sort} onChange={change}>{boardSorts.map(s=><option key={s} value={s}>{boardSortLabels[s]}</option>)}</select></label>
  <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="published" value="1" defaultChecked={query.published} onChange={change}/>Afficher les publications publiées</label>
  <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="hidden" value="1" defaultChecked={query.hidden} onChange={change}/>Afficher les retirées</label>
  </div>
  {query.debug&&<input type="hidden" name="debug" value="1"/>}
  <div className="flex items-end gap-3"><Link href={query.debug?'/publications?debug=1':'/publications'} className="text-sm text-accent">Réinitialiser</Link><span role="status" className="text-xs text-muted">{pending?'Actualisation…':''}</span></div>
 </form>;
}
