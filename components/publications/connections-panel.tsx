'use client';
import {useActionState} from 'react';
import {Badge,Panel} from '@/components/ui/primitives';
import {assignPublicationAccountAction,disconnectPublicationConnectionAction,startOAuthAction,verifyConnectionAction,type ConnectionActionState} from '@/app/(cockpit)/publications/connection-actions';
import {accountOptionLabel,PROVIDER_PLATFORMS,type AccountOption,type ChannelAccountView,type ConnectionSummary} from '@/lib/publications/connections/model';
import {platformLabels} from '@/lib/publications/editor';

// Publication connections (Lot 4.3 P9): status and counts only. No token, no credential reference, no external id
// is ever rendered or sent; forms carry the project and a platform / provider, the server resolves the rest.
const initial:ConnectionActionState={};
const input='rounded-lg border border-border bg-background p-2 text-sm';
const tones:Record<ConnectionSummary['status'],'green'|'amber'|undefined>={none:undefined,pending:'amber',active:'green',expired:'amber',revoked:'amber',error:'amber',disabled:undefined};

// oauthReady: whether the server configuration allows connecting this provider (booleans only, no value).
// returnView 'client': started from the client page, the OAuth callback brings the admin back there.
// accounts: names and statuses of the accounts discovered by each connection (identity shown on the card).
export function ConnectionsPanel({projectId,connections,oauthMessage,oauthReady,banner=null,returnView='project',accounts=null}:{projectId:string;connections:ConnectionSummary[];oauthMessage:string;
 oauthReady:Record<ConnectionSummary['provider'],boolean>;banner?:{ok:boolean;message:string}|null;returnView?:'project'|'client';accounts?:AccountOption[]|null}){
 return <Panel className="mt-6 p-6"><h2 className="font-semibold">Connexions</h2>
  <p className="mt-2 text-sm text-muted">Comptes du client utilisables par les canaux de ce projet. Aucune publication n’est diffusée depuis cette page.</p>
  {banner&&<p role={banner.ok?'status':'alert'} data-oauth-result={banner.ok?'success':'failure'} className={`mt-3 rounded-lg border p-3 text-sm ${banner.ok?'border-success/60':'border-danger/60 text-danger'}`}>{banner.message}</p>}
  <div className="mt-4 grid gap-4 md:grid-cols-2">{connections.map(c=><ConnectionCard key={c.provider} projectId={projectId} connection={c} oauthMessage={oauthMessage} ready={oauthReady[c.provider]} returnView={returnView}
  accounts={accounts?.filter(a=>PROVIDER_PLATFORMS[c.provider].includes(a.platform))??null}/>)}</div></Panel>;
}
function ConnectionCard({projectId,connection:c,oauthMessage,ready,returnView,accounts}:{projectId:string;connection:ConnectionSummary;oauthMessage:string;ready:boolean;returnView:'project'|'client';accounts:AccountOption[]|null}){
 const existing=c.status!=='none'&&c.status!=='disabled',reconnect=c.status==='expired'||c.status==='revoked'||c.status==='error';
 return <article data-connection={c.provider} data-status={c.status} className="rounded-lg border border-border p-4 text-sm">
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{c.label}</h3><Badge tone={tones[c.status]}>{c.statusLabel}</Badge></div>
  <p className="mt-2">{c.connected?'Connecté':'Non connecté'}{c.connectedLabel?` · ${c.connectedLabel}`:''}{c.expiresLabel?` · ${c.expiresLabel}`:''}</p>
  {c.provider==='meta'?<p className="mt-1 text-muted">{c.counts.facebook} page(s) Facebook · {c.counts.instagram} compte(s) Instagram</p>
   :<p className="mt-1 text-muted">{c.counts.google_business_profile} fiche(s) Google Business Profile</p>}
  {reconnect&&<p role="status" data-needs-reconnection="true" className="mt-2 rounded-lg border border-warning/60 p-2 text-xs">Reconnexion nécessaire : les publications de ces comptes sont bloquées tant que l’accès n’est pas renouvelé.</p>}
  {accounts&&accounts.length>0&&<ul className="mt-2 space-y-1 text-xs" data-connection-accounts="true">{accounts.map(a=><li key={a.id}>{platformLabels[a.platform]} · <span className="text-foreground">{a.name}</span> · {a.usedByOtherClient?'Déjà utilisé par un autre client':a.statusLabel}</li>)}</ul>}
  {ready?<div className="mt-3 flex flex-wrap items-start gap-2"><ConnectForm projectId={projectId} provider={c.provider} label={`${existing?'Reconnecter':'Connecter'} ${c.label}`} returnView={returnView}/>
    {existing&&<VerifyForm projectId={projectId} provider={c.provider}/>}</div>
   :<div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" disabled className="rounded-lg border border-border px-3 py-2 disabled:opacity-60">Connecter {c.label}</button>
    <span className="text-xs text-muted" data-oauth-pending="true">{oauthMessage}</span></div>}
  {c.canDisconnect&&<DisconnectForm projectId={projectId} provider={c.provider} label={c.label}/>}</article>;
}
// The server builds the consent URL (state, PKCE) and redirects; the browser only sends the project and provider.
function ConnectForm({projectId,provider,label,returnView}:{projectId:string;provider:ConnectionSummary['provider'];label:string;returnView:'project'|'client'}){
 const [state,start,pending]=useActionState(startOAuthAction,initial);
 return <form action={start}><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="provider" value={provider}/>{returnView==='client'&&<input type="hidden" name="return_view" value="client"/>}
  <button disabled={pending} className="rounded-lg bg-accent-strong px-3 py-2 font-semibold text-accent-foreground disabled:opacity-60">{pending?'Redirection…':label}</button>
  {state.message&&<p role="alert" className="mt-1 text-danger">{state.message}</p>}</form>;
}
function VerifyForm({projectId,provider}:{projectId:string;provider:ConnectionSummary['provider']}){
 const [state,verify,pending]=useActionState(verifyConnectionAction,initial);
 return <form action={verify}><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="provider" value={provider}/>
  <button disabled={pending} className="rounded-lg border border-border px-3 py-2">{pending?'Vérification…':'Vérifier la connexion'}</button>
  {state.message&&<p role={state.ok?'status':'alert'} className={`mt-1 ${state.ok?'':'text-danger'}`}>{state.message}</p>}</form>;
}
function DisconnectForm({projectId,provider,label}:{projectId:string;provider:ConnectionSummary['provider'];label:string}){
 const [state,disconnect,pending]=useActionState(disconnectPublicationConnectionAction,initial);
 return <form action={disconnect} className="mt-3 space-y-2 border-t border-border pt-3"><input type="hidden" name="project_id" value={projectId}/><input type="hidden" name="provider" value={provider}/>
  <label className="block text-xs"><input type="checkbox" name="confirm" required/> Je confirme : les comptes {label} ne pourront plus être utilisés pour publier.</label>
  <button disabled={pending} className="rounded-lg border border-danger/60 px-3 py-2 text-danger">{pending?'Déconnexion…':'Déconnecter'}</button>
  {state.message&&<p role={state.ok?'status':'alert'} className={state.ok?'':'text-danger'}>{state.message}</p>}</form>;
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
    {state.message&&<p role={state.ok?'status':'alert'} className={`w-full ${state.ok?'':'text-danger'}`}>{state.message}</p>}</form>}
  <p data-publishability={view.publishability} className={`text-xs ${publishable?'text-success':'text-muted'}`}>Publication : {view.publishabilityLabel}</p></div>;
}
