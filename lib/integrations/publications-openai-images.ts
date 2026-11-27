import 'server-only';
// Transport OpenAI Images de l'Agent Photo (Publications découpées, lot 4). Clé serveur uniquement, jamais journalisée.
// Modèle réglable par AI_IMAGE_MODEL (défaut gpt-image-1), qualité par AI_IMAGE_QUALITY (défaut high). Format portrait
// 1024 × 1536 : recadré ensuite en 4:5 (Instagram, Facebook) ou 1:1 sans perdre le sujet. L'image renvoyée reste en
// attente de validation humaine.
import {DEFAULT_IMAGE_MODEL,IMAGE_SAFETY_SUFFIX} from '@/lib/publications/photo-agent/model';

export type ImageGenerator=(prompt:string)=>Promise<{bytes:Uint8Array;model:string}>;
const PNG=[0x89,0x50,0x4e,0x47];

const imageQuality=()=>{const q=(process.env.AI_IMAGE_QUALITY??'').trim();return ['low','medium','high'].includes(q)?q:'high';};
export const imageGenerationConfigured=()=>Boolean(process.env.OPENAI_API_KEY);

export const openaiImageGenerator:ImageGenerator=async(prompt)=>{
 const key=process.env.OPENAI_API_KEY;if(!key)throw Error('image credential unavailable');
 const model=(process.env.AI_IMAGE_MODEL??'').trim()||DEFAULT_IMAGE_MODEL;
 const response=await fetch('https://api.openai.com/v1/images/generations',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
  body:JSON.stringify({model,prompt:`${prompt}${IMAGE_SAFETY_SUFFIX}`,size:'1024x1536',quality:imageQuality(),n:1}),signal:AbortSignal.timeout(120_000),redirect:'error'});
 if(!response.ok)throw Error('image request failed');
 const body=await response.json() as {data?:{b64_json?:unknown}[]};
 const b64=body.data?.[0]?.b64_json;if(typeof b64!=='string'||!b64.length)throw Error('image missing');
 const bytes=new Uint8Array(Buffer.from(b64,'base64'));
 if(bytes.length<1000||bytes.length>12_000_000||!PNG.every((byte,i)=>bytes[i]===byte))throw Error('image invalid');
 return {bytes,model};
};
