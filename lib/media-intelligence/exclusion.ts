// « Pourquoi écartée ? » : explication lisible des raisons pour lesquelles une photo n'est pas proposée à l'agent
// Publications. Pur et testable. L'éligibilité reprend exactement les règles de la sélection
// (isPublicationCandidate, fitsPlatforms, reusable) ; la base reste l'autorité (publications_private.agent_v2_library_available).
import {fitsPlatforms,reusable,type ReuseSettings} from '@/lib/publications/agent-v2/library-pool';
import {isPublicationCandidate,SENSITIVE_LABELS,type SensitiveKind,type Verdict} from './model';

export type ExclusionInput={
 libraryStatus:string;mediaKind:string;mimeType:string;size:number;width:number|null;height:number|null;purged:boolean;claimed:boolean;
 statusChangedBy:string|null;statusChangedAt:string|null;classificationFailures:number;classificationFailedAt:string|null;
 assessment:{verdict:Verdict;confidential:boolean;sensitive:string[];manual_verdict:'relevant'|'off_topic'|null;quality:string;quality_issues:string[];
  business_relevance:number;publishability:number;reviewed_by:string|null;reviewed_at:string|null}|null;
 uses:{used_at:string}[];reuse:ReuseSettings;now:Date;
};
export type ExclusionReason={code:string;label:string;blocking:boolean};
const IMAGE_MIMES=['image/jpeg','image/png','image/webp'],MAX_BYTES=8388608,BLOCKING_ISSUES=['blurry','screenshot','text_heavy'];
const ISSUE_LABELS:Record<string,string>={blurry:'photo floue',screenshot:'capture d’écran',text_heavy:'image surtout textuelle',dark:'photo sombre',low_resolution:'résolution faible',watermark:'filigrane',cropped:'cadrage coupé'};
const human=(by:string|null)=>typeof by==='string'&&/^user_/.test(by);
const day=(iso:string)=>new Date(iso).toLocaleDateString('fr-FR',{timeZone:'Europe/Paris'});

/** Raisons (bloquantes ou informatives) et verdict d'éligibilité pour l'agent, dans l'ordre de gravité. */
export function exclusionReasons(m:ExclusionInput):{eligible:boolean;reasons:ExclusionReason[]}{
 const reasons:ExclusionReason[]=[];const block=(code:string,label:string)=>reasons.push({code,label,blocking:true});
 const a=m.assessment,byHuman=human(m.statusChangedBy);
 // Même forme que l'historique lu par la sélection (seule la date compte pour le réemploi).
 const uses=m.uses.map(u=>({asset_id:'',publication_id:'',used_at:u.used_at}));
 if(m.purged)block('purged','Photo purgée après un rejet : seule sa référence subsiste.');
 if(m.mediaKind!=='image')block('video','Vidéo : le circuit Publications n’accepte que des photos.');
 if(m.libraryStatus==='quarantined')block('quarantined',byHuman?'Mise en quarantaine par un administrateur.':'Mise en quarantaine par l’analyse automatique (hors sujet ou confidentielle) : à vérifier.');
 if(m.libraryStatus==='rejected')block('rejected','Rejetée par un administrateur.');
 if(m.libraryStatus==='archived')block('archived','Archivée.');
 if(a?.confidential){const kinds=a.sensitive.filter((k):k is SensitiveKind=>k in SENSITIVE_LABELS).map(k=>SENSITIVE_LABELS[k].toLowerCase());
  block('confidential',`Élément confidentiel détecté${kinds.length?` (${kinds.join(', ')})`:''} : jamais proposée à l’agent, même validée.`);}
 if(a?.manual_verdict==='off_topic')block('manual_off_topic','Jugée hors sujet par un administrateur.');
 const validated=m.libraryStatus==='validated'||m.libraryStatus==='used';
 if(!validated&&['received','to_review'].includes(m.libraryStatus)){
  if(!a)block('not_assessed','Ni analysée ni validée : validez-la ou lancez l’analyse.');
  else if(a.verdict==='off_topic')block('ai_off_topic',`L’analyse la juge hors sujet (pertinence ${Math.round(a.business_relevance*100)} %).`);
  else if(a.verdict==='to_review')block('ai_to_review',`L’analyse demande un regard humain (pertinence ${Math.round(a.business_relevance*100)} %, publiable ${Math.round(a.publishability*100)} %) : validez-la si elle convient.`);
  if(a&&a.sensitive.some(s=>s==='face'||s==='minor'))block('face_or_minor','Visage ou mineur visible : une validation humaine est nécessaire.');
 }
 if(a&&(a.quality==='poor'||a.quality_issues.some(i=>BLOCKING_ISSUES.includes(i)))){
  const issues=a.quality_issues.filter(i=>BLOCKING_ISSUES.includes(i)).map(i=>ISSUE_LABELS[i]??i);
  block('quality',`Qualité insuffisante pour une publication${issues.length?` : ${issues.join(', ')}`:''}.`);
 }
 if(!IMAGE_MIMES.includes(m.mimeType)||m.size<=0||m.size>MAX_BYTES){if(m.mediaKind==='image')block('format','Format ou poids non accepté par les plateformes (JPEG, PNG ou WebP de 8 Mo au plus).');}
 else if(!fitsPlatforms({width:m.width,height:m.height}))block('dimensions','Dimensions inadaptées : 600 px minimum sur le petit côté et un rapport largeur/hauteur de 3 au plus.');
 if(m.claimed)block('claimed','Réservée par une préparation en cours de l’agent.');
 if(uses.length&&!reusable(uses,m.reuse,m.now)){
  if(!m.reuse.allowed)block('reuse_disabled','Déjà utilisée, et le réemploi des photos est désactivé pour ce client.');
  else{const last=Math.max(...m.uses.map(u=>Date.parse(u.used_at)));block('reuse_delay',`Déjà utilisée : réemploi possible à partir du ${day(new Date(last+m.reuse.afterDays*86400000).toISOString())}.`);}
 }
 if(m.classificationFailures>0)reasons.push({code:'classification_failed',blocking:false,
  label:`Analyse automatique en échec ${m.classificationFailures} fois${m.classificationFailedAt?` (dernier échec le ${day(m.classificationFailedAt)})`:''}${m.classificationFailures>=3?' : elle n’est plus relancée automatiquement.':'.'}`});
 if(a){const issues=a.quality_issues.filter(i=>!BLOCKING_ISSUES.includes(i)).map(i=>ISSUE_LABELS[i]??i);
  if(issues.length)reasons.push({code:'quality_notes',blocking:false,label:`Remarques de qualité : ${issues.join(', ')}.`});}
 // Éligibilité exacte de la sélection (mêmes fonctions que l'agent) : les raisons ci-dessus l'expliquent.
 const eligible=!m.purged&&!m.claimed&&IMAGE_MIMES.includes(m.mimeType)&&m.size>0&&m.size<=MAX_BYTES
  &&isPublicationCandidate({libraryStatus:m.libraryStatus,mediaKind:m.mediaKind,purged:m.purged,assessment:a})
  &&fitsPlatforms({width:m.width,height:m.height})&&(!a||(a.quality!=='poor'&&!a.quality_issues.some(i=>BLOCKING_ISSUES.includes(i))))&&reusable(uses,m.reuse,m.now);
 if(!eligible&&!reasons.some(r=>r.blocking))block('other','Non retenue par les règles de sélection de l’agent.');
 return {eligible,reasons:eligible?reasons.filter(r=>!r.blocking):reasons};
}
