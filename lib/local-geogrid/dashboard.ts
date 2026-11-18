import 'server-only';
// Onglet « Local · Google Maps » de Données et performances : dernières cartes de positions et dernier relevé de
// concurrence locale d'un client, et dernier relevé de sa fiche Google. Lecture seule ; aucune donnée inventée (rien relevé = état vide expliqué).
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {COMPETITION_PROVIDER,readCompetition,type CompetitionSnapshot} from '@/lib/local-competition/model';
import {GEOGRID_PROVIDER,readGeogrid,type GeogridSnapshot} from './model';
import {localSignals,type LocalRow} from '@/lib/harness/briefing';

/** profile : constats du dernier relevé de fiche Google (null = module non installé ou illisible ; facts vide = rien relevé). */
export type LocalDashboard={grids:GeogridSnapshot[];competition:CompetitionSnapshot[];profile:{facts:string[];at:string|null}|null;dataforseo:boolean;places:boolean};
export async function getLocalDashboard(clientId:string):Promise<LocalDashboard>{
 const db=getSupabaseServerClient();
 const since=new Date(Date.now()-45*86_400_000).toISOString();
 const [grids,competition,profile]=await Promise.all([
  db.from('metric_snapshots').select('metric_key,fetched_at,data').eq('client_id',clientId).eq('provider',GEOGRID_PROVIDER).gte('fetched_at',since).order('fetched_at',{ascending:false}).limit(30),
  db.from('metric_snapshots').select('metric_key,fetched_at,data').eq('client_id',clientId).eq('provider',COMPETITION_PROVIDER).gte('fetched_at',since).order('fetched_at',{ascending:false}).limit(10),
  db.from('local_seo_snapshots').select('location_title,metrics,reviews,fetched_at').eq('client_id',clientId).gte('fetched_at',since).order('fetched_at',{ascending:false}).limit(5),
 ]);
 if(grids.error||competition.error)throw Error('Relevés locaux illisibles.');
 const latest=<T,>(rows:{metric_key:string;data:unknown}[],read:(v:unknown)=>T|null)=>rows.filter((row,i,all)=>all.findIndex(o=>o.metric_key===row.metric_key)===i).flatMap(row=>{const v=read(row.data);return v?[v]:[];});
 return {
  grids:latest((grids.data??[]) as {metric_key:string;data:unknown}[],readGeogrid).slice(0,3),
  competition:latest((competition.data??[]) as {metric_key:string;data:unknown}[],readCompetition),
  profile:profile.error?null:{facts:localSignals((profile.data??[]) as LocalRow[]).facts.map(f=>f.statement),at:(profile.data?.[0] as LocalRow|undefined)?.fetched_at??null},
  dataforseo:Boolean(process.env.DATAFORSEO_LOGIN&&process.env.DATAFORSEO_PASSWORD),places:Boolean(process.env.GOOGLE_PLACES_API_KEY),
 };
}
