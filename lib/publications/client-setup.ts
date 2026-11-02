import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {getPublicationCapabilitiesForProjects,getPublicationProjectChannels} from './project-channels';
import {projectHasPublicationsWorkspace} from './channels';
import {loadChannelConfiguration} from './channel-configuration';
import {getAvailablePublicationAccounts,getProjectConnectionConfiguration,type ProjectConnectionConfiguration} from './connections/service';
import type {AccountOption} from './connections/model';
import type {ChannelConfigurationView} from './channel-configuration-model';
import {autoApprovalPayload,clientSettingsFromRow,clientSettingsPayload,type ClientPublicationSettings} from './client-setup-model';
import type {PublicationsAgentProject} from './agent-types';
import {isPublicationUuid} from './validation';

// Socle Publications, lot 1 : onglet « Publications » de la fiche client. Réutilise la configuration existante des
// projets (canaux, créneaux, connexions OAuth, agent) en résolvant le projet technique du client sur le serveur.
// Écritures uniquement par RPC auditées ; aucune donnée de compte autre que les libellés, aucun secret.
const unavailable='Configuration Publications du client indisponible.';
export type ClientPublicationProject={id:string;name:string;type:string|null};
export type ClientPublicationsSetup={projects:ClientPublicationProject[];project:ClientPublicationProject|null;settings:ClientPublicationSettings;globalStop:boolean;
 channels:ChannelConfigurationView|null;connections:ProjectConnectionConfiguration|null;accounts:AccountOption[];agent:PublicationsAgentProject|null;agentReady:boolean};

// Projects of the client that own a Publications workspace (configured channels, or the transitional legacy set),
// oldest first: the same rule as the project pages, never decided from the type here.
async function eligibleProjects(clientId:string):Promise<ClientPublicationProject[]>{
 const {data,error}=await getSupabaseServerClient().from('projects').select('id,client_id,name,type,created_at').eq('client_id',clientId).order('created_at').order('id');
 if(error||!data)throw Error(unavailable);
 const capabilities=await getPublicationCapabilitiesForProjects(data);
 return data.filter(p=>{const c=capabilities.get(p.id);return c?projectHasPublicationsWorkspace(c):false;}).map(p=>({id:p.id,name:p.name,type:p.type}));
}
export async function getClientPublicationsSetup(clientId:string,requestedProject?:unknown):Promise<ClientPublicationsSetup>{
 await requireAdmin();if(!isPublicationUuid(clientId))throw Error(unavailable);
 const db=getSupabaseServerClient();
 const [projects,settings,global]=await Promise.all([eligibleProjects(clientId),
  db.from('publication_client_settings').select('*').eq('client_id',clientId).maybeSingle(),
  db.from('publication_settings').select('emergency_stop').limit(1).maybeSingle()]);
 if(settings.error||global.error)throw Error(unavailable);
 const project=projects.find(p=>p.id===requestedProject)??projects[0]??null;
 const base={projects,project,settings:clientSettingsFromRow(settings.data),globalStop:global.data?.emergency_stop!==false};
 if(!project)return {...base,channels:null,connections:null,accounts:[],agent:null,agentReady:false};
 const ref={id:project.id,client_id:clientId,type:project.type};
 const [channels,connections,accounts,agent]=await Promise.all([
  getPublicationProjectChannels(ref).then(c=>loadChannelConfiguration(ref,c)).then(l=>l.view).catch(()=>null),
  getProjectConnectionConfiguration(project.id).catch(()=>null),
  getAvailablePublicationAccounts(clientId).catch(()=>[]),
  db.from('publication_agent_projects').select('*').eq('project_id',project.id).eq('client_id',clientId).maybeSingle()]);
 return {...base,channels,connections,accounts,agent:agent.error?null:agent.data as PublicationsAgentProject|null,agentReady:!agent.error};
}

// « Configurer les publications » : retrouve ou crée le projet technique (RPC idempotente, verrou par client).
export async function ensureClientPublicationsProject(clientId:unknown):Promise<{ok:true;projectId:string;created:boolean}|{ok:false;message:string}>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(clientId))return {ok:false,message:'Client invalide.'};
 const {data,error}=await getSupabaseServerClient().rpc('publication_client_project_ensure',{p_client_id:clientId,p_actor_id:userId});
 const r=data as {project_id?:unknown;created?:unknown}|null;
 if(error||!r||!isPublicationUuid(r.project_id))return {ok:false,message:'Configuration non créée. Vérifiez que la migration du socle Publications est appliquée.'};
 return {ok:true,projectId:r.project_id,created:r.created===true};
}

export async function saveClientPublicationSettings(clientId:unknown,form:FormData):Promise<{ok:boolean;message:string}>{
 const {userId}=await requireAdmin();if(!isPublicationUuid(clientId))return {ok:false,message:'Client invalide.'};
 const parsed=clientSettingsPayload(form);if('error' in parsed)return {ok:false,message:parsed.error};
 const auto=autoApprovalPayload(form);if('error' in auto)return {ok:false,message:auto.error};
 const {error}=await getSupabaseServerClient().rpc('publication_client_settings_save',{p_client_id:clientId,p_settings:parsed.payload,p_actor_id:userId});
 if(error)return {ok:false,message:error.code==='23514'?'Valeur refusée (fuseau horaire ou délai invalide).':'Réglages non enregistrés. Réessayez.'};
 const saved=await getSupabaseServerClient().rpc('publication_auto_approval_save',{p_client_id:clientId,p_enabled:auto.enabled,p_hours_before:auto.hoursBefore,p_actor_id:userId});
 if(saved.error)return {ok:false,message:'Réglages enregistrés, mais pas la validation automatique. Réessayez.'};
 return {ok:true,message:'Réglages Publications enregistrés.'};
}
