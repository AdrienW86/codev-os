// Simulation du pipeline Publications (PR #44) : types, libellés et lecture du formulaire. Pur et client-safe.
// Rapport d'un scénario fictif : photo → analyse IA → choix éditorial → déclinaisons → brouillon → approbation simulée
// → créneau → diffusion simulée. Rien n'est écrit en base, aucun appel externe, aucune publication réelle.
import type {PublicationPlatform} from '../types';

export const SIMULATION_PLATFORMS:readonly PublicationPlatform[]=['facebook','instagram','google_business_profile'];
// Résultat de diffusion choisi par l'administrateur pour chaque plateforme (toujours simulé).
export const SIMULATED_OUTCOMES=['success','refused','expired','down'] as const;
export type SimulatedOutcome=typeof SIMULATED_OUTCOMES[number];
export type SimulatedOutcomes=Record<PublicationPlatform,SimulatedOutcome>;
export const OUTCOME_LABELS:Record<SimulatedOutcome,string>={success:'Succès',refused:'Refusée par la plateforme',expired:'Connexion expirée',down:'Plateforme indisponible'};
export const FICTITIOUS_NOTICE='Clients, photos et historiques entièrement fictifs : aucune donnée réelle, aucune intervention réelle.';
export const SIMULATION_GUARANTEES=[
 'Aucune écriture en base : ni publication, ni diffusion, ni tentative, ni usage de photo, ni notification.',
 'Aucun appel aux API de publication : les publishers Facebook, Instagram et Google sont toujours simulés.',
 'Analyse des photos par un modèle simulé déterministe ; rédaction simulée sauf option explicite « IA réelle ».',
 'Les règles appliquées sont celles de l’application (photothèque, Agent v2, plateformes, diffusion) : rien n’est contourné.',
] as const;

export type ScenarioSummary={id:string;name:string;description:string;clientName:string;negative:boolean;defaultOutcomes:SimulatedOutcomes};
export type AiMode='mock'|'real';

export type PhotoReport={id:string;label:string;modelVerdict:string;verdict:string;verdictLabel:string;description:string;topics:string[];sensitive:string[];
 confidential:boolean;relevance:number;publishability:number;quality:string;overridden:boolean;candidate:boolean;exclusion:string|null};
export type SlotReport={platform:PublicationPlatform;platformLabel:string;date:string;time:string;timezone:string;scheduledFor:string};
export type AttemptReport={n:number;subject:string|null;mediaLabel:string|null;accepted:boolean;reason:string|null;message:string};
export type VariantReport={platform:PublicationPlatform;platformLabel:string;text:string;cta:string|null;length:number;maxLength:number;hashtags:number;maxHashtags:number;ruleOk:boolean;slot:string|null};
// ok : garde-fou satisfait · blocked : bloquant · info : rappel d'un garde-fou réel que la simulation ne lit ni ne modifie.
export type ValidationReport={label:string;state:'ok'|'blocked'|'info';detail:string};
export type DeliveryReport={platform:PublicationPlatform;platformLabel:string;outcome:SimulatedOutcome;outcomeLabel:string;status:string;statusLabel:string;detail:string;
 nextRetry:string|null;publisherCalled:boolean;simulated:true};
export type SimulationReport={
 scenario:{id:string;name:string;description:string;clientName:string;activity:string;negative:boolean};
 fictitious:true;aiMode:AiMode;now:string;
 photos:PhotoReport[];
 selected:{photoId:string|null;label:string|null;description:string|null;reason:string};
 services:string[];priorityTopics:string[];
 history:{subject:string;media:string|null}[];
 slots:{considered:number;batch:SlotReport[]};
 attempts:AttemptReport[];
 idea:{subject:string;angle:string}|null;
 variants:VariantReport[];
 draft:{created:boolean;status:string;message:string};
 approval:{possible:boolean;status:string;message:string;validations:ValidationReport[]};
 deliveries:DeliveryReport[];
 guarantees:readonly string[];
};

export type SimulationRunRequest={scenarioId:string;outcomes:SimulatedOutcomes;realAI:boolean};
export type SimulationRunState={report?:SimulationReport;error?:string};

const isOutcome=(v:unknown):v is SimulatedOutcome=>typeof v==='string'&&(SIMULATED_OUTCOMES as readonly string[]).includes(v);
// Formulaire → demande de simulation (clés fermées). Un résultat absent ou inconnu est refusé, jamais deviné.
export function parseSimulationForm(form:{get(name:string):unknown;getAll?(name:string):unknown[]},scenarioIds:readonly string[]):SimulationRunRequest|null{
 const scenarioId=form.get('scenario');
 if(typeof scenarioId!=='string'||!scenarioIds.includes(scenarioId))return null;
 const outcomes={} as SimulatedOutcomes;
 for(const p of SIMULATION_PLATFORMS){const v=form.get(`outcome_${p}`);if(!isOutcome(v))return null;outcomes[p]=v;}
 return {scenarioId,outcomes,realAI:form.get('real_ai')==='on'};
}
