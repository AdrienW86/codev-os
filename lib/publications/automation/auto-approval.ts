import 'server-only';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isAuthorizedAdmin} from '@/lib/admin-policy';
import {revisionChannelsWithoutMedia,type MediaRuleDb} from '../media-rule';
import {delegatedActor} from './scheduled';
import {checkRevisionCoherence,type CoherenceVerdict} from '../photo-agent/coherence';

// Validation automatique (« sans réponse, ça part ») : pour les clients qui l'ont activée, une publication préparée par
// l'agent et restée « À valider » est approuvée N heures avant son créneau (réglage du client), au nom de
// l'administrateur qui a délégué la préparation automatique. L'humain a été notifié à la préparation et garde la main
// jusque-là : modifier (révision humaine), rejeter ou approuver lui-même. La base revérifie tout sous verrou
// (publication_auto_approve) : jamais une révision modifiée par un humain, jamais sans photo. TikTok (migration
// 20261221000000) : sans réglages humains, la diffusion envoie le post dans l'application TikTok, le créateur publie.
// Agent Contrôle (lot 4) : juste avant, la cohérence texte / image de la révision est vérifiée ; une incohérence ou un
// contrôle impossible laisse la publication « À valider » et l'administrateur est notifié (une fois par révision).
export const MAX_AUTO_APPROVALS_PER_TICK=20;
export type AutoApprovalSummary={disabled?:'global';approved:number;blocked:number;noActor:number;incoherent?:number};
export type AutoApprovalDeps={isAdmin:(userId:string)=>boolean;coherence?:(input:{publicationId:string;revisionId:string;clientId:string})=>Promise<CoherenceVerdict>};
type Candidate={publication_id:string;revision_id:string;client_id:string};
const db=()=>getSupabaseServerClient();

export async function runAutoApproval(now=new Date(),deps:AutoApprovalDeps={isAdmin:userId=>isAuthorizedAdmin(userId)}):Promise<AutoApprovalSummary>{
 const summary:AutoApprovalSummary={approved:0,blocked:0,noActor:0};
 const s=await db().from('publication_settings').select('emergency_stop,publishing_enabled').limit(1).maybeSingle();
 const sw=s.data as {emergency_stop?:boolean;publishing_enabled?:boolean}|null;
 if(s.error||!sw||sw.emergency_stop!==false||sw.publishing_enabled!==true)return {...summary,disabled:'global'};
 const candidates=await db().rpc('publication_auto_approval_candidates',{p_now:now.toISOString(),p_limit:MAX_AUTO_APPROVALS_PER_TICK});
 if(candidates.error||!Array.isArray(candidates.data))return summary;
 const actors=new Map<string,string|null>();
 for(const c of candidates.data as Candidate[]){
  if(!actors.has(c.client_id))actors.set(c.client_id,await delegatedActor(c.client_id,deps.isAdmin).catch(()=>null));
  const actor=actors.get(c.client_id);
  // Sans administrateur délégué toujours autorisé, personne au nom de qui approuver : la publication reste « À valider ».
  if(!actor){summary.noActor++;continue;}
  const missing=await revisionChannelsWithoutMedia(db() as unknown as MediaRuleDb,c.revision_id).catch(()=>null);
  if(missing===null||missing.length){summary.blocked++;continue;}
  const verdict=await (deps.coherence??checkRevisionCoherence)({publicationId:c.publication_id,revisionId:c.revision_id,clientId:c.client_id}).catch(():CoherenceVerdict=>({state:'error'}));
  if(verdict.state==='incoherent'||verdict.state==='error'){
   summary.blocked++;summary.incoherent=(summary.incoherent??0)+1;
   if(verdict.state==='incoherent')await db().from('admin_notifications').upsert({event_key:`coherence:${c.revision_id}`,category:'publication_review',href:`/publications/${c.publication_id}`},{onConflict:'event_key',ignoreDuplicates:true}).then(()=>undefined,()=>undefined);
   continue;
  }
  const r=await db().rpc('publication_auto_approve',{p_publication_id:c.publication_id,p_revision_id:c.revision_id,p_actor_id:actor});
  if(r.error)summary.blocked++;else summary.approved++;
 }
 return summary;
}
