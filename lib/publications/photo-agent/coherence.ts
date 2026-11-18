import 'server-only';
// Agent Contrôle (Publications découpées, lot 4) : avant toute validation automatique, vérifie que le texte et l'image
// d'une révision vont ensemble (vision). Verdict mis en cache par révision (publication_coherence_checks) : une révision
// n'est contrôlée qu'une fois. Fermé par défaut : un contrôle qui n'a pas pu tourner bloque la validation automatique
// (la publication reste « À valider » pour l'humain). Sans la migration 20261214000000 : aucun contrôle, comportement d'avant.
import type {SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseServerClient} from '@/lib/supabase/server';
import {structuredResponse,withAiScope} from '@/lib/ai/metered';
import {withCharter} from '@/lib/harness/charter';
import {mediaBucket} from '../editor';
import {visionPreview} from '../media/transform';
import {COHERENCE_INSTRUCTIONS,COHERENCE_SCHEMA,coherenceText,readCoherence} from './model';

export type CoherenceVerdict={state:'coherent'}|{state:'incoherent';issues:string[]}|{state:'error'}|{state:'not_installed'}|{state:'no_image'};
const db=()=>getSupabaseServerClient() as unknown as SupabaseClient;
const missingTable=(error:unknown)=>{const e=error as {code?:string;message?:string}|null;return e?.code==='42P01'||e?.code==='PGRST205'||/could not find the table|does not exist/i.test(e?.message??'');};

export async function checkRevisionCoherence(input:{publicationId:string;revisionId:string;clientId:string}):Promise<CoherenceVerdict>{
 const cached=await db().from('publication_coherence_checks').select('coherent,issues').eq('revision_id',input.revisionId).maybeSingle();
 if(cached.error)return missingTable(cached.error)?{state:'not_installed'}:{state:'error'};
 const hit=cached.data as {coherent:boolean;issues:unknown}|null;
 if(hit)return hit.coherent?{state:'coherent'}:{state:'incoherent',issues:Array.isArray(hit.issues)?hit.issues.filter((i):i is string=>typeof i==='string'):[]};
 const variants=await db().from('publication_variants').select('id,platform,text_content').eq('revision_id',input.revisionId);
 if(variants.error||!variants.data?.length)return {state:'error'};
 const rows=variants.data as {id:string;platform:string;text_content:string}[];
 const links=await db().from('publication_variant_assets').select('asset_id,sort_order').in('variant_id',rows.map(v=>v.id)).order('sort_order').limit(1);
 const assetId=(links.data as {asset_id:string}[]|null)?.[0]?.asset_id;
 if(links.error)return {state:'error'};
 if(!assetId)return {state:'no_image'};
 const asset=await db().from('publication_assets').select('storage_path,mime_type,provenance').eq('id',assetId).maybeSingle();
 const a=asset.data as {storage_path:string;mime_type:string;provenance:string|null}|null;
 if(asset.error||!a)return {state:'error'};
 // Vidéo : l'image n'est pas contrôlée ici (rien à comparer image par image) ; la validation automatique continue.
 if(a.mime_type.startsWith('video/'))return {state:'coherent'};
 try{
  const file=await db().storage.from(mediaBucket(a.mime_type)).download(a.storage_path);
  if(file.error||!file.data)return {state:'error'};
  const preview=await visionPreview(new Uint8Array(await file.data.arrayBuffer()));
  const generated=/générée par IA/i.test(a.provenance??'');
  const response=await withAiScope({agent:'publication-check',clientId:input.clientId},()=>structuredResponse(withCharter('publication-check',COHERENCE_INSTRUCTIONS),
   [{role:'user',content:[{type:'input_text',text:JSON.stringify({image_generated_by_ai:generated,texts_untrusted:coherenceText(rows)})},
    {type:'input_image',image_url:`data:image/jpeg;base64,${Buffer.from(preview).toString('base64')}`,detail:'low'}]}],COHERENCE_SCHEMA,{maxOutputTokens:800,timeoutMs:60000}));
  const verdict=readCoherence(response.value);
  if(!verdict)return {state:'error'};
  const saved=await db().from('publication_coherence_checks').upsert({revision_id:input.revisionId,client_id:input.clientId,publication_id:input.publicationId,coherent:verdict.coherent,issues:verdict.issues,model:(response.usage as {model?:string}|undefined)?.model??null},{onConflict:'revision_id',ignoreDuplicates:true});
  if(saved.error)console.error('[publication-check] verdict not cached');
  return verdict.coherent?{state:'coherent'}:{state:'incoherent',issues:verdict.issues};
 }catch{return {state:'error'};}
}
