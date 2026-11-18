import 'server-only';
// Relevé des statistiques des publications diffusées (architecture des agents, lot 3). Lecture seule chez le réseau,
// avec le jeton déjà accordé (aucune autorisation nouvelle demandée) ; rien n'est publié ni modifié. Borné par passage.
// Facebook et Instagram : réactions / « j'aime », commentaires, partages. Google Business Profile, TikTok et Snapchat :
// marqués « non disponible » (pas de statistiques par post avec les accès actuels), jamais comptés zéro.
// Sans la migration 20261215000000 : aucun relevé (comportement d'avant).
import type {SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {metaOAuthConfig} from '@/lib/integrations/publications-oauth/config';
import {metaStatsTransport,type MetaStatsTransport} from '@/lib/integrations/publications-meta-stats';
import {productionOAuthDeps} from '../oauth/service';
import {isCredentialReference,type CredentialVault} from '../connections/vault';
import {
 FACEBOOK_STATS_FIELDS,INSTAGRAM_STATS_FIELDS,STATS_SUPPORTED,STATS_UNSUPPORTED_REASON,STATS_WINDOW_DAYS,dueForStats,readFacebookStats,readInstagramStats,
 type StatsDelivery,type StatsMetrics,type StatsRow,
} from './model';

export type StatsSummary={disabled?:'migration'|'vault';due:number;ok:number;unsupported:number;failed:number};
export type StatsDeps={db:SupabaseClient;vault:CredentialVault|null;meta:MetaStatsTransport|null;now?:Date};
const TABLE='publication_delivery_stats';
const missingTable=(error:unknown)=>{const e=error as {code?:string;message?:string}|null;return e?.code==='42P01'||e?.code==='PGRST205'||/could not find the table|does not exist/i.test(e?.message??'');};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const opaque=(v:unknown):v is string=>typeof v==='string'&&v.length>=8&&v.length<=8192&&/^[\x21-\x7e]+$/.test(v);

export function productionStatsDeps():StatsDeps{
 const meta=metaOAuthConfig();
 return {db:getSupabaseServerClient() as unknown as SupabaseClient,vault:productionOAuthDeps().vault,meta:meta?metaStatsTransport(meta):null};
}

type Outcome={status:'ok';metrics:StatsMetrics}|{status:'unsupported'|'error';code:string};

export async function collectPublicationStats(deps:StatsDeps=productionStatsDeps()):Promise<StatsSummary>{
 const now=deps.now??new Date();const summary:StatsSummary={due:0,ok:0,unsupported:0,failed:0};
 const since=new Date(now.getTime()-STATS_WINDOW_DAYS*86_400_000).toISOString();
 const stats=await deps.db.from(TABLE).select('delivery_id,status,fetched_at,fetch_count').gte('fetched_at',new Date(now.getTime()-60*86_400_000).toISOString()).limit(5000);
 if(stats.error){if(missingTable(stats.error))return {...summary,disabled:'migration'};throw Error('stats read');}
 const deliveries=await deps.db.from('publication_deliveries').select('id,client_id,platform,remote_id,published_at,scheduled_for,publication_account_id').eq('status','published').gte('scheduled_for',since).limit(2000);
 if(deliveries.error)throw Error('deliveries read');
 const rows=(deliveries.data??[]) as (StatsDelivery&{publication_account_id:string})[];
 const due=dueForStats(rows,(stats.data??[]) as StatsRow[],now);summary.due=due.length;
 if(!due.length)return summary;
 const previous=new Map(((stats.data??[]) as (StatsRow&{fetch_count?:number})[]).map(row=>[row.delivery_id,row]));
 const pageTokens=new Map<string,string|null>();
 for(const delivery of due){
  const outcome=await collectOne(delivery as StatsDelivery&{publication_account_id:string},deps,pageTokens).catch(():Outcome=>({status:'error',code:'unexpected'}));
  if(outcome.status==='error'&&outcome.code==='vault_unavailable')summary.disabled='vault';
  const saved=await deps.db.from(TABLE).upsert({delivery_id:delivery.id,client_id:delivery.client_id,platform:delivery.platform,status:outcome.status,
   metrics:outcome.status==='ok'?outcome.metrics:{},error_code:outcome.status==='ok'?null:outcome.code,fetch_count:Math.min(1000,(previous.get(delivery.id)?.fetch_count??0)+1),fetched_at:now.toISOString()},{onConflict:'delivery_id'});
  if(saved.error){summary.failed++;continue;}
  summary[outcome.status==='ok'?'ok':outcome.status==='unsupported'?'unsupported':'failed']++;
 }
 return summary;
}

async function collectOne(delivery:StatsDelivery&{publication_account_id:string},deps:StatsDeps,pageTokens:Map<string,string|null>):Promise<Outcome>{
 if(!STATS_SUPPORTED.has(delivery.platform))return {status:'unsupported',code:STATS_UNSUPPORTED_REASON[delivery.platform]??'platform_unsupported'};
 if(!deps.meta)return {status:'error',code:'meta_not_configured'};
 if(!deps.vault)return {status:'error',code:'vault_unavailable'};
 const account=await deps.db.from('publication_accounts').select('connection_id,external_account_id,parent_external_id').eq('id',delivery.publication_account_id).maybeSingle();
 const a=account.data as {connection_id:string|null;external_account_id:string;parent_external_id:string|null}|null;
 if(account.error||!a?.connection_id)return {status:'error',code:'account_unavailable'};
 const pageId=delivery.platform==='facebook'?a.external_account_id:a.parent_external_id;
 if(!pageId||!/^[0-9]{1,30}$/.test(pageId))return {status:'error',code:'account_unavailable'};
 let token=pageTokens.get(pageId);
 if(token===undefined){
  token=null;
  const connection=await deps.db.from('client_connections').select('credential_reference,status').eq('id',a.connection_id).maybeSingle();
  const c=connection.data as {credential_reference?:unknown;status?:unknown}|null;
  if(!connection.error&&c?.status==='active'&&isCredentialReference(c.credential_reference)){
   const credential=await deps.vault.readCredential(c.credential_reference,'meta').catch(()=>null);
   if(credential&&opaque(credential.accessToken)){
    const r=await deps.meta.read({path:pageId,fields:'access_token',token:credential.accessToken}).catch(()=>null);
    const pageToken=r?.status===200?record(r.body).access_token:null;
    token=opaque(pageToken)?pageToken:null;
   }
  }
  pageTokens.set(pageId,token);
 }
 if(!token)return {status:'error',code:'credential_unavailable'};
 const remote=delivery.remote_id??'';
 if(!/^[0-9]{1,30}(_[0-9]{1,30})?$/.test(remote))return {status:'error',code:'remote_id_invalid'};
 const r=await deps.meta.read({path:remote,fields:delivery.platform==='facebook'?FACEBOOK_STATS_FIELDS:INSTAGRAM_STATS_FIELDS,token}).catch(()=>null);
 if(!r)return {status:'error',code:'network'};
 if(r.status!==200){const code=record(record(r.body).error).code;return {status:'error',code:code===190?'token_invalid':code===10||(typeof code==='number'&&code>=200&&code<300)?'permission_missing':code===100?'post_unavailable':r.status===429?'rate_limited':'provider_error'};}
 const metrics=delivery.platform==='facebook'?readFacebookStats(r.body):readInstagramStats(r.body);
 return metrics?{status:'ok',metrics}:{status:'error',code:'malformed_response'};
}
