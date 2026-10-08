// Creation of a mono-platform publication from a channel occurrence (Lot 4.3 P4-b). Pure and client-safe.
import {isPublicationUuid} from './validation';
import type {EditorialGroupView} from './editorial-group-model';
import type {PublicationPlatform} from './types';

export type GroupMode='none'|'new'|'existing';
export type CreationInput={occurrenceId:string;subject:string;text:string;cta:string|null;groupMode:GroupMode;groupId:string|null;newGroupSubject:string|null};
export type GroupChoice={id:string;subject:string;platforms:PublicationPlatform[];available:boolean};
export const SUBJECT_MAX=300,TEXT_MAX=10000,CTA_MAX=500,SKIP_REASON_MAX=500;
const control=/[\u0000-\u001f]/;

function field(form:FormData,key:string):string|null{const values=form.getAll(key);return values.length===1&&typeof values[0]==='string'?values[0]:values.length===0?'':null;}
// Strict parsing of the creation form; null when anything is invalid (the RPC validates again).
export function parseCreationForm(form:FormData):CreationInput|null{
 const occurrenceId=field(form,'occurrence_id'),subject=field(form,'subject')?.trim(),text=field(form,'text')?.trim(),cta=field(form,'cta')?.trim(),mode=field(form,'group_mode'),
  groupId=field(form,'group_id'),newGroup=field(form,'new_group_subject')?.trim();
 if(!isPublicationUuid(occurrenceId)||!subject||subject.length>SUBJECT_MAX||control.test(subject)||!text||text.length>TEXT_MAX||cta===undefined||cta===null||cta.length>CTA_MAX||control.test(cta))return null;
 if(mode!=='none'&&mode!=='new'&&mode!=='existing')return null;
 if(mode==='existing'&&!isPublicationUuid(groupId))return null;
 if(mode==='new'&&(!newGroup||newGroup.length>SUBJECT_MAX||control.test(newGroup)))return null;
 return {occurrenceId,subject,text,cta:cta||null,groupMode:mode,groupId:mode==='existing'?groupId as string:null,newGroupSubject:mode==='new'?newGroup as string:null};
}
// Existing groups of the project; a group already holding a publication on this platform cannot take another one.
export function groupChoices(groups:readonly EditorialGroupView[],platform:PublicationPlatform):GroupChoice[]{
 return groups.map(g=>{const platforms=g.sisters.map(s=>s.platform);return {id:g.groupId,subject:g.subject,platforms,available:!platforms.includes(platform)};});
}
export function validSkipReason(value:unknown):string|null{
 if(typeof value!=='string')return null;const reason=value.trim();return reason&&reason.length<=SKIP_REASON_MAX&&!control.test(reason)?reason:null;
}
export function creationErrorMessage(code:string|undefined):string{
 return code==='23505'?'Ce créneau a déjà une publication, ou ce groupe a déjà une publication sur cette plateforme.'
  :code==='23514'?'Création impossible : créneau ignoré, canal désactivé ou groupe d’un autre projet.'
  :code==='22023'?'Vérifiez le sujet, le texte et le groupe éditorial.':'Création non confirmée. Réessayez.';
}
export function skipErrorMessage(code:string|undefined):string{
 return code==='55000'?'Ce créneau est déjà ignoré.':code==='23514'?'Ce créneau a déjà une publication liée ou n’existe pas.':code==='22023'?'Indiquez un motif (500 caractères maximum).':'Action non confirmée. Réessayez.';
}
