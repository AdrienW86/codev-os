'use client';
import {useActionState} from 'react';
import {configureAgentAction,prepareAgentAction} from '@/app/(cockpit)/publications/agent-actions';
import type {PublicationsAgentProject} from '@/lib/publications/agent-types';
const input='mt-2 block w-full rounded-lg border border-border bg-background p-3';
export function AgentConfigurationForm({projectId,config}:{projectId:string;config:PublicationsAgentProject|null}){
 const [state,action,pending]=useActionState(configureAgentAction,{});
 return <form action={action} className="mt-4 space-y-4"><input type="hidden" name="project_id" value={projectId}/>
 <label className="block">ID du dossier de photos Drive<input className={input} name="folder" required pattern="[a-zA-Z0-9_-]{10,200}" defaultValue={config?.drive_folder_id??''}/></label>
 <label className="block">Prestations réellement proposées, une par ligne<textarea className={input} name="services" required maxLength={2200} defaultValue={Array.isArray(config?.verified_services)?config.verified_services.join('\n'):''}/></label>
 <label className="block">Objectif et règles éditoriales du projet<textarea className={input} name="rules" maxLength={4000} defaultValue={config?.editorial_rules??''}/></label>
 <label className="block"><input type="checkbox" name="rights" required defaultChecked={config?.rights_confirmed??false}/> Je confirme les droits d’utilisation des photos de ce dossier.</label>
 <label className="block"><input type="checkbox" name="enabled" defaultChecked={config?.enabled??false}/> Autoriser la préparation manuelle pour ce projet et assigner l’Agent Publications.</label>
 <button disabled={pending} className="rounded-lg border border-border px-4 py-2">{pending?'Enregistrement…':'Enregistrer la configuration'}</button>{state.message&&<p role="status">{state.message}</p>}</form>;
}
export function AgentPrepareForm({projectId,placeholders,publicationId,regenerate=false,disabled=false}:{projectId:string;placeholders?:{id:string;date:string}[];publicationId?:string;regenerate?:boolean;disabled?:boolean}){
 const [state,action,pending]=useActionState(prepareAgentAction,{});const unavailable=disabled||!publicationId&&!placeholders?.length;
 return <form action={action} className="mt-5 space-y-4"><input type="hidden" name="project_id" value={projectId}/>{publicationId?<input type="hidden" name="publication_id" value={publicationId}/>:<label className="block">Une seule publication réservée<select className={input} name="publication_id" required disabled={unavailable}><option value="">Choisir un créneau</option>{placeholders?.map(p=><option value={p.id} key={p.id}>{p.date} · {p.id.slice(0,8)}</option>)}</select></label>}
 <p className="text-sm text-muted">Préparation manuelle uniquement. Budget réservé : 0,10 € maximum. Une nouvelle révision sera soumise à validation humaine.</p>
 <label className="block"><input type="checkbox" name="authorize_ai" required disabled={unavailable}/> J’autorise un appel IA réel pour cette publication et la lecture de ses photos Drive.</label>
 <button disabled={pending||unavailable} className="rounded-lg bg-accent px-4 py-2 text-background">{pending?'Préparation…':regenerate?'Régénérer':'Préparer les publications'}</button>{state.message&&<p role="status">{state.message}</p>}</form>;
}
