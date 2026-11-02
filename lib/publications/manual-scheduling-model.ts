// Publication manuelle à tout moment (hors créneaux du planning) — logique pure, sans I/O.
// Le formulaire envoie « maintenant » ou un instant ISO (calculé par le navigateur depuis l'heure locale saisie).
// La base arrondit à la minute, refuse le passé et au-delà de 12 semaines (publication_schedule_manual).
import {isPublicationUuid} from './validation';
import {platformLabels} from './editor';
import type {PublicationPlatform} from './types';

export const MANUAL_HORIZON_DAYS=84;
const PAST_TOLERANCE_MS=5*60_000;
export type ManualScheduleInput={publicationId:string;revisionId:string;at:string;now:boolean};
/** Formulaire : champs uniques ; « at » = ISO valide, ni passé (5 min de tolérance) ni au-delà de 12 semaines. */
export function parseManualScheduleForm(form:FormData,now=new Date()):ManualScheduleInput|null{
 const one=(key:string)=>{const all=form.getAll(key);return all.length===1&&typeof all[0]==='string'?all[0]:null;};
 const publicationId=one('publication_id'),revisionId=one('revision_id'),when=one('when');
 if(!isPublicationUuid(publicationId)||!isPublicationUuid(revisionId))return null;
 if(when==='now')return {publicationId,revisionId,at:now.toISOString(),now:true};
 if(when!=='at')return null;
 const raw=one('at');if(!raw||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw))return null;
 const at=new Date(raw);if(Number.isNaN(at.getTime()))return null;
 if(at.getTime()<now.getTime()-PAST_TOLERANCE_MS||at.getTime()>now.getTime()+MANUAL_HORIZON_DAYS*86400000)return null;
 return {publicationId,revisionId,at:at.toISOString(),now:false};
}
export function manualScheduleErrorMessage(code:string|undefined,message:string|undefined):string{
 if(code==='40001')return 'Le brouillon a changé depuis l’ouverture de la page. Rechargez avant de programmer.';
 if(code==='22023'&&/past/i.test(message??''))return 'Cette date est déjà passée. Choisissez maintenant ou une date à venir.';
 if(code==='22023'&&/too far/i.test(message??''))return 'Date trop lointaine : 12 semaines maximum.';
 if(code==='22023'&&/ambiguous/i.test(message??''))return 'Heure ambiguë (changement d’heure) : choisissez une autre heure.';
 if(code==='23514'&&/channel not enabled/i.test(message??''))return 'Un réseau de ce brouillon n’est pas activé sur le projet. Activez-le dans la configuration ou retirez-le du brouillon.';
 if(code==='55000')return 'Ce brouillon est déjà planifié, archivé ou en cours de diffusion.';
 if(code==='22023')return 'Date invalide.';
 return 'Programmation non confirmée. Le brouillon n’a pas été modifié : réessayez.';
}
/** Raison pour laquelle une publication programmée n'a pas été validée d'office (elle reste à valider sur sa fiche). */
export type ManualApproval='approved'|'tiktok'|'media'|'failed';
export function manualApprovalLabel(platform:PublicationPlatform,approval:ManualApproval):string{
 const label=platformLabels[platform]??platform;
 if(approval==='approved')return `${label} : validée, part à l’heure prévue.`;
 if(approval==='tiktok')return `${label} : à valider sur sa fiche (réglages TikTok obligatoires).`;
 if(approval==='media')return `${label} : ajoutez un média sur sa fiche, puis validez.`;
 return `${label} : validation non confirmée, validez-la sur sa fiche.`;
}
/** Heure de départ lisible (fuseau de Paris), ex. « lundi 2 novembre à 21:05 ». */
export function manualScheduledLabel(iso:string,timeZone='Europe/Paris'):string{
 const d=new Date(iso);
 const day=new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',timeZone}).format(d);
 const time=new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone}).format(d);
 return `${day} à ${time}`;
}
