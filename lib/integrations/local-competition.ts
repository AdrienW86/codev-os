import 'server-only';
import type {FetchLike} from './publications-oauth/http';

// Concurrence locale (architecture des agents, lot 7). Deux lectures, chacune limitée à une seule adresse fixe :
//  - Google Places API (New) searchText, clé GOOGLE_PLACES_API_KEY (en-tête), masque de champs fermé ;
//  - DataForSEO SERP Google Maps live/advanced, identifiants DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD (Basic).
// Délai, aucune redirection, corps borné ; la recherche (« métier ville ») est le seul contenu envoyé. Ne journalise rien.
export type CompetitionSearch={keyword:string};
export interface LocalCompetitionTransport{
 places:((search:CompetitionSearch)=>Promise<{status:number;body:unknown}>)|null;
 dataforseo:((search:CompetitionSearch)=>Promise<{status:number;body:unknown}>)|null;
}
export const PLACES_SEARCH_URL='https://places.googleapis.com/v1/places:searchText';
export const DATAFORSEO_MAPS_URL='https://api.dataforseo.com/v3/serp/google/maps/live/advanced';
export const PLACES_FIELDS='places.id,places.displayName,places.rating,places.userRatingCount,places.websiteUri,places.businessStatus';
const MAX_BODY=2_097_152,TIMEOUT_MS=25_000;

async function post(fetchImpl:FetchLike,url:string,headers:Record<string,string>,body:unknown){
 const response=await fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',...headers},body:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});
 const text=await response.text();if(text.length>MAX_BODY)throw Error('competition response too large');
 let parsed:unknown=null;try{parsed=JSON.parse(text);}catch{parsed=null;}
 return {status:response.status,body:parsed};
}
const validKeyword=(keyword:string)=>typeof keyword==='string'&&keyword.trim().length>=3&&keyword.length<=120&&!/[\u0000-\u001f]/.test(keyword);

export function localCompetitionTransport(keys:{placesKey?:string|null;dataforseoLogin?:string|null;dataforseoPassword?:string|null},fetchImpl:FetchLike=fetch):LocalCompetitionTransport{
 const placesKey=keys.placesKey?.trim()||null;
 const login=keys.dataforseoLogin?.trim()||null,password=keys.dataforseoPassword?.trim()||null;
 return {
  places:placesKey?async({keyword})=>{
   if(!validKeyword(keyword))throw Error('invalid search');
   return post(fetchImpl,PLACES_SEARCH_URL,{'X-Goog-Api-Key':placesKey,'X-Goog-FieldMask':PLACES_FIELDS},{textQuery:keyword.trim(),languageCode:'fr',regionCode:'FR',pageSize:20});
  }:null,
  dataforseo:login&&password?async({keyword})=>{
   if(!validKeyword(keyword))throw Error('invalid search');
   // location_code 2250 = France ; la ville est dans la recherche. Appareil mobile, 20 résultats.
   return post(fetchImpl,DATAFORSEO_MAPS_URL,{Authorization:`Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`},[{keyword:keyword.trim(),location_code:2250,language_code:'fr',device:'mobile',os:'android',depth:20}]);
  }:null,
 };
}
