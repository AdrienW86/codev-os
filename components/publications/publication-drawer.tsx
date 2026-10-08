/* eslint-disable @next/next/no-img-element -- Private signed URLs are short-lived and must not be cached by an image proxy. */
'use client';
import {useRouter} from 'next/navigation';
import {useActionState,useEffect,useRef,useState,type ReactNode} from 'react';
import {approveFromDrawerAction,rejectFromDrawerAction,saveFromDrawerAction,stageMediaAction,type DrawerState} from '@/app/(cockpit)/publications/drawer-actions';
import {AgentPrepareForm} from './agent-forms';
import {BoardVisibilityForm} from './board-visibility-form';
import {DebugDetails} from '@/components/projects/debug-details';
import {boardOriginLabels,boardStatusClasses,boardStatusLabels} from '@/lib/publications/board-query';
import {formatDate} from '@/lib/format-date';
import {platformLabels} from '@/lib/publications/editor';
import type {DetailVariant,MediaState,PublicationDetailData} from '@/lib/publications/publication-detail';
import type {DrawerLoad} from '@/lib/publications/drawer';
import type {StagedMedia} from '@/lib/publications/workspace';

const input='mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm';
const section='rounded-xl border border-border p-4';
type MediaChoice={mode:'current'}|{mode:'staged';staged:StagedMedia}|{mode:'detached'};

// URL-driven drawer: opened by publication=<id>, closed by removing only that param (X, Escape). The native modal
// dialog provides focus management and an inert background; data comes from the server, mutations are Server Actions.
export function PublicationDrawer({load,closeHref}:{load:DrawerLoad;closeHref:string}){
 const router=useRouter(),ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current;if(d&&!d.open&&typeof d.showModal==='function')d.showModal();},[]);
 const close=()=>router.replace(closeHref,{scroll:false});
 const detail=load.state==='ok'?load.detail:null;
 return <dialog ref={ref} aria-labelledby="publication-drawer-title" data-drawer={detail?detail.status:load.state} onCancel={e=>{e.preventDefault();close();}}
  className="fixed inset-0 z-50 m-0 ml-auto h-dvh max-h-none w-full max-w-none overflow-y-auto border-l border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/50 md:max-w-3xl">
  <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-background px-5 py-4">
   <div className="min-w-0"><h2 id="publication-drawer-title" className="text-lg font-semibold">{detail?detail.subject:'Publication'}</h2>{detail&&<Header detail={detail}/>}</div>
   <button type="button" onClick={close} aria-label="Fermer le panneau" className="shrink-0 rounded-lg border border-border px-3 py-1.5">✕</button></div>
  <div className="space-y-5 px-5 py-5">
   {load.state==='not_found'&&<p role="alert">Publication introuvable. Le lien est peut-être incorrect ou la publication n’existe plus.</p>}
   {load.state==='unavailable'&&<p role="alert">Publication indisponible pour le moment. Réessayez dans quelques instants.</p>}
   {detail&&<DrawerBody detail={detail}/>}
  </div></dialog>;
}

function Header({detail}:{detail:PublicationDetailData}){
 return <div className="mt-1 space-y-1 text-sm"><p className="text-muted">{detail.clientName} · {detail.projectName??'Sans projet'}</p>
  <p className="flex flex-wrap items-center gap-2 text-xs"><span data-drawer-status={detail.status} className={`rounded-full border px-2 py-0.5 ${boardStatusClasses[detail.status]}`}>{boardStatusLabels[detail.status]}</span>
   <span>{detail.dateIsWeek?`Semaine du ${formatDate(detail.date)}`:formatDate(detail.date)}</span><span>· {boardOriginLabels[detail.origin]}{detail.edited?' (modifiée)':''}</span>
   <span>· {detail.platforms.length?detail.platforms.map(p=>platformLabels[p]).join(' · '):'Plateformes à définir'}</span>
   {detail.hidden&&<span className="rounded-full border border-border px-2 py-0.5 text-muted">Retirée du tableau</span>}</p></div>;
}

