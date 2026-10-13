// Intelligence éditoriale (PR #42) — plan éditorial déterministe calculé côté serveur avant l'appel au modèle.
// Rotation des prestations (photos publiables à l'appui), saisonnalité prudente, rotation des accroches et des CTA,
// formulations à éviter et lieux autorisés. Aucun appel IA supplémentaire : le plan est compact et plafonné.
import {CTA_STYLES,INTRO_STYLES,aboutService,nextInPool,type CtaStyle,type IntroStyle} from './editorial-text';
import {mainCtaStyle,mainIntroStyle,recurringPhrases,type EditorialHistoryItem} from './editorial-memory';
import {photoServices} from './editorial-photos';
import {allowedPlaces} from './editorial-places';
import type {AgentMediaCandidate} from './agent-v2/contract';

/**
 * Saisonnalité : aucune donnée saisonnière explicite n'existe dans la fiche client ni dans le profil média (vérifié :
 * client_media_profiles et publication_client_settings n'ont pas de champ saisonnier). Une table statique et prudente
 * mois → prestations sert donc UNIQUEMENT de préférence douce (départage entre prestations déjà permises et illustrées),
 * jamais de fait : elle n'est appliquée qu'aux prestations vérifiées du client, et le prompt interdit d'affirmer une
 * saison, une météo ou une urgence qui n'est pas dans les faits.
 */
export const SEASONAL_SERVICE_HINTS:Record<number,readonly string[]>={
 1:['isolation','ramonage','deratisation'],2:['isolation','deratisation','charpente'],3:['demoussage','hydrofuge','ravalement'],4:['demoussage','hydrofuge','desinsectisation'],
 5:['desinsectisation','ravalement','hydrofuge'],6:['desinsectisation','ravalement','etancheite'],7:['desinsectisation','etancheite','ravalement'],8:['desinsectisation','etancheite','ravalement'],
 9:['zinguerie','demoussage','ramonage'],10:['zinguerie','ramonage','deratisation','demoussage'],11:['zinguerie','isolation','ramonage','deratisation'],12:['isolation','ramonage','deratisation']};
export function seasonalPreference(services:readonly string[],month:number):string[]{
 const hints=SEASONAL_SERVICE_HINTS[month]??[];
 return services.filter(s=>hints.some(h=>aboutService(h,s))).slice(0,3);
}

export type DeprioritisedService={service:string;reason:string};
export type EditorialPlan={favouredServices:string[];deprioritised:DeprioritisedService[];servicesWithoutPhoto:string[];seasonalPreference:string[];
 introStyle:IntroStyle;avoidIntroStyle:IntroStyle|null;ctaStyle:CtaStyle;avoidOpenings:string[];avoidCtas:string[];recurringPhrases:string[];allowedPlaces:string[];historyConsidered:number};
export type EditorialContext={history:EditorialHistoryItem[];plan:EditorialPlan};
const RECENT_WINDOW=6;
const day=(iso:string|null)=>iso?iso.slice(0,10):null;

export function buildEditorialPlan(input:{history:readonly EditorialHistoryItem[];services:readonly string[];media:readonly AgentMediaCandidate[];priorityTopics?:readonly string[];zone:string|null;now:Date}):EditorialPlan{
 const {history,services}=input,recent=history.slice(0,RECENT_WINDOW);
 const lastIndex=(s:string)=>recent.findIndex(h=>h.services.includes(s));
 const deprioritised:DeprioritisedService[]=[];
 for(const s of services){
  const last=lastIndex(s),inLast4=recent.slice(0,4).filter(h=>h.services.includes(s)).length;
  if(last===0)deprioritised.push({service:s,reason:`mise en avant par la dernière publication${recent[0].date?` (${day(recent[0].date)})`:''}`});
  else if(inLast4>=2)deprioritised.push({service:s,reason:`mise en avant ${inLast4} fois dans les 4 dernières publications`});
 }
 const available=input.media.filter(m=>!m.used);
 const illustrated=services.filter(s=>available.some(m=>photoServices(m,services).includes(s)));
 const seasonal=seasonalPreference(services,input.now.getUTCMonth()+1);
 const priority=(s:string)=>(input.priorityTopics??[]).some(t=>aboutService(t,s));
 const rank=(s:string)=>{const i=lastIndex(s);return i<0?RECENT_WINDOW:i;};
 const favoured=illustrated.filter(s=>!deprioritised.some(d=>d.service===s))
  .sort((a,b)=>rank(b)-rank(a)||Number(seasonal.includes(b))-Number(seasonal.includes(a))||Number(priority(b))-Number(priority(a))||services.indexOf(a)-services.indexOf(b)).slice(0,5);
 const intros=recent.map(mainIntroStyle).filter((s):s is IntroStyle=>s!==null),ctas=recent.map(mainCtaStyle).filter((s):s is CtaStyle=>s!==null&&s!=='aucun'&&s!=='autre');
 const sameIntro=intros.length>=3&&intros.slice(0,3).every(s=>s===intros[0])?intros[0]:null;
 return {favouredServices:favoured,deprioritised:deprioritised.slice(0,6),servicesWithoutPhoto:services.filter(s=>!illustrated.includes(s)).slice(0,10),seasonalPreference:seasonal,
  introStyle:nextInPool(INTRO_STYLES,intros),avoidIntroStyle:sameIntro,ctaStyle:nextInPool(CTA_STYLES,ctas),
  avoidOpenings:[...new Set(history.slice(0,12).flatMap(h=>h.openings))].filter(o=>o.split(' ').length>=3).slice(0,12),
  avoidCtas:[...new Set(history.slice(0,10).flatMap(h=>h.ctas))].slice(0,5),recurringPhrases:recurringPhrases(history),allowedPlaces:allowedPlaces(input.zone),historyConsidered:history.length};
}

// Version compacte envoyée au modèle (coût borné) : 10 idées au plus, sans texte complet ni identifiant de photo.
export const PROMPT_HISTORY_ITEMS=10;
export function compactEditorial(ctx:EditorialContext){
 const clip=(s:string,n:number)=>s.length>n?s.slice(0,n-1)+'…':s;
 return {editorial_history:ctx.history.slice(0,PROMPT_HISTORY_ITEMS).map(h=>({date:day(h.date),subject:clip(h.subject,120),services:h.services.slice(0,3),platforms:h.platforms,
   intro_style:mainIntroStyle(h),cta_style:mainCtaStyle(h),photo_count:h.photos.length})),
  editorial_plan:{favoured_services:ctx.plan.favouredServices,deprioritised_services:ctx.plan.deprioritised,seasonal_preference_soft:ctx.plan.seasonalPreference,
   intro_style:ctx.plan.introStyle,avoid_intro_style:ctx.plan.avoidIntroStyle,cta_style:ctx.plan.ctaStyle,avoid_openings:ctx.plan.avoidOpenings.map(o=>clip(o,80)),
   avoid_ctas:ctx.plan.avoidCtas.map(c=>clip(c,120)),phrases_to_avoid:ctx.plan.recurringPhrases},
  allowed_places:ctx.plan.allowedPlaces};
}
