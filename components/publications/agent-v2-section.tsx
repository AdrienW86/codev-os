import Link from 'next/link';
import {Panel,Badge} from '@/components/ui/primitives';
import {agentStatusLabels,formatDay,type AgentStatus} from '@/lib/projects/workspace-view';
import type {PublicationsAgentProject} from '@/lib/publications/agent-types';
import {AgentConfigurationForm} from './agent-forms';
import {AgentV2Form} from './agent-v2-form';

// Agent Publications v2 for configured projects (Lot 4.3 P7): next open occurrences (one per platform) → one idea,
// one draft per occurrence. Presentation only; the single write is the explicit form.
export type AgentV2Upcoming={key:string;platformLabel:string;date:string;time:string};
export function AgentV2Section({projectId,status,config,upcoming,openCount}:{projectId:string;status:AgentStatus;config:PublicationsAgentProject|null;upcoming:AgentV2Upcoming[];openCount:number}){
 const ready=status==='active';
 return <>
  <Panel className="mt-6 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Agent Publications</h2><Badge>{agentStatusLabels[status]}</Badge></div>
   <p className="mt-2 text-sm text-muted">Une idée éditoriale déclinée en un brouillon par plateforme, à partir des prochaines occurrences ouvertes. Validation humaine obligatoire ; rien n’est publié.</p>
   {upcoming.length?<><h3 className="mt-4 text-sm font-semibold">Prochaines occurrences</h3>
    <ul className="mt-2 space-y-1 text-sm" data-agent-v2-upcoming="true">{upcoming.map(o=><li key={o.key}>{o.platformLabel} — <span className="capitalize">{formatDay(o.date)}</span> à {o.time}</li>)}</ul>
    {openCount>upcoming.length&&<p className="mt-1 text-xs text-muted">{openCount-upcoming.length} autre(s) occurrence(s) ouverte(s) pour les préparations suivantes.</p>}</>
    :<p className="mt-4 text-sm" data-agent-v2-empty="true">Aucune occurrence ouverte. Préparez d’abord les prochaines semaines depuis le <Link className="text-accent" href={`/projects/${projectId}/calendar`}>calendrier</Link>.</p>}
   {!ready&&<p className="mt-4 text-sm text-muted">Activez l’agent et confirmez les droits médias dans la configuration ci-dessous pour lancer une préparation.</p>}
   <AgentV2Form projectId={projectId} disabled={!ready||!upcoming.length}/>
   <p className="mt-3 text-xs text-muted">Média : une photo réelle déjà analysée peut être suggérée ; sinon les brouillons sont créés sans média.</p></Panel>
  <details open={status==='unconfigured'} className="mt-6 rounded-lg border border-border p-6"><summary className="cursor-pointer font-semibold">Configuration de l’agent</summary>
   <AgentConfigurationForm key={config?.updated_at??'new'} projectId={projectId} config={config}/></details></>;
}
