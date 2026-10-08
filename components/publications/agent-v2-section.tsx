import Link from 'next/link';
import {Panel,Badge} from '@/components/ui/primitives';
import {agentStatusLabels,formatDay,type AgentStatus} from '@/lib/projects/workspace-view';
import type {PublicationsAgentProject} from '@/lib/publications/agent-types';
import {AgentConfigurationForm} from './agent-forms';
import {AgentV2Form,AgentV2MediaRetryForm,AgentV2MediaSummary} from './agent-v2-form';
import type {AgentV2MediaRunView} from '@/lib/publications/agent-v2/media-view';

// Agent Publications v2 for configured projects (Lot 4.3 P7): next open occurrences (one per platform) → one idea,
// one draft per occurrence. Presentation only; the single write is the explicit form.
export type AgentV2Upcoming={key:string;platformLabel:string;date:string;time:string};
export function AgentV2Section({projectId,status,config,upcoming,openCount,runs=[]}:{projectId:string;status:AgentStatus;config:PublicationsAgentProject|null;upcoming:AgentV2Upcoming[];openCount:number;runs?:AgentV2MediaRunView[]}){
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
   <p className="mt-3 text-xs text-muted">Média : une photo réelle déjà analysée peut être attachée aux brouillons ; sinon ils sont créés sans média (média requis avant validation).</p>
   {runs.length>0&&<><h3 className="mt-6 text-sm font-semibold">Dernières préparations</h3>
    <ul className="mt-2 space-y-3 text-sm" data-agent-v2-runs="true">{runs.map(r=><li key={r.id} className="space-y-1 rounded-lg border border-border p-3">
     <p><span className="capitalize">{formatDay(r.createdAt.slice(0,10))}</span> · {r.drafts} brouillon{r.drafts>1?'s':''}</p>
     <AgentV2MediaSummary media={r.media}/>
     {r.media.state==='failed'&&<p className="text-red-400">Les brouillons ont été créés mais le média n’a pas pu être attaché.</p>}
     {r.retryable&&<AgentV2MediaRetryForm runId={r.id}/>}</li>)}</ul></>}</Panel>
  <details open={status==='unconfigured'} className="mt-6 rounded-lg border border-border p-6"><summary className="cursor-pointer font-semibold">Configuration de l’agent</summary>
   <AgentConfigurationForm key={config?.updated_at??'new'} projectId={projectId} config={config}/></details></>;
}