function DrawerBody({detail}:{detail:PublicationDetailData}){
 const editable=!detail.readOnly&&detail.revisionId!==null&&detail.status!=='to_prepare';
 return <>
  {detail.readOnlyReason&&<p role="note" data-read-only="true" className="rounded-lg border border-border p-3 text-sm">{detail.readOnlyReason}</p>}
  {detail.status==='to_prepare'?<ToPrepare detail={detail}/>:<>
   {detail.rejection&&<p className="rounded-lg border border-red-600/40 p-3 text-sm"><span className="font-medium">Motif du rejet :</span> {detail.rejection}</p>}
   {detail.status==='ready'&&editable&&<p className="text-sm text-muted">Version approuvée. Toute modification crée une nouvelle version, à revalider avant publication.</p>}
   {editable?<Editor key={detail.revisionId} detail={detail}/>:<ReadOnly detail={detail}/>}
   {detail.status==='rejected'&&!detail.readOnly&&detail.projectId&&<section className={section} data-regenerate="true"><h3 className="font-semibold">Régénérer</h3>
    <p className="mt-1 text-xs text-muted">Une seule publication, en tenant compte du motif du rejet. La nouvelle version sera soumise à votre validation.</p>
    <AgentPrepareForm projectId={detail.projectId} publicationId={detail.publicationId} regenerate/></section>}
   <History detail={detail}/></>}
  <section className={section}><h3 className="mb-2 text-sm font-semibold">Tableau</h3><BoardVisibilityForm publicationId={detail.publicationId} hidden={detail.hidden}/></section>
  {detail.debug&&<DebugDetails enabled data={detail.debug}/>}
 </>;
}

// An empty slot is not a publication: no fictitious editorial form, only the agent preparation.
function ToPrepare({detail}:{detail:PublicationDetailData}){
 return <section className={section} data-to-prepare="true"><h3 className="font-semibold">Créneau à préparer</h3>
  <p className="mt-1 text-sm text-muted">Aucun contenu n’a encore été préparé pour ce créneau.</p>
  {detail.projectId?<><h4 className="mt-4 text-sm font-semibold">Préparer avec l’agent</h4><AgentPrepareForm projectId={detail.projectId} publicationId={detail.publicationId}/></>
   :<p className="mt-3 text-sm">Associez d’abord un projet pour préparer ce créneau.</p>}</section>;
}

function mediaLabel(state:MediaState){return state==='missing'?'Média requis':'Média indisponible';}
export function MediaBox({state,preview,label}:{state:MediaState;preview:string|null;label?:string}){
 return <figure className="space-y-1">{preview?<img src={preview} alt="Aperçu du média de la publication" className="max-h-72 w-full rounded-lg object-contain"/>
  :<div role="img" aria-label={state==='ok'?'Aperçu indisponible':mediaLabel(state)} data-media={state} className={`flex h-40 items-center justify-center rounded-lg border text-sm ${state==='missing'?'border-red-600/60 text-red-700':'border-dashed border-border text-muted'}`}>{state==='ok'?'Aperçu indisponible':mediaLabel(state)}</div>}
  {label&&<figcaption className="text-xs font-medium">{label}</figcaption>}</figure>;
}

function PlatformTabs({variants,render}:{variants:DetailVariant[];render:(v:DetailVariant)=>ReactNode}){
 const [active,setActive]=useState(variants[0]?.platform);
 return <div><div role="tablist" aria-label="Plateformes" className="flex flex-wrap gap-1 border-b border-border">{variants.map(v=><button key={v.platform} type="button" role="tab" aria-selected={v.platform===active} onClick={()=>setActive(v.platform)}
  className={`-mb-px rounded-t-lg border px-3 py-1.5 text-sm ${v.platform===active?'border-border border-b-background font-semibold':'border-transparent text-muted'}`}>{v.label}</button>)}</div>
  {variants.map(v=><div key={v.platform} role="tabpanel" data-platform={v.platform} hidden={v.platform!==active} className="mt-3 space-y-3">{render(v)}</div>)}</div>;
}

function ReadOnly({detail}:{detail:PublicationDetailData}){
 return <section className={section}><h3 className="mb-3 font-semibold">Contenu</h3>{!detail.variants.length?<p className="text-sm text-muted">Aucun contenu.</p>:
  <PlatformTabs variants={detail.variants} render={v=><><MediaBox state={v.media.state} preview={v.media.preview}/>{v.title&&<p className="font-semibold">{v.title}</p>}<p className="whitespace-pre-wrap text-sm">{v.text}</p>{v.cta&&<p className="rounded-lg border border-border p-2 text-sm"><span className="text-xs text-muted">CTA · </span>{v.cta}</p>}</>}/>}</section>;
}

