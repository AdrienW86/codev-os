import 'server-only';
import type {FetchLike} from './publications-oauth/http';

// Lecture seule de la fiche Google Business Profile pour le référencement local (architecture des agents, lot 6).
// Liste fermée : statistiques quotidiennes et recherches (Business Profile Performance API v1), avis (My Business
// API v4, lecture). Jeton dans l'en-tête Authorization, délai, aucune redirection, corps borné ; aucune écriture,
// aucune réponse aux avis. Ne journalise rien.
export type GbpInsightsRequest={kind:'daily'|'keywords'|'reviews';location:string;params:[string,string][];token:string};
export interface GbpInsightsTransport{read(request:GbpInsightsRequest):Promise<{status:number;body:unknown}>}
const SEG='[0-9A-Za-z_-]{1,100}';
const LOCATION=new RegExp(`^accounts/(${SEG})/locations/(${SEG})$`);
const MAX_BODY=1_048_576,TIMEOUT_MS=20_000;
export function gbpInsightsTransport(fetchImpl:FetchLike=fetch):GbpInsightsTransport{
 return {async read(r){
  const match=LOCATION.exec(r.location);if(!match||!r.token)throw Error('invalid insights request');
  const query=new URLSearchParams(r.params).toString();
  const url=r.kind==='daily'?`https://businessprofileperformance.googleapis.com/v1/locations/${match[2]}:fetchMultiDailyMetricsTimeSeries?${query}`
   :r.kind==='keywords'?`https://businessprofileperformance.googleapis.com/v1/locations/${match[2]}/searchkeywords/impressions/monthly?${query}`
   :`https://mybusiness.googleapis.com/v4/${r.location}/reviews?${query}`;
  const response=await fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${r.token}`,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});
  const text=await response.text();if(text.length>MAX_BODY)throw Error('insights response too large');
  let body:unknown=null;try{body=JSON.parse(text);}catch{body=null;}
  return {status:response.status,body};
 }};
}
