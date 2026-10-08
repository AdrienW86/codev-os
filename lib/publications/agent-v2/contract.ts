// Agent Publications v2 — preparation only (Lot 4.3 P7-prep). Pure and client-safe types and contract.
// Target flow (not implemented yet): open occurrences → one editorial idea → optional editorial group →
// ONE draft publication per occurrence / platform (publication_create_from_occurrence) → human review.
// Never publishes, never auto-validates, no cron. The generator implementation (OpenAI) is P7 itself.
import type {PublicationPlatform} from '../types';

export type OpenOccurrenceCandidate={occurrenceId:string;projectId:string;clientId:string;platform:PublicationPlatform;date:string;time:string;timezone:string;scheduledFor:string};
export type AgentMediaCandidate={id:string;categories:string[];used:boolean};
// Everything the future generator may receive: no secret, no token, no account data, no storage path.
export type AgentV2GeneratorInput={client:{name:string;activity:string|null;zone:string|null};project:{name:string};rules:string;
 occurrences:OpenOccurrenceCandidate[];media:AgentMediaCandidate[];previousSubjects:string[]};
export type AgentV2GeneratedPublication={occurrenceId:string;platform:PublicationPlatform;text:string;cta:string|null;mediaId:string|null};
export type AgentV2GeneratorOutput={idea:{subject:string;angle:string};publications:AgentV2GeneratedPublication[]};
// The only contract P7 has to implement (a real provider or a deterministic test double).
export interface PublicationsAgentV2Generator{generate(input:AgentV2GeneratorInput):Promise<AgentV2GeneratorOutput>}

export const AGENT_V2_LIMITS={subject:300,angle:3000,text:10000,cta:500,maxPublicationsPerIdea:3} as const;
