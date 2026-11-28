import 'server-only';
// Onglet « Concurrence » de Données et performances : dernier rapport de veille du client, ses réglages et ce qui
// manque pour qu'il tourne. Lecture seule ; rien relevé = état vide expliqué, jamais un rapport inventé.
import type {SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {competitionTarget} from '@/lib/local-competition/model';
import {WATCH_PROVIDER,readSettings,readWatchReport,type WatchReport,type WatchSettings} from './model';
import {WATCH_SETTINGS_TABLE} from './service';

export type CompetitorWatchDashboard={
 report:WatchReport|null;previous:{at:string;findings:number}[];settings:WatchSettings;settingsInstalled:boolean;
 /** Raison pour laquelle le client n'est pas suivi (null = suivi). */
 ineligible:string|null;dataforseo:boolean;
};
const missingTable=(error:unknown)=>{const e=error as {code?:string;message?:string}|null;return e?.code==='42P01'||e?.code==='PGRST205'||/could not find the table|does not exist/i.test(e?.message??'');};

export async function getCompetitorWatchDashboard(clientId:string):Promise<CompetitorWatchDashboard>{
 const db=getSupabaseServerClient() as unknown as SupabaseClient;
 const [client,reports,settings]=await Promise.all([
  db.from('clients').select('id,name,company_name,activity,geographic_area,website').eq('id',clientId).maybeSingle(),
  db.from('metric_snapshots').select('fetched_at,data').eq('client_id',clientId).eq('provider',WATCH_PROVIDER).order('fetched_at',{ascending:false}).limit(6),
  db.from(WATCH_SETTINGS_TABLE).select('enabled,competitors').eq('client_id',clientId).maybeSingle(),
 ]);
 if(client.error||reports.error||(settings.error&&!missingTable(settings.error)))throw Error('Veille concurrence illisible.');
 const rows=((reports.data??[]) as {fetched_at:string;data:unknown}[]).flatMap(row=>{const report=readWatchReport(row.data);return report?[{at:row.fetched_at,report}]:[];});
 const target=client.data?competitionTarget(client.data as never):null;
 const parsed=readSettings(settings.error?null:settings.data);
 return {
  report:rows[0]?.report??null,previous:rows.slice(1).map(row=>({at:row.at,findings:row.report.findings.length})),
  settings:parsed,settingsInstalled:!settings.error,
  ineligible:!target?'Le client n’a pas de métier ou de ville renseignés sur sa fiche (un client national n’a pas de concurrence locale).':!parsed.enabled?'Veille désactivée pour ce client.':null,
  dataforseo:Boolean(process.env.DATAFORSEO_LOGIN&&process.env.DATAFORSEO_PASSWORD),
 };
}

/** Enregistre les réglages du client (administrateur). */
export async function saveCompetitorWatchSettings(userId:string,clientId:string,settings:WatchSettings):Promise<{ok:boolean;message:string}>{
 const db=getSupabaseServerClient() as unknown as SupabaseClient;
 const {error}=await db.from(WATCH_SETTINGS_TABLE).upsert({client_id:clientId,enabled:settings.enabled,competitors:settings.competitors,updated_by:/^user_[a-zA-Z0-9_-]{1,200}$/.test(userId)?userId:null,updated_at:new Date().toISOString()},{onConflict:'client_id'});
 if(error)return {ok:false,message:missingTable(error)?'Réglages non installés : la migration 20261224300000_competitor_watch doit être appliquée.':'Enregistrement impossible.'};
 return {ok:true,message:'Réglages de la veille enregistrés.'};
}
