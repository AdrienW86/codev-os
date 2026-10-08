// Agent Publications v2 (Lot 4.3 P7). Pure and client-safe types and contract.
// Flow: open occurrences → one editorial idea → one editorial group (2+ platforms) → ONE draft publication per
// occurrence / platform (shared creation logic, atomic batch) → human review. Never publishes, never submits,
// never approves, no cron.
import type {PublicationPlatform} from '../types';

export type OpenOccurrenceCandidate={occurrenceId:string;projectId:string;clientId:string;platform:PublicationPlatform;date:string;time:string;timezone:string;scheduledFor:string};
// Media sent to the generator: internal id, reliable categories and the fixed description of its stored analysis.
// Never a file name, URL, storage path, Drive id, token or credential.
export type AgentMediaCandidate={id:string;categories:string[];description:string|null;used:boolean};
// Everything the generator may receive: only facts actually stored (no fictitious fallback), no secret.
export type AgentV2GeneratorInput={client:{name:string;activity:string|null;zone:string|null};project:{name:string};services:string[];rules:string;
 channelRules:{platform:PublicationPlatform;rules:string}[];occurrences:OpenOccurrenceCandidate[];media:AgentMediaCandidate[];previousSubjects:string[]};
export type AgentV2GeneratedPublication={occurrenceId:string;platform:PublicationPlatform;text:string;cta:string|null;mediaId:string|null};
export type AgentV2GeneratorOutput={idea:{subject:string;angle:string};publications:AgentV2GeneratedPublication[]};
export type AgentV2Usage={input_tokens:number;output_tokens:number;estimated_cost_eur:number;model:string};
// The provider returns the raw structured output (validated afterwards, fail closed) and its usage.
export interface PublicationsAgentV2Generator{generate(input:AgentV2GeneratorInput):Promise<{output:unknown;usage:AgentV2Usage}>}

export const AGENT_V2_LIMITS={subject:300,angle:3000,text:10000,cta:500,maxPublicationsPerIdea:3,maxCost:.1} as const;
