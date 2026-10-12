// Planification d'un brouillon non planifié sur les occurrences ouvertes du calendrier (logique pure, sans I/O).
import type {PublicationPlatform} from './types';
import {isPublicationUuid} from './validation';
import {platformLabels} from './editor';

export type ScheduleAssignment={platform:PublicationPlatform;occurrence_id:string};
export type ScheduleInput={publicationId:string;revisionId:string;assignments:ScheduleAssignment[]};
export type ScheduleOccurrence={occurrenceId:string;platform:PublicationPlatform;date:string;time:string;timezone:string;scheduledFor:string};
export type ScheduledPublication={publicationId:string;platform:PublicationPlatform;occurrenceId:string};
export type ScheduleChoice={platform:PublicationPlatform;label:string;options:{id:string;label:string}[]};

/** Brouillon planifiable : ni créneau hebdomadaire, ni occurrence, ni groupe, non archivé. */
export function isUnscheduledDraft(p:{slot:number|null;occurrence_id?:string|null;editorial_group_id?:string|null;archived_at?:string|null;project_id:string|null}):boolean{
 return p.slot==null&&!p.occurrence_id&&!p.editorial_group_id&&!p.archived_at&&Boolean(p.project_id);
}
const dateLabel=(o:ScheduleOccurrence)=>`${new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}).format(new Date(`${o.date}T00:00:00Z`))} à ${o.time}`;
/** Une liste de créneaux ouverts par plateforme du brouillon, dans l'ordre chronologique. */
export function scheduleChoices(platforms:PublicationPlatform[],occurrences:ScheduleOccurrence[]):ScheduleChoice[]{
 return [...new Set(platforms)].sort().map(platform=>({platform,label:platformLabels[platform],options:occurrences.filter(o=>o.platform===platform)
  .sort((a,b)=>a.scheduledFor.localeCompare(b.scheduledFor)||a.occurrenceId.localeCompare(b.occurrenceId)).map(o=>({id:o.occurrenceId,label:dateLabel(o)}))}));
}
/** Formulaire : exactement une occurrence par plateforme attendue, aucun champ dupliqué. */
export function parseScheduleForm(form:FormData,platforms:PublicationPlatform[]):ScheduleInput|null{
 const one=(key:string)=>{const all=form.getAll(key);return all.length===1&&typeof all[0]==='string'?all[0]:null;};
 const publicationId=one('publication_id'),revisionId=one('revision_id');
 if(!isPublicationUuid(publicationId)||!isPublicationUuid(revisionId)||!platforms.length)return null;
 const assignments:ScheduleAssignment[]=[];
 for(const platform of [...new Set(platforms)].sort()){const occurrence=one(`occurrence_${platform}`);if(!isPublicationUuid(occurrence))return null;assignments.push({platform,occurrence_id:occurrence});}
 if(new Set(assignments.map(a=>a.occurrence_id)).size!==assignments.length)return null;
 return {publicationId,revisionId,assignments};
}
export function scheduleErrorMessage(code:string|undefined,message:string|undefined):string{
 if(code==='40001')return 'Le brouillon a changé depuis l’ouverture de la page. Rechargez avant de planifier.';
 if(code==='23505')return 'Ce créneau vient d’être pris par une autre publication. Choisissez-en un autre.';
 if(code==='23514'&&/past/i.test(message??''))return 'Ce créneau est déjà passé. Choisissez un créneau à venir.';
 if(code==='23514'&&/skipped/i.test(message??''))return 'Ce créneau a été ignoré. Choisissez-en un autre.';
 if(code==='23514'&&/every draft platform/i.test(message??''))return 'Choisissez un créneau pour chaque plateforme du brouillon.';
 if(code==='23514')return 'Créneau indisponible pour ce projet ou cette plateforme.';
 if(code==='55000')return 'Ce brouillon est déjà planifié, archivé ou en cours de diffusion.';
 if(code==='22023')return 'Sélection invalide : un créneau distinct par plateforme.';
 return 'Planification non confirmée. Le brouillon n’a pas été modifié : réessayez.';
}