function Ids({detail}:{detail:PublicationDetailData}){return <><input type="hidden" name="publication_id" value={detail.publicationId}/><input type="hidden" name="revision_id" value={detail.revisionId??''}/><input type="hidden" name="project_id" value={detail.projectId??''}/></>;}

// Editing never touches the current revision: Enregistrer creates a new manual revision through saveDraft.
function Editor({detail}:{detail:PublicationDetailData}){
 const [textDirty,setTextDirty]=useState(false),[media,setMedia]=useState<MediaChoice>({mode:'current'});
 const [saveState,save,saving]=useActionState<DrawerState,FormData>(saveFromDrawerAction,{});
 const [stageState,stage,staging]=useActionState<DrawerState,FormData>(stageMediaAction,{});
 const [seenStage,setSeenStage]=useState(stageState);
 if(stageState!==seenStage){setSeenStage(stageState);if(stageState.staged)setMedia({mode:'staged',staged:stageState.staged});}
 const dirty=textDirty||media.mode!=='current';
 const assetsFor=(v:DetailVariant)=>media.mode==='staged'?[media.staged.assetId]:media.mode==='detached'?[]:v.assetIds;
 const hasAssets=detail.variants.some(v=>v.assetIds.length);
 return <>
  <section className={section} data-media-panel="true"><h3 className="mb-3 font-semibold">Média</h3>
   {media.mode==='staged'?<MediaBox state="ok" preview={media.staged.previewUrl} label="Nouvelle image — modifications non enregistrées"/>
    :media.mode==='detached'?<MediaBox state="missing" preview={null} label="Image retirée — modifications non enregistrées"/>
    :<MediaBox state={detail.media.state} preview={detail.media.preview}/>}
   {media.mode==='current'&&detail.missingMedia.length>0&&detail.missingMedia.length<detail.variants.length&&<p className="mt-2 text-xs text-red-700">Média requis pour : {detail.missingMedia.map(p=>platformLabels[p]).join(', ')}.</p>}
   <div className="mt-3 flex flex-wrap gap-2">{media.mode!=='current'&&<button type="button" onClick={()=>setMedia({mode:'current'})} className="rounded-lg border border-border px-3 py-1.5 text-sm">Annuler le changement d’image</button>}
    {media.mode==='current'&&hasAssets&&<button type="button" onClick={()=>setMedia({mode:'detached'})} className="rounded-lg border border-border px-3 py-1.5 text-sm">Retirer l’image</button>}</div>
   <form action={stage} className="mt-4 space-y-2 text-sm" data-stage-media="true"><Ids detail={detail}/>
    <label className="block">{hasAssets?'Remplacer l’image':'Ajouter une image'}<input className={input} type="file" name="image" accept="image/jpeg,image/png,image/webp" required/></label>
    <p className="text-xs text-muted">Formats acceptés : JPEG, PNG ou WebP, 768 Ko maximum. Image uniquement.</p>
    <label className="block">Provenance<input className={input} name="provenance" required maxLength={2000} placeholder="Ex. : photo fournie par le client"/></label>
    <label className="flex items-start gap-2"><input type="checkbox" name="rights" required/>Je confirme disposer des droits d’utilisation de cette image.</label>
    <button disabled={staging} className="rounded-lg border border-border px-3 py-1.5">{staging?'Envoi…':'Préparer cette image'}</button>{stageState.message&&<p role="status">{stageState.message}</p>}</form>
  </section>
  <form action={save} onInput={()=>setTextDirty(true)} className={`${section} space-y-4`} data-drawer-editor="true"><Ids detail={detail}/>
   <input type="hidden" name="client_id" value={detail.clientId}/><input type="hidden" name="angle" value={detail.editorial.angle}/><input type="hidden" name="source" value={detail.editorial.source}/>
   <label className="block text-sm">Sujet<input className={input} name="title" required maxLength={300} defaultValue={detail.subject}/></label>
   {detail.dateEditable?<label className="block text-sm">Date de publication<input className={input} type="date" name="target_date" defaultValue={detail.targetDate}/></label>
    :<div className="text-sm"><input type="hidden" name="target_date" value={detail.targetDate}/><p>Date de publication : {detail.targetDate?formatDate(detail.targetDate):'à définir'}</p><p className="text-xs text-muted" data-date-locked="true">{detail.occurrenceBound?'Date et plateforme fixées par le créneau du canal.':'Cette date est pilotée par le calendrier.'}</p></div>}
   <PlatformTabs variants={detail.variants} render={v=><><input type="hidden" name={`${v.platform}_enabled`} value="on"/>{assetsFor(v).map(id=><input key={id} type="hidden" name={`${v.platform}_assets`} value={id}/>)}
    <label className="block text-sm">Texte {v.label}<textarea className={input} name={`${v.platform}_text`} required maxLength={10000} rows={7} defaultValue={v.text}/></label>
    {v.title!==null&&<label className="block text-sm">Titre<input className={input} name={`${v.platform}_title`} maxLength={500} defaultValue={v.title}/></label>}
    {v.cta!==null&&<label className="block text-sm">CTA<input className={input} name={`${v.platform}_cta`} maxLength={500} defaultValue={v.cta}/></label>}</>}/>
   <p className="text-xs text-muted">Enregistrer crée une nouvelle version en brouillon. Les versions précédentes restent inchangées dans l’historique.</p>
   <div className="flex flex-wrap items-center gap-3"><button disabled={!dirty||saving} className="rounded-lg border border-accent px-4 py-2 text-accent disabled:opacity-50">{saving?'Enregistrement…':'Enregistrer'}</button>
    {dirty&&<span className="text-xs text-muted">Modifications non enregistrées</span>}{saveState.message&&<p role="status" className="text-sm">{saveState.message}</p>}</div>
  </form>
  {detail.status==='draft'&&<Decision detail={detail} dirty={dirty}/>}
 </>;
}

