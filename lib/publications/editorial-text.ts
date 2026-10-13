// Intelligence éditoriale (PR #42) — outils de texte purs partagés par la sélection, l'historique et les gardes.
// Comparaisons indépendantes de la casse, des accents, de la ponctuation et des hashtags. Aucune dépendance serveur.

export const normalizeText=(text:string)=>text.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/#[\p{L}\p{N}_]+/gu,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const words=(text:string)=>normalizeText(text).split(' ').filter(Boolean);
const bigrams=(text:string)=>{const w=words(text);const set=new Set<string>();for(let i=0;i<w.length-1;i++)set.add(w[i]+' '+w[i+1]);return set;};
// Similarité de Jaccard sur les paires de mots (formulation), indépendante des accents, de la ponctuation et des hashtags.
export function textSimilarity(a:string,b:string):number{
 const x=bigrams(a),y=bigrams(b);if(!x.size||!y.size)return 0;let common=0;for(const g of x)if(y.has(g))common++;
 return common/(x.size+y.size-common);
}
// Accroche : les n premiers mots normalisés (6 par défaut, règle historique des lots 4-5).
export const openingOf=(text:string,n=6)=>words(text).slice(0,n).join(' ');
// Suites de n mots (formulations récurrentes).
export function shingles(text:string,n=4):Set<string>{const w=words(text),set=new Set<string>();for(let i=0;i+n<=w.length;i++)set.add(w.slice(i,i+n).join(' '));return set;}

// --- Prestations : mots qui désignent une prestation du client (« Réparation de faîtage » → faitage) ---
const GENERIC_WORDS=new Set(['reparation','reparations','entretien','renovation','installation','nettoyage','traitement','pose','remplacement','toiture','toitures','travaux','service','services']);
// Vocabulaire visible associé à une prestation reconnue (descriptions de photos, sujets). Mots entiers, pluriel toléré.
// Liste fermée et prudente : elle sert à rapprocher une photo et un sujet, jamais à affirmer une prestation.
export const SERVICE_SYNONYMS:Record<string,string[]>={
 demoussage:['mousse','mousses','lichen','lichens'],faitage:['faitiere','faitieres','faitage'],zinguerie:['gouttiere','gouttieres','cheneau','cheneaux','zinc','descente'],
 charpente:['poutre','poutres','chevron','chevrons'],isolation:['isolant','isolants','combles'],ravalement:['enduit','enduits'],etancheite:['membrane','terrasse'],
 ramonage:['cheminee','cheminees','conduit'],desinsectisation:['insecte','insectes','cafard','cafards','blatte','blattes','punaise','punaises','guepe','guepes','frelon','frelons','fourmi','fourmis'],
 deratisation:['rat','rats','souris','rongeur','rongeurs'],elagage:['arbre','arbres','branche','branches'],carrelage:['carreau','carreaux'],menuiserie:['fenetre','fenetres','volet','volets']};
export function serviceKeywords(service:string):{prefixes:string[];exact:string[]}{
 const prefixes=normalizeText(service).split(' ').filter(w=>w.length>=4&&!GENERIC_WORDS.has(w));
 const exact=prefixes.flatMap(w=>Object.entries(SERVICE_SYNONYMS).filter(([k])=>w.startsWith(k)||k.startsWith(w)).flatMap(([,v])=>v));
 return {prefixes,exact};
}
// Le texte parle-t-il de cette prestation ? Mots propres à la prestation (préfixe) ou vocabulaire associé (mot entier).
export function aboutService(text:string,service:string):boolean{
 const {prefixes,exact}=serviceKeywords(service),t=' '+normalizeText(text)+' ';
 return prefixes.length>0&&(prefixes.some(w=>t.includes(' '+w))||exact.some(w=>t.includes(' '+w+' ')));
}
export const servicesIn=(text:string,services:readonly string[])=>services.filter(s=>aboutService(text,s));

// --- Styles d'accroche et d'appel à l'action (rotation) ---
export const INTRO_STYLES=['question','conseil','presentation','exclamation','constat'] as const;
export type IntroStyle=typeof INTRO_STYLES[number];
export const INTRO_STYLE_LABELS:Record<IntroStyle,string>={question:'Question',conseil:'Conseil',presentation:'Présentation d’une réalisation ou d’un savoir-faire',exclamation:'Exclamation',constat:'Constat'};
const IMPERATIVE=/^(pensez|decouvrez|anticipez|protegez|faites|verifiez|prenez|confiez|n attendez|evitez|gardez|preparez|surveillez|entretenez|misez|choisissez|optez)\b/;
const PRESENTATION=/^(voici|zoom|focus|retour sur|gros plan|en images|coup d oeil|place a|aujourd hui)\b/;
// Style de la première phrase : question, conseil (impératif), présentation, exclamation, sinon constat.
export function introStyleOf(text:string):IntroStyle{
 const first=(text.trim().match(/^[^\n.!?…]*[.!?…]?/)?.[0]??'').trim(),plain=normalizeText(first);
 if(first.endsWith('?')||/^(le saviez vous|saviez vous)\b/.test(plain))return 'question';
 if(IMPERATIVE.test(plain))return 'conseil';
 if(PRESENTATION.test(plain))return 'presentation';
 if(first.endsWith('!'))return 'exclamation';
 return 'constat';
}
export const CTA_STYLES=['contact','message','conseil','question','appel'] as const;
export type CtaStyle=typeof CTA_STYLES[number]|'aucun'|'autre';
export const CTA_STYLE_LABELS:Record<CtaStyle,string>={contact:'Invitation au contact',message:'Message privé',conseil:'Demande de conseil',question:'Question à poser',appel:'Appel téléphonique',aucun:'Aucun',autre:'Autre'};
export function ctaStyleOf(cta:string|null|undefined):CtaStyle{
 if(!cta||!cta.trim())return 'aucun';const t=' '+normalizeText(cta)+' ';
 if(/ (appelez|appeler|telephone|telephonez|appel) /.test(t))return 'appel';
 if(/ (message|messagerie|ecrivez|mp|messenger) /.test(t))return 'message';
 if(/ (conseil|conseils|conseiller) /.test(t))return 'conseil';
 if(/ (question|questions) /.test(t))return 'question';
 if(/ (contact|contactez|contacter|joindre|parlons|echangeons) /.test(t))return 'contact';
 return 'autre';
}
// Prochain style d'un pool : le moins récemment utilisé (jamais utilisé d'abord), ordre du pool à égalité.
export function nextInPool<T extends string>(pool:readonly T[],recent:readonly string[]):T{
 const rank=(s:T)=>{const i=recent.indexOf(s);return i<0?Infinity:i;};
 return [...pool].sort((a,b)=>rank(b)-rank(a)||pool.indexOf(a)-pool.indexOf(b))[0];
}
