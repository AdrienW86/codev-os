import 'server-only';
import type {FetchLike} from './publications-oauth/http';

// Agent Veille concurrence : une seule lecture externe payante, DataForSEO SERP Google organic live/advanced (résultats
// naturels + annonces Google Ads affichées), identifiants DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (Basic), les mêmes que
// la concurrence locale. Adresse fixe, délai, aucune redirection, corps borné ; seule la recherche est envoyée.
// Ne journalise rien. Sans identifiants : null (positions Google et annonces « non relevées »).
export const DATAFORSEO_ORGANIC_URL='https://api.dataforseo.com/v3/serp/google/organic/live/advanced';
const MAX_BODY=3_145_728,TIMEOUT_MS=25_000;
export type OrganicSearch=(keyword:string)=>Promise<{status:number;body:unknown}>;

export function organicSerpTransport(keys:{login?:string|null;password?:string|null},fetchImpl:FetchLike=fetch):OrganicSearch|null{
 const login=keys.login?.trim()||null,password=keys.password?.trim()||null;
 if(!login||!password)return null;
 return async(keyword)=>{
  if(typeof keyword!=='string'||keyword.trim().length<3||keyword.length>120||/[\u0000-\u001f]/.test(keyword))throw Error('invalid search');
  // location_code 2250 = France (la ville est dans la recherche), ordinateur, 20 premiers résultats naturels.
  const response=await fetchImpl(DATAFORSEO_ORGANIC_URL,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`},
   body:JSON.stringify([{keyword:keyword.trim(),location_code:2250,language_code:'fr',device:'desktop',os:'windows',depth:20}]),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});
  const text=await response.text();if(text.length>MAX_BODY)throw Error('serp response too large');
  let body:unknown=null;try{body=JSON.parse(text);}catch{body=null;}
  return {status:response.status,body};
 };
}