// À publier / Rejeter act on the saved current revision only (draft → submit → decision; pending_review → decision).
function Decision({detail,dirty}:{detail:PublicationDetailData;dirty:boolean}){
 const [approveState,approve,approving]=useActionState<DrawerState,FormData>(approveFromDrawerAction,{});
 const [rejectState,reject,rejecting]=useActionState<DrawerState,FormData>(rejectFromDrawerAction,{});
 const blocked=dirty?'Enregistrez vos modifications avant de valider.':detail.missingMedia.length?'Média requis : ajoutez une photo avant de valider.':null;
 return <section className={`${section} space-y-4`} data-decision="true"><h3 className="font-semibold">Validation</h3>
  <form action={approve} className="space-y-2"><Ids detail={detail}/><button disabled={Boolean(blocked)||approving} className="rounded-lg bg-accent px-5 py-2 font-semibold text-background disabled:opacity-50">{approving?'Validation…':'À publier'}</button>
   {blocked&&<p role="note" data-approve-blocked="true" className="text-sm text-red-700">{blocked}</p>}{approveState.message&&<p role="status" className="text-sm">{approveState.message}</p>}</form>
  <details><summary className="cursor-pointer text-sm text-red-700">Rejeter…</summary>
   <form action={reject} className="mt-2 space-y-2"><Ids detail={detail}/><label className="block text-sm">Motif du rejet<textarea className={input} name="reason" required minLength={10} maxLength={3000} rows={3} placeholder="Expliquez ce qui doit changer (10 caractères minimum)."/></label>
    <button disabled={dirty||rejecting} className="rounded-lg border border-red-600 px-4 py-2 text-red-700 disabled:opacity-50">{rejecting?'Enregistrement…':'Confirmer le rejet'}</button>
    {dirty&&<p className="text-xs text-muted">Enregistrez vos modifications avant de rejeter.</p>}{rejectState.message&&<p role="status" className="text-sm">{rejectState.message}</p>}</form></details>
 </section>;
}

function History({detail}:{detail:PublicationDetailData}){
 return <details className={section} data-history="true"><summary className="cursor-pointer text-sm font-semibold">Historique des versions ({detail.versions.length})</summary>
  <ol className="mt-3 space-y-1 text-sm">{detail.versions.map(v=><li key={v.number}>Version {v.number} · {v.origin} · {formatDate(v.date)}{v.decision?` · ${v.decision}`:''}{v.reason?` · ${v.reason}`:''}{v.current?' · actuelle':''}</li>)}</ol></details>;
}
