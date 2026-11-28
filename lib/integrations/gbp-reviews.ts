import 'server-only';
import type {FetchLike} from './publications-oauth/http';

// Agent Avis Google : transport fermé vers Google Business Profile, avec la connexion Google déjà accordée
// (business.manage). Trois appels seulement : liste des avis d'une fiche (My Business API v4, lecture), lien « Laisser
// un avis » de la fiche (Business Information API v1, lecture) et réponse à UN avis (v4 reviews.updateReply, écriture
// appelée uniquement après validation). Jeton dans l'en-tête Authorization, délai, aucune redirection, corps borné,
// aucune nouvelle tentative automatique d'une écriture. Ne journalise rien.
export type GbpReviewsRequest=
 |{kind:'list';location:string;pageToken?:string|null;token:string}
 |{kind:'metadata';location:string;token:string}
 |{kind:'reply';review:string;comment:string;token:string};
export interface GbpReviewsTransport{request(request:GbpReviewsRequest):Promise<{status:number;body:unknown}>}
const SEG='[0-9A-Za-z_-]{1,100}';
const LOCATION=new RegExp(`^accounts/${SEG}/locations/(${SEG})$`);
const REVIEW=new RegExp(`^accounts/${SEG}/locations/${SEG}/reviews/[0-9A-Za-z_-]{1,300}$`);
const MAX_BODY=1_048_576,TIMEOUT_MS=20_000;
export function gbpReviewsTransport(fetchImpl:FetchLike=fetch):GbpReviewsTransport{
 return {async request(r){
  if(!r.token)throw Error('invalid reviews request');
  let url:string,init:RequestInit;
  const headers={Authorization:`Bearer ${r.token}`,Accept:'application/json'};
  if(r.kind==='list'){
   if(!LOCATION.test(r.location)||(r.pageToken&&!/^[\x21-\x7e]{1,500}$/.test(r.pageToken)))throw Error('invalid reviews request');
   const query=new URLSearchParams({pageSize:'50',orderBy:'updateTime desc',...(r.pageToken?{pageToken:r.pageToken}:{})});
   url=`https://mybusiness.googleapis.com/v4/${r.location}/reviews?${query}`;init={method:'GET',headers};
  }else if(r.kind==='metadata'){
   const match=LOCATION.exec(r.location);if(!match)throw Error('invalid reviews request');
   url=`https://mybusinessbusinessinformation.googleapis.com/v1/locations/${match[1]}?readMask=metadata`;init={method:'GET',headers};
  }else{
   if(!REVIEW.test(r.review)||typeof r.comment!=='string'||!r.comment.trim()||r.comment.length>4096)throw Error('invalid reviews request');
   url=`https://mybusiness.googleapis.com/v4/${r.review}/reply`;init={method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({comment:r.comment})};
  }
  const response=await fetchImpl(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(TIMEOUT_MS)});
  const text=await response.text();if(text.length>MAX_BODY)throw Error('reviews response too large');
  let body:unknown=null;try{body=JSON.parse(text);}catch{body=null;}
  return {status:response.status,body};
 }};
}
