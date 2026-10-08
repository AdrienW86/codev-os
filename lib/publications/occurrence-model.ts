// Dated channel occurrences (Lot 4.3 P3): pure presentation model, client-safe. No identifier other than the
// linked publication id (already used by existing publication links) is exposed.
import {addDays} from './calendar';
import {platformLabels} from './editor';
import type {PublicationPlatform} from './types';

export type OccurrenceRow={id:string;platform:PublicationPlatform;local_date:string;local_time:string;timezone:string;scheduled_for:string;
 publication_id:string|null;skipped_at:string|null;skipped_reason:string|null};
export type LinkedPublication={id:string;subject:string;status:string};
export type OccurrenceState='open'|'missed'|'linked'|'skipped';
export type OccurrenceEntry={key:string;date:string;time:string;timezone:string;platform:PublicationPlatform;platformLabel:string;state:OccurrenceState;stateLabel:string;
 publication:LinkedPublication|null;skippedReason:string|null};
export type EnsureOccurrencesResult={created:number;existing:number;dst_conflicts:number;channels:number;conflicts:{platform:PublicationPlatform;local_date:string;local_time:string;timezone:string}[]};

export const occurrenceStateLabels:Record<OccurrenceState,string>={open:'À préparer',missed:'Passée sans publication',linked:'Publication liée',skipped:'Ignorée'};
export const PREPARE_WEEK_OPTIONS=[1,2,4] as const;
export const DEFAULT_PREPARE_WEEKS=4;
const platformOrder:PublicationPlatform[]=['facebook','instagram','google_business_profile'];

export function occurrenceState(row:Pick<OccurrenceRow,'publication_id'|'skipped_at'|'scheduled_for'>,now:Date):OccurrenceState{
 if(row.skipped_at)return 'skipped';if(row.publication_id)return 'linked';return Date.parse(row.scheduled_for)<now.getTime()?'missed':'open';
}
// Date, then local time, then platform (Facebook, Instagram, Google Business Profile).
export function sortOccurrences<T extends {date:string;time:string;platform:PublicationPlatform}>(rows:readonly T[]):T[]{
 return [...rows].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||platformOrder.indexOf(a.platform)-platformOrder.indexOf(b.platform));
}
export function buildOccurrenceEntries(rows:readonly OccurrenceRow[],publications:readonly LinkedPublication[],now:Date):OccurrenceEntry[]{
 return sortOccurrences(rows.map(r=>{const state=occurrenceState(r,now);return {key:r.id,date:r.local_date,time:r.local_time.slice(0,5),timezone:r.timezone,platform:r.platform,
  platformLabel:platformLabels[r.platform],state,stateLabel:occurrenceStateLabels[state],publication:r.publication_id?publications.find(p=>p.id===r.publication_id)??null:null,
  skippedReason:r.skipped_reason};}));
}
// Explicit admin preparation: from today (Paris) over 1, 2 or 4 weeks, inclusive.
export function preparationPeriod(today:string,weeks:number):{start:string;end:string}|null{
 if(!(PREPARE_WEEK_OPTIONS as readonly number[]).includes(weeks)||!/^\d{4}-\d{2}-\d{2}$/.test(today))return null;
 return {start:today,end:addDays(today,weeks*7-1)};
}
function plural(n:number,word:string){return `${n} ${word}${n>1?'s':''}`;}
export function ensureResultMessage(r:EnsureOccurrencesResult):string{
 const head=`${plural(r.created,'occurrence')} préparée${r.created>1?'s':''}`+(r.existing?` · ${r.existing} déjà présente${r.existing>1?'s':''}`:'')+'.';
 if(!r.dst_conflicts)return head+' Aucune publication n’est créée ni diffusée.';
 const examples=r.conflicts.slice(0,3).map(c=>`${platformLabels[c.platform]} le ${c.local_date.split('-').reverse().join('/')} à ${c.local_time}`).join(', ');
 return `${head} ${plural(r.dst_conflicts,'créneau')} non créé${r.dst_conflicts>1?'s':''} : heure inexistante lors du passage à l’heure d’été (${examples}). Ajustez l’horaire de ces créneaux si nécessaire.`;
}
export function parseEnsureResult(value:unknown):EnsureOccurrencesResult|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;const v=value as Record<string,unknown>;
 const n=(k:string)=>typeof v[k]==='number'&&Number.isInteger(v[k])&&(v[k] as number)>=0?v[k] as number:null;
 const created=n('created'),existing=n('existing'),dst=n('dst_conflicts'),channels=n('channels');
 if(created===null||existing===null||dst===null||channels===null||!Array.isArray(v.conflicts))return null;
 return {created,existing,dst_conflicts:dst,channels,conflicts:(v.conflicts as EnsureOccurrencesResult['conflicts']).filter(c=>c&&typeof c==='object'&&c.platform in platformLabels)};
}
// Overview / alerts display of an occurrence (Lot 4.3 P7): open → to prepare; linked → its publication status.
const linkedDisplay:Record<string,'draft'|'pending_review'|'approved'|'rejected'>={draft:'draft',pending_review:'pending_review',approved:'approved',rejected:'rejected'};
export function occurrenceSlotDisplay(e:Pick<OccurrenceEntry,'state'|'publication'>):'empty'|'draft'|'pending_review'|'approved'|'rejected'{
 return e.state==='linked'&&e.publication?linkedDisplay[e.publication.status]??'draft':'empty';
}
