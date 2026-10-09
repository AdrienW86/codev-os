import Link from 'next/link';
import {Panel,Badge} from '@/components/ui/primitives';
import {agentStatusLabels,type AgentStatus} from '@/lib/projects/workspace-view';
import type {PublicationsAgentProject} from '@/lib/publications/agent-types';
import {AgentConfigurationForm,AgentPrepareForm} from './agent-forms';
// Presentation of the existing Agent Publications configuration and manual preparation; behavior is unchanged.
export function AgentWorkspace({projectId,status,config,placeholders}:{projectId:string;status:AgentStatus;config:PublicationsAgentProject|null;placeholders:{id:string;date:string;label:string}[]}){
 const services=Array.isArray(config?.verified_services)?config.verified_services.filter((s):s is string=>typeof s==='string'):[];
 if(status==='unavailable')return <Panel className="mt-6 p-6"><h2 className="font-semibold">Agent Publications</h2><p className="mt-3 text-sm">Agent Publications indisponible pour le moment. Vérifiez l’installation et l’accès au stockage.</p></Panel>;
 return <>
 <Panel className="mt-6 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Agent Publications</h2><Badge>{agentStatusLabels[status]}</Badge></div>
  <dl className="mt-4 grid gap-4 text-sm md:grid-cols-2">
   <div><dt className="text-xs text-muted">Dossier de photos Drive</dt><dd>{config?.drive_folder_id?'Configuré':'Non configuré'}</dd></div>
   <div><dt className="text-xs text-muted">Droits d’utilisation des photos</dt><dd>{config?.rights_confirmed?'Confirmés':'Non confirmés'}</dd></div>
   <div className="md:col-span-2"><dt className="text-xs text-muted">Prestations vérifiées</dt><dd>{services.length?<ul className="mt-1 flex flex-wrap gap-2">{services.map(s=><li key={s} className="rounded-full border border-border px-2 py-0.5">{s}</li>)}</ul>:'Aucune prestation renseignée'}</dd></div>
   <div className="md:col-span-2"><dt className="text-xs text-muted">Objectif et règles éditoriales</dt><dd className="whitespace-pre-wrap">{config?.editorial_rules?.trim()||'Aucune règle renseignée'}</dd></div>
  </dl></Panel>
 <Panel className="mt-6 p-6"><h2 className="font-semibold">Préparer un contenu</h2><p className="mt-2 text-sm text-muted">Préparation manuelle d’un créneau réservé, soumise ensuite à votre validation. Aucune publication n’est diffusée.</p>
  <AgentPrepareForm projectId={projectId} disabled={status!=='active'} placeholders={placeholders}/>
  {status!=='active'&&<p className="mt-3 text-sm text-muted">Activez l’agent dans la configuration ci-dessous pour préparer un contenu.</p>}
  {!placeholders.length&&<p className="mt-3 text-sm text-muted">Aucun créneau à préparer. Réservez des créneaux depuis le <Link className="text-accent" href={`/projects/${projectId}/calendar`}>calendrier</Link>.</p>}</Panel>
 <details open={status==='unconfigured'} className="mt-6 rounded-lg border border-border p-6"><summary className="cursor-pointer font-semibold">Configuration de l’agent</summary>
  <AgentConfigurationForm key={config?.updated_at??'new'} projectId={projectId} config={config}/></details></>;
}
