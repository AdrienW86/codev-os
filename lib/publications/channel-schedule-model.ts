// Weekly schedule of one explicit project channel (Lot 4.3 P2-a). Pure and client-safe.
// Posts per week are derived from enabled slots; nothing else is stored.
export type ChannelScheduleSlot={id:string;weekday:number;localTime:string;enabled:boolean};
export type ChannelSchedule={scheduleId:string;projectChannelId:string;enabled:boolean;timezone:string;slots:ChannelScheduleSlot[]};
export type ChannelScheduleSlotInput={weekday:number;local_time:string;enabled:boolean};
export const DEFAULT_SCHEDULE_TIMEZONE='Europe/Paris';
export const MAX_SCHEDULE_SLOTS=28;
const TIME=/^([01][0-9]|2[0-3]):[0-5][0-9]$/;

// weekday ASC (1 = Monday … 7 = Sunday), then local time ASC.
export function sortScheduleSlots<T extends {weekday:number;localTime:string}>(slots:readonly T[]):T[]{
 return [...slots].sort((a,b)=>a.weekday-b.weekday||a.localTime.localeCompare(b.localTime));
}
export function postsPerWeek(schedule:Pick<ChannelSchedule,'slots'>|null):number{return schedule?schedule.slots.filter(s=>s.enabled).length:0;}
// A channel is schedulable only if the channel, its schedule and at least one slot are enabled.
export function channelSchedulable(channel:{enabled:boolean}|null|undefined,schedule:Pick<ChannelSchedule,'enabled'|'slots'>|null|undefined):boolean{
 return Boolean(channel?.enabled&&schedule?.enabled&&schedule.slots.some(s=>s.enabled));
}
// Complete payload for publication_channel_schedule_save: only weekday, local_time and enabled; no duplicate.
// Returns null when invalid (the RPC validates again).
export function normalizeScheduleSlots(input:unknown):ChannelScheduleSlotInput[]|null{
 if(!Array.isArray(input)||input.length>MAX_SCHEDULE_SLOTS)return null;
 const seen=new Set<string>(),result:ChannelScheduleSlotInput[]=[];
 for(const item of input){
  if(!item||typeof item!=='object'||Array.isArray(item))return null;
  const keys=Object.keys(item).sort();if(keys.join(',')!=='enabled,local_time,weekday')return null;
  const {weekday,local_time,enabled}=item as Record<string,unknown>;
  if(typeof weekday!=='number'||!Number.isInteger(weekday)||weekday<1||weekday>7||typeof local_time!=='string'||!TIME.test(local_time)||typeof enabled!=='boolean')return null;
  const key=`${weekday}|${local_time}`;if(seen.has(key))return null;seen.add(key);result.push({weekday,local_time,enabled});
 }
 return result;
}
