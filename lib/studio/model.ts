// Studio vidéo : contrat pur du formulaire de création (aucun accès réseau ni base). Utilisable côté client et serveur.
import {MOTION_MAX_PHOTOS,MOTION_PACES,type MotionPace,type MotionScript} from '@/lib/motion/video/storyboard';

export const STUDIO_BUCKET='studio-videos';
export const STUDIO_MAX_UPLOAD_BYTES=8*1024*1024;
export const STUDIO_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type StudioDraft={clientId:string;title:string;script:MotionScript;libraryAssetIds:string[]};
export type StudioVideo={id:string;clientId:string;title:string;script:MotionScript;durationSeconds:number;sizeBytes:number;createdAt:string;url:string|null;lastPublicationId:string|null};
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max?v.replace(/\r/g,'').trim():null;
const isPace=(v:unknown):v is MotionPace=>typeof v==='string'&&Object.hasOwn(MOTION_PACES,v);

/** Champs texte du formulaire → brouillon validé, ou message d'erreur lisible. Les fichiers sont vérifiés à part. */
export function parseStudioForm(form:{get(name:string):unknown;getAll(name:string):unknown[]},uploadCount:number):{ok:true;draft:StudioDraft}|{ok:false;message:string}{
 const clientId=form.get('client_id'),title=text(form.get('title'),160),headline=text(form.get('headline'),160),captions=text(form.get('captions'),2000),
  closing=text(form.get('closing'),160),brand=text(form.get('brand'),60),pace=form.get('pace');
 if(typeof clientId!=='string'||!STUDIO_UUID.test(clientId))return {ok:false,message:'Choisissez un client.'};
 if(!title)return {ok:false,message:'Donnez un titre à la vidéo (160 caractères au plus).'};
 if(!headline||headline.length<2)return {ok:false,message:'L’accroche est obligatoire (160 caractères au plus).'};
 if(captions===null||closing===null||brand===null)return {ok:false,message:'Textes trop longs : raccourcissez les légendes ou la phrase de fin.'};
 if(!isPace(pace))return {ok:false,message:'Choisissez un rythme.'};
 const ids=form.getAll('library_asset').filter((v):v is string=>typeof v==='string');
 if(ids.some(id=>!STUDIO_UUID.test(id))||new Set(ids).size!==ids.length)return {ok:false,message:'Sélection de photos invalide.'};
 const total=ids.length+uploadCount;
 if(total<1)return {ok:false,message:'Choisissez au moins une photo.'};
 if(total>MOTION_MAX_PHOTOS)return {ok:false,message:`${MOTION_MAX_PHOTOS} photos au plus par vidéo.`};
 const lines=captions.split('\n').map(l=>l.trim()).filter(Boolean);
 if(lines.length>MOTION_MAX_PHOTOS||lines.some(l=>l.length>120))return {ok:false,message:'Une légende par ligne, 120 caractères au plus chacune.'};
 return {ok:true,draft:{clientId,title,libraryAssetIds:ids,script:{headline,captions:lines,closing:closing||null,brand,pace}}};
}
/** Texte proposé pour une publication TikTok de la vidéo : les textes de la vidéo, modifiables avant création. */
export function suggestedCaption(script:MotionScript):string{
 return [script.headline,...script.captions,script.closing??''].map(s=>s.trim()).filter(Boolean).join('\n').slice(0,2200);
}
