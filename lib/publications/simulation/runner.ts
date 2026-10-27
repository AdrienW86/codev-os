// Simulation du pipeline Publications (PR #44) : exécute un scénario fictif de bout en bout avec les VRAIES règles
// de l'application et des adaptateurs simulés. Ordre : analyse des photos (consignes, contexte et normalisation de la
// photothèque) → photos candidates (library-pool) → créneaux ouverts (planning hebdomadaire, sélection Agent v2) →
// rédaction (contrat de générateur Agent v2) → validation stricte (anti-invention, rotation, règles des plateformes)
// → brouillons → approbation simulée (transitions, règle « média requis ») → diffusion simulée (publiabilité du canal,
// contrat publisher, normalisation et classes d'erreur du moteur de diffusion).
// Aucune base, aucun réseau : rien n'est écrit dans les tables réelles, aucun publisher réel n'est chargé. Le moteur
// executeClaimedPublicationJob n'est volontairement pas branché (garde P10 : jamais câblé à l'application) ; sa chaîne
// de décision est rejouée à partir de ses fonctions pures, statut final identique à publication_job_complete.
import {CLASSIFICATION_VERSION,SENSITIVE_LABELS,VERDICT_LABELS,classificationContext,classificationInstructions,classificationSchema,isPublicationCandidate,normalizeAssessment,type Assessment,type SensitiveKind} from '@/lib/media-intelligence/model';
import {fitsPlatforms,libraryCandidates,reusable,type LibraryAssessment,type LibraryRow,type LibraryUse} from '../agent-v2/library-pool';
import {PLATFORM_TEXT_RULES,futureOccurrences,platformRuleViolation,selectIdeaBatch,validateGeneratorOutput} from '../agent-v2/selection';
import type {AgentV2GeneratorInput,OpenOccurrenceCandidate,PublicationsAgentV2Generator} from '../agent-v2/contract';
import {normalizeScheduleSlots,sortScheduleSlots} from '../channel-schedule-model';
import {addDays,localInstant,parisToday} from '../calendar';
import {approvalMatchesRevision,canTransitionPublication} from '../transitions';
import {channelsWithoutMedia,missingMediaMessage} from '../media-rule';
import {PUBLISHABILITY_LABELS,getChannelPublishability,providerOfPlatform} from '../connections/model';
import {DELIVERY_STATUS_LABELS,ERROR_CLASS_LABELS,MAX_DELIVERY_ATTEMPTS,canTransition,nextRetryDelaySeconds,outcomePayload,type DeliveryErrorClass,type DeliveryStatus,type PublishOutcome} from '../delivery/model';
import {outcomeOf,outcomeOfError,type PublicationPublisher} from '../delivery/publisher';
import {platformLabels} from '../editor';
import type {PublicationPlatform} from '../types';
import {getPipelineScenario,PIPELINE_SCENARIOS,type FixtureScenario} from './fixtures';
import {mockGenerator,mockVision,simulatedPublisher,type SimulationVisionCall} from './adapters';
import {OUTCOME_LABELS,SIMULATION_GUARANTEES,SIMULATION_PLATFORMS,type AiMode,type AttemptReport,type DeliveryReport,type PhotoReport,type ScenarioSummary,
 type SimulatedOutcomes,type SimulationReport,type SlotReport,type ValidationReport,type VariantReport} from './model';

export type SimulationOptions={now:Date;generator?:PublicationsAgentV2Generator;aiMode?:AiMode;vision?:SimulationVisionCall;publisher?:PublicationPublisher};
export const SIMULATION_HORIZON_DAYS=14;
export const MAX_SIMULATED_ATTEMPTS=2;
const day=86400000;

export function pipelineScenarioSummaries():ScenarioSummary[]{
 return PIPELINE_SCENARIOS.map(s=>({id:s.id,name:s.name,description:s.description,clientName:s.client.name,negative:s.negative,defaultOutcomes:{...s.defaultOutcomes}}));
}

