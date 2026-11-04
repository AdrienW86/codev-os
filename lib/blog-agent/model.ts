// Agent Blog (pur, testable) : réglages, échéance, contrôle de l'article et des résumés, slug, rendu HTML sûr,
// textes de relais par réseau et forme publique d'un article.
import {SERVICE_TERMS,trimExtraHashtags,unsupportedClaims} from '@/lib/publications/agent-v2/selection';

export const RELAY_PLATFORMS=['facebook','instagram','google_business_profile'] as const;
export type RelayPlatform=typeof RELAY_PLATFORMS[number];
export const RELAY_LABELS:Record<RelayPlatform,string>={facebook:'Facebook',instagram:'Instagram',google_business_profile:'Google Business Profile'};
export const NOTICE_HOURS=24;
export const TITLE_MIN=10,TITLE_MAX=90,META_MIN=50,META_MAX=160,EXCERPT_MIN=30,EXCERPT_MAX=300,ALT_MAX=150,SUMMARY_MIN=40,SUMMARY_MAX=600;
export const WORDS_MIN=450,WORDS_MAX=1600,SECTIONS_MIN=3;
export const CTA_SENTENCE='Retrouvez l’intégralité de notre article sur notre site web';

export type BlogAgentSettings={enabled:boolean;perWeek:1|2;siteUrl:string|null;blogPath:string;socialRelay:boolean};
export const DEFAULT_BLOG_SETTINGS:BlogAgentSettings={enabled:false,perWeek:1,siteUrl:null,blogPath:'/blog',socialRelay:false};
const SITE=/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/,PATH=/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;

