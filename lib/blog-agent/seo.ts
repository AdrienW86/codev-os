// Agent Blog — expertise SEO (pur, testable) : requête cible tirée des recherches Search Console réelles du client et
// note SEO sur 100 de chaque article (titre, meta description, mot-clé dans l'introduction et un intertitre, FAQ,
// lisibilité mobile, sur-optimisation, zone). La note ne bloque jamais un article : elle guide un nouvel essai de
// rédaction et la relecture. Aucune donnée n'est inventée : sans requête lue, la prestation reste l'expression principale.
import {aboutService,normalizeText} from '@/lib/publications/editorial-text';

export type SeoIssue={code:string;level:'warning'|'info';message:string};
export type SeoAudit={score:number;words:number;keyword:string;issues:SeoIssue[]};
export type OrganicQueryRow={query:string;clicks:number;impressions:number;position:number|null};
export type TargetQuery={query:string;impressions:number;position:number|null};

export const SEO_TITLE_MAX=65,SEO_TITLE_MIN=30,SEO_META_MIN=120,SEO_META_MAX=158,SEO_GOOD_SCORE=80;
const STOP=new Set(['de','des','du','la','le','les','un','une','et','en','a','au','aux','pour','sur','par','dans','son','sa','ses','mon','ma','mes','votre','vos','l','d','qu','que','quoi','comment','pourquoi','quand','est','ce','ou']);
/** Recherches à ne jamais viser : elles pousseraient l'article vers une promesse (prix, gratuité, urgence, avis) ou hors sujet. */
const RISKY=/\b(avis|prix|tarifs?|couts?|pas cher|gratuit\w*|devis|urgen\w*|24 ?h|nuit|dimanche|numero|telephone|tel|contact|adresse|horaires?|emploi|recrutement|salaire|formation|stage|pdf|youtube|leroy|castorama|bricomarche|norme|reglementation|aide|subvention|credit)\b/;

const tokens=(text:string)=>normalizeText(text).split(' ').filter(w=>w.length>=3&&!STOP.has(w));
/** Le texte reprend-il l'expression ? Chaque mot significatif présent (pluriel et variantes tolérés par préfixe). */
export function mentions(text:string,keyword:string):boolean{
 const words=normalizeText(text).split(' '),need=tokens(keyword);
 return need.length>0&&need.every(k=>{const root=k.length>5?k.slice(0,k.length-1):k;return words.some(w=>w.startsWith(root));});
}
const occurrences=(text:string,keyword:string)=>{
 const need=tokens(keyword).sort((a,b)=>b.length-a.length)[0];if(!need)return 0;
 const root=need.length>5?need.slice(0,need.length-1):need;return normalizeText(text).split(' ').filter(w=>w.startsWith(root)).length;
};

/**
 * Requête cible : une recherche réellement tapée par des internautes (dernier instantané Search Console), sur la
 * prestation de l'article, ni marque du client (tous les mots de son nom), ni intention risquée, pas déjà couverte par un article publié ;
 * la plus vue (au moins 10 impressions). null si rien ne convient : l'article vise alors la prestation.
 */
export function pickTargetQuery(queries:readonly OrganicQueryRow[]|null,options:{service:string;clientName:string;usedTitles:readonly string[]}):TargetQuery|null{
 if(!queries?.length)return null;
 const brand=tokens(options.clientName).filter(w=>w.length>=4);
 const candidates=queries.filter(q=>{
  const text=normalizeText(q.query),words=text.split(' ');
  if(q.impressions<10||q.query.length>80||words.length<2||words.length>8)return false;
  if(RISKY.test(text)||(brand.length>0&&brand.every(b=>words.some(w=>w.startsWith(b)))))return false;
  if(!aboutService(q.query,options.service))return false;
  return !options.usedTitles.some(t=>mentions(t,q.query));
 });
 const best=[...candidates].sort((a,b)=>b.impressions-a.impressions||(a.position??99)-(b.position??99)||a.query.localeCompare(b.query))[0];
 return best?{query:best.query.trim().replace(/\s+/g,' '),impressions:best.impressions,position:best.position}:null;
}

type Article={title:string;metaDescription:string;bodyMarkdown:string};
const PENALTY:Record<string,number>={title_keyword:15,intro_keyword:10,faq:10,stuffing:10,title_long:8,h2_keyword:6,meta_keyword:5,meta_short:5,meta_long:5,
 title_short:5,long_paragraph:5,long_sentences:5,no_list:4,questions:4,thin:5,zone_missing:4,zone_repeated:4};

