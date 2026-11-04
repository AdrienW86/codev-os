// Agent Vidéo (pur, testable) : réglages, échéance, choix des photos, contrôle du script.
import {unsupportedClaims} from '@/lib/publications/agent-v2/selection';
import {aboutService} from '@/lib/publications/editorial-text';
import {isMusicChoice} from '@/lib/motion/music';
import {MOTION_PACES,type MotionPace,type MotionPalette} from '@/lib/motion/video/storyboard';
import {readableOn} from '@/lib/visual-agent/model';

export type VideoAgentSettings={enabled:boolean;perWeek:number;pace:MotionPace;music:string};
export const DEFAULT_VIDEO_SETTINGS:VideoAgentSettings={enabled:false,perWeek:1,pace:'standard',music:'auto'};
export const VIDEO_HEADLINE_MAX=60,VIDEO_CAPTION_MAX=60,VIDEO_CLOSING_MAX=50,VIDEO_MIN_PHOTOS=2,VIDEO_MAX_PHOTOS=5;
export type VideoItem={created_at:string;service:string;headline:string};
const isPace=(v:unknown):v is MotionPace=>typeof v==='string'&&Object.hasOwn(MOTION_PACES,v);

export function videoSettingsFromRow(row:Record<string,unknown>|null):VideoAgentSettings{
 if(!row)return {...DEFAULT_VIDEO_SETTINGS};
 const per=Number(row.per_week);
 return {enabled:row.enabled===true,perWeek:Number.isInteger(per)&&per>=1&&per<=7?per:1,pace:isPace(row.pace)?row.pace:'standard',music:isMusicChoice(row.music)?String(row.music):'auto'};
}
export function parseVideoSettingsForm(form:{get(name:string):unknown}):VideoAgentSettings|{error:string}{
 const per=Number(form.get('per_week')),pace=form.get('pace'),music=form.get('music')??'auto';
 if(!Number.isInteger(per)||per<1||per>7)return {error:'Entre 1 et 7 vidéos par semaine.'};
 if(!isPace(pace))return {error:'Choisissez un rythme.'};
 if(!isMusicChoice(music))return {error:'Choisissez une musique de la liste.'};
 return {enabled:form.get('enabled')==='on',perWeek:per,pace,music:String(music)};
}
/** Au plus per_week vidéos sur 7 jours glissants, espacées d'au moins 80 % de l'intervalle régulier. */
export function videoDue(settings:Pick<VideoAgentSettings,'enabled'|'perWeek'>,items:readonly Pick<VideoItem,'created_at'>[],now:Date):boolean{
 if(!settings.enabled)return false;
 const week=now.getTime()-7*86400000,recent=items.filter(i=>Date.parse(i.created_at)>week);
 if(recent.length>=settings.perWeek)return false;
 const last=Math.max(0,...items.map(i=>Date.parse(i.created_at)).filter(Number.isFinite));
 return now.getTime()-last>=Math.floor(7*86400000/settings.perWeek*0.8);
}
export type PhotoCandidate={id:string;text:string;used:boolean;date:string};
/**
 * Prestation et photos ensemble : la prestation la moins récemment mise en vidéo parmi celles qu'au moins
 * VIDEO_MIN_PHOTOS photos illustrent ; photos jamais publiées d'abord, puis les plus récentes. null si aucune.
 */
export function chooseServiceAndPhotos(services:readonly string[],photos:readonly PhotoCandidate[],items:readonly Pick<VideoItem,'service'|'created_at'>[]):{service:string;photoIds:string[]}|null{
 const last=(s:string)=>Math.max(-1,...items.filter(i=>i.service===s).map(i=>Date.parse(i.created_at)));
 const order=[...services].sort((a,b)=>last(a)-last(b)||services.indexOf(a)-services.indexOf(b));
 for(const service of order){
  const matching=photos.filter(p=>aboutService(p.text,service)).sort((a,b)=>Number(a.used)-Number(b.used)||b.date.localeCompare(a.date));
  if(matching.length>=VIDEO_MIN_PHOTOS)return {service,photoIds:matching.slice(0,VIDEO_MAX_PHOTOS).map(p=>p.id)};
 }
 return null;
}
export type VideoScript={headline:string;captions:string[];closing:string|null};
type Check={ok:true;script:VideoScript}|{ok:false;reason:string};
const clean=(v:unknown)=>typeof v==='string'?v.replace(/\s+/g,' ').trim():'';
const norm=(s:string)=>s.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** Script contrôlé : longueurs, ni hashtag ni lien, aucune affirmation absente des faits, accroche jamais réutilisée. */
export function checkVideoScript(value:unknown,facts:string,used:readonly string[],captionCount:number):Check{
 const v=value as {headline?:unknown;captions?:unknown;closing?:unknown}|null;
 const headline=clean(v?.headline),closing=clean(v?.closing);
 const captions=(Array.isArray(v?.captions)?v.captions:[]).map(clean).filter(Boolean).slice(0,captionCount);
 if(headline.length<2||headline.length>VIDEO_HEADLINE_MAX)return {ok:false,reason:`accroche de 2 à ${VIDEO_HEADLINE_MAX} caractères`};
 if(captions.some(c=>c.length>VIDEO_CAPTION_MAX))return {ok:false,reason:`légendes de ${VIDEO_CAPTION_MAX} caractères au plus`};
 if(closing.length>VIDEO_CLOSING_MAX)return {ok:false,reason:`phrase de fin de ${VIDEO_CLOSING_MAX} caractères au plus`};
 const all=[headline,...captions,closing];
 if(all.some(t=>/[#@]|https?:|www\./i.test(t)))return {ok:false,reason:'ni hashtag, ni lien, ni mention'};
 const claims=[...new Set(all.flatMap(t=>unsupportedClaims(t,facts)).map(c=>c.split(':').slice(1).join(':').trim()))];
 if(claims.length)return {ok:false,reason:`affirmation non confirmée : ${claims.join(', ')}`};
 if(used.some(u=>norm(u)===norm(headline)))return {ok:false,reason:'accroche déjà employée'};
 return {ok:true,script:{headline,captions,closing:closing||null}};
}
/** Script de secours, sans IA : la prestation en accroche, la zone en phrase de fin. */
export function fallbackVideoScript(service:string,zone:string|null):VideoScript{
 return {headline:service.slice(0,VIDEO_HEADLINE_MAX),captions:[],closing:zone?`À votre service — ${zone}`.slice(0,VIDEO_CLOSING_MAX):null};
}
/** Palette vidéo tirée de la charte : le fond doit porter un texte blanc ; sinon, palette par défaut (null). */
export function videoPaletteFromBrand(brand:{primary:string;secondary:string}|null):MotionPalette|null{
 if(!brand)return null;
 const dark=(c:string)=>readableOn(c)==='#ffffff';
 const deep=dark(brand.primary)?brand.primary:dark(brand.secondary)?brand.secondary:null;
 if(!deep)return null;
 return {deep,accent:deep===brand.primary?brand.secondary:brand.primary,ink:'#FFFFFF'};
}
