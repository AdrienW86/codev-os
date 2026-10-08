'use client';
import {useActionState} from 'react';
import {Badge,Panel} from '@/components/ui/primitives';
import {assignPublicationAccountAction,disconnectPublicationConnectionAction,type ConnectionActionState} from '@/app/(cockpit)/publications/connection-actions';
import {accountOptionLabel,type ChannelAccountView,type ConnectionSummary} from '@/lib/publications/connections/model';

// Publication connections (Lot 4.3 P9): status and counts only. No token, no credential reference, no external id
// is ever rendered or sent; forms carry the project and a platform / provider, the server resolves the rest.
const initial:ConnectionActionState={};
const input='rounded-lg border border-border bg-background p-2 text-sm';
const tones:Record<ConnectionSummary['status'],'green'|'amber'|undefined>={none:undefined,pending:'amber',active:'green',expired:'amber',revoked:'amber',error:'amber',disabled:undefined};

export function ConnectionsPanel({projectId,connections,oauthMessage}:{projectId:string;connections:ConnectionSummary[];oauthMessage:string}){
 return <Panel className="mt-6 p-6"><h2 className="font-semibold">Connexions</h2>
  <p className="mt-2 text-sm text-muted">Comptes du client utilisables par les canaux de ce projet. Aucune publication n’est diffusée depuis cette page.</p>
  <div className="mt-4 grid gap-4 md:grid-cols-2">{connections.map(c=><ConnectionCard key={c.provider} projectId={projectId} connection={c} oauthMessage={oauthMessage}/>)}</div></Panel>;
}
function ConnectionCard({projectId,connection:c,oauthMessage}:{projectId:string;connection:ConnectionSummary;oauthMessage:string}){
 return <article data-connection={c.provider} data-status={c.status} className="rounded-lg border border-border p-4 text-sm">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{c.label}</h3><Badge tone={tones[c.status]}>{c.statusLabel}</Badge></div>
  <p className="mt-2">{c.connected?'Connecté':'Non connecté'}{c.expiresLabel?` · ${c.expiresLabel}`:''}</p>
  {c.provider==='meta'?<p className="mt-1 text-muted">{c.counts.facebook} page(s) Facebook · {c.counts.instagram} compte(s) Instagram</p>
   :<p className="mt-1 text-muted">{c.counts.google_business_profile} fiche(s) Google Business Profile</p>}
  <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled className="rounded-lg border border-border px-3 py-2 disabled:opacity-60">Configurer {c.label}</button>
   <span className="text-xs text-muted" data-oauth-pending="true">{oauthMessage}</span></div>
  {c.canDisconnect&&<DisconnectForm projectId={projectId} provider={c.provider} label={c.label}/>}</article>;
}
function DisconnectForm({projectId,provider,label}:{projectId:string;provider:ConnectionSummary['provider'];label:string}){
 const [state,disconnect,pending]=useActionState(disconnectPublicationConnectionAction,initial);
 return <form action={disconnect} className="mt-3 space-y-2 border-t border-border pt-3"><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="provider" value={provider}/>
  <label className="block text-xs"><input type="checkbox" name="confirm" required/> Je confirme : les comptes {label} ne pourront plus être utilisés pour publier.</label>
  <button disabled={pending} className="rounded-lg border border-red-400 px-3 py-2 text-red-400">{pending?'Déconnexion…':'Déconnecter'}</button>
  {state.message&&<p role={state.ok?'status':'alert'} className={state.ok?'':'text-red-400'}>{state.message}</p>}</form>;
}

// "Compte de publication" of one channel card: accounts of the right platform only; non-assignable ones are shown
// but disabled. The current account stays visible with its status even when it is no longer usable.
export function ChannelAccountSelector({projectId,view}:{projectId:string;view:ChannelAccountView}){
 const [state,assign,pending]=useActionState(assignPublicationAccountAction,initial);
 const publishable=view.publishability==='publishable';
 return <div className="mt-3 space-y-2 text-sm" data-account-selector={view.platform}>
  <p className="text-xs text-muted">Compte de publication</p>
  {view.emptyMessage?<p data-account-empty="true">{view.emptyMessage}</p>
   :<form action={assign} className="flex flex-wrap items-center gap-2"><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="platform" value={view.platform}/>
    <select name="account_id" aria-label={`Compte de publication ${view.platformLabel}`} defaultValue={view.currentAccountId??''} className={input}>
     <option value="">Aucun compte</option>
     {view.currentAccountId&&!view.options.some(o=>o.id===view.currentAccountId)&&<option value={view.currentAccountId} disabled>{view.currentLabel}</option>}
     {view.options.map(o=><option key={o.id} value={o.id} disabled={!o.assignable&&o.id!==view.currentAccountId}>{accountOptionLabel(o)}</option>)}
    </select>
    <button disabled={pending} className="rounded-lg border border-border px-3 py-2">{pending?'Enregistrement…':'Enregistrer le compte'}</button>
    {state.message&&<p role={state.ok?'status':'alert'} className={`w-full ${state.ok?'':'text-red-400'}`}>{state.message}</p>}</form>}
  <p data-publishability={view.publishability} className={`text-xs ${publishable?'text-green-400':'text-muted'}`}>Publication : {view.publishabilityLabel}</p></div>;
}