/** Note SEO sur 100 d'un article et remarques actionnables (pénalités fixes, déterministes). */
export function auditBlogArticle(article:Article,options:{keyword:string;zone?:string|null}):SeoAudit{
 const issues:SeoIssue[]=[],add=(code:string,message:string,level:'warning'|'info'='warning')=>issues.push({code,level,message});
 const {title,metaDescription:meta,bodyMarkdown:body}=article,keyword=options.keyword.trim();
 const lines=body.split('\n'),h2=lines.filter(l=>/^## \S/.test(l)).map(l=>l.slice(3).trim()),h3=lines.filter(l=>/^### \S/.test(l));
 const paragraphs=body.split(/\n{2,}/).map(p=>p.trim()).filter(p=>p&&!/^#/.test(p)&&!/^[-*]\s|^\d+[.)]\s/.test(p));
 const plain=body.replace(/^#+\s*/gm,'').replace(/[*_]/g,''),words=plain.split(/\s+/).filter(w=>/[\p{L}\p{N}]/u.test(w)).length;
 if(title.length>SEO_TITLE_MAX)add('title_long',`Titre de ${title.length} caractères : Google le coupe au-delà de ${SEO_TITLE_MAX} environ.`);
 if(title.length<SEO_TITLE_MIN)add('title_short',`Titre de ${title.length} caractères : trop court pour décrire la recherche visée.`,'info');
 if(!mentions(title,keyword))add('title_keyword',`Le titre ne reprend pas l’expression visée « ${keyword} ».`);
 if(meta.length<SEO_META_MIN)add('meta_short',`Meta description de ${meta.length} caractères : visez ${SEO_META_MIN} à ${SEO_META_MAX}.`,'info');
 if(meta.length>SEO_META_MAX)add('meta_long',`Meta description de ${meta.length} caractères : Google la coupe au-delà de ${SEO_META_MAX} environ.`,'info');
 if(!mentions(meta,keyword))add('meta_keyword','La meta description ne reprend pas l’expression visée.','info');
 if(!paragraphs[0]||!mentions(paragraphs[0],keyword))add('intro_keyword','L’introduction ne cite pas l’expression visée dès les premières phrases.');
 if(!h2.some(h=>mentions(h,keyword)))add('h2_keyword','Aucun intertitre « ## » ne reprend l’expression visée.','info');
 const faqIndex=h2.findIndex(h=>/questions? fr[eé]quentes|faq/i.test(h));
 if(faqIndex<0||h3.length<2)add('faq','Pas de partie « Questions fréquentes » avec au moins deux questions (format favorisé par Google).');
 const topical=h2.filter((h,i)=>i!==faqIndex&&!/r[ée]sum[ée]|conclusion|en bref/i.test(h));
 if(topical.length&&topical.filter(h=>/\?$|^(comment|pourquoi|quand|quel|quelle|quels|quelles|que|qu’|qu'|faut-il|combien|où)\b/i.test(h)).length<Math.ceil(topical.length/2))
  add('questions','Moins de la moitié des intertitres sont formulés comme les questions que posent les internautes.','info');
 if(paragraphs.some(p=>p.split(/\s+/).length>90))add('long_paragraph','Un paragraphe dépasse 90 mots : difficile à lire sur téléphone.','info');
 const sentences=plain.split(/[.!?…]+\s/).map(s=>s.split(/\s+/).filter(Boolean).length).filter(n=>n>2);
 if(sentences.length&&sentences.reduce((a,b)=>a+b,0)/sentences.length>22)add('long_sentences','Phrases longues (plus de 22 mots en moyenne) : raccourcir.','info');
 if(!lines.some(l=>/^\s*([-*]|\d+[.)])\s+\S/.test(l)))add('no_list','Aucune liste : les étapes ou critères gagnent à être listés.','info');
 const density=words?occurrences(`${title} ${plain}`,keyword)/words*100:0;
 if(density>2.5)add('stuffing',`Expression visée répétée trop souvent (${density.toFixed(1)} pour 100 mots) : Google peut y voir de la sur-optimisation.`);
 if(words<700)add('thin',`${words} mots : un peu court pour se positionner face aux pages concurrentes (700 et plus).`,'info');
 const zone=options.zone?.trim();
 if(zone&&tokens(zone).length){const n=occurrences(`${title} ${meta} ${plain}`,zone);
  if(n===0)add('zone_missing',`La zone « ${zone} » n’apparaît nulle part : utile pour le référencement local.`,'info');
  else if(n>4)add('zone_repeated',`La zone « ${zone} » revient ${n} fois : une à trois mentions naturelles suffisent.`,'info');}
 const score=Math.max(0,100-issues.reduce((sum,i)=>sum+(PENALTY[i.code]??0),0));
 return {score,words,keyword,issues};
}

/** Retour donné au rédacteur IA pour un nouvel essai : les remarques, sans la note. */
export const seoFeedback=(audit:SeoAudit)=>`note SEO ${audit.score}/100 ; à corriger : ${audit.issues.map(i=>i.message).join(' ')}`;
