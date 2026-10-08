import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {requireAdmin} from "@/lib/require-admin";
import {getSupabaseServerClient} from "@/lib/supabase/server";
import {isPublicationUuid} from "./validation";
import {reviewDecisions} from "./review-decisions";
import {missingMediaMessage,revisionChannelsWithoutMedia,type MediaRuleDb} from "./media-rule";
import {getPublicationProjectChannels,publicationChannelLock} from "./project-channels";
import {projectAllowsPlatform} from "./channels";
import {IMAGE_BUCKET,IMAGE_URL_TTL,MAX_IMAGE_BYTES,imageMime,parseEditorialForm,platformLabels} from "./editor";
import type {Publication,PublicationRevision,PublicationVariant,PublicationReview,PublicationEvent,PublicationAsset,PublicationVariantAsset} from "./types";
export type Workspace={publication:Publication;revisions:PublicationRevision[];variants:PublicationVariant[];reviews:PublicationReview[];events:PublicationEvent[];assets:(PublicationAsset&{preview:string|null})[];links:PublicationVariantAsset[]};
const failed="Opération non confirmée. Rechargez la fiche et réessayez. Vérifiez aussi que les migrations du Lot 2 sont appliquées.";
async function allRows<T>(query:()=>{range:(start:number,end:number)=>PromiseLike<{data:T[]|null;error:unknown}>}):Promise<T[]>{
 const result:T[]=[];for(let offset=0;;offset+=100){const page=await query().range(offset,offset+99);if(page.error)throw new Error(failed);result.push(...(page.data??[]));if(!page.data||page.data.length<100)return result;}
}
export async function publicationSummaries(ids:string[]){
 await requireAdmin();const db=getSupabaseServerClient();const result:Record<string,{version:number;platforms:string[];search:string}>={};
 for(let offset=0;offset<ids.length;offset+=100){const batch=ids.slice(offset,offset+100);if(batch.some(id=>!isPublicationUuid(id)))throw new Error(failed);const [revisions,variants]=await Promise.all([db.from("publication_revisions").select("id,revision_number,angle,source_content").in("id",batch),db.from("publication_variants").select("revision_id,platform,text_content").in("revision_id",batch)]);if(revisions.error||variants.error)throw new Error(failed);for(const r of revisions.data??[]){const vv=(variants.data??[]).filter(v=>v.revision_id===r.id);result[r.id]={version:r.revision_number,platforms:vv.map(v=>v.platform),search:[r.angle,r.source_content,...vv.map(v=>v.text_content)].join(" ")};}}
 return result;
}
function uploadedAsset(event:PublicationEvent):string|null{
 if(event.action!=="publication.media_uploaded"||!event.metadata||typeof event.metadata!=="object"||Array.isArray(event.metadata))return null;
 const asset=(event.metadata as Record<string,unknown>).asset_id;return isPublicationUuid(asset)?asset:null;
}
export async function getWorkspace(id:string):Promise<Workspace|null>{
 await requireAdmin();if(!isPublicationUuid(id))return null;const db=getSupabaseServerClient();const root=await db.from("publications").select("*").eq("id",id).maybeSingle();if(root.error)throw new Error(failed);if(!root.data)return null;
 const clientId=root.data.client_id;
 const [revisions,variants,reviews,events]=await Promise.all([
  allRows<PublicationRevision>(()=>db.from("publication_revisions").select("*").eq("publication_id",id).order("revision_number",{ascending:false})),
  allRows<PublicationVariant>(()=>db.from("publication_variants").select("*").eq("publication_id",id).order("id")),
  allRows<PublicationReview>(()=>db.from("publication_reviews").select("*").eq("publication_id",id).order("id")),
  allRows<PublicationEvent>(()=>db.from("publication_events").select("*").eq("resource_id",id).order("created_at",{ascending:false}).order("id"))]);
 // Only the links of this publication's variants (previously every link of the client, filtered afterwards).
 const variantIds=variants.map(v=>v.id),links:PublicationVariantAsset[]=[];
 for(let offset=0;offset<variantIds.length;offset+=100){const batch=variantIds.slice(offset,offset+100);links.push(...await allRows<PublicationVariantAsset>(()=>db.from("publication_variant_assets").select("*").eq("client_id",clientId).in("variant_id",batch).order("variant_id").order("asset_id")));}
 // Media ownership comes from database relations only, never from the storage path: assets linked to this
 // publication's variants, plus images uploaded for it (audited media_uploaded events) and not yet attached.
 const assetIds=[...new Set([...links.map(l=>l.asset_id),...events.flatMap(e=>uploadedAsset(e)??[])])],assets:PublicationAsset[]=[];
 for(let offset=0;offset<assetIds.length;offset+=100){const batch=assetIds.slice(offset,offset+100);assets.push(...await allRows<PublicationAsset>(()=>db.from("publication_assets").select("*").eq("client_id",clientId).in("id",batch).order("id")));}
 const previews=await Promise.all(assets.map(async asset=>{const signed=await db.storage.from(IMAGE_BUCKET).createSignedUrl(asset.storage_path,IMAGE_URL_TTL);return {...asset,preview:signed.error?null:signed.data.signedUrl};}));
 return {publication:root.data,revisions,variants,reviews:reviewDecisions(reviews,events,variants),events,assets:previews,links:links.filter(l=>variants.some(v=>v.id===l.variant_id))};
}
// Guarded refusals of the save RPC (55000), mapped without exposing the database message.
function lockedMessage(message:string|undefined):string{return /rescheduling/i.test(message??"")?"Cette date est pilotée par le calendrier.":/deliveries/i.test(message??"")?"Un envoi est en cours ou terminé : modification impossible.":failed;}
export async function saveDraft(form:FormData):Promise<{id?:string;message?:string}>{
 const {userId}=await requireAdmin();const input=parseEditorialForm(form);if(!input)return {message:"Vérifiez les champs obligatoires, les dates et les variantes."};const db=getSupabaseServerClient();
 if(input.publication_id){const lock=await publicationChannelLock(input.publication_id);if(lock)return {message:lock};}
 // Mono-platform publication (Lot 4.3 P4): one variant on its platform, same project, and the date of its occurrence.
 if(input.publication_id){const bound=await db.from("publications").select("platform,occurrence_id,target_date,project_id").eq("id",input.publication_id).maybeSingle();
  if(bound.error)return {message:failed};const b=bound.data as {platform?:PublicationVariant["platform"]|null;occurrence_id?:string|null;target_date?:string|null;project_id?:string|null}|null;
  if(b?.platform){if(input.variants.length!==1||input.variants[0].platform!==b.platform)return {message:`Publication mono-plateforme : seul le texte ${platformLabels[b.platform]} peut être modifié.`};
   if(input.project_id!==b.project_id)return {message:"Le projet d’une publication liée à un créneau ne peut pas changer."};
   if(b.occurrence_id&&input.target_date!==b.target_date)return {message:"La date d’une publication liée à un créneau ne peut pas changer."};}}
 const project=await db.from("projects").select("id,client_id,type").eq("id",input.project_id).eq("client_id",input.client_id).maybeSingle();
 const capabilities=project.data?await getPublicationProjectChannels(project.data):null;
 if(project.error||!project.data||!capabilities||input.variants.some(v=>!projectAllowsPlatform(capabilities,v.platform)))return {message:"Le projet doit appartenir au client et autoriser toutes les plateformes choisies."};
 const result=await db.rpc("publication_save_draft",{p_publication_id:input.publication_id,p_expected_revision_id:input.expected_revision_id,p_client_id:input.client_id,p_project_id:input.project_id,p_title:input.title,p_angle:input.angle,p_source:input.source,p_target_date:input.target_date,p_week:input.week,p_slot:input.slot,p_variants:input.variants,p_actor_id:userId});
 if(result.error)return {message:result.error.code==="23505"?"Ce créneau est occupé ou les deux créneaux de cette semaine sont déjà utilisés.":result.error.code==="40001"?"La publication a changé. Rechargez avant de modifier.":result.error.code==="55000"?lockedMessage(result.error.message):failed};return {id:result.data};
}
export async function submitOrReview(form:FormData):Promise<{message:string}>{
 const {userId}=await requireAdmin();const id=form.get("publication_id"),revision=form.get("revision_id"),decision=form.get("decision"),reason=form.get("reason");
 if(!isPublicationUuid(id)||!isPublicationUuid(revision)||!["submit","approved","rejected"].includes(String(decision))|| (decision==="rejected"&&(typeof reason!=="string"||!reason.trim()||reason.length>3000)))return {message:"Identifiant, révision ou motif de refus invalide."};
 const db=getSupabaseServerClient();
 if(decision==="approved"){const lock=await publicationChannelLock(id);if(lock)return {message:lock};}
 if(decision==="approved"){const missing=await revisionChannelsWithoutMedia(db as unknown as MediaRuleDb,revision);if(missing===null)return {message:failed};if(missing.length)return {message:missingMediaMessage(missing)};}
 const result=decision==="submit"?await db.rpc("publication_submit_manual",{p_publication_id:id,p_revision_id:revision,p_actor_id:userId}):await db.rpc("publication_review_manual",{p_publication_id:id,p_revision_id:revision,p_decision:String(decision),p_reason:typeof reason==="string"?reason.trim()||null:null,p_actor_id:userId});
 return {message:result.error?failed:decision==="submit"?"Révision soumise à validation.":decision==="approved"?"Révision approuvée.":"Révision refusée. Créez une nouvelle révision pour la retravailler."};
}
// Safe description of an uploaded, not yet attached image: no storage path or bucket, only a short-lived preview.
export type StagedMedia={assetId:string;previewUrl:string|null;mime:string};
export async function uploadImage(form:FormData):Promise<{message:string;staged?:StagedMedia}>{
 const {userId}=await requireAdmin();const id=form.get("publication_id"),revision=form.get("revision_id"),file=form.get("image"),provenance=form.get("provenance");
 if(!isPublicationUuid(id)||!isPublicationUuid(revision)||!(file instanceof File)||file.size<12||file.size>MAX_IMAGE_BYTES||form.get("rights")!=="on"||typeof provenance!=="string"||!provenance.trim()||provenance.length>2000)return {message:"Image requise (JPEG, PNG ou WebP, 768 Ko maximum), provenance et droits confirmés obligatoires."};
 const lock=await publicationChannelLock(id);if(lock)return {message:lock};
 const db=getSupabaseServerClient();const pub=await db.from("publications").select("client_id,current_revision_id").eq("id",id).single();if(pub.error||pub.data.current_revision_id!==revision)return {message:"Révision périmée. Rechargez la publication."};
 const bytes=new Uint8Array(await file.arrayBuffer());const mime=imageMime(bytes);if(!mime||mime!==file.type)return {message:"Le contenu du fichier ne correspond pas à un format image accepté."};
 const asset=randomUUID(),path=`${pub.data.client_id}/${id}/${asset}`;const upload=await db.storage.from(IMAGE_BUCKET).upload(path,bytes,{contentType:mime,upsert:false});if(upload.error)return {message:"Upload impossible. Vérifiez le stockage privé Publications."};
 const registered=await db.rpc("publication_register_image",{p_publication_id:id,p_revision_id:revision,p_asset_id:asset,p_path:path,p_hash:createHash("sha256").update(bytes).digest("hex"),p_mime:mime,p_provenance:provenance.trim(),p_actor_id:userId});
 if(registered.error){await db.storage.from(IMAGE_BUCKET).remove([path]);return {message:failed};}
 const signed=await db.storage.from(IMAGE_BUCKET).createSignedUrl(path,IMAGE_URL_TTL);
 return {message:"Image privée ajoutée. Associez-la à une variante en créant une nouvelle révision.",staged:{assetId:asset,previewUrl:signed.error?null:signed.data.signedUrl,mime}};
}
// Current revision after a manual save, so the new revision can be submitted to human review.
export async function currentRevision(id:string):Promise<{revision_id:string|null;status:string}|null>{
 await requireAdmin();if(!isPublicationUuid(id))return null;const {data,error}=await getSupabaseServerClient().from("publications").select("current_revision_id,status").eq("id",id).maybeSingle();
 if(error)throw new Error(failed);return data?{revision_id:data.current_revision_id,status:data.status}:null;
}
