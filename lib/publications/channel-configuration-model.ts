// View model of the project "Configuration" tab (Lot 4.3 P2-b). Pure and client-safe: no identifier, no
// internal source value, no account data other than a "connected" flag.
import {platformLabels} from './editor';
import {DEFAULT_SCHEDULE_TIMEZONE,MAX_SCHEDULE_SLOTS,postsPerWeek,sortScheduleSlots,type ChannelSchedule} from './channel-schedule-model';
import {legacyProductionBlock,projectSupportsPublications,SUSPENDED_PUBLICATIONS_MESSAGE,type PublicationCapabilities} from './channels';
import {publicationPlatforms,type PublicationPlatform} from './types';

export const WEEKDAY_LABELS=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'] as const;
export type ChannelState='legacy'|'active'|'inactive';
export type ConfigurationSlot={weekday:number;localTime:string};
export type ChannelCard={platform:PublicationPlatform;label:string;state:ChannelState;configured:boolean;accountConnected:boolean;rules:string|null;
 schedule:{enabled:boolean;timezone:string;slots:ConfigurationSlot[];inactiveSlots:ConfigurationSlot[]}|null;postsPerWeek:number};
export type ChannelConfigurationView={legacy:boolean;suspended:string|null;calendarNotice:string|null;agentNotice:string|null;cards:ChannelCard[]};
export type ExplicitChannelInput={platform:PublicationPlatform;enabled:boolean;accountConnected:boolean;rules:string|null;schedule:ChannelSchedule|null};

const order:PublicationPlatform[]=['facebook','instagram','google_business_profile'];
export function buildChannelConfiguration(capabilities:PublicationCapabilities,explicit:readonly ExplicitChannelInput[]):ChannelConfigurationView{
 const legacy=capabilities.source==='legacy';
 const cards=order.filter(p=>(publicationPlatforms as readonly string[]).includes(p)).map(platform=>{
  const row=legacy?undefined:explicit.find(c=>c.platform===platform);
  const state:ChannelState=legacy?'legacy':row?.enabled?'active':'inactive';
  const s=row?.schedule??null;
  return {platform,label:platformLabels[platform],state,configured:Boolean(row),accountConnected:Boolean(row?.accountConnected),rules:row?.rules?.trim()||null,
   schedule:s?{enabled:s.enabled,timezone:s.timezone,slots:sortScheduleSlots(s.slots.filter(x=>x.enabled)).map(x=>({weekday:x.weekday,localTime:x.localTime})),
    inactiveSlots:sortScheduleSlots(s.slots.filter(x=>!x.enabled)).map(x=>({weekday:x.weekday,localTime:x.localTime}))}:null,
   postsPerWeek:postsPerWeek(s)};});
 const legacyCards=legacy?cards.filter(c=>capabilities.platforms.includes(c.platform)):cards;
 return {legacy,cards:legacyCards,suspended:!legacy&&!projectSupportsPublications(capabilities)?SUSPENDED_PUBLICATIONS_MESSAGE:null,
  calendarNotice:!legacy&&projectSupportsPublications(capabilities)?legacyProductionBlock(capabilities,'calendar'):null,
  agentNotice:!legacy&&projectSupportsPublications(capabilities)?legacyProductionBlock(capabilities,'agent'):null};
}

export function postsPerWeekLabel(count:number):string{return `${count} publication${count>1?'s':''} / semaine`;}
export function weekdayLabel(weekday:number):string{return WEEKDAY_LABELS[weekday-1]??'Jour inconnu';}
// Rows edited on screen: sorted Monday → Sunday then time, at most 28, no duplicate, HH:MM only.
export function sortConfigurationSlots<T extends ConfigurationSlot>(rows:readonly T[]):T[]{return sortScheduleSlots(rows);}
export function slotRowsError(rows:readonly ConfigurationSlot[]):string|null{
 if(rows.length>MAX_SCHEDULE_SLOTS)return `${MAX_SCHEDULE_SLOTS} créneaux maximum.`;
 const seen=new Set<string>();
 for(const r of rows){if(!Number.isInteger(r.weekday)||r.weekday<1||r.weekday>7||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(r.localTime))return 'Chaque créneau doit avoir un jour et une heure valides.';
  const key=`${r.weekday}|${r.localTime}`;if(seen.has(key))return `Créneau en double : ${weekdayLabel(r.weekday)} ${r.localTime}.`;seen.add(key);}
 return null;
}
// Complete payload for the P2-a RPC: the rows kept on screen are enabled; anything absent is disabled by the RPC.
export function scheduleSlotsPayload(rows:readonly ConfigurationSlot[]){return sortConfigurationSlots(rows).map(r=>({weekday:r.weekday,local_time:r.localTime,enabled:true}));}
export {DEFAULT_SCHEDULE_TIMEZONE,MAX_SCHEDULE_SLOTS};
