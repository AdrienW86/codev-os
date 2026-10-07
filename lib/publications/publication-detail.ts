// Neutral detail model of one publication, whatever its status. Built from getWorkspace plus targeted reads;
// shared by the drawer and the review cards (ReviewCardData is a projection of the same variant/history logic).
import {platformLabels} from './editor';
import {boardStatus,type BoardStatus,type BoardOrigin} from './board-query';
import {hiddenPublications} from './board-visibility-events';
import type {PublicationPlatform,PublicationRevision} from './types';
import type {Workspace} from './workspace';

export type MediaState='ok'|'unavailable'|'missing';
export type DetailVariant={platform:PublicationPlatform;label:string;text:string;title:string|null;cta:string|null;assetIds:string[];media:{state:MediaState;preview:string|null}};
export type DetailVersion={number:number;origin:string;date:string;decision:string|null;reason:string|null;current:boolean};
export type PublicationDetailData={
 publicationId:string;revisionId:string|null;clientId:string;clientName:string;projectId:string|null;projectName:string|null;
 subject:string;date:string;dateIsWeek:boolean;targetDate:string;dateEditable:boolean;status:BoardStatus;origin:BoardOrigin;edited:boolean;hidden:boolean;
 platforms:PublicationPlatform[];variants:DetailVariant[];media:{state:MediaState;preview:string|null};missingMedia:PublicationPlatform[];
 rejection:string|null;versions:DetailVersion[];editorial:{angle:string;source:string};
 readOnly:boolean;readOnlyReason:string|null;debug:Record<string,unknown>|null};
export type DetailPublication={id:string;client_id:string;project_id:string|null;status:string;current_revision_id:string|null;subject:string;target_date:string|null;editorial_week:string;creation_origin:string;updated_at:string};
export type DetailDelivery={variant_id:string;platform:string;status:string};

export const originLabels:Record<PublicationRevision['origin'],string>={generated:'IA',regenerated:'Régénération IA',manual:'Modification manuelle'};
const decisionLabels:Record<string,string>={approved:'Validée',rejected:'Rejetée'};
const platformOrder=Object.keys(platformLabels) as PublicationPlatform[];
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value:null;
// Fail closed: a delivery targets one precise variant, so editing would leave it able to send an old version.
// Until an atomic edit → cancel → recreate workflow exists, a publication is editable only without any delivery
// or when every delivery is cancelled. Any other state, unknown ones included, makes the drawer read-only.
export const EDITABLE_DELIVERY_STATES:ReadonlySet<string>=new Set(['cancelled']);
export function deliveryLockMessage(deliveries:{status:string}[]):string|null{
 const states=new Set(deliveries.map(d=>d.status).filter(s=>!EDITABLE_DELIVERY_STATES.has(s)));
 if(!states.size)return null;
 if(states.has('published'))return 'Publication déjà publiée : lecture seule.';
 if(states.has('processing')||states.has('uncertain'))return 'Un envoi est en cours ou incertain : lecture seule par sécurité.';
 if(states.has('retryable_error'))return 'Une tentative de publication est en attente de reprise : lecture seule.';
 if(states.has('scheduled'))return 'Cette publication possède déjà un envoi planifié : lecture seule.';
 return 'Une diffusion existe déjà pour cette publication : lecture seule.';
}

// Variants of one revision with their linked media; an existing asset without a preview is "unavailable", not missing.
export function currentVariants(w:Pick<Workspace,'variants'|'links'|'assets'>,revisionId:string|null):DetailVariant[]{
 if(!revisionId)return [];
 return w.variants.filter(v=>v.revision_id===revisionId).sort((a,b)=>platformOrder.indexOf(a.platform)-platformOrder.indexOf(b.platform)).map(v=>{
  const m=(v.metadata??{}) as Record<string,unknown>,assetIds=w.links.filter(l=>l.variant_id===v.id).sort((a,b)=>a.sort_order-b.sort_order).map(l=>l.asset_id);
  const preview=assetIds.map(id=>w.assets.find(a=>a.id===id)?.preview).find((url):url is string=>Boolean(url))??null;
  return {platform:v.platform,label:platformLabels[v.platform],text:v.text_content,title:text(m.title),cta:text(m.cta),assetIds,media:{state:!assetIds.length?'missing':preview?'ok':'unavailable',preview}};});
}
export function decisionFor(w:Pick<Workspace,'reviews'>,revisionId:string){return w.reviews.find(r=>r.revision_id===revisionId)??null;}
export function versionHistory(w:Pick<Workspace,'revisions'|'reviews'>,revisionId:string|null):DetailVersion[]{
 return w.revisions.map(r=>{const d=decisionFor(w,r.id);return {number:r.revision_number,origin:originLabels[r.origin]??'Version',date:r.created_at,decision:d?decisionLabels[d.decision]??null:null,reason:d?.reason??null,current:r.id===revisionId};}).sort((a,b)=>b.number-a.number);
}
export function primaryMedia(variants:DetailVariant[]):{state:MediaState;preview:string|null}{
 const ok=variants.find(v=>v.media.state==='ok');if(ok)return ok.media;
 return {state:variants.some(v=>v.media.state==='unavailable')?'unavailable':'missing',preview:null};
}

export function buildPublicationDetail(input:{publication:DetailPublication;clientName:string;projectName:string|null;workspace:Workspace;
 slot:{platforms:string[]}|null;deliveries:DetailDelivery[];debug:Record<string,unknown>|null}):PublicationDetailData{
 const {publication:p,workspace:w}=input,revisionId=p.current_revision_id,revision=w.revisions.find(r=>r.id===revisionId)??null;
 const variants=currentVariants(w,revisionId),variantIds=new Set(w.variants.filter(v=>v.revision_id===revisionId).map(v=>v.id));
 const platforms=variants.length?variants.map(v=>v.platform):(input.slot?.platforms??[]).filter((x):x is PublicationPlatform=>x in platformLabels);
 const published=new Set(input.deliveries.filter(d=>variantIds.has(d.variant_id)&&d.status==='published').map(d=>d.platform));
 const status=boardStatus(p,variants.map(v=>v.platform),published);
 const origin:BoardOrigin=!revision?'planning':w.revisions.some(r=>r.origin!=='manual')?'agent':'manual';
 const lock=deliveryLockMessage(input.deliveries);
 const readOnly=status==='published'||lock!==null;
 const rejection=p.status==='rejected'&&revisionId?decisionFor(w,revisionId)?.reason??null:null;
 return {publicationId:p.id,revisionId,clientId:p.client_id,clientName:input.clientName,projectId:p.project_id,projectName:input.projectName,
  subject:p.subject,date:p.target_date??p.editorial_week,dateIsWeek:!p.target_date,targetDate:p.target_date??'',dateEditable:!input.slot&&!readOnly,
  status,origin,edited:origin==='agent'&&revision?.origin==='manual',hidden:hiddenPublications(w.events).has(p.id),
  platforms,variants,media:primaryMedia(variants),missingMedia:variants.filter(v=>v.media.state==='missing').map(v=>v.platform),
  rejection,versions:versionHistory(w,revisionId),editorial:{angle:revision?.angle??p.subject,source:revision?.source_content??variants[0]?.text??p.subject},
  readOnly,readOnlyReason:status==='published'?'Publication déjà publiée : lecture seule.':lock,debug:input.debug};
}
