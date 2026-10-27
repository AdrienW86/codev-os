// Simulation du pipeline Publications (PR #44) : adaptateurs simulés injectés à la place des fournisseurs réels.
// - modèle de vision simulé : réponse brute déterministe de la fixture (normalisée ensuite par la vraie règle) ;
// - modèle de rédaction simulé : implémente le contrat PublicationsAgentV2Generator de l'Agent v2 ;
// - publisher simulé : implémente le contrat PublicationPublisher, aucun réseau, identifiants « simulated-… ».
// Aucun accès à la base, aucun appel externe. Pur et déterministe.
import type {AgentMediaCandidate,AgentV2GeneratorInput,PublicationsAgentV2Generator} from '../agent-v2/contract';
import type {PublicationPublisher,PublishInput,PublishResult} from '../delivery/publisher';
import type {PublicationPlatform} from '../types';
import type {FixtureScenario,FixtureTemplate} from './fixtures';
import type {SimulatedOutcome} from './model';

// Même signature que l'appel vision de la photothèque (media-intelligence/service : VisionCall).
export type SimulationVisionCall=(instructions:string,input:unknown,schema:unknown)=>Promise<{value:unknown;usage:{input_tokens:number;output_tokens:number;estimated_cost_eur:number;model:string}}>;
export const MOCK_MODEL='simulation-mock';
const zero={input_tokens:0,output_tokens:0,estimated_cost_eur:0,model:MOCK_MODEL};

// L'image n'existe pas : la photo est désignée par son identifiant fictif, la réponse vient de la fixture.
export function mockVision(scenario:FixtureScenario):SimulationVisionCall&{calls:string[]}{
 const calls:string[]=[];
 const call=async(_instructions:string,input:unknown)=>{
  const id=(input as {photo?:unknown}|null)?.photo;const photo=scenario.photos.find(p=>p.id===id);
  if(!photo)throw Error('Unknown simulated photo');calls.push(photo.id);
  return {value:JSON.parse(JSON.stringify(photo.vision)) as unknown,usage:zero};};
 return Object.assign(call,{calls});
}

const plain=(text:string)=>text.toLocaleLowerCase('fr').normalize('NFD').replace(/[̀-ͯ]/g,'');
const matches=(media:AgentMediaCandidate,template:FixtureTemplate)=>{const hay=plain([media.description??'',...media.categories].join(' '));return template.keywords.some(k=>hay.includes(plain(k)));};
// Une série : au moins deux des dernières publications, toutes sur la même prestation (consigne du prompt Agent v2).
const exhausted=(input:AgentV2GeneratorInput,template:FixtureTemplate)=>{const previous=(input.previousPublications??[]).slice(0,3);
 return previous.length>=2&&previous.every(p=>template.keywords.some(k=>plain(p.subject).includes(plain(k))));};

/**
 * Modèle de rédaction simulé. Il lit uniquement l'entrée de l'Agent v2 (jamais la base) et suit ses consignes :
 * une idée, une photo commune choisie parmi les candidates, un texte natif par occurrence. Au premier appel, un
 * scénario peut lui faire commettre une erreur typique (reprendre la même prestation, choisir une photo interdite)
 * pour montrer le garde-fou ; la relance est toujours conforme.
 */
export function mockGenerator(scenario:FixtureScenario):PublicationsAgentV2Generator&{calls:number}{
 const state={calls:0};
 const write=(input:AgentV2GeneratorInput,template:FixtureTemplate,mediaId:string|null)=>({idea:{subject:template.subject,angle:template.angle},
  publications:input.occurrences.map(o=>({occurrenceId:o.occurrenceId,platform:o.platform,text:template.texts[o.platform],cta:template.cta,mediaId}))});
 return {get calls(){return state.calls;},
  async generate(input){
   state.calls++;const media=input.media.filter(m=>!m.used);
   if(state.calls===1&&scenario.firstAttempt==='pick_media'&&scenario.adversarialMediaId)return {output:write(input,scenario.templates[0]??scenario.fallback,scenario.adversarialMediaId),usage:zero};
   if(state.calls===1&&scenario.firstAttempt==='repeat_service'){
    // Erreur typique : la photo la mieux notée, sur la prestation des dernières publications.
    for(const m of media){const t=scenario.templates.find(x=>matches(m,x)&&exhausted(input,x));if(t)return {output:write(input,t,m.id),usage:zero};}}
   for(const m of media){const t=scenario.templates.find(x=>matches(m,x)&&!exhausted(input,x));if(t)return {output:write(input,t,m.id),usage:zero};}
   // Aucune photo adaptée : media_id=null (« Photo manquante »), jamais une photo inventée.
   return {output:write(input,scenario.fallback,null),usage:zero};}};
}

// Publisher simulé : le résultat est celui choisi par l'administrateur pour la plateforme. Jamais de réseau.
export function simulatedPublisher(outcomes:Partial<Record<PublicationPlatform,SimulatedOutcome>>,scenarioId:string):PublicationPublisher&{calls:PublicationPlatform[]}{
 const calls:PublicationPlatform[]=[];
 return {calls,async publish(input:PublishInput):Promise<PublishResult>{
  calls.push(input.platform);const outcome=outcomes[input.platform];
  if(outcome==='success')return {ok:true,simulated:true,remoteId:`simulated-${scenarioId}-${input.platform.replace(/_/g,'-')}`,requestId:'simulation'};
  if(outcome==='refused')return {ok:false,errorClass:'invalid_payload',errorCode:'simulated_refused'};
  if(outcome==='down')return {ok:false,errorClass:'provider_unavailable',errorCode:'simulated_http_503'};
  return {ok:false,errorClass:'auth',errorCode:'simulated_token_expired'};}};
}