// Mêmes messages que la préparation réelle (agent-v2/service) pour les refus du validateur.
const REFUSALS:Record<string,string>={unsupported_claim:'Refusé : affirmation absente du contexte (prix, garantie, délai, prestation non vérifiée…).',
 repetition:'Refusé : trop proche des dernières publications (sujet, prestation, formulation ou accroche).',similar_texts:'Refusé : textes presque identiques d’une plateforme à l’autre.',
 platform_rules:'Refusé : hors des règles d’une plateforme (longueur ou hashtags).',invalid_media:'Refusé : photo non autorisée (confidentielle, hors sujet, non candidate ou déjà réservée).',
 generation_failed:'Génération indisponible.'};
const refusal=(reason:string)=>REFUSALS[reason]??'Refusé : contenu généré invalide.';
const hashtags=(text:string)=>text.match(/(?<![\p{L}\p{N}&])#[\p{L}\p{N}_]+/gu)?.length??0;
const percent=(n:number)=>n.toLocaleString('fr-FR',{maximumFractionDigits:2});

// Occurrences ouvertes des 14 prochains jours à partir du planning hebdomadaire (même règle que la base : jour ISO,
// heure locale, fuseau du canal ; une heure inexistante au changement d'heure est ignorée).
export function simulatedOccurrences(scenario:FixtureScenario,now:Date,horizonDays=SIMULATION_HORIZON_DAYS):OpenOccurrenceCandidate[]{
 const today=parisToday(now),result:OpenOccurrenceCandidate[]=[];
 for(const platform of SIMULATION_PLATFORMS){
  const slots=normalizeScheduleSlots((scenario.schedule[platform]??[]).map(s=>({weekday:s.weekday,local_time:s.localTime,enabled:true})));if(!slots)continue;
  const ordered=sortScheduleSlots(slots.map(s=>({weekday:s.weekday,localTime:s.local_time})));
  for(let d=0;d<horizonDays;d++){const date=addDays(today,d),iso=new Date(`${date}T00:00:00Z`).getUTCDay()||7;
   for(const s of ordered){if(s.weekday!==iso)continue;const at=localInstant(date,s.localTime,scenario.timezone);if(!at)continue;
    result.push({occurrenceId:`sim-occ-${platform}-${date}-${s.localTime.replace(':','')}`,projectId:`sim-project-${scenario.id}`,clientId:`sim-client-${scenario.id}`,platform,date,time:s.localTime,timezone:scenario.timezone,scheduledFor:at});}}}
 return result;
}

// Motif lisible d'une photo écartée (affichage seulement : libraryCandidates reste l'autorité).
function exclusionReason(row:LibraryRow,a:Assessment,uses:readonly LibraryUse[],scenario:FixtureScenario,recent:ReadonlySet<string>,now:Date):string{
 if(a.confidential)return `Confidentielle (${a.sensitive.filter(s=>s!=='face'&&s!=='minor').map(s=>SENSITIVE_LABELS[s as SensitiveKind]).join(', ')||'information privée'}) : ne peut jamais illustrer une publication.`;
 if(['quarantined','rejected','archived'].includes(row.library_status))return 'Photo en quarantaine, rejetée ou archivée.';
 if(a.verdict==='off_topic')return 'Hors sujet pour l’activité du client.';
 if(a.sensitive.includes('face')||a.sensitive.includes('minor'))return 'Visage ou mineur identifiable : examen humain obligatoire avant tout usage.';
 if(a.quality==='poor'||a.quality_issues.some(i=>['blurry','screenshot','text_heavy'].includes(i)))return 'Qualité insuffisante (flou, capture d’écran ou image surtout textuelle).';
 if(a.verdict==='to_review'&&row.library_status!=='validated')return 'À examiner : pas encore validée par un humain.';
 if(!fitsPlatforms(row))return 'Format inadapté aux trois plateformes.';
 const own=uses.filter(u=>u.asset_id===row.id);
 if(own.some(u=>recent.has(u.publication_id)))return 'Photo d’une des dernières publications.';
 if(!reusable(own,scenario.reuse,now))return `Déjà utilisée : réemploi ${scenario.reuse.allowed?`après ${scenario.reuse.afterDays} jours`:'non autorisé'} pour ce client.`;
 return 'Écartée par les règles de la photothèque.';
}

export async function runPublicationSimulation(request:{scenarioId:string;outcomes:SimulatedOutcomes},options:SimulationOptions):Promise<SimulationReport>{
 const scenario=getPipelineScenario(request.scenarioId);if(!scenario)throw Error('Unknown simulation scenario');
 const now=options.now,iso=(daysAgo:number)=>new Date(now.getTime()-daysAgo*day).toISOString();
 const vision=options.vision??mockVision(scenario),generator=options.generator??mockGenerator(scenario);
 const publisher=options.publisher??simulatedPublisher(request.outcomes,scenario.id);
 const aiMode:AiMode=options.generator&&options.aiMode==='real'?'real':'mock';

 // 1. Analyse des photos : mêmes consignes, même contexte, même normalisation que la photothèque.
 const assessments:{photo:FixtureScenario['photos'][number];row:LibraryRow;assessment:Assessment}[]=[];
 for(const photo of scenario.photos){
  const raw=await vision(classificationInstructions,{context:classificationContext(scenario.profile,scenario.client,photo.caption),photo:photo.id,version:CLASSIFICATION_VERSION},classificationSchema);
  const assessment=normalizeAssessment(raw.value,scenario.profile.version);
  assessments.push({photo,assessment,row:{id:photo.id,library_status:photo.libraryStatus,media_kind:'image',mime_type:'image/jpeg',size:350000,width:photo.width,height:photo.height,
   purged_at:null,imported_at:iso(photo.importedDaysAgo),claimed_agent_v2_run_id:null}});}
 const libraryAssessments:LibraryAssessment[]=assessments.map(({photo,assessment:a})=>({asset_id:photo.id,verdict:a.verdict,confidential:a.confidential,sensitive:a.sensitive,manual_verdict:null,
  description:a.description,topics:a.topics,quality:a.quality,quality_issues:a.quality_issues,business_relevance:a.business_relevance,publishability:a.publishability}));
 const uses:LibraryUse[]=scenario.uses.map(u=>({asset_id:u.assetId,publication_id:u.publicationId,used_at:iso(u.usedDaysAgo)}));
 const history=scenario.history.slice(0,3),recent=new Set(history.map(h=>h.id));
 // 2. Photos candidates : la règle réelle de l'Agent v2 (publiable, format, qualité, réemploi, pas une photo récente).
 const candidates=libraryCandidates(assessments.map(a=>a.row),libraryAssessments,uses,scenario.reuse,recent,now);
 const candidateIds=new Set(candidates.map(c=>c.id));
 const photos:PhotoReport[]=assessments.map(({photo,row,assessment:a})=>({id:photo.id,label:photo.label,modelVerdict:VERDICT_LABELS[photo.vision.verdict as keyof typeof VERDICT_LABELS]??photo.vision.verdict,
  verdict:a.verdict,verdictLabel:VERDICT_LABELS[a.verdict],description:a.description,topics:a.topics,sensitive:a.sensitive.map(s=>SENSITIVE_LABELS[s]),confidential:a.confidential,
  relevance:a.business_relevance,publishability:a.publishability,quality:a.quality,overridden:a.verdict!==photo.vision.verdict||a.confidential!==photo.vision.confidential,
  candidate:candidateIds.has(photo.id)&&isPublicationCandidate({libraryStatus:row.library_status,mediaKind:'image',purged:false,assessment:{...a,manual_verdict:null}}),
  exclusion:candidateIds.has(photo.id)?null:exclusionReason(row,a,uses,scenario,recent,now)}));

 // 3. Créneaux : occurrences ouvertes du planning, puis le lot d'une idée (sélection réelle de l'Agent v2).
 const open=futureOccurrences(simulatedOccurrences(scenario,now),now),batch=selectIdeaBatch(open,now);
 const slotOf=(o:OpenOccurrenceCandidate):SlotReport=>({platform:o.platform,platformLabel:platformLabels[o.platform],date:o.date,time:o.time,timezone:o.timezone,scheduledFor:o.scheduledFor});

 // 4. Contexte de rédaction : même forme que loadAgentV2Context (faits stockés uniquement, jamais de légende).
 const services=[...new Set([...scenario.verifiedServices,...scenario.profile.services])];
 const input:AgentV2GeneratorInput={client:{name:scenario.client.name,activity:scenario.client.activity,zone:scenario.client.zone},project:{name:scenario.project.name},services,
  rules:[scenario.editorialRules,scenario.profile.communicationGuidelines].map(r=>r.trim()).filter(Boolean).join('\n'),channelRules:scenario.channelRules,occurrences:batch,media:candidates,
  previousSubjects:scenario.history.map(h=>h.subject),previousPublications:history.map(h=>({subject:h.subject,texts:h.texts,media:h.media})),priorityTopics:scenario.profile.priorityTopics};

 // 5. Rédaction et validation stricte. Un refus ne crée rien ; une relance (comme l'administrateur) est simulée une fois.
 const attempts:AttemptReport[]=[];let accepted:Extract<ReturnType<typeof validateGeneratorOutput>,{ok:true}>['value']|null=null;
 const labelOf=(id:string|null|undefined)=>id?scenario.photos.find(p=>p.id===id)?.label??'Photo inconnue':null;
 if(batch.length){
  for(let n=1;n<=MAX_SIMULATED_ATTEMPTS&&!accepted;n++){
   let raw:unknown;
   try{raw=(await generator.generate(input)).output;}catch{attempts.push({n,subject:null,mediaLabel:null,accepted:false,reason:'generation_failed',message:refusal('generation_failed')});continue;}
   const o=raw as {idea?:{subject?:unknown};publications?:{mediaId?:unknown}[]}|null;
   const subject=typeof o?.idea?.subject==='string'?o.idea.subject:null,mediaId=typeof o?.publications?.[0]?.mediaId==='string'?o.publications[0].mediaId as string:null;
   const checked=validateGeneratorOutput(input,raw);
   if(checked.ok){accepted=checked.value;attempts.push({n,subject,mediaLabel:labelOf(mediaId),accepted:true,reason:null,message:'Accepté par le validateur de l’Agent v2.'});}
   else attempts.push({n,subject,mediaLabel:labelOf(mediaId),accepted:false,reason:checked.reason,message:refusal(checked.reason)});}}

 const mediaId=accepted?.publications[0]?.mediaId??null,chosen=mediaId?candidates.find(c=>c.id===mediaId):undefined,chosenPhoto=photos.find(p=>p.id===mediaId);
 const refusedFirst=attempts.find(a=>!a.accepted);
 const reason=!batch.length?'Aucun créneau ouvert dans les 14 prochains jours : rien à préparer.'
  :!accepted?'Aucune proposition acceptée : aucun brouillon n’est créé (en réel, l’administrateur relance plus tard).'
  :chosenPhoto&&chosen?[`« ${chosenPhoto.label} » : ${chosen.used?'déjà utilisée':'jamais publiée'}, pertinence ${percent(chosenPhoto.relevance)}, publiabilité ${percent(chosenPhoto.publishability)}, parmi ${candidates.length} photo${candidates.length>1?'s':''} candidate${candidates.length>1?'s':''}.`,
    `Elle illustre le sujet « ${accepted.idea.subject} ».`,refusedFirst?`Première proposition (« ${refusedFirst.subject??'—'} ») écartée — ${refusedFirst.message}`:''].filter(Boolean).join(' ')
  :`Aucune photo publiable parmi ${scenario.photos.length} : « Photo manquante » (en réel, une notification serait créée ; ici, rien n’est écrit).${refusedFirst?` Première proposition écartée — ${refusedFirst.message}`:''}`;

 // 6. Déclinaisons par plateforme et brouillons (une révision simulée, une variante par plateforme).
 const variants:VariantReport[]=(accepted?.publications??[]).map(p=>{const rule=PLATFORM_TEXT_RULES[p.platform],occ=batch.find(b=>b.occurrenceId===p.occurrenceId);
  return {platform:p.platform,platformLabel:platformLabels[p.platform],text:p.text,cta:p.cta,length:p.text.length,maxLength:rule.maxLength,hashtags:hashtags(p.text),maxHashtags:rule.maxHashtags,
   ruleOk:platformRuleViolation(p.platform,p.text)===null,slot:occ?.scheduledFor??null};});
 const draftStatus=accepted&&canTransitionPublication('draft','pending_review')?'pending_review':accepted?'draft':'none';
 const draft={created:Boolean(accepted),status:draftStatus,message:accepted?`${variants.length} brouillon${variants.length>1?'s':''} simulé${variants.length>1?'s':''} (aucune écriture), soumis à validation humaine.`:'Aucun brouillon.'};

 // 7. Approbation simulée : transitions réelles, révision courante, règle « média requis » de chaque canal.
 const variantRefs=variants.map(v=>({id:`sim-variant-${v.platform}`,platform:v.platform}));
 const missing=accepted?channelsWithoutMedia(variantRefs,mediaId?variantRefs.map(v=>({variant_id:v.id})):[]):[];
 const approvable=Boolean(accepted)&&missing.length===0&&canTransitionPublication(draftStatus,'approved')&&approvalMatchesRevision('sim-revision-1','sim-revision-1');
 const connectionOf=(platform:PublicationPlatform)=>({provider:providerOfPlatform(platform),status:request.outcomes[platform]==='expired'?'expired':'active',hasCredential:true,expiresAt:null});
 const publishability=Object.fromEntries(variants.map(v=>[v.platform,getChannelPublishability({emergencyStop:false,publishingEnabled:true,clientPublishingEnabled:true,platform:v.platform,
  channel:{enabled:true,accountId:`sim-account-${v.platform}`},account:{status:'active',enabled:true,platform:v.platform,connectionBacked:true},connection:connectionOf(v.platform),now})])) as Record<PublicationPlatform,ReturnType<typeof getChannelPublishability>>;
 const inactive=variants.filter(v=>publishability[v.platform]!=='publishable');
 const validations:ValidationReport[]=[
  {label:'Validation humaine',state:approvable?'ok':'blocked',detail:approvable?'Obligatoire avant toute diffusion : approbation simulée ici, aucune décision réelle enregistrée.':'Obligatoire avant toute diffusion : impossible tant qu’un point bloque.'},
  {label:'Photo publiable attachée',state:accepted&&!missing.length?'ok':'blocked',detail:!accepted?'Aucun brouillon.':missing.length?missingMediaMessage(missing):`« ${chosenPhoto?.label??''} » sur chaque plateforme.`},
  {label:'Règles des plateformes',state:variants.length&&variants.every(v=>v.ruleOk)?'ok':'blocked',detail:variants.length?variants.map(v=>`${v.platformLabel} ${v.length}/${v.maxLength} caractères, ${v.hashtags}/${v.maxHashtags} hashtags`).join(' · '):'Aucune déclinaison.'},
  {label:'Aucune affirmation inventée, pas de répétition',state:accepted?'ok':'blocked',detail:accepted?'Validateur Agent v2 passé (faits vérifiés, rotation des prestations, textes natifs).':refusedFirst?.message??'Aucune proposition.'},
  {label:'Connexion et compte actifs',state:inactive.length?'blocked':'ok',detail:inactive.length?inactive.map(v=>`${v.platformLabel} : ${PUBLISHABILITY_LABELS[publishability[v.platform]]}`).join(' · '):'Comptes simulés connectés.'},
  {label:'Arrêt d’urgence et activation de la diffusion',state:'info',detail:'En réel, l’arrêt d’urgence est actif et la diffusion programmée désactivée par défaut. La simulation ne lit ni ne modifie ces réglages : elle suppose ces garde-fous levés pour montrer la suite.'}];
 const approval={possible:approvable,status:approvable?'approved':draftStatus,
  message:approvable?'Approuvée (simulation) : la publication passerait « À publier » sur son créneau.':!accepted?'Rien à approuver.':missing.length?missingMediaMessage(missing):'Approbation impossible.',validations};

 // 8. Diffusion simulée, une par plateforme : publiabilité du canal, puis UN appel au publisher simulé, puis la
 // normalisation du moteur (outcomeOf, outcomePayload) et le statut final de publication_job_complete.
 const deliveries:DeliveryReport[]=[];
 if(approvable)for(const v of variants){
  const outcome=request.outcomes[v.platform]??'success',base={platform:v.platform,platformLabel:v.platformLabel,outcome,outcomeLabel:OUTCOME_LABELS[outcome],simulated:true as const};
  const p=publishability[v.platform];
  if(p!=='publishable'){deliveries.push({...base,status:'blocked',statusLabel:DELIVERY_STATUS_LABELS.blocked,detail:`Motif : ${PUBLISHABILITY_LABELS[p]}. Aucun envoi tenté ; reconnexion du compte requise.`,nextRetry:null,publisherCalled:false});continue;}
  let result:PublishOutcome;
  try{result=outcomeOf(await publisher.publish({platform:v.platform,account:{externalAccountId:`sim-account-${v.platform}`,parentExternalId:null},text:v.text,
   media:mediaId?[{url:`simulation://photo/${mediaId}`,mimeType:'image/jpeg'}]:[],idempotencyKey:`simulation:${scenario.id}:${v.platform}`,credential:{accessToken:'simulation',refreshToken:null,expiresAt:null,scopes:[]}}));}
  catch(error){result=outcomeOfError(error);}
  try{outcomePayload(result,0);}catch{result={result:'uncertain',errorCode:'invalid_publisher_result'};}
  const {status,next}=completedStatus(result,1);
  const klass='errorCode' in result&&result.result!=='uncertain'?result.result as DeliveryErrorClass:null,code='errorCode' in result?result.errorCode:null;
  deliveries.push({...base,status,statusLabel:DELIVERY_STATUS_LABELS[status],publisherCalled:true,nextRetry:next===null?null:`Nouvelle tentative simulée dans ${next<3600?`${Math.round(next/60)} min`:`${Math.round(next/3600)} h`} (tentative 2 sur ${MAX_DELIVERY_ATTEMPTS}).`,
   detail:status==='simulated'?'Diffusion simulée : identifiant simulé, aucune publication réelle.':klass?`${ERROR_CLASS_LABELS[klass]}${code?` (${code})`:''}.`:'Résultat incertain : à vérifier.'});}

 return {scenario:{id:scenario.id,name:scenario.name,description:scenario.description,clientName:scenario.client.name,activity:scenario.client.activity,negative:scenario.negative},
  fictitious:true,aiMode,now:now.toISOString(),photos,selected:{photoId:mediaId,label:chosenPhoto?.label??null,description:chosenPhoto?.description??null,reason},
  services,priorityTopics:scenario.profile.priorityTopics,history:history.map(h=>({subject:h.subject,media:h.media})),slots:{considered:open.length,batch:batch.map(slotOf)},
  attempts,idea:accepted?.idea??null,variants,draft,approval,deliveries,guarantees:SIMULATION_GUARANTEES};
}

// Statut final d'une diffusion après une tentative : même table que publication_job_complete (P10), jamais
// « published » pour un identifiant simulé ; transition vérifiée par la table du moteur.
export function completedStatus(outcome:PublishOutcome,attempt:number):{status:DeliveryStatus;next:number|null}{
 let status:DeliveryStatus,next:number|null=null;
 if(outcome.result==='simulated')status='simulated';
 else if(outcome.result==='published')status='uncertain'; // un publisher simulé ne publie jamais réellement
 else if(outcome.result==='uncertain')status='uncertain';
 else if(outcome.result==='auth')status='blocked';
 else{next=nextRetryDelaySeconds(attempt,outcome.result,'retryAfterSeconds' in outcome?outcome.retryAfterSeconds:null);status=next===null?'failed':'retryable_error';}
 return canTransition('processing',status)?{status,next}:{status:'uncertain',next:null};
}
