// Intelligence éditoriale (PR #42) — justification éditoriale d'une préparation de l'Agent v2.
// Construite de façon déterministe par le serveur (aucun appel IA), enregistrée avec le run
// (publication_agent_v2_runs.editorial_justification, via publication_editorial_justification_record, immuable une fois
// posée) et affichée en lecture seule à l'administrateur dans le panneau de la publication.
// Jamais de légende WhatsApp, de nom de fichier, d'identifiant Drive ni de texte d'image (descriptions non fiables exclues).
import {introStyleOf,ctaStyleOf,servicesIn,INTRO_STYLE_LABELS,CTA_STYLE_LABELS,type IntroStyle,type CtaStyle} from './editorial-text';
import type {AgentV2GeneratorInput,AgentV2GeneratorOutput} from './agent-v2/contract';

export const JUSTIFICATION_VERSION=1;
export const MAX_JUSTIFICATION_BYTES=16000;
export type EditorialJustification={version:number;outcome:'prepared'|'refused';refusal:{reason:string;detail:string|null}|null;subject:string|null;
 services:string[];subjectReasons:string[];photo:{source:'library'|'catalog';services:string[];reason:string}|null;
 history:{date:string|null;subject:string;services:string[];platforms:string[]}[];deprioritised:{service:string;reason:string}[];servicesWithoutPhoto:string[];
 introStyles:IntroStyle[];ctaStyle:CtaStyle|null;checks:string[]};

const CHECKS=['Faits : aucune affirmation absente des données du client (prix, garantie, délai, prestation, chantier réalisé)',
 'Lieux : uniquement ceux des données du client','Photo : publiable, jamais un document, cohérente avec la prestation du sujet',
 'Historique : sujet, formulation, accroche, CTA et formulations récurrentes comparés aux dernières idées','Plateformes : un texte natif par plateforme, règles de longueur et de hashtags'];
const clip=(s:string,n:number)=>s.length>n?s.slice(0,n-1)+'…':s;

/** Justification d'une préparation acceptée (value) ou refusée (refusal), à partir du contexte déjà chargé. */
export function buildEditorialJustification(input:AgentV2GeneratorInput,result:{value:AgentV2GeneratorOutput}|{refusal:{reason:string;detail?:string|null}},now:Date):EditorialJustification{
 const plan=input.editorial?.plan,history=(input.editorial?.history??[]).slice(0,10);
 const value='value' in result?result.value:null;
 const subject=value?.idea.subject??null,services=subject?servicesIn(subject,input.services):[];
 const reasons:string[]=[];
 for(const s of services){
  if(plan?.favouredServices.includes(s))reasons.push(`« ${s} » privilégiée : pas mise en avant récemment et illustrée par une photo disponible`);
  if(plan?.seasonalPreference.includes(s))reasons.push(`« ${s} » : préférence saisonnière douce (mois ${now.getUTCMonth()+1}), jamais présentée comme un fait`);
  if((input.priorityTopics??[]).some(t=>servicesIn(t,[s]).length))reasons.push(`« ${s} » figure dans les sujets prioritaires du profil média`);
 }
 if(subject&&!services.length)reasons.push('Sujet sans prestation précise : thème général du client');
 const mediaId=value?.publications[0]?.mediaId??null,media=mediaId?input.media.find(m=>m.id===mediaId):undefined;
 const photo=media?{source:media.source??'catalog',services:media.services??[],
  reason:media.services?.some(s=>services.includes(s))?`illustre la prestation du sujet (${media.services.filter(s=>services.includes(s)).join(', ')})`:'photo publiable la plus pertinente parmi les candidates (prestation non identifiable sur la photo)'}:null;
 const texts=value?.publications.map(p=>p.text)??[],ctas=value?.publications.map(p=>p.cta).filter((c):c is string=>Boolean(c))??[];
 return {version:JUSTIFICATION_VERSION,outcome:value?'prepared':'refused',refusal:'refusal' in result?{reason:result.refusal.reason,detail:result.refusal.detail??null}:null,
  subject:subject?clip(subject,300):null,services,subjectReasons:reasons.slice(0,6),photo,
  history:history.map(h=>({date:h.date?h.date.slice(0,10):null,subject:clip(h.subject,120),services:h.services.slice(0,3),platforms:h.platforms})),
  deprioritised:plan?.deprioritised??[],servicesWithoutPhoto:plan?.servicesWithoutPhoto??[],
  introStyles:[...new Set(texts.map(introStyleOf))],ctaStyle:ctas.length?ctaStyleOf(ctas[0]):null,checks:value?CHECKS:[]};
}

// --- Lecture pour le panneau (données relues de la base : validées, bornées, jamais interprétées comme du HTML) ---
export type JustificationView={outcome:'prepared'|'refused';refusal:string|null;subject:string|null;subjectReasons:string[];photo:string|null;
 history:string[];deprioritised:string[];servicesWithoutPhoto:string[];styles:string|null;checks:string[]};
const strs=(v:unknown,max:number,len=300)=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string').slice(0,max).map(x=>clip(x,len)):[];
const str=(v:unknown,len=300)=>typeof v==='string'&&v.trim()?clip(v.trim(),len):null;
export function justificationView(raw:unknown):JustificationView|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const j=raw as Record<string,unknown>;
 if(j.version!==JUSTIFICATION_VERSION||(j.outcome!=='prepared'&&j.outcome!=='refused'))return null;
 const refusal=j.refusal as {reason?:unknown;detail?:unknown}|null,photo=j.photo as {source?:unknown;reason?:unknown}|null;
 const history=Array.isArray(j.history)?j.history.slice(0,10).flatMap(h=>{const x=h as Record<string,unknown>;const subject=str(x?.subject,120);if(!subject)return [];
  const services=strs(x.services,3,80);return [`${str(x.date,10)??'date inconnue'} · ${subject}${services.length?` (${services.join(', ')})`:''}`];}):[];
 const deprioritised=Array.isArray(j.deprioritised)?j.deprioritised.slice(0,6).flatMap(d=>{const x=d as Record<string,unknown>;const s=str(x?.service,120),r=str(x?.reason,200);return s&&r?[`${s} : ${r}`]:[];}):[];
 const intros=strs(j.introStyles,3,20).filter((s):s is IntroStyle=>s in INTRO_STYLE_LABELS).map(s=>INTRO_STYLE_LABELS[s]);
 const cta=typeof j.ctaStyle==='string'&&j.ctaStyle in CTA_STYLE_LABELS?CTA_STYLE_LABELS[j.ctaStyle as CtaStyle]:null;
 return {outcome:j.outcome,refusal:refusal?[str(refusal.reason,60),str(refusal.detail,300)].filter(Boolean).join(' : ')||null:null,subject:str(j.subject),
  subjectReasons:strs(j.subjectReasons,6),photo:photo?`${photo.source==='library'?'Photothèque':'Catalogue Drive'} — ${str(photo.reason,300)??''}`:null,
  history,deprioritised,servicesWithoutPhoto:strs(j.servicesWithoutPhoto,10,120),styles:intros.length||cta?`Accroche : ${intros.join(', ')||'—'} · CTA : ${cta??'aucun'}`:null,checks:strs(j.checks,8)};
}
