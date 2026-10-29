import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const model=loadTs("lib/motion/model.ts");
const handoff=loadTs("lib/motion/handoff.ts");
const CLIENT="11111111-1111-4111-8111-111111111111";
const FOLDER="driveFolderReal123";
const sources=[{clientId:CLIENT,clientName:"Entreprise",folderId:FOLDER,label:"Publications"}];
const values={
 source_key:CLIENT+":"+FOLDER,
 title:"Animation éducative",
 brief:"Présenter des conseils de prévention sans inventer de prestations.",
 brand_direction:"Utiliser uniquement le logo et les couleurs confirmés.",
 duration_seconds:"20",aspect_ratio:"9:16",engine:"remotion",voice_mode:"none",
};
function form(record=values){
 const result=new FormData();
 for(const [k,v] of Object.entries(record))result.append(k,String(v));
 return result;
}

test("Studio Motion validates a complete bounded brief",()=>{
 const parsed=model.parseMotionForm(form());
 assert.ok(parsed);
 assert.equal(parsed.duration_seconds,20);
 assert.equal(parsed.voice_mode,"none");
 assert.equal(model.resolveMotionSource(sources,parsed.source_key)?.folderId,FOLDER);
});

test("Form rejects missing fields, duplicated fields, invalid duration and unknown sources",()=>{
 const missing={...values};delete missing.title;
 assert.equal(model.parseMotionForm(form(missing)),null);
 assert.equal(model.parseMotionForm(form({...values,duration_seconds:"120"})),null);
 assert.equal(model.parseMotionForm(form({...values,engine:"shell"})),null);
 assert.equal(model.parseMotionForm(form({...values,brief:"Mensonge"})),null);
 const repeated=form();repeated.append("title","duplicate");
 assert.equal(model.parseMotionForm(repeated),null);
 assert.equal(model.resolveMotionSource(sources,CLIENT+":otherFolder1234"),null);
 assert.equal(model.resolveMotionSource(sources,"22222222-2222-4222-8222-222222222222:"+FOLDER),null);
});

test("Handoff is explicit about missing assets and never claims a produced video",()=>{
 const project={id:CLIENT,client_id:CLIENT,source_folder_id:FOLDER,title:values.title,brief:values.brief,
  brand_direction:values.brand_direction,duration_seconds:20,aspect_ratio:"9:16",engine:"remotion",voice_mode:"none",status:"draft",created_at:"2026-10-29T00:00:00Z"};
 const unavailable=handoff.motionProductionHandoff(project,null);
 assert.match(unavailable,/Inventaire Drive indisponible/);
 assert.match(unavailable,/BRIEF NON ENCORE EXÉCUTÉ/);
 const actual=handoff.motionProductionHandoff(project,[{id:"fileReal1234",name:"logo.png",mimeType:"image/png",size:300,modifiedTime:"2026-10-29T00:00:00Z"}]);
 assert.match(actual,/logo\.png/);
 assert.doesNotMatch(actual,/faux rendu|MP4 livré/);
});

test("Admin denial stops motion service before touching storage",async()=>{
 let touched=false;
 const service=loadTs("lib/motion/service.ts",{
  "@/lib/require-admin":{requireAdmin:async()=>{throw Error("forbidden");}},
  "@/lib/supabase/server":{getSupabaseServerClient:()=>{touched=true;throw Error("DB");}},
  "@/lib/motion/model":model,
 });
 await assert.rejects(service.listMotionProjects(),/forbidden/);
 await assert.rejects(service.listMotionSources(),/forbidden/);
 await assert.rejects(()=>service.createMotionProject(model.parseMotionForm(form())),/forbidden/);
 assert.equal(touched,false);
});

test("Drive access is rejected for an unassigned client before any credential or network access",async()=>{
 let tokens=0;
 const drive=loadTs("lib/motion/drive.ts",{
  "@/lib/require-admin":{requireAdmin:async()=>({userId:"user_admin"})},
  "@/lib/integrations/google-drive-oauth":{driveCredentials:()=>{tokens++;throw Error("credential called");}},
  "@/lib/motion/model":model,
  "@/lib/motion/service":{listMotionSources:async()=>sources},
 });
 await assert.rejects(()=>drive.listMotionDriveFiles("22222222-2222-4222-8222-222222222222",FOLDER),/non autorisé/);
 await assert.rejects(()=>drive.listMotionDriveFiles(CLIENT,"../../etc"),/invalide/);
 assert.equal(tokens,0);
});

test("SQL enforces client-folder match, RLS, service role, and atomic audit; no rendering actions",()=>{
 const sql=readFileSync(new URL("../supabase/migrations/20261119000000_motion_studio_foundation.sql",import.meta.url),"utf8");
 assert.match(sql,/alter table public\.motion_projects enable row level security/);
 assert.match(sql,/from public\.publication_agent_projects/);
 assert.match(sql,/from public\.whatsapp_senders/);
 assert.match(sql,/insert into public\.motion_events/);
 assert.match(sql,/grant execute on function public\.motion_project_create[\s\S]*to service_role/);
 assert.match(sql,/check \(status = 'draft'\)/);
 assert.doesNotMatch(sql,/create table .*motion_videos/);
});
