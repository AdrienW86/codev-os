import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';

// Lien public signé vers une image de diffusion, servi par CODE-V OS (/api/publications/media/<jeton>) : TikTok
// n'accepte que des images hébergées sur un domaine dont la propriété est vérifiée (PULL_FROM_URL). Le jeton contient
// l'URL signée Supabase (courte durée) de l'image, une échéance et une signature HMAC avec une clé serveur : il ne
// donne accès qu'à cette image, et seulement jusqu'à son échéance. Aucun autre hôte que le stockage du projet.
export const MEDIA_LINK_PATH='/api/publications/media/';
type Env=Record<string,string|undefined>;
function linkKey(env:Env):Buffer|null{
 const raw=env.PUBLICATION_CREDENTIALS_KEY;if(!raw)return null;
 let key:Buffer;try{key=Buffer.from(raw,'base64');}catch{return null;}
 return key.length===32?createHmac('sha256',key).update('codev:publications-media-link:v1').digest():null;
}
const sign=(key:Buffer,payload:string)=>createHmac('sha256',key).update(payload).digest('base64url');
export function storageOrigin(env:Env=process.env):string|null{
 try{const url=new URL(env.NEXT_PUBLIC_SUPABASE_URL??env.SUPABASE_URL??'');return url.protocol==='https:'?url.origin:null;}catch{return null;}
}
/** Lien public pour une URL signée du stockage, ou null si la configuration manque (aucune diffusion TikTok alors). */
export function publicMediaLink(signedUrl:string,baseUrl:string,ttlSeconds=1800,env:Env=process.env,now=Date.now()):string|null{
 const key=linkKey(env),origin=storageOrigin(env);
 let url:URL;try{url=new URL(signedUrl);}catch{return null;}
 if(!key||!origin||url.origin!==origin||!/^https:\/\//.test(baseUrl))return null;
 const payload=Buffer.from(JSON.stringify({u:signedUrl,e:Math.floor(now/1000)+Math.min(Math.max(ttlSeconds,60),3600)})).toString('base64url');
 return `${baseUrl}${MEDIA_LINK_PATH}${payload}.${sign(key,payload)}.jpg`;
}
/** URL de stockage d'un jeton valide (signature, échéance, hôte), sinon null. */
export function resolveMediaLink(token:string,env:Env=process.env,now=Date.now()):string|null{
 const m=/^([A-Za-z0-9_-]{20,4000})\.([A-Za-z0-9_-]{43})\.jpg$/.exec(token);const key=linkKey(env),origin=storageOrigin(env);
 if(!m||!key||!origin)return null;
 const expected=Buffer.from(sign(key,m[1])),given=Buffer.from(m[2]);
 if(expected.length!==given.length||!timingSafeEqual(expected,given))return null;
 let data:{u?:unknown;e?:unknown};try{data=JSON.parse(Buffer.from(m[1],'base64url').toString('utf8'));}catch{return null;}
 if(typeof data.u!=='string'||typeof data.e!=='number'||data.e*1000<now)return null;
 try{return new URL(data.u).origin===origin?data.u:null;}catch{return null;}
}
