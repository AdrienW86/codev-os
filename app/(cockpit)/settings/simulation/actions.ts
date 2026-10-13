"use server";
import {requireAdmin} from "@/lib/require-admin";
import {openaiAgentV2Generator} from "@/lib/publications/agent-v2/openai-generator";
import {pipelineScenarioSummaries,runPublicationSimulation} from "@/lib/publications/simulation/runner";
import {parseSimulationForm,type SimulationRunState} from "@/lib/publications/simulation/model";

// Simulation du pipeline Publications (PR #44) : action administrateur uniquement. Aucune écriture en base, aucun
// publisher réel ; la rédaction utilise le modèle simulé, sauf option explicite « IA réelle » ET clé serveur présente
// (seule la rédaction appelle alors l'IA, sur des données fictives ; rien n'est publié).
export async function runPublicationSimulationAction(_state:SimulationRunState,form:FormData):Promise<SimulationRunState>{
 await requireAdmin();
 const request=parseSimulationForm(form,pipelineScenarioSummaries().map(s=>s.id));
 if(!request)return {error:"Scénario ou résultat de diffusion invalide."};
 if(request.realAI&&!process.env.OPENAI_API_KEY)return {error:"IA réelle indisponible : aucune clé serveur configurée. Relancez avec le modèle simulé."};
 try{
  const report=await runPublicationSimulation(request,{now:new Date(),...(request.realAI?{generator:openaiAgentV2Generator(),aiMode:"real" as const}:{})});
  return {report};
 }catch{console.error("[publications-simulation] run failed");return {error:"Simulation interrompue. Aucune donnée n’a été écrite."};}
}
