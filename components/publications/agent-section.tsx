import Link from 'next/link';
import {Panel} from '@/components/ui/primitives';
import {getPublicationsAgentProject} from '@/lib/publications/agent-data';
import {allowedPlatforms} from '@/lib/publications/editor';
import {AgentConfigurationForm,AgentPrepareForm} from './agent-forms';
export async function PublicationsAgentSection({project}:{project:{id:string;type:string|null}}){
 if(!allowedPlatforms(project.type).length)return null;const state=await getPublicationsAgentProject(project.id);
 return <Panel className="mt-6 p-6"><h2 className="font-semibold">Agent Publications · opportunités et photos client</h2>{!state.ready?<p className="mt-3 text-sm text-muted">Le socle du Lot 4 doit être installé avant de configurer cet agent.</p>:<>
 <AgentConfigurationForm key={state.config?.updated_at??'new'} projectId={project.id} config={state.config}/>
 <AgentPrepareForm projectId={project.id} disabled={!state.config?.enabled} placeholders={state.placeholders.map(p=>({id:p.id,date:p.target_date??p.editorial_week}))}/>
 {!state.placeholders.length&&<p className="mt-3 text-sm text-muted">Aucun placeholder disponible. Réservez les créneaux avec la cadence avant de préparer leur contenu.</p>}</>}
 <Link href="/publications/review" className="mt-4 inline-block text-accent">Ouvrir la file de validation</Link></Panel>;
}
