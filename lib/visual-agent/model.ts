// Agent Visuels — logique pure (sans I/O) : réglages, échéance, rotation des prestations et des modèles, contrôle
// des accroches, couleurs. Les visuels sont des mises en page à la charte du client ; le texte est court et vérifié.
import {unsupportedClaims} from '@/lib/publications/agent-v2/selection';

export const VISUAL_TEMPLATES=['bandeau','diagonale','encadre','minimal'] as const;
export type VisualTemplate=typeof VISUAL_TEMPLATES[number];
export const VISUAL_WIDTH=1080,VISUAL_HEIGHT=1350;
export const HEADLINE_MAX=60,SUBLINE_MAX=110;
export type VisualAgentSettings={enabled:boolean;perWeek:number;primaryColor:string;secondaryColor:string;textColor:string;contactLine:string|null;logoPath:string|null;lastGeneratedAt:string|null};
export const DEFAULT_VISUAL_SETTINGS:VisualAgentSettings={enabled:false,perWeek:3,primaryColor:'#1f2937',secondaryColor:'#f59e0b',textColor:'#ffffff',contactLine:null,logoPath:null,lastGeneratedAt:null};
export type VisualItem={service:string;headline:string;template:VisualTemplate|string;created_at:string};

const HEX=/^#[0-9a-fA-F]{6}$/;
export function settingsFromRow(row:Record<string,unknown>|null|undefined):VisualAgentSettings{
 if(!row)return {...DEFAULT_VISUAL_SETTINGS};
 const s=(v:unknown,d:string)=>typeof v==='string'&&HEX.test(v)?v:d;
 return {enabled:row.enabled===true,perWeek:Number.isInteger(row.per_week)?Number(row.per_week):3,primaryColor:s(row.primary_color,DEFAULT_VISUAL_SETTINGS.primaryColor),
  secondaryColor:s(row.secondary_color,DEFAULT_VISUAL_SETTINGS.secondaryColor),textColor:s(row.text_color,DEFAULT_VISUAL_SETTINGS.textColor),
  contactLine:typeof row.contact_line==='string'&&row.contact_line.trim()?row.contact_line.trim():null,logoPath:typeof row.logo_path==='string'?row.logo_path:null,
  lastGeneratedAt:typeof row.last_generated_at==='string'?row.last_generated_at:null};
}
export type SettingsInput={enabled:boolean;perWeek:number;primaryColor:string;secondaryColor:string;textColor:string;contactLine:string|null};
/** Formulaire de réglage : couleurs hexadécimales, 1 à 14 visuels par semaine, ligne de contact courte et sans retour ligne. */
export function parseSettingsForm(form:FormData):SettingsInput|{error:string}{
 const get=(k:string)=>{const v=form.get(k);return typeof v==='string'?v.trim():'';};
 const perWeek=Number(get('per_week')),colors=[get('primary_color'),get('secondary_color'),get('text_color')];
 if(!Number.isInteger(perWeek)||perWeek<1||perWeek>14)return {error:'Fréquence : de 1 à 14 visuels par semaine.'};
 if(colors.some(c=>!HEX.test(c)))return {error:'Couleurs au format #RRVVBB.'};
 const contact=get('contact_line');
 if(contact&&(contact.length<2||contact.length>80||/[\x00-\x1f]/.test(contact)))return {error:'Ligne de contact : 2 à 80 caractères, sur une ligne.'};
 return {enabled:form.get('enabled')==='on',perWeek,primaryColor:colors[0],secondaryColor:colors[1],textColor:colors[2],contactLine:contact||null};
}

/** Un visuel est dû si moins de « perWeek » visuels ont été générés sur 7 jours et que l'écart minimal est respecté. */
export function isDue(settings:Pick<VisualAgentSettings,'enabled'|'perWeek'>,items:readonly Pick<VisualItem,'created_at'>[],now:Date):boolean{
 if(!settings.enabled)return false;
 const week=now.getTime()-7*86400000,recent=items.filter(i=>Date.parse(i.created_at)>week);
 if(recent.length>=settings.perWeek)return false;
 const last=Math.max(0,...items.map(i=>Date.parse(i.created_at)).filter(Number.isFinite));
 return now.getTime()-last>=Math.floor(7*86400000/settings.perWeek*0.8);
}
/** Prestation la moins récemment illustrée (à égalité : ordre de la liste). */
export function nextService(services:readonly string[],items:readonly Pick<VisualItem,'service'|'created_at'>[]):string|null{
 if(!services.length)return null;
 const last=(s:string)=>Math.max(-1,...items.filter(i=>i.service===s).map(i=>Date.parse(i.created_at)));
 return [...services].sort((a,b)=>last(a)-last(b)||services.indexOf(a)-services.indexOf(b))[0];
}
/** Modèle différent du dernier visuel, en rotation. */
export function nextTemplate(items:readonly Pick<VisualItem,'template'|'created_at'>[]):VisualTemplate{
 const latest=[...items].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
 const i=latest?VISUAL_TEMPLATES.indexOf(latest.template as VisualTemplate):-1;
 return VISUAL_TEMPLATES[(i+1)%VISUAL_TEMPLATES.length];
}
const norm=(t:string)=>t.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export type CopyCheck={ok:true;headline:string;subline:string|null}|{ok:false;reason:string};
/** Accroche : courte, sans affirmation absente des faits du client (prix, délai, garantie…), jamais déjà employée. */
export function checkCopy(value:unknown,facts:string,used:readonly string[]):CopyCheck{
 const v=value as {headline?:unknown;subline?:unknown}|null;
 const headline=typeof v?.headline==='string'?v.headline.replace(/\s+/g,' ').trim():'',subline=typeof v?.subline==='string'?v.subline.replace(/\s+/g,' ').trim():'';
 if(headline.length<2||headline.length>HEADLINE_MAX)return {ok:false,reason:`accroche de 2 à ${HEADLINE_MAX} caractères`};
 if(subline.length>SUBLINE_MAX)return {ok:false,reason:`sous-titre de ${SUBLINE_MAX} caractères au plus`};
 if(/[#@]|https?:|www\./i.test(headline+subline))return {ok:false,reason:'ni hashtag, ni lien, ni mention'};
 const claims=[...unsupportedClaims(headline,facts),...unsupportedClaims(subline,facts)];
 if(claims.length)return {ok:false,reason:`affirmation non confirmée : ${claims.map(c=>c.split(':').slice(1).join(':')).join(', ')}`};
 if(used.some(u=>norm(u)===norm(headline)))return {ok:false,reason:'accroche déjà employée'};
 return {ok:true,headline,subline:subline||null};
}
/** Accroche de secours, sans IA : la prestation elle-même, et la zone en sous-titre. */
export function fallbackCopy(service:string,zone:string|null):{headline:string;subline:string|null}{
 return {headline:service.slice(0,HEADLINE_MAX),subline:zone?`À votre service — ${zone}`.slice(0,SUBLINE_MAX):null};
}
const lum=(hex:string)=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.03928?c/12.92:((c+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;};
/** Couleur de texte lisible sur un fond donné (blanc ou quasi noir). */
export const readableOn=(background:string)=>lum(background)>.4?'#111827':'#ffffff';
