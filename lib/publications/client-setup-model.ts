// Socle Publications, lot 1 : réglages Publications d'un client (onglet « Publications » de la fiche client).
// Pur et utilisable côté client : aucune donnée de compte autre que des libellés, aucun secret.
export type ClientPublicationSettings={timezone:string;publishingEnabled:boolean;generationEnabled:boolean;autoPrepareEnabled:boolean;prepareLeadDays:number;
 mediaReuseAllowed:boolean;mediaReuseAfterDays:number;editorialBrief:string;requireHumanApproval:true;saved:boolean};
export const DEFAULT_CLIENT_PUBLICATION_SETTINGS:ClientPublicationSettings={timezone:'Europe/Paris',publishingEnabled:false,generationEnabled:false,autoPrepareEnabled:false,
 prepareLeadDays:3,mediaReuseAllowed:false,mediaReuseAfterDays:180,editorialBrief:'',requireHumanApproval:true,saved:false};
// Fuseaux proposés (France, DOM-TOM, voisins). Le fuseau courant reste proposé même s'il n'est pas dans la liste.
export const COMMON_TIMEZONES=['Europe/Paris','Europe/Brussels','Europe/Luxembourg','Europe/Zurich','Europe/Monaco','Europe/London','Europe/Madrid','Europe/Lisbon',
 'America/Guadeloupe','America/Martinique','America/Cayenne','Indian/Reunion','Indian/Mayotte','Pacific/Noumea','Pacific/Tahiti','America/Montreal'] as const;
// Libellés lisibles des fuseaux proposés ; un fuseau inconnu garde son nom technique (ville extraite).
export const TIMEZONE_LABELS:Record<typeof COMMON_TIMEZONES[number],string>={'Europe/Paris':'Paris (France)','Europe/Brussels':'Bruxelles (Belgique)',
 'Europe/Luxembourg':'Luxembourg','Europe/Zurich':'Zurich (Suisse)','Europe/Monaco':'Monaco','Europe/London':'Londres (Royaume-Uni)','Europe/Madrid':'Madrid (Espagne)',
 'Europe/Lisbon':'Lisbonne (Portugal)','America/Guadeloupe':'Guadeloupe','America/Martinique':'Martinique','America/Cayenne':'Cayenne (Guyane)',
 'Indian/Reunion':'La Réunion','Indian/Mayotte':'Mayotte','Pacific/Noumea':'Nouméa (Nouvelle-Calédonie)','Pacific/Tahiti':'Tahiti (Polynésie française)',
 'America/Montreal':'Montréal (Canada)'};
export function timezoneLabel(zone:string):string{
 if(zone in TIMEZONE_LABELS)return TIMEZONE_LABELS[zone as keyof typeof TIMEZONE_LABELS];
 const city=zone.split('/').at(-1)?.replace(/_/g,' ');return city?`${city} (${zone})`:zone;
}
export function timezoneOptions(current:string|null|undefined):string[]{return current&&!(COMMON_TIMEZONES as readonly string[]).includes(current)?[current,...COMMON_TIMEZONES]:[...COMMON_TIMEZONES];}
const TIMEZONE=/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/;

type Row={timezone?:unknown;publishing_enabled?:unknown;generation_enabled?:unknown;auto_prepare_enabled?:unknown;prepare_lead_days?:unknown;
 media_reuse_allowed?:unknown;media_reuse_after_days?:unknown;editorial_brief?:unknown}|null;
// Ligne absente (aucun réglage enregistré) : valeurs par défaut sûres, tout désactivé.
export function clientSettingsFromRow(row:Row):ClientPublicationSettings{
 if(!row)return DEFAULT_CLIENT_PUBLICATION_SETTINGS;
 const d=DEFAULT_CLIENT_PUBLICATION_SETTINGS,bool=(v:unknown,f:boolean)=>typeof v==='boolean'?v:f,int=(v:unknown,f:number)=>typeof v==='number'&&Number.isInteger(v)?v:f;
 return {timezone:typeof row.timezone==='string'?row.timezone:d.timezone,publishingEnabled:bool(row.publishing_enabled,false),generationEnabled:bool(row.generation_enabled,false),
  autoPrepareEnabled:bool(row.auto_prepare_enabled,false),prepareLeadDays:int(row.prepare_lead_days,d.prepareLeadDays),mediaReuseAllowed:bool(row.media_reuse_allowed,false),
  mediaReuseAfterDays:int(row.media_reuse_after_days,d.mediaReuseAfterDays),editorialBrief:typeof row.editorial_brief==='string'?row.editorial_brief:'',requireHumanApproval:true,saved:true};
}
// Formulaire → charge utile de publication_client_settings_save (clés fermées, valeurs typées). null = invalide.
export function clientSettingsPayload(form:{get(name:string):unknown}):{payload:Record<string,string|number|boolean>}|{error:string}{
 const timezone=form.get('timezone'),lead=Number(form.get('prepare_lead_days')),reuseDays=Number(form.get('media_reuse_after_days')),brief=form.get('editorial_brief');
 if(typeof timezone!=='string'||!TIMEZONE.test(timezone))return {error:'Fuseau horaire invalide.'};
 if(!Number.isInteger(lead)||lead<1||lead>14)return {error:'L’avance de préparation doit être comprise entre 1 et 14 jours.'};
 if(!Number.isInteger(reuseDays)||reuseDays<30||reuseDays>730)return {error:'Le délai de réemploi doit être compris entre 30 et 730 jours.'};
 if(typeof brief!=='string'||brief.length>10000)return {error:'Consignes éditoriales trop longues (10 000 caractères maximum).'};
 const on=(name:string)=>form.get(name)==='on';
 return {payload:{timezone,publishing_enabled:on('publishing_enabled'),generation_enabled:on('auto_prepare_enabled')||on('generation_enabled'),auto_prepare_enabled:on('auto_prepare_enabled'),
  prepare_lead_days:lead,media_reuse_allowed:on('media_reuse_allowed'),media_reuse_after_days:reuseDays,editorial_brief:brief}};
}
// Résumé lisible de l'état de la préparation automatique pour la fiche client.
export function automationSummary(s:ClientPublicationSettings,globalStop:boolean):string{
 if(!s.autoPrepareEnabled)return 'Préparation automatique suspendue : l’agent ne prépare rien seul pour ce client.';
 const base=`L’agent prépare les publications ${s.prepareLeadDays} jour${s.prepareLeadDays>1?'s':''} avant chaque créneau, puis les soumet à votre validation.`;
 return globalStop?`${base} L’arrêt général est actif : aucune diffusion n’aura lieu tant qu’il n’est pas levé.`:base;
}
