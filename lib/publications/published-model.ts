// Calendrier des publications (pur, testable) : vue mobile d'abord, par client et par réseau, sur un mois.
// Trois vues : publiées (diffusions confirmées), à venir (créneaux occupés par une publication pas encore partie),
// à traiter (échecs, blocages, résultats à vérifier). Les filtres vivent dans l'URL (aucun état caché).
import {platformLabels} from './editor';
import {publicationPlatforms,type PublicationPlatform} from './types';

export const CALENDAR_VIEWS={published:'Publiées',upcoming:'À venir',problems:'À traiter'} as const;
export type CalendarView=keyof typeof CALENDAR_VIEWS;
export type PublishedFilters={view:CalendarView;client:string|null;platform:PublicationPlatform|null;month:string;day:string|null};
export type CalendarItemStatus='published'|'pending_review'|'approved'|'scheduled'|'failed'|'blocked'|'uncertain'|'retry';
export const ITEM_STATUS_LABELS:Record<CalendarItemStatus,string>={published:'Publiée',pending_review:'À valider',approved:'Validée',scheduled:'Programmée',
 failed:'Échec',blocked:'Bloquée',uncertain:'À vérifier',retry:'Nouvel essai prévu'};
/** Une diffusion (ou une publication à venir) sur un réseau. */
export type CalendarItem={key:string;publicationId:string;groupKey:string;clientId:string;clientName:string;platform:PublicationPlatform;
 status:CalendarItemStatus;at:string;text:string|null;imagePath:string|null;remoteId:string|null;errorCode:string|null};
/** Carte affichée : une publication déclinée sur un ou plusieurs réseaux le même jour. */
export type CalendarCard={key:string;date:string;time:string;clientId:string;clientName:string;publicationId:string;text:string|null;imagePath:string|null;
 networks:{platform:PublicationPlatform;label:string;status:CalendarItemStatus;statusLabel:string;publicationId:string;url:string|null;errorCode:string|null}[]};

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const one=(v:unknown)=>typeof v==='string'?v:Array.isArray(v)&&typeof v[0]==='string'?v[0]:'';

/** Filtres lus dans l'URL ; toute valeur inconnue revient à sa valeur par défaut (jamais d'erreur). */
export function parsePublishedFilters(search:Record<string,unknown>,today:string):PublishedFilters{
 const view=one(search.view),client=one(search.client),platform=one(search.platform),month=one(search.month),day=one(search.day);
 const m=MONTH.test(month)?month:today.slice(0,7);
 return {view:(Object.hasOwn(CALENDAR_VIEWS,view)?view:'published') as CalendarView,client:UUID.test(client)?client.toLowerCase():null,
  platform:(publicationPlatforms as readonly string[]).includes(platform)?platform as PublicationPlatform:null,month:m,
  day:DAY.test(day)&&day.startsWith(m)&&validDay(day)?day:null};
}
function validDay(d:string){const t=new Date(d+'T00:00:00Z');return !Number.isNaN(t.getTime())&&t.toISOString().slice(0,10)===d;}
export function monthRange(month:string):{from:string;to:string}{
 const [y,m]=month.split('-').map(Number);const last=new Date(Date.UTC(y,m,0)).getUTCDate();
 return {from:`${month}-01`,to:`${month}-${String(last).padStart(2,'0')}`};
}
export function shiftMonth(month:string,delta:number):string{
 const [y,m]=month.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+delta,1));
 return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}
export function monthLabel(month:string):string{
 const [y,m]=month.split('-').map(Number);
 const s=new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,1)));
 return s.charAt(0).toUpperCase()+s.slice(1);
}
export function dayLabel(date:string):string{
 const s=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
 return s.charAt(0).toUpperCase()+s.slice(1);
}
/** Date et heure à Paris d'un instant ISO. */
export function parisParts(iso:string):{date:string;time:string}{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
 const p=(k:string)=>parts.find(x=>x.type===k)?.value??'00';
 return {date:`${p('year')}-${p('month')}-${p('day')}`,time:`${p('hour')}:${p('minute')}`};
}
/** Lien public vers le post quand l'identifiant le permet sans appel au réseau (Facebook uniquement). */
export function remoteUrl(platform:PublicationPlatform,remoteId:string|null):string|null{
 if(!remoteId)return null;
 if(platform==='facebook'&&/^\d{5,30}(_\d{5,30})?$/.test(remoteId))return `https://www.facebook.com/${remoteId}`;
 return null;
}
const ORDER:Record<PublicationPlatform,number>={facebook:0,instagram:1,google_business_profile:2,tiktok:3,snapchat:4};
/** Regroupe les éléments du mois en cartes (même publication éditoriale, même jour), du plus récent au plus ancien
 *  pour les publiées et les problèmes, du plus proche au plus lointain pour l'à-venir. */
