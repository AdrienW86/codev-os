'use client';
import Link from 'next/link';
import {useActionState} from 'react';
import {Badge,Panel} from '@/components/ui/primitives';
import {ensureClientPublicationsAction,saveClientPublicationSettingsAction,type ClientPublicationsState} from '@/app/(cockpit)/clients/[id]/publications-actions';
import {automationSummary,timezoneOptions,type ClientPublicationSettings} from '@/lib/publications/client-setup-model';

// Onglet « Publications » de la fiche client (socle lot 1) : réglages propres au client. Les connexions, canaux,
// créneaux et la photothèque Drive réutilisent les composants existants des projets Publications.
const initial:ClientPublicationsState={};
const input='mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm';

export function ClientPublicationsSetupStart({clientId}:{clientId:string}){
 const [state,start,pending]=useActionState(ensureClientPublicationsAction,initial);
 return <Panel className="p-6"><h2 className="font-semibold">Publications sur les réseaux sociaux</h2>
  <p className="mt-2 text-sm text-muted">Aucune configuration Publications pour ce client. Elle regroupe ses comptes Facebook, Instagram et Google Business Profile, les plateformes cochées, les créneaux et sa photothèque. Rien n’est publié sans votre validation.</p>
  <form action={start} className="mt-4"><input type="hidden" name="client_id" value={clientId}/>
   <button disabled={pending} className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-60">{pending?'Préparation…':'Configurer les publications'}</button>
   {state.message&&<p role="alert" className="mt-2 text-sm text-danger">{state.message}</p>}</form></Panel>;
}

export function ClientPublicationsProjectPicker({clientId,projects,current}:{clientId:string;projects:{id:string;name:string}[];current:string}){
 if(projects.length<2)return null;
 return <nav aria-label="Projet Publications" className="mb-4 flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">Projet :</span>
  {projects.map(p=><Link key={p.id} href={`/clients/${clientId}?tab=publications&project=${p.id}`} aria-current={p.id===current?'page':undefined}
   className={`rounded-full border px-3 py-1 ${p.id===current?'border-accent text-accent':'border-border'}`}>{p.name}</Link>)}</nav>;
}

export function ClientPublicationSettingsForm({clientId,settings,globalStop}:{clientId:string;settings:ClientPublicationSettings;globalStop:boolean}){
 const [state,save,pending]=useActionState(saveClientPublicationSettingsAction,initial);
 return <Panel className="p-6"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Préparation et validation</h2>
   {settings.autoPrepareEnabled?<Badge tone="green">Préparation automatique active</Badge>:<Badge>Préparation automatique suspendue</Badge>}</div>
  <p className="mt-2 text-sm text-muted" data-automation-summary="true">{automationSummary(settings,globalStop)}</p>
  {globalStop&&<p role="status" className="mt-3 rounded-lg border border-warning/60 p-3 text-sm">Arrêt général actif : aucune diffusion externe n’est possible, quel que soit le réglage du client.</p>}
  <form action={save} className="mt-4 grid gap-4 md:grid-cols-2"><input type="hidden" name="client_id" value={clientId}/>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="auto_prepare_enabled" defaultChecked={settings.autoPrepareEnabled}/><span>Préparer automatiquement les publications<span className="block text-xs text-muted">L’agent choisit un sujet et une photo, rédige une variante par plateforme et les place « À valider ».</span></span></label>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="publishing_enabled" defaultChecked={settings.publishingEnabled}/><span>Autoriser la diffusion des publications approuvées<span className="block text-xs text-muted">Décochez pour suspendre toute diffusion de ce client.</span></span></label>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked disabled readOnly/><span>Validation humaine obligatoire<span className="block text-xs text-muted">Toujours active : chaque publication attend votre approbation explicite, et toute modification après approbation demande une nouvelle validation.</span></span></label>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="media_reuse_allowed" defaultChecked={settings.mediaReuseAllowed}/><span>Autoriser le réemploi d’une photo déjà publiée<span className="block text-xs text-muted">Sinon, une photo n’est jamais réutilisée.</span></span></label>
   <label className="block text-sm">Préparer combien de jours avant le créneau<input type="number" name="prepare_lead_days" min={1} max={14} required defaultValue={settings.prepareLeadDays} className={input}/></label>
   <label className="block text-sm">Délai minimal avant réemploi (jours)<input type="number" name="media_reuse_after_days" min={30} max={730} required defaultValue={settings.mediaReuseAfterDays} className={input}/></label>
   <label className="block text-sm">Fuseau horaire du client<select name="timezone" defaultValue={settings.timezone} className={input}>{timezoneOptions(settings.timezone).map(t=><option key={t} value={t}>{t}</option>)}</select></label>
   <label className="block text-sm md:col-span-2">Règles éditoriales du client<span className="block text-xs text-muted">Ton, vocabulaire, mentions obligatoires, sujets à éviter. Appliquées à toutes les plateformes.</span>
    <textarea name="editorial_brief" maxLength={10000} rows={5} defaultValue={settings.editorialBrief} className={input}/></label>
   <div className="md:col-span-2"><button disabled={pending} className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-accent-foreground disabled:opacity-60">{pending?'Enregistrement…':'Enregistrer les réglages'}</button>
    {state.message&&<p role={state.ok?'status':'alert'} className={`mt-2 text-sm ${state.ok?'':'text-danger'}`}>{state.message}</p>}</div></form></Panel>;
}
