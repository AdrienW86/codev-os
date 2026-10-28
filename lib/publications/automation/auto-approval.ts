import 'server-only';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {isAuthorizedAdmin} from '@/lib/admin-policy';
import {revisionChannelsWithoutMedia,type MediaRuleDb} from '../media-rule';
import {delegatedActor} from './scheduled';

// Validation automatique (« sans réponse, ça part ») : pour les clients qui l'ont activée, une publication préparée par
// l'agent et restée « À valider » est approuvée N heures avant son créneau (réglage du client), au nom de
// l'administrateur qui a délégué la préparation automatique. L'humain a été notifié à la préparation et garde la main
// jusque-là : modifier (révision humaine), rejeter ou approuver lui-même. La base revérifie tout sous verrou
// (publication_auto_approve) : jamais TikTok, jamais une révision modifiée par un humain, jamais sans photo.
export const MAX_AUTO_APPROVALS_PER_TICK=20;
export type AutoApprovalSummary={disabled?:'global';approved:number;blocked:number;noActor:number};
export type AutoApprovalDeps={isAdmin:(userId:string)=>boolean};
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
  const r=await db().rpc('publication_auto_approve',{p_publication_id:c.publication_id,p_revision_id:c.revision_id,p_actor_id:actor});
  if(r.error)summary.blocked++;else summary.approved++;
 }
 return summary;
}
