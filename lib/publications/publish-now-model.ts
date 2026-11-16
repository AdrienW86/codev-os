import type {PublicationPlatform} from './types';

// « Rédiger et publier maintenant » (fiche client) : modèle pur, sans base ni IA.
// L'agent rédige sur des créneaux MANUELS créés quelques minutes plus tard (le temps de la génération, des
// régénérations après refus et de l'étape photo), puis le planificateur (toutes les 15 minutes) envoie.
export const PUBLISH_NOW_LEAD_MS=6*60000;
// Réseaux de posts texte + photo pris en charge par l'Agent Publications ; TikTok et Snapchat ont leurs propres
// réglages imposés et restent sur leur circuit.
export const PUBLISH_NOW_PLATFORMS:readonly PublicationPlatform[]=['facebook','instagram','google_business_profile'];
export const PUBLISH_NOW_SKIP_REASON='Publication immédiate abandonnée (contenu non rédigé)';

/** Instant des créneaux immédiats : maintenant + délai, arrondi à la minute supérieure. */
export function publishNowInstant(now:Date):Date{
 const t=now.getTime()+PUBLISH_NOW_LEAD_MS;return new Date(Math.ceil(t/60000)*60000);
}
/** Date et heure locales (AAAA-MM-JJ, HH:MM:SS) d'un instant dans un fuseau IANA ; null si le fuseau est inconnu. */
export function localParts(instant:Date,timezone:string):{date:string;time:string}|null{
 let parts:Intl.DateTimeFormatPart[];
 try{parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant);}
 catch{return null;}
 const v=(type:string)=>parts.find(p=>p.type===type)?.value??'';
 const date=`${v('year')}-${v('month')}-${v('day')}`,time=`${v('hour')}:${v('minute')}:${v('second')}`;
 return /^\d{4}-\d{2}-\d{2}$/.test(date)&&/^\d{2}:\d{2}:\d{2}$/.test(time)?{date,time}:null;
}
/** Réseaux visés : ceux du projet actifs et pris en charge, dans l'ordre habituel. */
export function publishNowPlatforms(projectPlatforms:readonly PublicationPlatform[]):PublicationPlatform[]{
 return PUBLISH_NOW_PLATFORMS.filter(p=>projectPlatforms.includes(p));
}
export function publishNowMessage(approved:number,total:number,at:Date,timezone:string,mediaMissing:boolean):string{
 const hour=localParts(at,timezone)?.time.slice(0,5)??'';
 if(mediaMissing)return `Contenu rédigé, mais aucune photo adaptée dans la photothèque : ajoutez une photo sur chaque fiche puis validez-la (envoi possible jusqu’à 2 h après ${hour}).`;
 if(approved===total)return `${total>1?`${total} publications rédigées et validées`:'Publication rédigée et validée'} : envoi prévu à ${hour}, au plus tard 15 minutes après.`;
 if(approved===0)return 'Contenu rédigé, mais la validation automatique n’a pas abouti : validez les publications depuis la file de validation.';
 return `${approved} publication${approved>1?'s':''} validée${approved>1?'s':''} sur ${total} (envoi prévu à ${hour}) ; validez les autres depuis la file de validation.`;
}
