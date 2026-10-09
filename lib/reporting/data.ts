import "server-only";
import {requireAdmin} from "@/lib/require-admin";
import {getSupabaseServerClient} from "@/lib/supabase/server";
import {isAgentUuid} from "@/lib/agents/validation";
import {summaryPeriod} from "./period";
import {aggregateClientMonthlySummary} from "./aggregate";
import type {ClientMonthlySummaryContext} from "./types";
import type {PublicationJob,PublicationAttempt} from "@/lib/publications/types";
async function all<T>(read:(start:number,end:number)=>PromiseLike<{data:T[]|null;error:unknown}>):Promise<T[]> {
 const result:T[]=[];
 for(let start=0;;start+=100){const {data,error}=await read(start,start+99);if(error)throw new Error();result.push(...(data??[]));if(!data||data.length<100)return result;}
}
export async function buildClientMonthlySummaryContext(clientId:string,period:string):Promise<ClientMonthlySummaryContext> {
 await requireAdmin();
 if(!isAgentUuid(clientId))throw new Error("Client invalide.");
 summaryPeriod(period);
 try {
  const db=getSupabaseServerClient();
  const {data:client,error}=await db.from("clients").select("*").eq("id",clientId).single();if(error||!client)throw new Error();
  const [projects,runs,recommendations,actions,tasks,publications,deliveries,revisions,variants]=await Promise.all([
   all((s,e)=>db.from("projects").select("*").eq("client_id",clientId).order("id").range(s,e)),
   all((s,e)=>db.from("agent_runs").select("*").eq("client_id",clientId).order("id").range(s,e)),
   all((s,e)=>db.from("recommendations").select("*").eq("client_id",clientId).order("id").range(s,e)),
   all((s,e)=>db.from("actions").select("*").eq("client_id",clientId).order("id").range(s,e)),
   all((s,e)=>db.from("tasks").select("*").eq("client_id",clientId).order("id").range(s,e)),
   all((s,e)=>db.from("publications").select("*").eq("client_id",clientId).order("id").range(s,e)),
   all((s,e)=>db.from("publication_deliveries").select("*").eq("client_id",clientId).order("id").range(s,e)),
   all((s,e)=>db.from("publication_revisions").select("*").eq("client_id",clientId).order("id").range(s,e)),
   all((s,e)=>db.from("publication_variants").select("*").eq("client_id",clientId).order("id").range(s,e)),
  ]);
  const jobs:PublicationJob[]=[],attempts:PublicationAttempt[]=[];
  for(let start=0;start<publications.length;start+=100)jobs.push(...await all((s,e)=>db.from("publication_jobs").select("*").in("publication_id",publications.slice(start,start+100).map(p=>p.id)).order("id").range(s,e)));
  for(let start=0;start<jobs.length;start+=100)attempts.push(...await all((s,e)=>db.from("publication_attempts").select("*").in("job_id",jobs.slice(start,start+100).map(j=>j.id)).order("id").range(s,e)));
  return aggregateClientMonthlySummary({client,projects,runs,recommendations,actions,tasks,publications,deliveries,revisions,variants,jobs,attempts},period);
 }catch{console.error("[reporting] Contexte mensuel indisponible.");throw new Error("La synthèse est indisponible. Vérifiez le stockage et les migrations ; aucune donnée manquante n’a été remplacée par zéro.");}
}
