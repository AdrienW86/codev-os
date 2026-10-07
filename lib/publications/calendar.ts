import type {CadenceConfig,CalendarSlot,Publication,PublicationPlatform,PublicationDelivery} from "./types";

export function validDate(value:string):boolean {const d=new Date(value+"T00:00:00Z");return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function addDays(date:string,days:number):string {return new Date(Date.parse(date+"T00:00:00Z")+days*86400000).toISOString().slice(0,10);}
export function editorialMonday(date:string):string {if(!validDate(date))throw Error("Date invalide.");const day=new Date(date+"T00:00:00Z").getUTCDay();return addDays(date,-((day+6)%7));}
export function parisToday(now=new Date()):string {const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);const part=(key:string)=>parts.find(p=>p.type===key)?.value;return `${part('year')}-${part('month')}-${part('day')}`;}
// Temporary until per-channel schedules (P2): one weekly post when the only channel is GBP, two otherwise.
export function defaultCadence(platforms:readonly PublicationPlatform[]):CadenceConfig {const n=platforms.length===1&&platforms[0]==="google_business_profile"?1:2;return {enabled:false,posts_per_week:n,preferred_weekdays:n===1?[1]:[1,5],preferred_times:n===1?["12:00"]:["12:00","12:00"],timezone:"Europe/Paris",planning_horizon_weeks:4,auto_create_slots:false,require_manual_approval:true};}
export function validateCadence(value:unknown):CadenceConfig|null {
 if(!value||typeof value!=="object"||Array.isArray(value))return null;const c=value as CadenceConfig;
 const keys=Object.keys(defaultCadence([]));if(Object.keys(c).length!==keys.length||Object.keys(c).some(k=>!keys.includes(k)))return null;
 if(typeof c.enabled!=="boolean"||typeof c.auto_create_slots!=="boolean"||c.require_manual_approval!==true||![1,2].includes(c.posts_per_week)||!Number.isInteger(c.planning_horizon_weeks)||c.planning_horizon_weeks<1||c.planning_horizon_weeks>12||!Array.isArray(c.preferred_weekdays)||!Array.isArray(c.preferred_times)||c.preferred_weekdays.length!==c.posts_per_week||c.preferred_times.length!==c.posts_per_week||!c.preferred_weekdays.every(d=>Number.isInteger(d)&&d>=1&&d<=7)||!c.preferred_times.every(t=>typeof t==="string"&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t))||typeof c.timezone!=="string")return null;
 try{new Intl.DateTimeFormat("en",{timeZone:c.timezone});}catch{return null;}
 if(c.posts_per_week===2&&c.preferred_weekdays[0]===c.preferred_weekdays[1]&&c.preferred_times[0]===c.preferred_times[1])return null;
 return {...c,preferred_weekdays:[...c.preferred_weekdays],preferred_times:[...c.preferred_times]};
}
// Match a wall clock to a UTC instant. A gap has no match; an autumn overlap
// uses the later instant, matching PostgreSQL AT TIME ZONE (standard time).
export function localInstant(date:string,time:string,zone:string):string|null {
 const f=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
 const anchor=Date.parse(`${date}T${time}:00Z`);let match:number|null=null;
 for(let offset=-840;offset<=840;offset+=15){const stamp=anchor+offset*60000;const parts=f.formatToParts(stamp);const p=(key:string)=>parts.find(v=>v.type===key)?.value;if(`${p('year')}-${p('month')}-${p('day')}`===date&&`${p('hour')}:${p('minute')}`===time)match=stamp;}
 return match===null?null:new Date(match).toISOString();
}
export type CalendarCandidate={key:string;client_id:string;project_id:string;editorial_week:string;slot:1|2;local_date:string;local_time:string;timezone:string;scheduled_for:string|null;platforms:PublicationPlatform[];publication_id:string|null;reservation_id:string|null;state:"missing"|"reserved"|"existing"|"conflict"};
// Platforms come from the project capabilities (project-channels.ts); this pure function never reads the project type.
export function buildEditorialCalendar(client:{id:string},project:{id:string;client_id:string},platforms:readonly PublicationPlatform[],cadence:CadenceConfig,period:{start_week:string;weeks?:number},publications:Publication[]=[],reservations:CalendarSlot[]=[]):CalendarCandidate[]{
 if(project.client_id!==client.id||!platforms.length)throw Error("Périmètre client/projet invalide.");
 const config=Object.fromEntries(Object.keys(defaultCadence([])).map(k=>[k,cadence[k as keyof CadenceConfig]]));
 const c=validateCadence(config);if(!c||editorialMonday(period.start_week)!==period.start_week)throw Error("Cadence ou semaine invalide.");
 const weeks=period.weeks??c.planning_horizon_weeks;if(!Number.isInteger(weeks)||weeks<1||weeks>c.planning_horizon_weeks)throw Error("Horizon invalide.");
 if(!c.enabled||!c.auto_create_slots)return [];
 const result:CalendarCandidate[]=[];
 for(let w=0;w<weeks;w++){const week=addDays(period.start_week,w*7);for(let i=0;i<c.posts_per_week;i++){
  const slot=(i+1) as 1|2;const reservation=reservations.find(s=>s.client_id===client.id&&s.project_id===project.id&&s.editorial_week===week&&s.slot===slot);
  const pub=publications.find(p=>p.client_id===client.id&&p.project_id===project.id&&p.editorial_week===week&&p.slot===slot);
  const date=reservation?.local_date??addDays(week,c.preferred_weekdays[i]-1),time=reservation?.local_time.slice(0,5)??c.preferred_times[i],zone=reservation?.timezone??c.timezone;
  const instant=reservation?.scheduled_for??localInstant(date,time,zone);
  const conflict=!instant||Boolean(pub?.target_date&&pub.target_date!==date)||Boolean(reservation?.publication_id&&reservation.publication_id!==pub?.id);
  result.push({key:`${project.id}:${week}:${slot}`,client_id:client.id,project_id:project.id,editorial_week:week,slot,local_date:date,local_time:time,timezone:zone,scheduled_for:instant,platforms:reservation?.platforms??[...platforms],publication_id:pub?.id??reservation?.publication_id??null,reservation_id:reservation?.id??null,state:conflict?"conflict":reservation?"reserved":pub?"existing":"missing"});
 }}return result;
}
export const calendarStatusLabels={free:"Slot libre",draft:"Brouillon",pending_review:"À valider",approved:"Approuvé",rejected:"Refusé",scheduled:"Planifié",published:"Publié",error:"Erreur"} as const;
export type CalendarStatus=keyof typeof calendarStatusLabels;
export type CalendarEntry={key:string;date:string;time:string|null;timezone:string;client_id:string;project_id:string|null;client_name:string;project_name:string;subject:string;platforms:PublicationPlatform[];status:CalendarStatus;revision:number|null;validation:string;publication_id:string|null;origin:Publication["creation_origin"]|null;conflict:boolean};
export function entryStatus(publication:Publication|undefined,deliveries:PublicationDelivery[]):CalendarStatus {
 if(!publication)return "free";const rows=deliveries.filter(d=>d.publication_id===publication.id);
 if(rows.some(d=>["retryable_error","uncertain"].includes(d.status)))return "error";
 if(rows.length&&rows.every(d=>d.status==="published"))return "published";
 if(rows.some(d=>["scheduled","processing"].includes(d.status)))return "scheduled";
 return publication.status;
}
export function filterCalendar(entries:CalendarEntry[],filter:{from:string;to:string;client?:string;project?:string;platform?:string;status?:string}):CalendarEntry[]{return entries.filter(e=>e.date>=filter.from&&e.date<=filter.to&&(!filter.client||e.client_id===filter.client)&&(!filter.project||e.project_id===filter.project)&&(!filter.platform||e.platforms.includes(filter.platform as PublicationPlatform))&&(!filter.status||e.status===filter.status)).sort((a,b)=>`${a.date}:${a.time??'99:99'}:${a.key}`.localeCompare(`${b.date}:${b.time??'99:99'}:${b.key}`));}
export function calendarPeriod(date:string,mode:"week"|"month"){if(!validDate(date))throw Error("Date invalide.");if(mode==="week"){const from=editorialMonday(date);return {from,to:addDays(from,6)};}const from=date.slice(0,7)+"-01";const next=new Date(from+"T00:00:00Z");next.setUTCMonth(next.getUTCMonth()+1);return {from,to:addDays(next.toISOString().slice(0,10),-1)};}
