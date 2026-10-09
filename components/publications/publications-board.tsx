/* eslint-disable @next/next/no-img-element -- Private signed URLs are short-lived and must not be cached by an image proxy. */
import Link from 'next/link';
import type {ReactNode} from 'react';
import {Panel} from '@/components/ui/primitives';
import {DebugDetails} from '@/components/projects/debug-details';
import {BoardFilterBar} from './board-filter-bar';
import {BoardVisibilityForm} from './board-visibility-form';
import {platformLabels} from '@/lib/publications/editor';
import {formatDate} from '@/lib/format-date';
import {boardHref,drawerHref,boardOriginLabels,boardStatusClasses,boardStatusLabels,boardStatuses,boardViewLabels,needsMedia,type BoardQuery} from '@/lib/publications/board-query';
import type {BoardResult,BoardRow} from '@/lib/publications/board';

type Option={id:string;name:string};
const cell='border-b border-border px-2 py-2 align-top';

// An empty slot is not a publication: it gets its own placeholder, distinct from a real publication without media.
function Thumbnail({row,size='h-12 w-12'}:{row:BoardRow;size?:string}){
 if(row.image)return <img src={row.image} alt="" loading="lazy" decoding="async" className={`${size} shrink-0 rounded object-cover`}/>;
 if(row.status==='to_prepare')return <span role="img" aria-label="Créneau à préparer" data-media="slot" className={`${size} flex shrink-0 items-center justify-center rounded border border-dashed border-border text-center text-[10px] leading-tight text-muted`}>À préparer</span>;
 const missing=!row.hasMedia;
 return <span role="img" aria-label={missing?'Sans média':'Média indisponible'} data-media={missing?'missing':'unavailable'} className={`${size} flex shrink-0 items-center justify-center rounded border text-center text-[10px] leading-tight ${missing?'border-red-600/60 text-red-700':'border-dashed border-border text-muted'}`}>{missing?'Sans média':'Média indisponible'}</span>;
}
function StatusPill({row}:{row:BoardRow}){return <span className="inline-flex flex-col items-start gap-1"><span data-board-status={row.status} className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${boardStatusClasses[row.status]}`}>{boardStatusLabels[row.status]}</span>
 {needsMedia(row)&&<span data-media-required="true" className="whitespace-nowrap text-[11px] text-red-700">Média requis</span>}{row.hidden&&<span className="whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">Retirée du tableau</span>}</span>;}
function DateLabel({row}:{row:BoardRow}){return <>{row.dateIsWeek?`Semaine du ${formatDate(row.date)}`:formatDate(row.date)}</>;}
function Platforms({row}:{row:BoardRow}){return <>{row.platforms.length?row.platforms.map(p=>platformLabels[p]).join(' · '):'—'}</>;}
function Origin({row}:{row:BoardRow}){return <>{boardOriginLabels[row.origin]}{row.edited&&<span className="text-muted"> · modifiée</span>}</>;}

// Navigation to existing, already-guarded screens, plus the board-only removal (explicit confirmation required).
export function RowMenu({row,query}:{row:BoardRow;query:BoardQuery}){
 const links:[string,string][]=[['Ouvrir',drawerHref(query,row.id)],['Fiche complète',`/publications/${row.id}`]];
 if(row.status!=='published'&&row.status!=='to_prepare')links.push(['Modifier',drawerHref(query,row.id)]);
 if(row.projectId&&row.status==='to_prepare')links.push(['Préparer avec l’agent',`/projects/${row.projectId}/agent`]);
 if(row.projectId&&(row.status==='draft'||row.status==='rejected'))links.push(['Valider ou régénérer',`/projects/${row.projectId}/review`]);
 if(row.projectId)links.push(['Calendrier du projet',`/projects/${row.projectId}/calendar`]);
 return <details className="relative"><summary aria-label={`Actions pour ${row.subject}`} className="cursor-pointer list-none rounded px-2 py-1 text-center hover:bg-border/40">…</summary>
  <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-border bg-background p-1 text-sm shadow-lg"><ul>{links.map(([label,href])=><li key={label}><Link href={href} className="block rounded px-3 py-1.5 hover:bg-border/40">{label}</Link></li>)}</ul>
  <div className="border-t border-border"><BoardVisibilityForm publicationId={row.id} hidden={row.hidden}/></div></div></details>;
}

export function BoardViews({query,counts}:{query:BoardQuery;counts:BoardResult['counts']}){
 const views:[BoardQuery['status'],string,number][]=[['','Toutes',counts.all],...boardStatuses.map(s=>[s,boardViewLabels[s],counts[s]] as [BoardQuery['status'],string,number])];
 return <nav aria-label="Vues rapides" className="flex flex-wrap gap-2">{views.map(([status,label,count])=>{const active=query.status===status;
  return <Link key={label} href={boardHref(query,{status})} aria-current={active?'page':undefined} className={`rounded-full border px-3 py-1 text-sm ${active?'border-accent bg-accent text-background':'border-border hover:border-accent'}`}>{label} <span className={active?'':'text-muted'}>{count}</span></Link>;})}</nav>;
}

// Shared switch between the two views of the same publications.
export function PublicationsNav({current}:{current:'board'|'calendar'}){
 const item=(key:'board'|'calendar',label:string,href:string)=><Link href={href} aria-current={current===key?'page':undefined} className={`rounded-md px-3 py-1.5 ${current===key?'bg-accent text-background':'hover:bg-border/40'}`}>{label}</Link>;
 return <nav aria-label="Vues Publications" className="inline-flex rounded-lg border border-border p-0.5 text-sm">{item('board','Tableau','/publications')}{item('calendar','Calendrier','/publications/calendar')}</nav>;
}

// Desktop: dense table, every cell links to the publication. Mobile: compact cards with the same link.
export function PublicationsBoard({result,query,clients,projects}:{result:BoardResult;query:BoardQuery;clients:Option[];projects:(Option&{client_id:string})[]}){
 const {rows,total,page,pageCount}=result;
 // Every data cell opens the drawer on the same view (publication=<id>), keeping all filters, sort and page.
 const open=(row:BoardRow,children:ReactNode,focusable=false)=><Link href={drawerHref(query,row.id)} scroll={false} tabIndex={focusable?undefined:-1} className="block">{children}</Link>;
 return <>
  <Panel className="mt-6 space-y-4 p-4"><BoardViews query={query} counts={result.counts}/><BoardFilterBar query={query} clients={clients} projects={projects}/></Panel>
  <Panel className="mt-4 p-0">
   <p className="px-4 py-3 text-sm text-muted">{total} publication{total>1?'s':''}{!query.published&&query.status!=='published'?' · publiées masquées':''}</p>
   {!rows.length?<p className="px-4 pb-6">Aucune publication pour ces critères.</p>:<>
   <div className="hidden overflow-x-auto md:block" data-board="table"><table className="w-full min-w-[1100px] border-collapse text-left text-sm">
    <thead className="sticky top-0 bg-background text-xs uppercase tracking-wide text-muted"><tr>{['Photo','Client','Projet','Date','Statut','Sujet','Aperçu','Plateformes','Origine','Modifiée','',...(query.debug?['Debug']:[])].map((t,i)=><th key={i} scope="col" className="border-b border-border px-2 py-2 font-medium">{t||<span className="sr-only">Actions</span>}</th>)}</tr></thead>
    <tbody>{rows.map(row=><tr key={row.id} data-board-row={row.id} className="hover:bg-border/20">
     <td className={cell}>{open(row,<Thumbnail row={row}/>)}</td>
     <td className={cell}>{open(row,row.clientName)}</td>
     <td className={`${cell} text-muted`}>{open(row,row.projectName??'Sans projet')}</td>
     <td className={`${cell} whitespace-nowrap`}>{open(row,<DateLabel row={row}/>)}</td>
     <td className={cell}>{open(row,<StatusPill row={row}/>)}</td>
     <td className={`${cell} max-w-56 font-medium`}>{open(row,row.subject,true)}</td>
     <td className={`${cell} max-w-80 text-muted`}>{open(row,<span className="line-clamp-2">{row.preview||'—'}</span>)}</td>
     <td className={`${cell} text-xs`}>{open(row,<Platforms row={row}/>)}</td>
     <td className={`${cell} text-xs`}>{open(row,<Origin row={row}/>)}</td>
     <td className={`${cell} whitespace-nowrap text-xs text-muted`}>{open(row,formatDate(row.updatedAt))}</td>
     <td className={cell}><RowMenu row={row} query={query}/></td>
     {query.debug&&<td className={cell}><DebugDetails enabled={Boolean(row.debug)} data={row.debug??{}} title="Données"/></td>}
    </tr>)}</tbody></table></div>
   <ul className="divide-y divide-border md:hidden" data-board="cards">{rows.map(row=><li key={row.id} data-board-card={row.id} className="flex gap-3 px-4 py-3">
    <Link href={drawerHref(query,row.id)} scroll={false} className="flex min-w-0 flex-1 gap-3"><Thumbnail row={row} size="h-14 w-14"/><span className="min-w-0">
     <span className="flex flex-wrap items-center gap-2 text-xs"><StatusPill row={row}/><span className="text-muted"><DateLabel row={row}/></span></span>
     <span className="mt-1 block truncate font-medium">{row.subject}</span><span className="block truncate text-xs text-muted">{row.clientName} · <Platforms row={row}/></span></span></Link>
    <RowMenu row={row} query={query}/></li>)}</ul></>}
   {pageCount>1&&<nav aria-label="Pagination" className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
    {page>1?<Link href={boardHref(query,{page:page-1})} className="text-accent">← Précédent</Link>:<span/>}<span className="text-muted">Page {page} / {pageCount}</span>
    {page<pageCount?<Link href={boardHref(query,{page:page+1})} className="text-accent">Suivant →</Link>:<span/>}</nav>}
  </Panel></>;
}