/** Adresse du site normalisée (https, sans chemin ni barre finale), ou null si elle n'est pas exploitable. */
export function normalizeSiteUrl(value:unknown):string|null{
 if(typeof value!=='string'||!value.trim())return null;
 let raw=value.trim();if(!/^https?:\/\//i.test(raw))raw='https://'+raw;
 try{const u=new URL(raw);if(u.username||u.password||u.port)return null;const site=`https://${u.hostname.toLowerCase()}`;return SITE.test(site)?site:null;}catch{return null;}
}
export function blogSettingsFromRow(row:Record<string,unknown>|null):BlogAgentSettings{
 if(!row)return {...DEFAULT_BLOG_SETTINGS};
 const site=typeof row.site_url==='string'&&SITE.test(row.site_url)?row.site_url:null,path=typeof row.blog_path==='string'&&PATH.test(row.blog_path)?row.blog_path:'/blog';
 return {enabled:row.enabled===true,perWeek:Number(row.per_week)===2?2:1,siteUrl:site,blogPath:path,socialRelay:row.social_relay===true};
}
export function parseBlogSettingsForm(form:{get(name:string):unknown}):BlogAgentSettings|{error:string}{
 const per=Number(form.get('per_week')),enabled=form.get('enabled')==='on';
 if(per!==1&&per!==2)return {error:'Un ou deux articles par semaine.'};
 const rawSite=form.get('site_url'),siteUrl=normalizeSiteUrl(rawSite);
 if(typeof rawSite==='string'&&rawSite.trim()&&!siteUrl)return {error:'Adresse du site invalide (ex. https://www.exemple.fr).'};
 if(enabled&&!siteUrl)return {error:'Indiquez l’adresse du site du client pour activer l’agent.'};
 const rawPath=String(form.get('blog_path')??'').trim().toLowerCase().replace(/\/+$/,'')||'/blog',blogPath=rawPath.startsWith('/')?rawPath:'/'+rawPath;
 if(!PATH.test(blogPath))return {error:'Chemin du blog invalide (ex. /blog).'};
 return {enabled,perWeek:per,siteUrl,blogPath,socialRelay:form.get('social_relay')==='on'};
}

export type BlogItem={created_at:string;service:string|null;title:string;status:string;library_asset_id?:string|null};
/** Au plus per_week articles rédigés sur 7 jours glissants (annulés compris), espacés d'au moins 80 % de l'intervalle. */
export function blogDue(settings:Pick<BlogAgentSettings,'enabled'|'perWeek'|'siteUrl'>,items:readonly Pick<BlogItem,'created_at'>[],now:Date):boolean{
 if(!settings.enabled||!settings.siteUrl)return false;
 const week=now.getTime()-7*86400000;
 if(items.filter(i=>Date.parse(i.created_at)>week).length>=settings.perWeek)return false;
 const last=Math.max(0,...items.map(i=>Date.parse(i.created_at)).filter(Number.isFinite));
 return now.getTime()-last>=Math.floor(7*86400000/settings.perWeek*0.8);
}
/** Mise en ligne : 24 h après la rédaction, arrondie au quart d'heure suivant. */
export function publishAtFrom(now:Date):Date{
 const q=15*60000;return new Date(Math.ceil((now.getTime()+NOTICE_HOURS*3600000)/q)*q);
}
/** Prestation la moins récemment traitée (jamais traitée d'abord), dans l'ordre des prestations confirmées. */
export function nextBlogService(services:readonly string[],items:readonly Pick<BlogItem,'service'|'created_at'>[]):string|null{
 if(!services.length)return null;
 const last=(s:string)=>Math.max(-1,...items.filter(i=>i.service===s).map(i=>Date.parse(i.created_at)));
 return [...services].sort((a,b)=>last(a)-last(b)||services.indexOf(a)-services.indexOf(b))[0];
}
export const ARTICLE_ANGLES=['guide pratique','conseils d’entretien et de prévention','questions fréquentes','erreurs à éviter','comment bien choisir','les étapes, expliquées simplement'] as const;
export function nextAngle(count:number):string{return ARTICLE_ANGLES[Math.abs(Math.trunc(count))%ARTICLE_ANGLES.length];}

const norm=(s:string)=>s.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function slugify(text:string):string{
 const words=norm(text).split(' ').filter(Boolean);let slug='';
 for(const w of words){const next=slug?`${slug}-${w}`:w;if(next.length>80)break;slug=next;}
 return slug.replace(/[^a-z0-9-]/g,'').replace(/-+/g,'-').replace(/^-|-$/g,'')||'article';
}
export function uniqueSlug(base:string,taken:ReadonlySet<string>):string{
 const root=(base.length<3?`article-${base}`:base).slice(0,84).replace(/-$/,'');
 if(!taken.has(root))return root;
 for(let n=2;;n++){const s=`${root}-${n}`;if(!taken.has(s))return s;}
}
/** Termes métier absents des faits du client : nommés au modèle pour qu'il n'en parle pas. */
export function forbiddenTerms(facts:string):string[]{const f=` ${norm(facts)} `;return SERVICE_TERMS.filter(t=>!f.includes(` ${norm(t)} `));}

export type ArticleDraft={title:string;metaDescription:string;excerpt:string;imageAlt:string;bodyMarkdown:string;social:Record<RelayPlatform,string>};
type Check={ok:true;article:ArticleDraft}|{ok:false;reason:string};
const clean=(v:unknown)=>typeof v==='string'?v.replace(/\s+/g,' ').trim():'';
const LINK=/https?:|www\.|\]\(|<[a-z!/]/i;
export const wordCount=(md:string)=>md.replace(/[#*_>-]/g,' ').split(/\s+/).filter(w=>/[\p{L}\p{N}]/u.test(w)).length;
/** Corps Markdown normalisé : fins de ligne, espaces de fin, trois lignes vides au plus réduites à une. */
export function normalizeMarkdown(md:string):string{return md.replace(/\r\n?/g,'\n').split('\n').map(l=>l.replace(/\s+$/,'')).join('\n').replace(/\n{3,}/g,'\n\n').trim();}
/**
 * Article contrôlé : longueurs, structure (intertitres, pas de titre de niveau 1), ni lien, ni HTML, ni image,
 * aucune affirmation absente des faits du client (prix, garanties, labels, délais, avis, chantiers…), titre jamais
 * réutilisé ; un résumé par réseau, sans lien (le renvoi vers l'article est ajouté ensuite).
 */
export function checkArticle(value:unknown,facts:string,usedTitles:readonly string[]):Check{
 const v=value as Record<string,unknown>|null;
 const title=clean(v?.title),metaDescription=clean(v?.meta_description),excerpt=clean(v?.excerpt),imageAlt=clean(v?.image_alt);
 const bodyMarkdown=normalizeMarkdown(typeof v?.body_markdown==='string'?v.body_markdown:'');
 const rawSocial=(v?.social&&typeof v.social==='object'?v.social:{}) as Record<string,unknown>;
 if(title.length<TITLE_MIN||title.length>TITLE_MAX)return {ok:false,reason:`titre de ${TITLE_MIN} à ${TITLE_MAX} caractères (actuellement ${title.length})`};
 if(metaDescription.length<META_MIN||metaDescription.length>META_MAX)return {ok:false,reason:`meta description de ${META_MIN} à ${META_MAX} caractères (actuellement ${metaDescription.length})`};
 if(excerpt.length<EXCERPT_MIN||excerpt.length>EXCERPT_MAX)return {ok:false,reason:`chapô de ${EXCERPT_MIN} à ${EXCERPT_MAX} caractères`};
 if(imageAlt.length<5||imageAlt.length>ALT_MAX)return {ok:false,reason:`texte alternatif de l’image de 5 à ${ALT_MAX} caractères`};
 const words=wordCount(bodyMarkdown);
 if(words<WORDS_MIN||words>WORDS_MAX)return {ok:false,reason:`corps de ${WORDS_MIN} à ${WORDS_MAX} mots (actuellement ${words})`};
 const lines=bodyMarkdown.split('\n');
 if(lines.some(l=>/^#(?!#)/.test(l)))return {ok:false,reason:'pas de titre de niveau 1 dans le corps (le titre est à part) : utilise ## pour les intertitres'};
 if(lines.filter(l=>/^## \S/.test(l)).length<SECTIONS_MIN)return {ok:false,reason:`au moins ${SECTIONS_MIN} intertitres « ## »`};
 if(lines.some(l=>/^#{4,}/.test(l)))return {ok:false,reason:'intertitres de niveau 2 ou 3 seulement'};
 const social={} as Record<RelayPlatform,string>;
 for(const p of RELAY_PLATFORMS){
  const text=trimExtraHashtags(p,typeof rawSocial[p]==='string'?(rawSocial[p] as string).trim():'');
  if(text.length<SUMMARY_MIN||text.length>SUMMARY_MAX)return {ok:false,reason:`résumé ${RELAY_LABELS[p]} de ${SUMMARY_MIN} à ${SUMMARY_MAX} caractères`};
  social[p]=text;
 }
 const all=[title,metaDescription,excerpt,imageAlt,bodyMarkdown,...Object.values(social)];
 if(all.some(t=>LINK.test(t)))return {ok:false,reason:'ni lien, ni adresse web, ni HTML, ni image dans le texte'};
 if(/[@]/.test(all.join(' ')))return {ok:false,reason:'ni adresse e-mail ni mention'};
 if(/(?:\+33|\b0)[1-9](?:[ .-]?\d{2}){4}\b/.test(all.join(' ')))return {ok:false,reason:'aucun numéro de téléphone'};
 const claims=[...new Set(all.flatMap(t=>unsupportedClaims(neutralizeDurations(t),facts)).map(c=>c.split(':').slice(1).join(':').trim()))];
 if(claims.length)return {ok:false,reason:`affirmation non confirmée par les faits du client : ${claims.slice(0,6).join(', ')} ; reformule sans ces mots`};
 if(usedTitles.some(u=>norm(u)===norm(title)))return {ok:false,reason:'titre déjà employé pour un autre article'};
 return {ok:true,article:{title,metaDescription,excerpt,imageAlt,bodyMarkdown,social}};
}

/**
 * Périodicités d'entretien (« tous les 5 ans », « entre 10 et 15 ans ») : un conseil général, pas une ancienneté
 * revendiquée ; elles sont neutralisées avant le contrôle des affirmations (« plus de 20 ans » reste contrôlé).
 */
export function neutralizeDurations(text:string):string{
 return text.replace(/\b(tous les|toutes les|chaque|entre|environ|au bout de|après|apres|pendant|durant|tou(?:s|tes) les)\s+\d+(?:\s*(?:à|a|et|-)\s*\d+)?\s+ans(?![\p{L}])/giu,'$1 plusieurs années')
  .replace(/\b\d+\s*(?:à|-)\s*\d+\s+ans(?![\p{L}])/giu,'plusieurs années');
}
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const inline=(s:string)=>esc(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g,'$1<em>$2</em>');
/** Rendu HTML d'un sous-ensemble sûr de Markdown (intertitres 2-3, paragraphes, listes, gras, italique), tout échappé. */
export function renderMarkdown(md:string):string{
 const out:string[]=[];let para:string[]=[],list:{tag:'ul'|'ol';items:string[]}|null=null;
 const flush=()=>{if(para.length){out.push(`<p>${inline(para.join(' '))}</p>`);para=[];}if(list){out.push(`<${list.tag}>${list.items.map(i=>`<li>${inline(i)}</li>`).join('')}</${list.tag}>`);list=null;}};
 for(const raw of normalizeMarkdown(md).split('\n')){
  const line=raw.trim();let m:RegExpMatchArray|null;
  if(!line){flush();continue;}
  if((m=line.match(/^(#{2,3})\s+(.+)$/))){flush();out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);continue;}
  if((m=line.match(/^[-*]\s+(.+)$/))||(m=line.match(/^\d+[.)]\s+(.+)$/))){
   const tag=/^\d/.test(line)?'ol':'ul';if(para.length||list&&list.tag!==tag)flush();(list??={tag,items:[]}).items.push(m[1]);continue;}
  if(list)flush();
  para.push(line.replace(/^#+\s*/,''));
 }
 flush();return out.join('\n');
}
export const readingMinutes=(md:string)=>Math.max(1,Math.round(wordCount(md)/200));

export function articleUrl(siteUrl:string,blogPath:string,slug:string):string{return `${siteUrl}${blogPath}/${slug}`;}
export const domainOf=(siteUrl:string)=>siteUrl.replace(/^https:\/\//,'').replace(/^www\./,'');
/** Texte publié sur un réseau : le résumé, puis le renvoi vers l'article (lien cliquable hors Instagram). */
export function relayText(platform:RelayPlatform,summary:string,url:string,siteUrl:string):string{
 if(platform==='instagram')return `${summary}\n\n${CTA_SENTENCE} : ${domainOf(siteUrl)}, rubrique Blog.`;
 return `${summary}\n\n${CTA_SENTENCE} 👉 ${url}`;
}

export type PublicArticle={slug:string;title:string;description:string;excerpt:string;service:string|null;url:string|null;
 image:{url:string;alt:string;width:number;height:number}|null;publishedAt:string;updatedAt:string;readingMinutes:number;html?:string;markdown?:string};
export type ArticleRow={slug:string;title:string;meta_description:string;excerpt:string;body_markdown:string;service:string|null;image_path:string|null;image_alt:string|null;published_at:string|null;updated_at:string};
export const BLOG_IMAGE={width:1600,height:900};
export function toPublicArticle(row:ArticleRow,imageBase:string,settings:Pick<BlogAgentSettings,'siteUrl'|'blogPath'>|null,full:boolean):PublicArticle{
 return {slug:row.slug,title:row.title,description:row.meta_description,excerpt:row.excerpt,service:row.service,
  url:settings?.siteUrl?articleUrl(settings.siteUrl,settings.blogPath,row.slug):null,
  image:row.image_path?{url:`${imageBase}/${row.image_path}`,alt:row.image_alt??'',...BLOG_IMAGE}:null,
  publishedAt:row.published_at??row.updated_at,updatedAt:row.updated_at,readingMinutes:readingMinutes(row.body_markdown),
  ...(full?{html:renderMarkdown(row.body_markdown),markdown:row.body_markdown}:{})};
}