export function buildCards(items:CalendarItem[],view:CalendarView):CalendarCard[]{
 const cards=new Map<string,CalendarCard>();
 for(const item of items){
  const {date,time}=parisParts(item.at),key=`${item.groupKey}:${date}`;
  let card=cards.get(key);
  if(!card){card={key,date,time,clientId:item.clientId,clientName:item.clientName,publicationId:item.publicationId,text:item.text,imagePath:item.imagePath,networks:[]};cards.set(key,card);}
  if(time<card.time)card.time=time;
  if(!card.imagePath&&item.imagePath)card.imagePath=item.imagePath;
  if(!card.text&&item.text)card.text=item.text;
  if(!card.networks.some(n=>n.platform===item.platform))card.networks.push({platform:item.platform,label:platformLabels[item.platform],status:item.status,statusLabel:ITEM_STATUS_LABELS[item.status],
   publicationId:item.publicationId,url:item.status==='published'?remoteUrl(item.platform,item.remoteId):null,errorCode:item.errorCode});
 }
 const list=[...cards.values()];
 for(const c of list)c.networks.sort((a,b)=>ORDER[a.platform]-ORDER[b.platform]);
 const asc=view==='upcoming';
 return list.sort((a,b)=>{const k=`${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)||a.clientName.localeCompare(b.clientName);return asc?k:-k;});
}
export type DayCell={date:string;inMonth:boolean;count:number;platforms:PublicationPlatform[];today:boolean;problem:boolean};
/** Grille du mois (lundi en premier) avec, par jour, le nombre de cartes et les réseaux concernés. */
export function monthGrid(month:string,cards:CalendarCard[],today:string):DayCell[][]{
 const {from,to}=monthRange(month);
 const byDay=new Map<string,CalendarCard[]>();for(const c of cards)byDay.set(c.date,[...(byDay.get(c.date)??[]),c]);
 const start=new Date(from+'T00:00:00Z');start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
 const end=new Date(to+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+(6-(end.getUTCDay()+6)%7));
 const weeks:DayCell[][]=[];
 for(const d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+7)){
  const week:DayCell[]=[];
  for(let i=0;i<7;i++){
   const day=new Date(d.getTime()+i*86400000).toISOString().slice(0,10),list=byDay.get(day)??[];
   const platforms=[...new Set(list.flatMap(c=>c.networks.map(n=>n.platform)))].sort((a,b)=>ORDER[a]-ORDER[b]);
   week.push({date:day,inMonth:day>=from&&day<=to,count:list.length,platforms,today:day===today,
    problem:list.some(c=>c.networks.some(n=>['failed','blocked','uncertain','retry'].includes(n.status)))});
  }
  weeks.push(week);
 }
 return weeks;
}
/** Compteurs des filtres « intelligents » : chaque puce affiche ce qu'elle contient, compte tenu des autres filtres. */
export function chipCounts(items:CalendarItem[],filters:Pick<PublishedFilters,'client'|'platform'>):{clients:Map<string,{name:string;count:number}>;platforms:Map<PublicationPlatform,number>;total:number}{
 const clients=new Map<string,{name:string;count:number}>(),platforms=new Map<PublicationPlatform,number>();
 for(const i of items){
  if(!filters.platform||i.platform===filters.platform){const c=clients.get(i.clientId)??{name:i.clientName,count:0};c.count++;clients.set(i.clientId,c);}
  if(!filters.client||i.clientId===filters.client)platforms.set(i.platform,(platforms.get(i.platform)??0)+1);
 }
 const total=items.filter(i=>(!filters.client||i.clientId===filters.client)&&(!filters.platform||i.platform===filters.platform)).length;
 return {clients,platforms,total};
}
export function applyFilters(items:CalendarItem[],filters:Pick<PublishedFilters,'client'|'platform'>):CalendarItem[]{
 return items.filter(i=>(!filters.client||i.clientId===filters.client)&&(!filters.platform||i.platform===filters.platform));
}
/** URL de la vue avec certains filtres modifiés (null retire le filtre). Changer de vue, de client, de réseau ou de
 *  mois retire le jour choisi. */
export function calendarHref(base:PublishedFilters,patch:Partial<Record<keyof PublishedFilters,string|null>>,path='/publications/published'):string{
 const next:Record<string,string|null>={view:base.view,client:base.client,platform:base.platform,month:base.month,day:base.day,...patch};
 if(!('day' in patch)&&Object.keys(patch).length)next.day=null;
 const q=new URLSearchParams();
 if(next.view&&next.view!=='published')q.set('view',next.view);
 for(const k of ['client','platform','month','day'] as const)if(next[k])q.set(k,next[k] as string);
 const s=q.toString();return s?`${path}?${s}`:path;
}
/** Extrait lisible d'un texte de publication (première ligne utile, coupée proprement). */
export function excerpt(text:string|null,max=160):string|null{
 if(!text)return null;const clean=text.replace(/#[\p{L}\p{N}_]+/gu,'').replace(/\s+/g,' ').trim();if(!clean)return null;
 if([...clean].length<=max)return clean;
 const cut=[...clean].slice(0,max-1).join(''),space=cut.lastIndexOf(' ');
 return (space>max*0.6?cut.slice(0,space):cut).replace(/[\s,;:–—-]+$/,'')+'…';
}
