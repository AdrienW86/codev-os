import "server-only";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MOTION_DRIVE_ID, MOTION_UUID, resolveMotionSource, type MotionDraft, type MotionProject, type MotionSource } from "@/lib/motion/model";

const unavailable = "Stockage Motion indisponible.";
type SourceRow = {client_id: string;drive_folder_id:string;rights_confirmed:boolean;enabled?:boolean};

export async function listMotionSources(): Promise<MotionSource[]> {
 await requireAdmin();
 const db = getSupabaseServerClient();
 const [publications, senders] = await Promise.all([
  db.from("publication_agent_projects").select("client_id,drive_folder_id,rights_confirmed")
   .eq("rights_confirmed",true).limit(100),
  db.from("whatsapp_senders").select("client_id,drive_folder_id,rights_confirmed,enabled")
   .eq("rights_confirmed",true).eq("enabled",true).limit(100),
 ]);
 if (publications.error || senders.error) throw new Error("Sources Drive indisponibles.");
 const folders = new Map<string,{clientId:string;folderId:string;label:string}>();
 const add = (items: SourceRow[], label: string) => {
  for (const row of items) {
   if (!MOTION_UUID.test(row.client_id) || !MOTION_DRIVE_ID.test(row.drive_folder_id) || row.rights_confirmed !== true) continue;
   const key = row.client_id+":"+row.drive_folder_id;
   if (!folders.has(key)) folders.set(key,{clientId:row.client_id,folderId:row.drive_folder_id,label});
  }
 };
 add((publications.data ?? []) as SourceRow[], "Dossier Publications");
 add((senders.data ?? []) as SourceRow[], "Dossier WhatsApp");
 const all = [...folders.values()];
 if (!all.length) return [];
 const {data:clients,error} = await db.from("clients").select("id,name").in("id",[...new Set(all.map(item=>item.clientId))]);
 if(error)throw new Error("Clients indisponibles.");
 const names = new Map((clients??[]).map(client=>[client.id,client.name]));
 return all.flatMap(source=>{
  const clientName=names.get(source.clientId);
  return clientName ? [{...source,clientName}] : [];
 }).sort((a,b)=>a.clientName.localeCompare(b.clientName,"fr"));
}

export async function listMotionProjects(): Promise<{ready:boolean;projects:MotionProject[]}> {
 await requireAdmin();
 const {data,error}=await getSupabaseServerClient().from("motion_projects")
  .select("id,client_id,source_folder_id,title,brief,brand_direction,duration_seconds,aspect_ratio,engine,voice_mode,status,created_at")
  .order("created_at",{ascending:false}).limit(60);
 if(error?.code==="PGRST205" || error?.code==="42P01")return {ready:false,projects:[]};
 if(error)throw new Error(unavailable);
 return {ready:true,projects:(data??[]) as MotionProject[]};
}

export async function createMotionProject(input: MotionDraft): Promise<{ok:true;id:string}|{ok:false;message:string}> {
 const {userId}=await requireAdmin();
 const source = resolveMotionSource(await listMotionSources(),input.source_key);
 if(!source)return {ok:false,message:"Dossier Drive absent ou non autorisé pour ce client."};
 const {data,error}=await getSupabaseServerClient().rpc("motion_project_create",{
  p_client_id:source.clientId,p_source_folder_id:source.folderId,
  p_title:input.title,p_brief:input.brief,p_brand_direction:input.brand_direction,
  p_duration_seconds:input.duration_seconds,p_aspect_ratio:input.aspect_ratio,
  p_engine:input.engine,p_voice_mode:input.voice_mode,p_actor_id:userId,
 });
 if(error || typeof data!=="string" || !MOTION_UUID.test(data))
  return {ok:false,message:"Brief non enregistré. Vérifiez que la migration Motion est appliquée."};
 return {ok:true,id:data};
}

export async function getMotionProject(id:string):Promise<MotionProject|null> {
 await requireAdmin();
 if(!MOTION_UUID.test(id))return null;
 const {data,error}=await getSupabaseServerClient().from("motion_projects")
  .select("id,client_id,source_folder_id,title,brief,brand_direction,duration_seconds,aspect_ratio,engine,voice_mode,status,created_at")
  .eq("id",id).maybeSingle();
 if(error)throw new Error(unavailable);
 return (data??null) as MotionProject|null;
}
