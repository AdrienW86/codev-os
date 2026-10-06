import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {validateAgentContext} from '@/lib/agents/scope';
import {getWorkspace} from './workspace';
import {getProjectCadence,planningRows} from './planning';
import {allowedPlatforms} from './editor';
import {isPublicationUuid} from './validation';
import {collectOpportunities} from './opportunities/service';
import type {MediaUse} from './agent-types';
import type {PublicationVariant,PublicationReview} from './types';

export async function buildPublicationAgentContext(projectId:string,publicationId:string){
 await requireAdmin();if(!isPublicationUuid(projectId)||!isPublicationUuid(publicationId))throw Error('Invalid context');const db=getSupabaseServerClient();
 const config=await db.from('publication_agent_projects').select('*').eq('project_id',projectId).maybeSingle();if(config.error||!config.data?.enabled||!config.data.rights_confirmed)throw Error('Agent project configuration required');const c=config.data;
 const [agent,project,workspace,client,cadence,assignment]=await Promise.all([db.from('agents').select('*').eq('id',c.agent_id).single(),db.from('projects').select('*').eq('id',projectId).eq('client_id',c.client_id).single(),getWorkspace(publicationId),db.from('clients').select('id,name,activity,geographic_area,website,notes').eq('id',c.client_id).single(),getProjectCadence(projectId),db.from('agent_client_assignments').select('client_instructions').eq('agent_id',c.agent_id).eq('client_id',c.client_id).single()]);
 if(agent.error||project.error||client.error||assignment.error||!workspace||workspace.publication.client_id!==c.client_id||workspace.publication.project_id!==projectId||!agent.data.publication_specialist||!agent.data.enabled||!await validateAgentContext(db,agent.data,c.client_id,projectId))throw Error('Project agent scope invalid');
 const slot=await db.from('publication_calendar_slots').select('*').eq('publication_id',publicationId).eq('project_id',projectId).eq('client_id',c.client_id).single();if(slot.error||!slot.data)throw Error('Reserved placeholder required');
 const [history,mediaUses,rules]=await Promise.all([planningRows(()=>db.from('publication_revisions').select('*').eq('project_id',projectId).eq('client_id',c.client_id).order('created_at',{ascending:false}).order('id')),planningRows<MediaUse>(()=>db.from('publication_media_uses').select('*').eq('client_id',c.client_id).order('id')),db.from('publication_client_settings').select('editorial_brief').eq('client_id',c.client_id).maybeSingle()]);if(rules.error)throw Error('Editorial rules unavailable');
 const services=c.verified_services;if(!Array.isArray(services)||!services.every(s=>typeof s==='string'))throw Error('Verified services required');
 const revisionIds=new Set(history.slice(0,30).map(r=>r.id));
 const [variants,reviews]=await Promise.all([planningRows<PublicationVariant>(()=>db.from('publication_variants').select('*').eq('client_id',c.client_id).order('id')),planningRows<PublicationReview>(()=>db.from('publication_reviews').select('*').eq('client_id',c.client_id).order('id'))]);
 const context={clientId:c.client_id,projectId,services:services as string[],date:slot.data.local_date,zone:client.data.geographic_area,recentSubjects:history.slice(0,30).flatMap(r=>r.internal_title?[r.internal_title]:[]),rules:c.editorial_rules};
 const opportunities=await collectOpportunities(context);
 return {config:c,agent:agent.data,client:client.data,project:project.data,cadence,slot:slot.data,workspace,history:history.slice(0,30),historyVariants:variants.filter(v=>revisionIds.has(v.revision_id)),historyReviews:reviews.filter(v=>revisionIds.has(v.revision_id)),mediaUses,opportunities,platforms:allowedPlatforms(project.data.type),rules:[c.editorial_rules,rules.data?.editorial_brief??'',assignment.data.client_instructions??'',agent.data.instructions].join('\n')};
}
