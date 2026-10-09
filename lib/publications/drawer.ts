import 'server-only';
import {requireAdmin} from '@/lib/require-admin';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {getWorkspace} from './workspace';
import {getAiRunForRevision,getGenerationDetails} from './agent-data';
import {isPublicationUuid} from './validation';
import {publicationChannelLock} from './project-channels';
import {DELIVERY_COLUMNS,describeDeliveries} from './delivery/service';
import type {DeliveryRow} from './delivery/model';
import {buildPublicationDetail,deliveryLockMessage,type DetailDelivery,type PublicationDetailData} from './publication-detail';

export type DrawerLoad={state:'ok';detail:PublicationDetailData}|{state:'not_found'}|{state:'unavailable'};
type Root={client:{name:string}|null;project:{name:string}|null};

// One publication only (never once per board row): getWorkspace plus the calendar slot and the delivery summary.
export async function loadPublicationDetail(id:string,options:{debug:boolean}):Promise<DrawerLoad>{
 await requireAdmin();if(!isPublicationUuid(id))return {state:'not_found'};
 try{
  const workspace=await getWorkspace(id);if(!workspace)return {state:'not_found'};
  const db=getSupabaseServerClient();
  const [root,slot,deliveries,channelLock]=await Promise.all([
   db.from('publications').select('client:clients(name),project:projects(name)').eq('id',id).maybeSingle(),
   db.from('publication_calendar_slots').select('platforms').eq('publication_id',id).maybeSingle(),
   db.from('publication_deliveries').select(DELIVERY_COLUMNS).eq('publication_id',id),publicationChannelLock(id)]);
  if(root.error||slot.error||deliveries.error)return {state:'unavailable'};
  const names=(root.data??{client:null,project:null}) as unknown as Root,p=workspace.publication,revisionId=p.current_revision_id;
  let debug:Record<string,unknown>|null=null;
  if(options.debug){const [details,run]=revisionId?await Promise.all([getGenerationDetails(revisionId),getAiRunForRevision(revisionId)]):[null,null];
   const assetIds=[...new Set(workspace.links.filter(l=>workspace.variants.some(v=>v.id===l.variant_id&&v.revision_id===revisionId)).map(l=>l.asset_id))];
   debug={publication_id:p.id,revision_id:revisionId,sql_status:p.status,creation_origin:p.creation_origin,slot_bound:Boolean(slot.data),deliveries:deliveries.data,
    run_id:details?.run_id??run?.id??null,model:run?.model??null,input_tokens:run?.input_tokens??null,output_tokens:run?.output_tokens??null,estimated_cost_eur:run?.estimated_cost_eur??null,
    asset_ids:assetIds,storage_paths:assetIds.map(a=>workspace.assets.find(x=>x.id===a)?.storage_path??null)};}
  const detail=buildPublicationDetail({publication:p,clientName:names.client?.name??'Client',projectName:names.project?.name??null,workspace,
   slot:slot.data?{platforms:(slot.data as {platforms:string[]}).platforms??[]}:null,deliveries:(deliveries.data??[]) as DetailDelivery[],debug,channelLock});
  // Lot 4.3 P10 « Diffusion »: read only; a read failure hides the section (the actions re-check everything in SQL).
  const rows=(deliveries.data??[]) as unknown as (DeliveryRow&{publication_account_id:string;created_at:string})[];
  const views=await describeDeliveries([...rows].sort((a,b)=>b.created_at.localeCompare(a.created_at))).catch(()=>null);
  const live=(deliveries.data??[]).some(d=>(d as {status:string}).status!=='cancelled');
  return {state:'ok',detail:{...detail,diffusion:views?{deliveries:views,canPrepare:p.status==='approved'&&!p.archived_at&&!live}:null}};
 }catch{console.error('[publications] Lecture du panneau indisponible.');return {state:'unavailable'};}
}

// Server-side read-only guard for every drawer mutation: same rule as the drawer, read from this publication's
// deliveries only. A read failure locks (fail closed). Invalid ids are left to the workflow validation.
export async function deliveryLock(id:string):Promise<string|null>{
 await requireAdmin();if(!isPublicationUuid(id))return null;
 const {data,error}=await getSupabaseServerClient().from('publication_deliveries').select('status').eq('publication_id',id);
 if(error||!data)return 'Vérification des envois impossible : lecture seule par sécurité.';
 return deliveryLockMessage(data as {status:string}[]);
}
